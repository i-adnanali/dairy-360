// Animal registry -- money, and the schema that holds it (docs/REGISTRY_SALES.md).
//
// The load-bearing assertion in this file is the FACTOR OF FORTY. This farm
// prices in 40-litre lots, and every failure mode here produces a number that
// still looks like a price -- 40x too big, 40x too small, or right by accident
// on the one rate where per-litre happens to divide evenly. None of them is
// visible by looking at the output, which is why they are tested rather than
// reasoned about.

import assert from 'node:assert';
import Database from 'better-sqlite3';
import { test } from 'node:test';

import { MINOR_PER_UNIT, amountMinor, formatMinor, formatRate, perLitreMinor } from './money';
import { applyRegistrySchema } from './schema';

const RS_7000_PER_40L = 700_000; // paisa

// ---------------------------------------------------------------------------
// amountMinor -- the only rounding in the system
// ---------------------------------------------------------------------------

test('the worked example: 12.5 L at Rs 7,000 per 40 L is Rs 2,187.50', () => {
  const paisa = amountMinor(12.5, RS_7000_PER_40L, 40);
  assert.equal(paisa, 218_750);
  assert.equal(formatMinor(paisa), 'Rs 2,187.50');
});

test('a full lot costs exactly the quoted rate', () => {
  // The sanity check that catches an inverted division, which every other case
  // here would survive.
  assert.equal(amountMinor(40, RS_7000_PER_40L, 40), RS_7000_PER_40L);
  assert.equal(formatMinor(amountMinor(40, RS_7000_PER_40L, 40)), 'Rs 7,000.00');
});

test('THE LOT SIZE IS NOT OPTIONAL -- the same numbers per litre are 40x the price', () => {
  // The whole reason unitLitres has no default. Both calls are well-formed and
  // both return a plausible-looking amount.
  assert.equal(amountMinor(10, RS_7000_PER_40L, 40), 175_000); // Rs 1,750.00
  assert.equal(amountMinor(10, RS_7000_PER_40L, 1), 7_000_000); // Rs 70,000.00
});

test('an odd rupee rate does not round-trip through per-litre, which is why it is stored as quoted', () => {
  // Rs 7,001 per 40 L is 175.025 rupees a litre -- 17502.5 paisa, not a whole
  // number. Stored as (700100, 40) there is nothing to lose; normalised on
  // entry the half-paisa is gone before the first sale.
  const quoted = 700_100;
  assert.ok(!Number.isInteger(perLitreMinor(quoted, 40)), 'per-litre is fractional paisa');
  assert.equal(amountMinor(40, quoted, 40), quoted, 'a full lot is still exact');
  // And the error a normalising implementation would have made, made visible:
  const normalisedAndLossy = Math.round(perLitreMinor(quoted, 40));
  assert.notEqual(amountMinor(40, normalisedAndLossy, 1), quoted);
});

test('rounding is half-up and happens exactly once', () => {
  // 0.5 paisa lands up. Asserted because "half-up" is a claim in the comment
  // and an undocumented convention is worse than a plain one.
  assert.equal(amountMinor(1, 5, 2), 3); // 2.5 -> 3
  assert.equal(amountMinor(1, 7, 2), 4); // 3.5 -> 4
});

test('zero litres is free, and zero is a legitimate rate', () => {
  assert.equal(amountMinor(0, RS_7000_PER_40L, 40), 0);
  assert.equal(amountMinor(12.5, 0, 40), 0);
});

test('nonsense arguments throw rather than producing a plausible number', () => {
  assert.throws(() => amountMinor(-1, RS_7000_PER_40L, 40), /non-negative/);
  assert.throws(() => amountMinor(NaN, RS_7000_PER_40L, 40), /non-negative/);
  assert.throws(() => amountMinor(10, 175.5, 40), /integer of paisa/);
  assert.throws(() => amountMinor(10, -1, 40), /integer of paisa/);
  assert.throws(() => amountMinor(10, RS_7000_PER_40L, 0), /positive/);
  assert.throws(() => amountMinor(10, RS_7000_PER_40L, -40), /positive/);
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

test('formatMinor always shows two decimals, so a column can be scanned', () => {
  assert.equal(formatMinor(0), 'Rs 0.00');
  assert.equal(formatMinor(50), 'Rs 0.50');
  assert.equal(formatMinor(700_000), 'Rs 7,000.00');
  assert.equal(formatMinor(700_050), 'Rs 7,000.50');
  assert.equal(formatMinor(123_456_789), 'Rs 1,234,567.89');
});

test('a negative balance formats as one -- a buyer in credit is a real state', () => {
  assert.equal(formatMinor(-31_290), '-Rs 312.90');
});

test('formatRate shows the agreement, NOT a per-litre conversion', () => {
  // The statement line has to be arithmetic the buyer can check against his own
  // khata. Converting his rate into ours is the one edit that would stop him.
  assert.equal(formatRate(RS_7000_PER_40L, 40), 'Rs 7,000.00 / 40 L');
  assert.ok(!formatRate(RS_7000_PER_40L, 40).includes('175'));
});

test('MINOR_PER_UNIT is paisa per rupee', () => {
  assert.equal(MINOR_PER_UNIT, 100);
  assert.equal(formatMinor(MINOR_PER_UNIT), 'Rs 1.00');
});

// ---------------------------------------------------------------------------
// Migration 5 -- the constraints, exercised against a real database
// ---------------------------------------------------------------------------

function db() {
  const d = new Database(':memory:');
  applyRegistrySchema(d);
  d.prepare(
    `INSERT INTO registry_destinations
       (id,name,kind,billable,standing,contact,started_on,ended_on,note,recorded_by,recorded_at)
     VALUES ('dst_1','Bashir','dodhi',1,1,NULL,'2026-01-01',NULL,NULL,'adnan','t')`,
  ).run();
  return d;
}

const DISPATCH = `INSERT INTO registry_dispatches
   (id,destination_id,occurred_on,session,status,litres,price_minor,price_unit_litres,
    reason,occurred_time,observed_by,recorded_by,recorded_at,source_form,note)
 VALUES (@id,'dst_1','2026-02-01',@session,@status,@litres,@price_minor,@price_unit_litres,
         @reason,NULL,NULL,'adnan','t','direct_entry',NULL)`;

const dispatch = (over: Record<string, unknown> = {}) => ({
  id: 'dsp_1',
  session: 'morning',
  status: 'taken',
  litres: 12.5,
  price_minor: RS_7000_PER_40L,
  price_unit_litres: 40,
  reason: null,
  ...over,
});

test('a price is BOTH halves or neither', () => {
  // A rate with no lot size is unpriceable and a lot size with no rate is
  // meaningless. Either alone would be stored happily without this.
  const d = db();
  assert.throws(
    () => d.prepare(DISPATCH).run(dispatch({ price_unit_litres: null })),
    /a_price_is_both_halves/,
  );
  assert.throws(
    () => d.prepare(DISPATCH).run(dispatch({ price_minor: null })),
    /a_price_is_both_halves/,
  );
  d.prepare(DISPATCH).run(dispatch()); // both -> fine
  d.close();
});

test('a lot size of zero is refused -- it would divide by zero downstream', () => {
  const d = db();
  assert.throws(
    () => d.prepare(DISPATCH).run(dispatch({ price_unit_litres: 0 })),
    /price_unit_is_positive/,
  );
  d.close();
});

test('the three dispatch row states hold their own shape', () => {
  const d = db();
  // `taken` needs litres; `none` must not have them.
  assert.throws(
    () => d.prepare(DISPATCH).run(dispatch({ status: 'taken', litres: null, price_minor: null, price_unit_litres: null })),
    /taken_has_litres/,
  );
  assert.throws(
    () => d.prepare(DISPATCH).run(dispatch({ status: 'none', litres: 5, price_minor: null, price_unit_litres: null })),
    /taken_has_litres/,
  );
  // A price on a row where nothing was taken is money for no milk.
  assert.throws(
    () =>
      d
        .prepare(DISPATCH)
        .run(dispatch({ status: 'none', litres: null, price_minor: RS_7000_PER_40L })),
    /price_only_when_taken/,
  );
  // A reason belongs only to `none` -- on a `taken` row it would explain nothing.
  assert.throws(
    () => d.prepare(DISPATCH).run(dispatch({ reason: 'did not come' })),
    /reason_only_when_none/,
  );
  d.prepare(DISPATCH).run(
    dispatch({
      id: 'dsp_none',
      status: 'none',
      litres: null,
      price_minor: null,
      price_unit_litres: null,
      reason: 'did not come',
    }),
  );
  d.close();
});

test('one row per destination per session -- what makes completeness countable', () => {
  const d = db();
  d.prepare(DISPATCH).run(dispatch());
  // NOTE the message shape: SQLite names a violated CHECK but reports a UNIQUE
  // violation by COLUMNS, so the constraint name is invisible here. That is why
  // the write boundary must produce its own refusal rather than letting this
  // reach an operator.
  assert.throws(
    () => d.prepare(DISPATCH).run(dispatch({ id: 'dsp_2' })),
    /UNIQUE constraint failed: registry_dispatches\.destination_id/,
  );
  // The same destination in the OTHER session is a different row, not a clash.
  d.prepare(DISPATCH).run(dispatch({ id: 'dsp_2', session: 'evening' }));
  d.close();
});

test('home is never billable, structurally', () => {
  const d = db();
  assert.throws(
    () =>
      d
        .prepare(
          `INSERT INTO registry_destinations
             (id,name,kind,billable,standing,contact,started_on,ended_on,note,recorded_by,recorded_at)
           VALUES ('dst_home','Home','home',1,1,NULL,'2026-01-01',NULL,NULL,'adnan','t')`,
        )
        .run(),
    /home_is_never_billable/,
  );
  d.close();
});

test('a destination range runs forwards and carries a name', () => {
  const d = db();
  const insert = (over: string) =>
    d
      .prepare(
        `INSERT INTO registry_destinations
           (id,name,kind,billable,standing,contact,started_on,ended_on,note,recorded_by,recorded_at)
         VALUES ${over}`,
      )
      .run();
  assert.throws(
    () => insert(`('dst_x','Ali','household',1,0,NULL,'2026-06-01','2026-01-01',NULL,'a','t')`),
    /the_range_runs_forwards/,
  );
  assert.throws(
    () => insert(`('dst_y','   ','household',1,0,NULL,'2026-01-01',NULL,NULL,'a','t')`),
    /a_destination_is_named/,
  );
  d.close();
});

test('two prices for one destination on one date is a typo, not a price change', () => {
  const d = db();
  const price = (id: string, on: string) =>
    d
      .prepare(
        `INSERT INTO registry_destination_prices
           (id,destination_id,effective_from,price_minor,price_unit_litres,recorded_by,recorded_at,note)
         VALUES (?,'dst_1',?,700000,40,'adnan','t',NULL)`,
      )
      .run(id, on);
  price('prc_1', '2026-01-01');
  assert.throws(
    () => price('prc_2', '2026-01-01'),
    /UNIQUE constraint failed: registry_destination_prices\.destination_id/,
  );
  price('prc_3', '2026-02-01'); // a real change, a different date
  d.close();
});

test('only an adjustment may be signed, and it has to say why', () => {
  const d = db();
  const pay = (over: Record<string, unknown>) =>
    d
      .prepare(
        `INSERT INTO registry_payments
           (id,destination_id,occurred_on,amount_minor,method,reference,observed_by,recorded_by,recorded_at,note)
         VALUES (@id,'dst_1','2026-02-28',@amount_minor,@method,NULL,NULL,'adnan','t',@note)`,
      )
      .run({ id: 'pay_1', amount_minor: 100, method: 'cash', note: null, ...over });

  assert.throws(() => pay({ amount_minor: -100, method: 'cash' }), /cash_and_bank_are_positive/);
  assert.throws(() => pay({ amount_minor: 0, method: 'bank' }), /cash_and_bank_are_positive/);
  // An adjustment may be negative -- but never silent.
  assert.throws(
    () => pay({ amount_minor: -100, method: 'adjustment' }),
    /an_adjustment_explains_itself/,
  );
  assert.throws(
    () => pay({ amount_minor: -100, method: 'adjustment', note: '  ' }),
    /an_adjustment_explains_itself/,
  );
  pay({ id: 'pay_ok', amount_minor: -100, method: 'adjustment', note: 'written off, agreed' });
  d.close();
});

test('the four sales tables permit UPDATE and DELETE, unlike the event log', () => {
  // Deliberate and worth pinning: a dispatch is corrected in place and a whole
  // session entered against the wrong date is repaired by deletion. If someone
  // ever adds append-only triggers here by analogy with registry_animal_events,
  // this is what tells them it was a decision rather than an oversight.
  const d = db();
  d.prepare(DISPATCH).run(dispatch());
  d.prepare(`UPDATE registry_dispatches SET litres = 13 WHERE id = 'dsp_1'`).run();
  assert.equal(
    (d.prepare(`SELECT litres FROM registry_dispatches WHERE id='dsp_1'`).get() as { litres: number })
      .litres,
    13,
  );
  d.prepare(`DELETE FROM registry_dispatches WHERE id = 'dsp_1'`).run();
  assert.equal(
    (d.prepare(`SELECT COUNT(*) n FROM registry_dispatches`).get() as { n: number }).n,
    0,
  );
  d.close();
});
