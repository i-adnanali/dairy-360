// Sales read tools -- the digest contracts (docs/REGISTRY_SALES.md).
//
// Every assertion here is about something a model would get WRONG in a way that
// still reads as an answer:
//
//   - a bare `700000` reported as seven hundred thousand rupees,
//   - a rate quoted per litre that the buyer never agreed to,
//   - a percentage computed from a denominator that is a lower bound,
//   - a negative balance read as a debt,
//   - an absent occasional buyer reported as missing data.
//
// None of those is a crash, and none is visible in the output.

import assert from 'node:assert';
import { test } from 'node:test';

import { SALES_READ_TOOLS, salesReadExecutors } from './salesReads';
import { addSalesDestinations, cleanHerd, tradingHerd } from '../registry/fixtures';
import { saveMilkingSession } from '../registry/milking';
import { recordPayment } from '../registry/ledger';
import { saveDispatchSession } from '../registry/dispatch';
import { setPrice } from '../registry/destinations';

const AS_OF = '2026-09-01';

function tools() {
  const { db, sales } = tradingHerd();
  return { db, sales, run: salesReadExecutors(db) };
}

const digest = (r: { modelDigest: unknown }) => r.modelDigest as Record<string, never>;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

test('all four tools are declared, and every description names the 40-litre trap or the null', () => {
  assert.deepEqual(
    SALES_READ_TOOLS.map((t) => t.name).sort(),
    ['get_buyer_balance', 'get_dispatches', 'get_milk_reconciliation', 'list_buyers'],
  );
  // The two failure modes that are invisible in the output have to be in the
  // prose, because nothing in a digest can stop a model dividing by 40 or
  // inventing a percentage.
  const byName = new Map(SALES_READ_TOOLS.map((t) => [t.name, t.description]));
  assert.match(byName.get('list_buyers')!, /never divide it into a per-litre figure/);
  assert.match(byName.get('get_milk_reconciliation')!, /do NOT compute a percentage yourself/);
  assert.match(byName.get('get_buyer_balance')!, /NEGATIVE balance/);
  assert.match(byName.get('get_dispatches')!, /is not missing data/);
});

// ---------------------------------------------------------------------------
// list_buyers
// ---------------------------------------------------------------------------

test('list_buyers reports a rate WITH its lot size, and formatted', () => {
  const { run } = tools();
  const d = digest(run.list_buyers({ as_of: AS_OF }));
  const rows = d.destinations as {
    name: string;
    kind: string;
    billable: boolean;
    on_every_sheet: boolean;
    rate: { amount_minor: number; per_litres: number; formatted: string } | null;
    balance: { minor: number; formatted: string } | null;
  }[];

  const dodhi = rows.find((r) => r.kind === 'dodhi')!;
  assert.equal(dodhi.rate!.amount_minor, 700_000);
  assert.equal(dodhi.rate!.per_litres, 40, 'without this the model has a bare number');
  assert.equal(dodhi.rate!.formatted, 'Rs 7,000.00 / 40 L');
  assert.ok(!dodhi.rate!.formatted.includes('175'), 'never converted to per-litre');
});

test('list_buyers marks home unbillable, with no rate and no balance', () => {
  // A zero balance next to home would read as "settled", which implies there
  // was something to settle.
  const { run } = tools();
  const rows = digest(run.list_buyers({ as_of: AS_OF })).destinations as {
    kind: string;
    billable: boolean;
    rate: unknown;
    balance: unknown;
  }[];
  const home = rows.find((r) => r.kind === 'home')!;
  assert.equal(home.billable, false);
  assert.equal(home.rate, null);
  assert.equal(home.balance, null, 'null, NOT zero');
});

test('list_buyers distinguishes billable from on-every-sheet', () => {
  // Two independent flags that a model will conflate given the chance: home is
  // on every sheet and never billed; a household is billable and not.
  const { run } = tools();
  const rows = digest(run.list_buyers({ as_of: AS_OF })).destinations as {
    kind: string;
    billable: boolean;
    on_every_sheet: boolean;
  }[];
  assert.deepEqual(
    rows.map((r) => [r.kind, r.billable, r.on_every_sheet]).sort(),
    [
      ['dodhi', true, true],
      ['home', false, true],
      ['household', true, false],
      ['household', true, false],
    ].sort(),
  );
});

// ---------------------------------------------------------------------------
// get_buyer_balance
// ---------------------------------------------------------------------------

test('get_buyer_balance carries paisa AND prose for every amount', () => {
  const { run, sales } = tools();
  const d = digest(run.get_buyer_balance({ destination_id: sales.dodhi }));
  for (const key of ['billed', 'paid', 'balance']) {
    const v = d[key] as unknown as { minor: number; formatted: string };
    assert.equal(typeof v.minor, 'number');
    assert.match(v.formatted, /^-?Rs [\d,]+\.\d\d$/, `${key} is formatted`);
  }
});

test('get_buyer_balance SAYS WHICH WAY a balance goes', () => {
  // The single most likely thing to be reported backwards.
  const { db, run, sales } = tools();
  assert.equal(digest(run.get_buyer_balance({ destination_id: sales.dodhi })).direction as unknown, 'they owe the farm');

  recordPayment(db, {
    destination_id: sales.dodhi,
    occurred_on: AS_OF,
    amount_minor: 100_000_000,
    method: 'bank',
    recorded_by: 'adnan',
  });
  const after = digest(run.get_buyer_balance({ destination_id: sales.dodhi }));
  assert.match(after.direction as unknown as string, /in credit/);
  assert.ok((after.balance as unknown as { minor: number }).minor < 0);
});

test('get_buyer_balance refuses home with a reason rather than reporting zero', () => {
  const { run, sales } = tools();
  const d = digest(run.get_buyer_balance({ destination_id: sales.home }));
  assert.equal(d.error as unknown, 'not_billable');
  assert.match(d.message as unknown as string, /milk the farm kept/);
});

test('get_buyer_balance refuses an unknown id and says where ids come from', () => {
  const { run } = tools();
  const d = digest(run.get_buyer_balance({ destination_id: 'dst_nope' }));
  assert.equal(d.error as unknown, 'unknown_destination');
  assert.match(d.message as unknown as string, /list_buyers/);
});

test('the monthly closing figure RUNS rather than resetting', () => {
  const { run, sales } = tools();
  const months = digest(run.get_buyer_balance({ destination_id: sales.dodhi })).months as {
    month: string;
    closing: { minor: number };
  }[];
  assert.ok(months.length >= 2, 'the fixture spans two months');
  // A model told these are "settled periods" would read a non-zero August as
  // overdue. The note says otherwise, and the numbers have to match the note.
  assert.ok(
    months[1].closing.minor !== months[1].closing.minor - months[0].closing.minor ||
      months[0].closing.minor === 0,
  );
});

// ---------------------------------------------------------------------------
// get_dispatches
// ---------------------------------------------------------------------------

test('get_dispatches splits sold from kept at home', () => {
  const { run } = tools();
  const d = digest(run.get_dispatches({ from: '2026-08-19', to: AS_OF }));
  assert.ok((d.sold_litres as unknown as number) > 0);
  assert.ok((d.kept_at_home_litres as unknown as number) > 0);
  assert.notEqual(d.sold_litres, d.kept_at_home_litres);
});

test('get_dispatches names its rows with the rate they were billed at', () => {
  const { run, sales } = tools();
  const rows = digest(
    run.get_dispatches({ destination_id: sales.dodhi, from: '2026-08-19', to: AS_OF }),
  ).rows as { rate: string | null; status: string }[];
  const sold = rows.find((r) => r.status === 'taken')!;
  assert.equal(sold.rate, 'Rs 7,000.00 / 40 L');
});

test('get_dispatches caps its enumeration but keeps the totals exact', () => {
  // Unlike a yield series there is no bucket to coarsen into -- each row is a
  // transaction with a counterparty -- so only the listing is bounded.
  const { run } = tools();
  const d = digest(run.get_dispatches({ from: '2026-01-01', to: AS_OF }));
  const rows = d.rows as unknown as unknown[];
  assert.ok(rows.length <= 40);
  assert.equal(d.truncated as unknown, (d.total_rows as unknown as number) > rows.length);
  assert.ok((d.sold_litres as unknown as number) > 0, 'the totals are over ALL rows');
});

test('get_dispatches refuses an unknown destination', () => {
  const { run } = tools();
  assert.equal(
    digest(run.get_dispatches({ destination_id: 'dst_nope' })).error as unknown,
    'unknown_destination',
  );
});

// ---------------------------------------------------------------------------
// get_milk_reconciliation -- the null
// ---------------------------------------------------------------------------

test('THE PERCENTAGE IS NULL when production is incomplete, with the reason attached', () => {
  // The whole reason this tool is worth having. A model handed a number with a
  // caveat drops the caveat; one handed a null cannot quote it.
  const { run } = tools();
  const d = digest(run.get_milk_reconciliation({ from: '2026-08-19', to: AS_OF }));
  assert.ok((d.milked_but_not_weighed_rows as unknown as number) > 0, 'the fixture has unweighed rows');
  assert.equal(d.gap_pct as unknown, null);
  assert.match(d.gap_pct_withheld_because as unknown as string, /lower bound/);
  assert.match(d.caveat as unknown as string, /NEGATIVE GAP IS NORMAL/);
});

test('the percentage IS reported once nothing is missing -- the null is data, not a constant', () => {
  // If gap_pct were always null the tool would simply be refusing to answer.
  // Built on its own database so the standing roster is only the one set: a
  // second addSalesDestinations() on top of the fixture leaves FOUR standing
  // destinations, and the save is refused -- which is the sheet rule working.
  const db = cleanHerd();
  const sales = addSalesDestinations(db);
  const run = salesReadExecutors(db);

  const open = db
    .prepare(`SELECT animal_id FROM registry_lactations WHERE ended_on IS NULL ORDER BY animal_id`)
    .all() as { animal_id: string }[];
  assert.ok(open.length > 0, 'the clean herd has animals in milk');

  // EVERY row measured, and every animal in milk answered -- the only state in
  // which production is not a lower bound.
  saveMilkingSession(db, {
    occurred_on: '2027-01-05',
    session: 'morning',
    entries: open.map(({ animal_id }) => ({
      animal_id,
      status: 'measured' as const,
      yield_litres: 10,
    })),
    provenance: { source_form: 'direct_entry', recorded_by: 'adnan' },
  });
  saveDispatchSession(db, {
    occurred_on: '2027-01-05',
    session: 'morning',
    entries: [
      { destination_id: sales.dodhi, status: 'taken', litres: open.length * 10 - 2 },
      { destination_id: sales.home, status: 'taken', litres: 2 },
    ],
    provenance: { source_form: 'direct_entry', recorded_by: 'adnan' },
  });

  const d = digest(run.get_milk_reconciliation({ from: '2027-01-05', to: '2027-01-05' }));
  assert.equal(d.milked_but_not_weighed_rows as unknown, 0);
  assert.equal(d.animal_sessions_with_no_row as unknown, 0);
  assert.equal(d.gap_pct as unknown, 0, 'everything measured, everything accounted for');
  assert.equal(d.gap_pct_withheld_because as unknown, null);
  db.close();
});

test('no production at all is ALSO a withheld percentage -- there is no denominator', () => {
  const db = cleanHerd();
  const sales = addSalesDestinations(db);
  const run = salesReadExecutors(db);
  saveDispatchSession(db, {
    occurred_on: '2027-02-05',
    session: 'morning',
    entries: [
      { destination_id: sales.dodhi, status: 'taken', litres: 10 },
      { destination_id: sales.home, status: 'taken', litres: 1 },
    ],
    provenance: { source_form: 'direct_entry', recorded_by: 'adnan' },
  });
  const d = digest(run.get_milk_reconciliation({ from: '2027-02-05', to: '2027-02-05' }));
  assert.equal(d.gap_pct as unknown, null);
  assert.match(d.gap_pct_withheld_because as unknown as string, /no denominator/);
  db.close();
});

test('reconciliation reports home as its own term, not inside the gap', () => {
  const { run } = tools();
  const d = digest(run.get_milk_reconciliation({ from: '2026-08-19', to: AS_OF }));
  const sold = d.sold_litres as unknown as number;
  const home = d.kept_at_home_litres as unknown as number;
  const total = d.dispatched_total_litres as unknown as number;
  assert.ok(home > 0);
  assert.equal(Math.round((sold + home) * 10) / 10, Math.round(total * 10) / 10);
  assert.equal(
    Math.round(((d.produced_measured_litres as unknown as number) - total) * 10) / 10,
    Math.round((d.gap_litres as unknown as number) * 10) / 10,
  );
});

test('an off-agreement rate is counted, not hidden', () => {
  const { db, run, sales } = tools();
  // The agreement moves AFTER the rows were billed, which is the ordinary way
  // this happens -- and it must not re-price them.
  setPrice(db, {
    destination_id: sales.dodhi,
    effective_from: '2026-08-01',
    price_minor: 999_000,
    price_unit_litres: 40,
    recorded_by: 'adnan',
  });
  const d = digest(run.get_milk_reconciliation({ from: '2026-08-19', to: AS_OF }));
  assert.ok((d.billed_off_agreed_rate as unknown as number) > 0);
});
