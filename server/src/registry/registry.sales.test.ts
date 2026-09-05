// Animal registry -- destinations, the daily dispatch sheet and the ledger.
//
// Three claims carry this file, and each of them is a place where the design
// deliberately diverges from something that already exists in the repo:
//
//   1. A STANDING destination must be answered in every session and an
//      OCCASIONAL one must not be. Get this backwards in either direction and
//      the sheet either lies about completeness or trains people to click past
//      it (docs/REGISTRY_SALES.md §4.1a).
//   2. The price is CAPTURED WITH ITS LOT SIZE at entry time, so a later price
//      change cannot re-price history -- the defect §2 found in the demo tables.
//   3. The balance is DERIVED from rows, never stored, so partial payment and
//      credit are ordinary states rather than special cases.

import assert from 'node:assert';
import Database from 'better-sqlite3';
import { test } from 'node:test';

import {
  activeOn,
  addDestination,
  destinationList,
  getDestination,
  priceInForce,
  setPrice,
  updateDestination,
} from './destinations';
import {
  dispatchSheet,
  deleteDispatches,
  reconcile,
  saveDispatchSession,
  sessionProduction,
  previousSession,
  dispatchAmountMinor,
} from './dispatch';
import { balanceMinor, balances, recordPayment, statement } from './ledger';
import { formatMinor } from './money';
import { applyRegistrySchema } from './schema';
import { isRegistryError } from './errors';
import type { Db } from './schema';
import type { DestinationPriceRow, DestinationRow } from './types';

const PROV = { source_form: 'direct_entry' as const, recorded_by: 'adnan' };
const RS_7000_PER_40L = 700_000;
const RS_9000_PER_40L = 900_000;

/**
 * The harness farm: one dodhi and two households, plus home -- the shape the
 * farm actually reported. Names are invented, and must stay that way: real
 * buyers are entered through the screen, into dairy.db, by the farm.
 */
function farm(): { db: Db; dodhi: DestinationRow; home: DestinationRow; ali: DestinationRow; bibi: DestinationRow } {
  const db = new Database(':memory:');
  applyRegistrySchema(db);
  const dodhi = addDestination(db, {
    name: 'Bashir (dodhi)', kind: 'dodhi', standing: true,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  const home = addDestination(db, {
    name: 'Home', kind: 'home', standing: true,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  const ali = addDestination(db, {
    name: 'Ali (next door)', kind: 'household', standing: false,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  const bibi = addDestination(db, {
    name: 'Bibi (corner house)', kind: 'household', standing: false,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  setPrice(db, {
    destination_id: dodhi.id, effective_from: '2026-01-01',
    price_minor: RS_7000_PER_40L, price_unit_litres: 40, recorded_by: 'adnan',
  });
  for (const h of [ali, bibi]) {
    setPrice(db, {
      destination_id: h.id, effective_from: '2026-01-01',
      price_minor: RS_9000_PER_40L, price_unit_litres: 40, recorded_by: 'adnan',
    });
  }
  return { db, dodhi, home, ali, bibi };
}

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (isRegistryError(e)) return e.code;
    throw e;
  }
  throw new assert.AssertionError({ message: 'expected a RegistryError, nothing was thrown' });
};

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

test('home is never billable, and asking for it is refused with a reason', () => {
  const { db, home } = farm();
  assert.equal(home.billable, false);
  assert.equal(
    code(() =>
      addDestination(db, {
        name: 'Home 2', kind: 'home', billable: true, standing: true,
        started_on: '2026-01-01', recorded_by: 'adnan',
      }),
    ),
    'invalid_payload',
  );
  db.close();
});

test('a non-billable destination cannot be priced or paid', () => {
  // The structural defence: home has no price rows, so it cannot produce an
  // amount, cannot appear in a balance and cannot be invoiced.
  const { db, home } = farm();
  assert.equal(
    code(() =>
      setPrice(db, {
        destination_id: home.id, effective_from: '2026-01-01',
        price_minor: 1, price_unit_litres: 40, recorded_by: 'adnan',
      }),
    ),
    'not_billable',
  );
  assert.equal(
    code(() =>
      recordPayment(db, {
        destination_id: home.id, occurred_on: '2026-02-01',
        amount_minor: 100, method: 'cash', recorded_by: 'adnan',
      }),
    ),
    'not_billable',
  );
  db.close();
});

test('activeOn is a RANGE, and the closing day is inclusive', () => {
  const d = {
    started_on: '2026-01-01',
    ended_on: '2026-06-30',
  } as DestinationRow;
  assert.equal(activeOn(d, '2025-12-31'), false);
  assert.equal(activeOn(d, '2026-01-01'), true);
  assert.equal(activeOn(d, '2026-06-30'), true, 'the last day may still carry a delivery');
  assert.equal(activeOn(d, '2026-07-01'), false);
  assert.equal(activeOn({ ...d, ended_on: null }, '2030-01-01'), true);
});

test('a destination is amendable in place, but kind, billable and started_on are not', () => {
  const { db, ali } = farm();
  const updated = updateDestination(db, ali.id, {
    contact: '+92-300-0000000', standing: true, recorded_by: 'adnan',
  });
  assert.equal(updated.contact, '+92-300-0000000');
  assert.equal(updated.standing, true, 'a household that starts coming daily becomes standing');
  // The unamendable three are not in the patch type at all -- asserted by
  // reading the row back rather than by attempting an edit the compiler stops.
  assert.equal(updated.kind, 'household');
  assert.equal(updated.billable, true);
  assert.equal(updated.started_on, ali.started_on);
  db.close();
});

test('a closing date before the start is refused', () => {
  const { db, ali } = farm();
  assert.equal(
    code(() => updateDestination(db, ali.id, { ended_on: '2025-06-01', recorded_by: 'adnan' })),
    'invalid_payload',
  );
  db.close();
});

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

test('priceInForce is the latest agreement at or before the date', () => {
  const p = (id: string, from: string, minor: number): DestinationPriceRow => ({
    id, destination_id: 'dst_1', effective_from: from, price_minor: minor,
    price_unit_litres: 40, recorded_by: 'a', recorded_at: 't', note: null,
  });
  const prices = [p('a', '2026-01-01', 700_000), p('b', '2026-04-01', 900_000)];
  assert.equal(priceInForce(prices, '2025-12-31'), null, 'before any agreement');
  assert.equal(priceInForce(prices, '2026-01-01')?.id, 'a');
  assert.equal(priceInForce(prices, '2026-03-31')?.id, 'a');
  assert.equal(priceInForce(prices, '2026-04-01')?.id, 'b', 'effective_from is inclusive');
  assert.equal(priceInForce(prices, '2030-01-01')?.id, 'b');
});

test('A PRICE CHANGE DOES NOT RE-PRICE HISTORY -- the defect the demo tables have', () => {
  // This is the assertion the whole two-layer design exists for. `vendors`
  // holds one mutable price_per_litre, so raising it rewrites what every past
  // delivery was worth.
  const { db, dodhi } = farm();
  saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'morning',
    entries: [
      { destination_id: dodhi.id, status: 'taken', litres: 40 },
      ...home(db),
    ],
    provenance: PROV,
  });
  const before = statement(db, dodhi.id)!.billed_minor;
  assert.equal(before, RS_7000_PER_40L);

  // The rate goes up in April.
  setPrice(db, {
    destination_id: dodhi.id, effective_from: '2026-04-01',
    price_minor: RS_9000_PER_40L, price_unit_litres: 40, recorded_by: 'adnan',
  });

  assert.equal(
    statement(db, dodhi.id)!.billed_minor,
    before,
    'February is still billed at February prices',
  );
  db.close();
});

test('re-setting a price for the same date CORRECTS it and keeps one row', () => {
  const { db, dodhi } = farm();
  const corrected = setPrice(db, {
    destination_id: dodhi.id, effective_from: '2026-01-01',
    price_minor: 710_000, price_unit_litres: 40, recorded_by: 'adnan',
    note: 'typed 7000, agreed 7100',
  });
  assert.equal(corrected.price_minor, 710_000);
  const rows = db
    .prepare(`SELECT COUNT(*) n FROM registry_destination_prices WHERE destination_id = ?`)
    .get(dodhi.id) as { n: number };
  assert.equal(rows.n, 1, 'a correction is not a second agreement');
  db.close();
});

test('a lot size is required and never assumed', () => {
  const { db, dodhi } = farm();
  for (const bad of [0, -40, Number.NaN]) {
    assert.equal(
      code(() =>
        setPrice(db, {
          destination_id: dodhi.id, effective_from: '2026-05-01',
          price_minor: 700_000, price_unit_litres: bad, recorded_by: 'adnan',
        }),
      ),
      'invalid_payload',
    );
  }
  db.close();
});

// ---------------------------------------------------------------------------
// The dispatch sheet
// ---------------------------------------------------------------------------

/** Home always has to answer, so most sessions below need this. */
const home = (db: Db) => {
  const h = db.prepare(`SELECT id FROM registry_destinations WHERE kind='home'`).get() as {
    id: string;
  };
  return [{ destination_id: h.id, status: 'taken' as const, litres: 3 }];
};

test('AN UNANSWERED STANDING DESTINATION BLOCKS THE SAVE, and names itself', () => {
  const { db, dodhi } = farm();
  let message = '';
  try {
    saveDispatchSession(db, {
      occurred_on: '2026-02-01', session: 'morning',
      entries: [{ destination_id: dodhi.id, status: 'taken', litres: 40 }],
      provenance: PROV,
    });
  } catch (e) {
    if (!isRegistryError(e)) throw e;
    assert.equal(e.code, 'untouched_standing_destination');
    message = e.message;
  }
  assert.match(message, /Home/, 'the refusal names who is missing');
  assert.equal(
    (db.prepare(`SELECT COUNT(*) n FROM registry_dispatches`).get() as { n: number }).n,
    0,
    'ALL ROWS OR NONE -- the dodhi row must not have landed either',
  );
  db.close();
});

test('AN ABSENT OCCASIONAL DESTINATION IS NOT AN ERROR -- it is their normal state', () => {
  // The other half of §4.1a, and the one that would be easy to get wrong by
  // copying the milking roster wholesale.
  const { db, dodhi } = farm();
  const r = saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'morning',
    entries: [{ destination_id: dodhi.id, status: 'taken', litres: 40 }, ...home(db)],
    provenance: PROV,
  });
  assert.equal(r.written, 2, 'the two households wrote nothing and that is fine');
  db.close();
});

test('a standing destination may answer "none", which is a real recorded fact', () => {
  const { db, dodhi } = farm();
  const r = saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'evening',
    entries: [
      { destination_id: dodhi.id, status: 'none', reason: 'did not come' },
      ...home(db),
    ],
    provenance: PROV,
  });
  assert.equal(r.none, 1);
  assert.equal(r.rows.find((x) => x.destination_id === dodhi.id)!.reason, 'did not come');
  db.close();
});

test('THE PRICE AND ITS LOT SIZE ARE CAPTURED ON THE ROW', () => {
  const { db, dodhi } = farm();
  const r = saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'morning',
    entries: [{ destination_id: dodhi.id, status: 'taken', litres: 12.5 }, ...home(db)],
    provenance: PROV,
  });
  const row = r.rows.find((x) => x.destination_id === dodhi.id)!;
  assert.equal(row.price_minor, RS_7000_PER_40L);
  assert.equal(row.price_unit_litres, 40, 'without this the amount is 40x wrong');
  assert.equal(dispatchAmountMinor(row), 218_750);
  assert.equal(formatMinor(dispatchAmountMinor(row)), 'Rs 2,187.50');
  db.close();
});

test('home takes milk but is never priced', () => {
  const { db, dodhi, home: h } = farm();
  const r = saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'morning',
    entries: [
      { destination_id: dodhi.id, status: 'taken', litres: 40 },
      { destination_id: h.id, status: 'taken', litres: 3 },
    ],
    provenance: PROV,
  });
  const homeRow = r.rows.find((x) => x.destination_id === h.id)!;
  assert.equal(homeRow.litres, 3);
  assert.equal(homeRow.price_minor, null);
  assert.equal(dispatchAmountMinor(homeRow), 0);
  assert.equal(r.amount_minor, RS_7000_PER_40L, 'only the dodhi is billed');
  db.close();
});

test('a billable sale with no agreed price is REFUSED, not billed at zero', () => {
  // A free sale is a decision somebody has to have made. A silent zero is how
  // it gets made by nobody.
  const { db, dodhi } = farm();
  const late = addDestination(db, {
    name: 'New shop', kind: 'shop', standing: false,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  assert.equal(
    code(() =>
      saveDispatchSession(db, {
        occurred_on: '2026-02-01', session: 'morning',
        entries: [
          { destination_id: dodhi.id, status: 'taken', litres: 40 },
          { destination_id: late.id, status: 'taken', litres: 5 },
          ...home(db),
        ],
        provenance: PROV,
      }),
    ),
    'no_price_in_force',
  );
  db.close();
});

test('a dispatch outside the destination range is refused', () => {
  const { db, dodhi, ali } = farm();
  updateDestination(db, ali.id, { ended_on: '2026-01-31', recorded_by: 'adnan' });
  assert.equal(
    code(() =>
      saveDispatchSession(db, {
        occurred_on: '2026-02-01', session: 'morning',
        entries: [
          { destination_id: dodhi.id, status: 'taken', litres: 40 },
          { destination_id: ali.id, status: 'taken', litres: 2 },
          ...home(db),
        ],
        provenance: PROV,
      }),
    ),
    'destination_not_active',
  );
  db.close();
});

test('re-saving a session CORRECTS in place rather than duplicating', () => {
  const { db, dodhi } = farm();
  const entries = (l: number) => ({
    occurred_on: '2026-02-01', session: 'morning' as const,
    entries: [{ destination_id: dodhi.id, status: 'taken' as const, litres: l }, ...home(db)],
    provenance: PROV,
  });
  saveDispatchSession(db, entries(40));
  const second = saveDispatchSession(db, entries(38));
  assert.equal(second.updated, 2);
  assert.equal(
    (db.prepare(`SELECT COUNT(*) n FROM registry_dispatches`).get() as { n: number }).n,
    2,
  );
  assert.equal(statement(db, dodhi.id)!.litres, 38);
  db.close();
});

test('the same destination twice in one payload is refused', () => {
  const { db, dodhi } = farm();
  assert.equal(
    code(() =>
      saveDispatchSession(db, {
        occurred_on: '2026-02-01', session: 'morning',
        entries: [
          { destination_id: dodhi.id, status: 'taken', litres: 40 },
          { destination_id: dodhi.id, status: 'taken', litres: 12 },
          ...home(db),
        ],
        provenance: PROV,
      }),
    ),
    'invalid_payload',
  );
  db.close();
});

test('a whole session is deletable -- the wrong-date repair path', () => {
  const { db, dodhi } = farm();
  saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'morning',
    entries: [{ destination_id: dodhi.id, status: 'taken', litres: 40 }, ...home(db)],
    provenance: PROV,
  });
  assert.equal(deleteDispatches(db, { occurred_on: '2026-02-01', session: 'morning' }), 2);
  assert.equal(deleteDispatches(db, { occurred_on: '2026-02-01', session: 'evening' }), 0);
  db.close();
});

test('the sheet SPLITS standing from occasional and derives both', () => {
  const { db, dodhi } = farm();
  const sheet = dispatchSheet(db, { occurred_on: '2026-02-01', session: 'morning' });
  assert.deepEqual(
    sheet.standing.map((r) => r.name).sort(),
    ['Bashir (dodhi)', 'Home'],
  );
  assert.deepEqual(
    sheet.occasional.map((r) => r.name).sort(),
    ['Ali (next door)', 'Bibi (corner house)'],
  );
  assert.equal(sheet.standing.find((r) => r.name === 'Home')!.price, null);
  assert.equal(
    sheet.standing.find((r) => r.destination_id === dodhi.id)!.price!.price_minor,
    RS_7000_PER_40L,
  );
  db.close();
});

test('the sheet shows the SAME session yesterday, never this morning', () => {
  const { db, dodhi } = farm();
  saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'evening',
    entries: [{ destination_id: dodhi.id, status: 'taken', litres: 31 }, ...home(db)],
    provenance: PROV,
  });
  saveDispatchSession(db, {
    occurred_on: '2026-02-02', session: 'morning',
    entries: [{ destination_id: dodhi.id, status: 'taken', litres: 44 }, ...home(db)],
    provenance: PROV,
  });
  const sheet = dispatchSheet(db, { occurred_on: '2026-02-02', session: 'evening' });
  const row = sheet.standing.find((r) => r.destination_id === dodhi.id)!;
  assert.deepEqual(sheet.previous_session, { occurred_on: '2026-02-01', session: 'evening' });
  assert.equal(row.previous!.litres, 31, 'yesterday EVENING, not this morning');
  db.close();
});

test('previousSession crosses a month boundary correctly', () => {
  assert.deepEqual(previousSession('2026-03-01', 'morning'), {
    occurred_on: '2026-02-28',
    session: 'morning',
  });
});

test('a destination closed before the date is off the sheet entirely', () => {
  const { db, ali } = farm();
  updateDestination(db, ali.id, { ended_on: '2026-01-15', recorded_by: 'adnan' });
  const sheet = dispatchSheet(db, { occurred_on: '2026-02-01', session: 'morning' });
  assert.ok(!sheet.occasional.some((r) => r.destination_id === ali.id));
  // ...but still on a sheet from while he was buying.
  const earlier = dispatchSheet(db, { occurred_on: '2026-01-10', session: 'morning' });
  assert.ok(earlier.occasional.some((r) => r.destination_id === ali.id));
  db.close();
});

// ---------------------------------------------------------------------------
// Production, and the reason the gap is not a percentage
// ---------------------------------------------------------------------------

test('sessionProduction never sums measured with not-measured', () => {
  const milkings = [
    { animal_id: 'BD-0001', occurred_on: '2026-02-01', session: 'morning', status: 'measured', yield_litres: 10 },
    { animal_id: 'BD-0002', occurred_on: '2026-02-01', session: 'morning', status: 'milked_not_measured', yield_litres: null },
    { animal_id: 'BD-0003', occurred_on: '2026-02-01', session: 'morning', status: 'not_milked', yield_litres: null },
    { animal_id: 'BD-0001', occurred_on: '2026-02-01', session: 'evening', status: 'measured', yield_litres: 8 },
  ] as never[];
  const lactations = [
    { animal_id: 'BD-0001', started_on: '2026-01-01', ended_on: null, end_reason: null },
    { animal_id: 'BD-0002', started_on: '2026-01-01', ended_on: null, end_reason: null },
    { animal_id: 'BD-0003', started_on: '2026-01-01', ended_on: null, end_reason: null },
    { animal_id: 'BD-0004', started_on: '2026-01-01', ended_on: null, end_reason: null },
  ] as never[];

  const p = sessionProduction(milkings, lactations, '2026-02-01', 'morning');
  assert.equal(p.measured_litres, 10, 'the two unmeasured rows contribute NOTHING');
  assert.equal(p.not_measured, 1);
  assert.equal(p.not_milked, 1);
  assert.equal(p.expected, 4, 'four animals were in milk');
  assert.equal(p.recorded, 3, 'one has no row at all');
});

test('the sheet carries this session production, so the gap is visible at entry', () => {
  const { db, dodhi } = farm();
  const sheet = dispatchSheet(db, { occurred_on: '2026-02-01', session: 'morning' });
  assert.equal(sheet.produced.measured_litres, 0);
  assert.equal(sheet.produced.expected, 0, 'an empty registry -- the sales half stands alone');
  assert.ok(dodhi);
  db.close();
});

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

test('balance is billed minus paid, and partial payment is an ordinary state', () => {
  const { db, dodhi } = farm();
  for (const day of ['2026-02-01', '2026-02-02', '2026-02-03']) {
    saveDispatchSession(db, {
      occurred_on: day, session: 'morning',
      entries: [{ destination_id: dodhi.id, status: 'taken', litres: 40 }, ...home(db)],
      provenance: PROV,
    });
  }
  assert.equal(statement(db, dodhi.id)!.billed_minor, 3 * RS_7000_PER_40L);

  // He pays part of it -- against no row in particular, which the demo `paid`
  // boolean cannot express at all.
  recordPayment(db, {
    destination_id: dodhi.id, occurred_on: '2026-02-28',
    amount_minor: 1_500_000, method: 'cash', recorded_by: 'adnan',
  });
  assert.equal(statement(db, dodhi.id)!.balance_minor, 2_100_000 - 1_500_000);
  assert.equal(formatMinor(statement(db, dodhi.id)!.balance_minor), 'Rs 6,000.00');
  db.close();
});

test('paying ahead puts a buyer in credit, with no special case', () => {
  const { db, dodhi } = farm();
  recordPayment(db, {
    destination_id: dodhi.id, occurred_on: '2026-02-01',
    amount_minor: 500_000, method: 'bank', reference: 'transfer 991', recorded_by: 'adnan',
  });
  assert.equal(statement(db, dodhi.id)!.balance_minor, -500_000);
  assert.equal(formatMinor(-500_000), '-Rs 5,000.00');
  db.close();
});

test('only an adjustment may be signed, and it must say why', () => {
  const { db, dodhi } = farm();
  const pay = (over: Record<string, unknown>) =>
    recordPayment(db, {
      destination_id: dodhi.id, occurred_on: '2026-02-28',
      amount_minor: 100, method: 'cash', recorded_by: 'adnan', ...over,
    } as never);

  assert.equal(code(() => pay({ amount_minor: -100 })), 'invalid_payload');
  assert.equal(code(() => pay({ amount_minor: 0 })), 'invalid_payload');
  assert.equal(code(() => pay({ method: 'adjustment', amount_minor: -100 })), 'invalid_payload');
  assert.equal(
    code(() => pay({ method: 'adjustment', amount_minor: 0, note: 'nothing' })),
    'invalid_payload',
  );
  const ok = pay({ method: 'adjustment', amount_minor: -2_500, note: 'rounded off at settlement' });
  assert.equal(ok.amount_minor, -2_500);
  db.close();
});

test('the statement groups by month with a running closing balance', () => {
  const { db, dodhi } = farm();
  const sell = (on: string, litres: number) =>
    saveDispatchSession(db, {
      occurred_on: on, session: 'morning',
      entries: [{ destination_id: dodhi.id, status: 'taken', litres }, ...home(db)],
      provenance: PROV,
    });
  sell('2026-02-01', 40);
  sell('2026-02-02', 40);
  recordPayment(db, {
    destination_id: dodhi.id, occurred_on: '2026-02-28',
    amount_minor: RS_7000_PER_40L, method: 'cash', recorded_by: 'adnan',
  });
  sell('2026-03-01', 40);

  const s = statement(db, dodhi.id)!;
  assert.deepEqual(s.months.map((m) => m.month), ['2026-02', '2026-03']);

  const feb = s.months[0];
  assert.equal(feb.litres, 80);
  assert.equal(feb.billed_minor, 2 * RS_7000_PER_40L);
  assert.equal(feb.paid_minor, RS_7000_PER_40L);
  assert.equal(feb.closing_minor, RS_7000_PER_40L, 'one lot carried forward');

  const mar = s.months[1];
  assert.equal(mar.closing_minor, 2 * RS_7000_PER_40L, 'the balance RUNS, it does not reset');
  assert.equal(s.balance_minor, mar.closing_minor);
  db.close();
});

test('the statement shows the rate as agreed, per row, and never a per-litre one', () => {
  const { db, dodhi } = farm();
  saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'morning',
    entries: [{ destination_id: dodhi.id, status: 'taken', litres: 40 }, ...home(db)],
    provenance: PROV,
  });
  const row = statement(db, dodhi.id)!.months[0].dispatches[0];
  assert.equal(row.price_minor, RS_7000_PER_40L);
  assert.equal(row.price_unit_litres, 40);
  db.close();
});

test('balances() excludes home rather than showing it as settled', () => {
  const { db, home: h } = farm();
  const rows = balances(db);
  assert.ok(!rows.some((r) => r.destination_id === h.id), 'a zero next to home would read as settled');
  assert.equal(rows.length, 3, 'the dodhi and the two households');
  db.close();
});

test('balanceMinor is pure and takes rows, so the invariants can use it', () => {
  assert.equal(balanceMinor([], []), 0);
});

test('destinationList reports the price in force on the as-of date', () => {
  const { db, dodhi } = farm();
  setPrice(db, {
    destination_id: dodhi.id, effective_from: '2026-04-01',
    price_minor: RS_9000_PER_40L, price_unit_litres: 40, recorded_by: 'adnan',
  });
  const feb = destinationList(db, '2026-02-01').find((d) => d.id === dodhi.id)!;
  assert.equal(feb.price!.price_minor, RS_7000_PER_40L);
  const may = destinationList(db, '2026-05-01').find((d) => d.id === dodhi.id)!;
  assert.equal(may.price!.price_minor, RS_9000_PER_40L);
  db.close();
});

test('getDestination returns null for an unknown id rather than throwing', () => {
  const { db } = farm();
  assert.equal(getDestination(db, 'dst_nope'), null);
  db.close();
});

// ---------------------------------------------------------------------------
// Reconciliation -- and the percentage it refuses to compute
// ---------------------------------------------------------------------------

const DEST = (id: string, name: string, billable: boolean, standing: boolean) =>
  ({
    id, name, kind: billable ? 'dodhi' : 'home', billable, standing, contact: null,
    started_on: '2026-01-01', ended_on: null, note: null, recorded_by: 'a', recorded_at: 't',
  }) as never;

const MILK = (animal: string, status: string, litres: number | null) =>
  ({
    id: `mlk_${animal}_${status}`, animal_id: animal, occurred_on: '2026-02-01',
    session: 'morning', status, yield_litres: litres, reason: null, occurred_time: null,
    observed_by: null, recorded_by: 'a', recorded_at: 't', source_form: 'direct_entry', note: null,
  }) as never;

const LACT = (animal: string) =>
  ({ id: `lact_${animal}`, animal_id: animal, started_on: '2026-01-01', ended_on: null,
     end_reason: null }) as never;

const DISP = (id: string, dest: string, litres: number, price: number | null) =>
  ({
    id, destination_id: dest, occurred_on: '2026-02-01', session: 'morning', status: 'taken',
    litres, price_minor: price, price_unit_litres: price === null ? null : 40, reason: null,
    occurred_time: null, observed_by: null, recorded_by: 'a', recorded_at: 't',
    source_form: 'direct_entry', note: null,
  }) as never;

test('with everything measured, the gap IS a percentage', () => {
  const r = reconcile(
    [MILK('BD-0001', 'measured', 30), MILK('BD-0002', 'measured', 20)],
    [LACT('BD-0001'), LACT('BD-0002')],
    [DISP('dsp_1', 'dst_dodhi', 40, 700_000), DISP('dsp_2', 'dst_home', 5, null)],
    [DEST('dst_dodhi', 'Bashir', true, true), DEST('dst_home', 'Home', false, true)],
    [],
    '2026-02-01',
    '2026-02-01',
  );
  assert.equal(r.produced_measured, 50);
  assert.equal(r.dispatched_sold, 40);
  assert.equal(r.dispatched_home, 5, 'home use is its OWN term, not part of the gap');
  assert.equal(r.dispatched_total, 45);
  assert.equal(r.gap_litres, 5);
  assert.equal(r.gap_pct, 10);
  assert.equal(r.gap_pct_withheld_because, null);
});

test('ONE UNWEIGHED MILKING WITHHOLDS THE PERCENTAGE ENTIRELY', () => {
  // The escalation past caveat-as-a-field. A caveat can be dropped by whoever
  // quotes the number; a null cannot be quoted at all.
  const r = reconcile(
    [MILK('BD-0001', 'measured', 30), MILK('BD-0002', 'milked_not_measured', null)],
    [LACT('BD-0001'), LACT('BD-0002')],
    [DISP('dsp_1', 'dst_dodhi', 40, 700_000)],
    [DEST('dst_dodhi', 'Bashir', true, true)],
    [],
    '2026-02-01',
    '2026-02-01',
  );
  assert.equal(r.not_measured_rows, 1);
  assert.equal(r.gap_pct, null, 'production is a LOWER BOUND, so a percentage of it is false');
  assert.match(r.gap_pct_withheld_because!, /lower bound/);
  assert.equal(r.gap_litres, -10, 'and the gap is negative, which is normal, not an alarm');
});

test('an animal in milk with no row at all also withholds it', () => {
  const r = reconcile(
    [MILK('BD-0001', 'measured', 30)],
    [LACT('BD-0001'), LACT('BD-0002')], // BD-0002 was in milk and has no row
    [DISP('dsp_1', 'dst_dodhi', 40, 700_000)],
    [DEST('dst_dodhi', 'Bashir', true, true)],
    [],
    '2026-02-01',
    '2026-02-01',
  );
  assert.equal(r.expected_milking_rows, 2);
  assert.equal(r.missing_milking_rows, 1);
  assert.equal(r.gap_pct, null);
});

test('not_milked does NOT withhold the percentage -- it is a real zero, not missing data', () => {
  // The distinction REGISTRY_MILKING §4 exists for, showing up in the one place
  // it changes an answer.
  const r = reconcile(
    [MILK('BD-0001', 'measured', 30), MILK('BD-0002', 'not_milked', null)],
    [LACT('BD-0001'), LACT('BD-0002')],
    [DISP('dsp_1', 'dst_dodhi', 30, 700_000)],
    [DEST('dst_dodhi', 'Bashir', true, true)],
    [],
    '2026-02-01',
    '2026-02-01',
  );
  assert.equal(r.not_milked_rows, 1);
  assert.equal(r.gap_pct, 0, 'nothing is missing, so the number is sayable');
  assert.equal(r.gap_pct_withheld_because, null);
});

test('an off-schedule price is REPORTED, never treated as a violation', () => {
  // A deliberate discount and a stale default look identical from here, so this
  // is a list to read.
  const prices = [
    { id: 'prc_1', destination_id: 'dst_dodhi', effective_from: '2026-01-01',
      price_minor: 700_000, price_unit_litres: 40, recorded_by: 'a', recorded_at: 't', note: null },
  ];
  const r = reconcile(
    [MILK('BD-0001', 'measured', 40)],
    [LACT('BD-0001')],
    [DISP('dsp_1', 'dst_dodhi', 40, 650_000)],
    [DEST('dst_dodhi', 'Bashir', true, true)],
    prices,
    '2026-02-01',
    '2026-02-01',
  );
  assert.equal(r.off_schedule.length, 1);
  assert.deepEqual(
    { c: r.off_schedule[0].captured_minor, a: r.off_schedule[0].agreed_minor },
    { c: 650_000, a: 700_000 },
  );
});

test('session completeness counts STANDING destinations only', () => {
  const r = reconcile(
    [],
    [],
    [DISP('dsp_1', 'dst_dodhi', 40, 700_000)], // home is standing and missing
    [DEST('dst_dodhi', 'Bashir', true, true), DEST('dst_home', 'Home', false, true)],
    [],
    '2026-02-01',
    '2026-02-01',
  );
  assert.equal(r.sessions, 1);
  assert.equal(r.complete_sessions, 0);
  assert.deepEqual(r.incomplete[0], {
    occurred_on: '2026-02-01', session: 'morning',
    expected_standing: 2, recorded_standing: 1,
  });
});

test('the interpretation travels WITH the numbers, as a field', () => {
  const r = reconcile([], [], [], [], [], '2026-02-01', '2026-02-01');
  assert.match(r.interpretation, /NEGATIVE GAP IS NORMAL/);
  assert.match(r.interpretation, /unrecorded household/);
  assert.equal(r.gap_pct, null, 'no production means no denominator');
});
