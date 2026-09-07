// Animal registry -- people, engagements, packages, the run and the wage ledger.
//
// Four claims carry this file, and each is a place where the design deliberately
// diverges from something already in the repo:
//
//   1. ENGAGEMENTS ARE LOOSE AND WAGE PERIODS ARE NOT. Overlapping stints are
//      allowed because the farm asked for them; overlapping wage periods are
//      refused because that is paying twice. Get this backwards in either
//      direction and the model is either useless or dangerous
//      (docs/REGISTRY_PAYROLL.md §4.2, §4.6).
//   2. THE AGREED FIGURE IS THE TRANSACTION. Nothing is computed from the
//      calendar, so a month with leave stores what was agreed and the deviation
//      from the term is REPORTED rather than refused.
//   3. AN ADVANCE NEEDS NO MACHINERY. It is a payment; the balance goes
//      negative; the next period walks it back.
//   4. A RETURNING WORKER MUST NOT INHERIT THEIR OLD SALARY. That is the whole
//      reason terms are scoped to an engagement rather than to a person, and it
//      is the bug this design exists to make structurally impossible.

import assert from 'node:assert';
import Database from 'better-sqlite3';
import { test } from 'node:test';

import {
  addEngagement,
  addPerson,
  engagedDuring,
  engagedOn,
  engagementsFor,
  findPersonByIdentifier,
  updateEngagement,
  updatePerson,
} from './people';
import {
  deleteWagePeriods,
  packageOn,
  payrollRun,
  rangesOverlap,
  saveRun,
  setTerm,
  termInForce,
  termsFor,
} from './payroll';
import {
  recordWagePayment,
  wageBalanceMinor,
  wageBalances,
  wagePeriodsForPerson,
  wageStatement,
} from './wages';
import { addDestination } from './destinations';
import { saveDispatchSession } from './dispatch';
import { labourReport } from './invariants';
import { dayBoard, monthBounds, previousMonthBounds } from './overview';
import { snapshot } from './store';
import { AS_OF, staffedHerd } from './fixtures';
import { applyRegistrySchema } from './schema';
import { isRegistryError } from './errors';
import type { Db } from './schema';
import type { EngagementRow, PersonRow } from './types';

const PROV = { source_form: 'direct_entry' as const, recorded_by: 'adnan' };
const RS_25K = 2_500_000;
const RS_1200 = 120_000;

function fresh(): Db {
  const db = new Database(':memory:');
  applyRegistrySchema(db);
  return db;
}

/**
 * The harness farm: two salaried staff and one dihari. Names are invented and
 * must stay that way -- real people and real salaries are entered through the
 * screen, into dairy.db, by the farm. This is the rule that cuts both ways.
 */
function farm(): {
  db: Db;
  imran: PersonRow;
  abdul: PersonRow;
  rashid: PersonRow;
  imranJob: EngagementRow;
  abdulJob: EngagementRow;
  rashidJob: EngagementRow;
} {
  const db = fresh();
  const imran = addPerson(db, { identifier: 'imran', name: 'Imran', recorded_by: 'adnan' });
  const abdul = addPerson(db, { identifier: 'abdul', name: 'Abdul', recorded_by: 'adnan' });
  const rashid = addPerson(db, { identifier: 'rashid', name: 'Rashid', recorded_by: 'adnan' });

  const imranJob = addEngagement(db, {
    person_id: imran.id, kind: 'permanent', role: 'milker',
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  const abdulJob = addEngagement(db, {
    person_id: abdul.id, kind: 'permanent', role: 'general',
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  const rashidJob = addEngagement(db, {
    person_id: rashid.id, kind: 'daily',
    started_on: '2026-01-01', recorded_by: 'adnan',
  });

  setTerm(db, {
    engagement_id: imranJob.id, effective_from: '2026-01-01',
    cash_minor: RS_25K, cash_period: 'month', recorded_by: 'adnan',
    benefits: [
      { kind: 'milk', quantity: 2, unit: 'L', period: 'day' },
      { kind: 'flour', quantity: 20, unit: 'kg', period: 'month' },
      { kind: 'accommodation' },
    ],
  });
  setTerm(db, {
    engagement_id: abdulJob.id, effective_from: '2026-01-01',
    cash_minor: 2_000_000, cash_period: 'month', recorded_by: 'adnan',
  });
  setTerm(db, {
    engagement_id: rashidJob.id, effective_from: '2026-01-01',
    cash_minor: RS_1200, cash_period: 'day', recorded_by: 'adnan',
  });

  return { db, imran, abdul, rashid, imranJob, abdulJob, rashidJob };
}

function refusal(fn: () => unknown): { code: string; message: string; field?: string } {
  try {
    fn();
  } catch (e) {
    if (isRegistryError(e)) return { code: e.code, message: e.message, field: e.field };
    throw e;
  }
  throw new assert.AssertionError({ message: 'expected a RegistryError, got none' });
}

// ---------------------------------------------------------------------------
// People -- identity, and the one column that cannot move
// ---------------------------------------------------------------------------

test('a duplicate identifier is refused by name, not by a raw constraint error', () => {
  const db = fresh();
  addPerson(db, { identifier: 'imran', name: 'Imran', recorded_by: 'adnan' });
  const r = refusal(() => addPerson(db, { identifier: 'Imran', recorded_by: 'adnan' }));
  assert.equal(r.code, 'duplicate_identifier');
  assert.equal(r.field, 'identifier');
  assert.match(r.message, /already Imran/);
  assert.match(r.message, /without regard to case/);
});

test('findPersonByIdentifier matches the way history spells it', () => {
  // The lookup has to be case-insensitive or "everything Imran milked" silently
  // returns nothing for half the spellings already in the event log.
  const db = fresh();
  const p = addPerson(db, { identifier: 'imran', recorded_by: 'adnan' });
  assert.equal(findPersonByIdentifier(db, 'IMRAN')?.id, p.id);
  assert.equal(findPersonByIdentifier(db, ' Imran ')?.id, p.id);
  assert.equal(findPersonByIdentifier(db, 'imra'), null);
});

test('an identifier cannot be renamed, and the refusal says what to do instead', () => {
  const db = fresh();
  const p = addPerson(db, { identifier: 'imran', recorded_by: 'adnan' });
  const r = refusal(() => updatePerson(db, p.id, { identifier: 'imran_r' }));
  assert.equal(r.code, 'identifier_is_immutable');
  assert.match(r.message, /event log cannot/);
  assert.match(r.message, /Add 'imran_r' as a person and close this one/);
});

test('passing the SAME identifier is not an edit', () => {
  // A form that round-trips every field must not have to special-case it.
  const db = fresh();
  const p = addPerson(db, { identifier: 'imran', recorded_by: 'adnan' });
  const next = updatePerson(db, p.id, { identifier: 'IMRAN', name: 'Imran Ali' });
  assert.equal(next.identifier, 'imran');
  assert.equal(next.name, 'Imran Ali');
});

// ---------------------------------------------------------------------------
// Engagements -- loose on purpose
// ---------------------------------------------------------------------------

test('engagedOn is a RANGE TEST, and the last day counts', () => {
  const e = {
    started_on: '2026-01-01', ended_on: '2026-06-30',
  } as EngagementRow;
  assert.equal(engagedOn(e, '2025-12-31'), false);
  assert.equal(engagedOn(e, '2026-01-01'), true);
  assert.equal(engagedOn(e, '2026-06-30'), true, 'the day somebody leaves is a day they worked');
  assert.equal(engagedOn(e, '2026-07-01'), false);
  assert.equal(engagedOn({ started_on: '2026-01-01', ended_on: null } as EngagementRow, '2030-01-01'), true);
});

test('engagedDuring catches a stint that only touches the edge of the run', () => {
  const e = { started_on: '2026-09-28', ended_on: null } as EngagementRow;
  assert.equal(engagedDuring(e, '2026-09-01', '2026-09-30'), true);
  assert.equal(engagedDuring(e, '2026-08-01', '2026-08-31'), false);
  const left = { started_on: '2026-01-01', ended_on: '2026-09-03' } as EngagementRow;
  assert.equal(
    engagedDuring(left, '2026-09-01', '2026-09-30'), true,
    'somebody who left on the 3rd worked three days of that month and is owed for them',
  );
});

test('a person may hold two open stints, and that is not an error', () => {
  // The farm asked for this. If it ever starts throwing, someone has added a
  // constraint that was explicitly declined.
  const { db, imran, imranJob } = farm();
  assert.doesNotThrow(() =>
    addEngagement(db, {
      person_id: imran.id, kind: 'daily', role: 'night watchman',
      started_on: '2026-06-01', recorded_by: 'adnan',
    }),
  );
  assert.equal(engagementsFor(db, imran.id).length, 2);
  assert.ok(imranJob.ended_on === null);
});

test('an end reason without an end date is refused', () => {
  const { db, imran } = farm();
  const r = refusal(() =>
    addEngagement(db, {
      person_id: imran.id, kind: 'daily', started_on: '2026-01-01',
      end_reason: 'left for the city', recorded_by: 'adnan',
    }),
  );
  assert.equal(r.field, 'end_reason');
});

// ---------------------------------------------------------------------------
// Packages -- the agreement, effective-dated
// ---------------------------------------------------------------------------

test('termInForce picks the latest agreement at or before the date', () => {
  const { db, imranJob } = farm();
  setTerm(db, {
    engagement_id: imranJob.id, effective_from: '2026-07-01',
    cash_minor: 3_000_000, cash_period: 'month', recorded_by: 'adnan',
  });
  const terms = termsFor(db, imranJob.id);
  assert.equal(termInForce(terms, '2026-06-30')?.cash_minor, RS_25K);
  assert.equal(termInForce(terms, '2026-07-01')?.cash_minor, 3_000_000);
  assert.equal(termInForce(terms, '2025-12-31'), null, 'before the first agreement there is none');
});

test('a raise does not move what was agreed in March', () => {
  const { db, imranJob } = farm();
  setTerm(db, {
    engagement_id: imranJob.id, effective_from: '2026-07-01',
    cash_minor: 3_000_000, cash_period: 'month', recorded_by: 'adnan',
  });
  assert.equal(packageOn(db, imranJob.id, '2026-03-01').term?.cash_minor, RS_25K);
});

test('the whole package is effective-dated, benefits included', () => {
  // A raise usually moves the milk allowance too. Dating the parts separately is
  // how they drift out of step with each other.
  const { db, imranJob } = farm();
  setTerm(db, {
    engagement_id: imranJob.id, effective_from: '2026-07-01',
    cash_minor: 3_000_000, cash_period: 'month', recorded_by: 'adnan',
    benefits: [{ kind: 'milk', quantity: 3, unit: 'L', period: 'day' }],
  });
  const before = packageOn(db, imranJob.id, '2026-06-01');
  const after = packageOn(db, imranJob.id, '2026-08-01');
  assert.equal(before.benefits.find((b) => b.kind === 'milk')?.quantity, 2);
  assert.equal(after.benefits.find((b) => b.kind === 'milk')?.quantity, 3);
  assert.equal(before.benefits.length, 3, 'flour and quarters were part of the old package');
  assert.equal(after.benefits.length, 1, 'and are not part of the new one unless restated');
});

test('a benefit needs its unit and its period, and accommodation needs neither', () => {
  const { db, abdulJob } = farm();
  const bad = (b: Parameters<typeof setTerm>[1]['benefits']) =>
    refusal(() =>
      setTerm(db, {
        engagement_id: abdulJob.id, effective_from: '2027-01-01',
        cash_minor: 100, cash_period: 'month', recorded_by: 'adnan', benefits: b,
      }),
    );
  assert.match(bad([{ kind: 'flour', quantity: 20 }]).message, /both a quantity and its unit/);
  assert.match(bad([{ kind: 'flour', quantity: 20, unit: 'kg' }]).message, /per day or per month/);
  assert.match(bad([{ kind: 'other' }]).message, /has to say what it is/);
  assert.doesNotThrow(() =>
    setTerm(db, {
      engagement_id: abdulJob.id, effective_from: '2027-01-01',
      cash_minor: 100, cash_period: 'month', recorded_by: 'adnan',
      benefits: [{ kind: 'accommodation' }],
    }),
  );
});

test('a package cannot list the same benefit twice', () => {
  const { db, abdulJob } = farm();
  const r = refusal(() =>
    setTerm(db, {
      engagement_id: abdulJob.id, effective_from: '2027-01-01',
      cash_minor: 100, cash_period: 'month', recorded_by: 'adnan',
      benefits: [
        { kind: 'milk', quantity: 2, unit: 'L', period: 'day' },
        { kind: 'milk', quantity: 3, unit: 'L', period: 'day' },
      ],
    }),
  );
  assert.match(r.message, /lists milk twice/);
});

test("two 'other' lines are allowed, because the note distinguishes them", () => {
  const { db, abdulJob } = farm();
  assert.doesNotThrow(() =>
    setTerm(db, {
      engagement_id: abdulJob.id, effective_from: '2027-01-01',
      cash_minor: 100, cash_period: 'month', recorded_by: 'adnan',
      benefits: [
        { kind: 'other', note: 'electricity' },
        { kind: 'other', note: 'a plot for fodder' },
      ],
    }),
  );
});

// ---------------------------------------------------------------------------
// The bug this design exists to make impossible
// ---------------------------------------------------------------------------

test('a returning worker does NOT inherit their pre-departure salary', () => {
  // The whole reason terms hang off an engagement rather than a person. With a
  // single range on the person row, the lookup for the new stint would walk back
  // past the gap and find Rs 25,000 -- silently, months later, and looking
  // exactly like a correct answer.
  const { db, imran, imranJob } = farm();
  updateEngagement(db, imranJob.id, { ended_on: '2026-06-30', end_reason: 'went home' });

  const second = addEngagement(db, {
    person_id: imran.id, kind: 'permanent', started_on: '2027-01-01', recorded_by: 'adnan',
  });

  assert.equal(
    termInForce(termsFor(db, second.id), '2027-01-15'), null,
    'the new stint has no agreement until one is recorded FOR IT',
  );
  assert.equal(
    termInForce(termsFor(db, imranJob.id), '2027-01-15')?.cash_minor, RS_25K,
    'while the old stint still knows what it was',
  );

  const r = refusal(() =>
    saveRun(db, {
      from_on: '2027-01-01', to_on: '2027-01-31',
      entries: [{ engagement_id: second.id, amount_minor: RS_25K }],
      provenance: PROV,
    }),
  );
  assert.equal(r.code, 'no_term_in_force');
  assert.match(r.message, /imran has no package agreement covering 2027-01-01/);
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

test('every permanent engagement must be answered; dihari must not', () => {
  const { db, imranJob, abdulJob } = farm();
  const r = refusal(() =>
    saveRun(db, {
      from_on: '2026-09-01', to_on: '2026-09-30',
      entries: [{ engagement_id: imranJob.id, amount_minor: RS_25K }],
      provenance: PROV,
    }),
  );
  assert.equal(r.code, 'untouched_permanent_engagement');
  assert.match(r.message, /abdul is on the payroll/);
  assert.match(r.message, /an omission is not an answer/);

  // With both answered and NOTHING for the dihari, it saves -- most months
  // nobody was hired, and absence is their normal state.
  assert.doesNotThrow(() =>
    saveRun(db, {
      from_on: '2026-09-01', to_on: '2026-09-30',
      entries: [
        { engagement_id: imranJob.id, amount_minor: RS_25K },
        { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
      ],
      provenance: PROV,
    }),
  );
});

test('one run holds a salaried month and a one-day dihari, in one table', () => {
  const { db, imranJob, abdulJob, rashidJob, rashid } = farm();
  const result = saveRun(db, {
    from_on: '2026-09-01', to_on: '2026-09-30',
    entries: [
      { engagement_id: imranJob.id, amount_minor: RS_25K },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
      { engagement_id: rashidJob.id, from_on: '2026-09-14', amount_minor: RS_1200 },
    ],
    provenance: PROV,
  });
  assert.equal(result.written, 3);
  assert.equal(result.total_minor, RS_25K + 2_000_000 + RS_1200);

  const dihari = wagePeriodsForPerson(db, rashid.id);
  assert.equal(dihari.length, 1);
  assert.deepEqual(
    { from: dihari[0].from_on, to: dihari[0].to_on },
    { from: '2026-09-14', to: '2026-09-14' },
    'a dihari day given one date becomes a period of one day, not the whole month',
  );
});

test('a month with leave stores what was AGREED, and nothing is computed', () => {
  // The design refuses to prorate. If this ever starts returning 21,667 then
  // something has started computing a salary from the calendar.
  const { db, imranJob, abdulJob } = farm();
  saveRun(db, {
    from_on: '2026-09-01', to_on: '2026-09-30',
    entries: [
      { engagement_id: imranJob.id, amount_minor: 2_200_000, note: 'four days leave' },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
    ],
    provenance: PROV,
  });
  const run = payrollRun(db, '2026-09-01', '2026-09-30');
  const imranRow = run.permanent.find((r) => r.person.identifier === 'imran');
  assert.equal(imranRow?.existing?.amount_minor, 2_200_000);
  assert.equal(imranRow?.suggested_minor, RS_25K, 'the term is still only the default');
});

test('overlapping wage periods are refused -- the one hard rule', () => {
  const { db, imranJob, abdulJob } = farm();
  saveRun(db, {
    from_on: '2026-09-01', to_on: '2026-09-30',
    entries: [
      { engagement_id: imranJob.id, amount_minor: RS_25K },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
    ],
    provenance: PROV,
  });
  const r = refusal(() =>
    saveRun(db, {
      from_on: '2026-09-15', to_on: '2026-10-15',
      entries: [
        { engagement_id: imranJob.id, amount_minor: RS_25K },
        { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
      ],
      provenance: PROV,
    }),
  );
  assert.equal(r.code, 'overlapping_wage_period');
  assert.match(r.message, /paying twice for the same days/);
});

test('rangesOverlap is inclusive at both ends', () => {
  const a = { from_on: '2026-09-01', to_on: '2026-09-30' };
  assert.equal(rangesOverlap(a, { from_on: '2026-09-30', to_on: '2026-10-05' }), true);
  assert.equal(rangesOverlap(a, { from_on: '2026-10-01', to_on: '2026-10-05' }), false);
  assert.equal(rangesOverlap(a, { from_on: '2026-08-01', to_on: '2026-08-31' }), false);
});

test('re-saving the same period UPDATES rather than duplicating', () => {
  const { db, imranJob, abdulJob } = farm();
  const entries = (amount: number) => [
    { engagement_id: imranJob.id, amount_minor: amount },
    { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
  ];
  saveRun(db, { from_on: '2026-09-01', to_on: '2026-09-30', entries: entries(RS_25K), provenance: PROV });
  const second = saveRun(db, {
    from_on: '2026-09-01', to_on: '2026-09-30', entries: entries(2_400_000), provenance: PROV,
  });
  assert.equal(second.updated, 2);
  const run = payrollRun(db, '2026-09-01', '2026-09-30');
  assert.equal(run.permanent.length, 2);
  assert.equal(
    run.permanent.find((r) => r.person.identifier === 'imran')?.existing?.amount_minor,
    2_400_000,
  );
});

test('a bonus needs no agreement behind it', () => {
  // A bonus is a decision rather than a rate. Demanding a term for one would
  // refuse the commonest reason a bonus exists.
  const { db, rashidJob } = farm();
  const solo = fresh();
  const p = addPerson(solo, { identifier: 'nawaz', recorded_by: 'adnan' });
  const e = addEngagement(solo, {
    person_id: p.id, kind: 'daily', started_on: '2026-01-01', recorded_by: 'adnan',
  });
  assert.doesNotThrow(() =>
    saveRun(solo, {
      from_on: '2026-09-01', to_on: '2026-09-30',
      entries: [{ engagement_id: e.id, kind: 'bonus', from_on: '2026-09-20', amount_minor: 500_000 }],
      provenance: PROV,
    }),
  );
  assert.ok(rashidJob.id);
});

test('a run entered against the wrong month is repaired by delete and re-entry', () => {
  const { db, imranJob, abdulJob } = farm();
  const saved = saveRun(db, {
    from_on: '2026-08-01', to_on: '2026-08-31',
    entries: [
      { engagement_id: imranJob.id, amount_minor: RS_25K },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
    ],
    provenance: PROV,
  });
  assert.equal(deleteWagePeriods(db, saved.rows.map((r) => r.id)), 2);
  assert.equal(payrollRun(db, '2026-08-01', '2026-08-31').answered, 0);
});

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

test('the balance is earned minus paid, across ALL of a person\'s stints', () => {
  const { db, imran, imranJob } = farm();
  updateEngagement(db, imranJob.id, { ended_on: '2026-06-30', end_reason: 'went home' });
  const second = addEngagement(db, {
    person_id: imran.id, kind: 'permanent', started_on: '2027-01-01', recorded_by: 'adnan',
  });
  setTerm(db, {
    engagement_id: second.id, effective_from: '2027-01-01',
    cash_minor: 3_000_000, cash_period: 'month', recorded_by: 'adnan',
  });

  const db2 = db;
  db2.prepare(
    `INSERT INTO registry_wage_periods
       (id,engagement_id,kind,from_on,to_on,amount_minor,recorded_by,recorded_at,source_form)
     VALUES ('w1',?, 'wage','2026-06-01','2026-06-30',?,'adnan','t','direct_entry')`,
  ).run(imranJob.id, RS_25K);
  db2.prepare(
    `INSERT INTO registry_wage_periods
       (id,engagement_id,kind,from_on,to_on,amount_minor,recorded_by,recorded_at,source_form)
     VALUES ('w2',?, 'wage','2027-01-01','2027-01-31',?,'adnan','t','direct_entry')`,
  ).run(second.id, 3_000_000);

  recordWagePayment(db, {
    person_id: imran.id, occurred_on: '2026-07-05', amount_minor: RS_25K,
    method: 'cash', recorded_by: 'adnan',
  });

  const st = wageStatement(db, imran.id);
  assert.equal(st?.earned_minor, RS_25K + 3_000_000, 'both stints count towards one balance');
  assert.equal(st?.paid_minor, RS_25K);
  assert.equal(st?.balance_minor, 3_000_000);
  assert.equal(st?.engagements.length, 2);
});

test('an advance makes the balance negative, and the next period walks it back', () => {
  const { db, imran, imranJob, abdulJob } = farm();
  recordWagePayment(db, {
    person_id: imran.id, occurred_on: '2026-08-20', amount_minor: 800_000,
    method: 'cash', reference: 'peshgi', recorded_by: 'adnan',
  });
  assert.equal(
    wageStatement(db, imran.id)?.balance_minor, -800_000,
    'in advance is an ordinary state and needs no flag',
  );

  saveRun(db, {
    from_on: '2026-09-01', to_on: '2026-09-30',
    entries: [
      { engagement_id: imranJob.id, amount_minor: RS_25K },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
    ],
    provenance: PROV,
  });
  assert.equal(wageStatement(db, imran.id)?.balance_minor, RS_25K - 800_000);
});

test('a deduction is an adjustment, and it has to say why', () => {
  const { db, imran } = farm();
  const r = refusal(() =>
    recordWagePayment(db, {
      person_id: imran.id, occurred_on: '2026-09-30', amount_minor: -5_000,
      method: 'cash', recorded_by: 'adnan',
    }),
  );
  assert.match(r.message, /must be positive/);
  assert.match(r.message, /record an adjustment and say why/);

  assert.match(
    refusal(() =>
      recordWagePayment(db, {
        person_id: imran.id, occurred_on: '2026-09-30', amount_minor: 30_000,
        method: 'adjustment', recorded_by: 'adnan',
      }),
    ).message,
    /must say why/,
  );

  assert.doesNotThrow(() =>
    recordWagePayment(db, {
      person_id: imran.id, occurred_on: '2026-09-30', amount_minor: 30_000,
      method: 'adjustment', note: 'took 4 L above the allowance in September',
      recorded_by: 'adnan',
    }),
  );
  assert.equal(wageStatement(db, imran.id)?.balance_minor, -30_000);
});

test('wageBalanceMinor is pure and handles both signs', () => {
  assert.equal(wageBalanceMinor([], []), 0);
  assert.equal(
    wageBalanceMinor(
      [{ amount_minor: RS_25K }, { amount_minor: 500_000 }] as never,
      [{ amount_minor: 800_000 }] as never,
    ),
    RS_25K + 500_000 - 800_000,
  );
});

test('the statement groups by month with a running closing balance', () => {
  const { db, imran, imranJob, abdulJob } = farm();
  for (const [from, to] of [
    ['2026-07-01', '2026-07-31'],
    ['2026-08-01', '2026-08-31'],
  ]) {
    saveRun(db, {
      from_on: from, to_on: to,
      entries: [
        { engagement_id: imranJob.id, amount_minor: RS_25K },
        { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
      ],
      provenance: PROV,
    });
  }
  recordWagePayment(db, {
    person_id: imran.id, occurred_on: '2026-08-05', amount_minor: RS_25K,
    method: 'cash', recorded_by: 'adnan',
  });

  const st = wageStatement(db, imran.id);
  assert.deepEqual(st?.months.map((m) => m.month), ['2026-07', '2026-08']);
  assert.equal(st?.months[0].closing_minor, RS_25K, 'July earned and unpaid');
  assert.equal(st?.months[1].closing_minor, RS_25K, 'August earned, July paid');
  assert.equal(st?.balance_minor, RS_25K);
});

test('people with no open stint are LISTED, not hidden', () => {
  // Unlike the buyer list, which excludes home. Somebody who has left may still
  // be owed a final payment, and hiding them is how it gets forgotten.
  const { db, imran, imranJob } = farm();
  updateEngagement(db, imranJob.id, { ended_on: '2026-06-30', end_reason: 'went home' });
  const rows = wageBalances(db, '2026-09-07');
  const mine = rows.find((r) => r.person_id === imran.id);
  assert.ok(mine, 'still listed');
  assert.equal(mine?.engaged, false, 'and flagged so the screen can dim them');
  assert.equal(rows.length, 3);
});

// ---------------------------------------------------------------------------
// Milk as part of the package (§4.6a)
// ---------------------------------------------------------------------------

test('the run compares the milk allowance against what was actually taken', () => {
  // The allowance is on the package; the litres are dispatch rows. The two are
  // deliberately allowed to differ, and the difference is the point.
  const { db, imran, imranJob, abdulJob } = farm();
  const dst = addDestination(db, {
    name: 'Imran milk', kind: 'staff', standing: true, person_id: imran.id,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  assert.equal(dst.billable, false, 'staff milk is never billed');

  for (const day of ['2026-09-01', '2026-09-02']) {
    saveDispatchSession(db, {
      occurred_on: day, session: 'morning',
      entries: [{ destination_id: dst.id, status: 'taken', litres: 3 }],
      provenance: PROV,
    });
  }
  const run = payrollRun(db, '2026-09-01', '2026-09-02');
  const row = run.permanent.find((r) => r.person.identifier === 'imran');
  assert.equal(row?.milk?.allowance_per_day, 2);
  assert.equal(row?.milk?.expected_litres, 4, '2 L a day over two days');
  assert.equal(row?.milk?.taken_litres, 6, 'and 6 L actually left the bulk');
  assert.equal(
    run.permanent.find((r) => r.person.identifier === 'abdul')?.milk, null,
    'no milk line in the package means nothing to compare',
  );
  assert.ok(abdulJob.id);
});

test('a staff destination cannot be billable, and refuses with a sentence', () => {
  const { db, imran } = farm();
  const r = refusal(() =>
    addDestination(db, {
      name: 'Sold to Imran', kind: 'staff', standing: true, billable: true,
      person_id: imran.id, started_on: '2026-01-01', recorded_by: 'adnan',
    }),
  );
  assert.match(r.message, /never billed/);
  assert.match(r.message, /adjustment on the wage ledger/);
});

test('a staff destination without a person, and a person on a non-staff kind, are both refused', () => {
  const { db, imran } = farm();
  assert.match(
    refusal(() =>
      addDestination(db, {
        name: 'Staff milk', kind: 'staff', standing: true,
        started_on: '2026-01-01', recorded_by: 'adnan',
      }),
    ).message,
    /one destination per person/,
  );
  assert.match(
    refusal(() =>
      addDestination(db, {
        name: 'Odd', kind: 'household', standing: false, person_id: imran.id,
        started_on: '2026-01-01', recorded_by: 'adnan',
      }),
    ).message,
    /only a 'staff' destination names a person/,
  );
});

// ---------------------------------------------------------------------------
// The fixture (docs/REGISTRY_PAYROLL.md §14, item 8)
// ---------------------------------------------------------------------------

test('staffedHerd renders the states that matter, not the settled ones', () => {
  // The sales fixtures were wrong twice by ending on a date that made every
  // screen show a correct and completely empty page. These assertions are the
  // guard against the same mistake: the CURRENT month must be outstanding, one
  // balance must be open, one settled, and one negative.
  const { db, labour } = staffedHerd();
  const run = payrollRun(db, `${AS_OF.slice(0, 7)}-01`, AS_OF);
  assert.equal(run.permanent.length, 2);
  assert.equal(run.outstanding, 2, 'the current month is deliberately unpaid');

  const imran = wageStatement(db, labour.imran.person);
  const abdul = wageStatement(db, labour.abdul.person);
  const rashid = wageStatement(db, labour.rashid.person);
  assert.ok((imran?.balance_minor ?? 0) > 0, 'one balance is open');
  assert.equal(abdul?.balance_minor, 0, 'one is settled');
  assert.ok((rashid?.balance_minor ?? 0) < 0, 'and one is in advance');
});

test('the fixture package covers a full package AND an all-cash one', () => {
  // A screen developed against only one of those shapes gets the empty state
  // wrong, which is exactly how two of the sales cycle's findings happened.
  const { db, labour } = staffedHerd();
  const full = packageOn(db, labour.imran.engagement, AS_OF);
  const cash = packageOn(db, labour.abdul.engagement, AS_OF);
  assert.deepEqual(full.benefits.map((b) => b.kind).sort(), ['accommodation', 'flour', 'milk']);
  assert.deepEqual(cash.benefits, [], 'and one package with no in-kind lines at all');
});

test('the fixture gives /check a real deviation line to render', () => {
  // Imran is paid less than his agreement, on purpose. A report that is always
  // empty is a report nobody learns to read.
  const { db } = staffedHerd();
  const lines = labourReport(snapshot(db), AS_OF);
  assert.ok(lines.some((l) => l.kind === 'amount_differs_from_term'));
});

test('the fixture milk allowance has dispatch rows to compare against', () => {
  // The failure this guards is the subtle one: labour added AFTER the dispatches
  // would leave the allowance reading zero against 2 L/day, and the screen would
  // look broken while the code was right.
  const { db, labour } = staffedHerd();
  const prev = `${AS_OF.slice(0, 8)}01`;
  const run = payrollRun(db, prev, AS_OF);
  const row = run.permanent.find((r) => r.engagement.id === labour.imran.engagement);
  assert.ok((row?.milk?.taken_litres ?? 0) > 0, 'milk actually left the bulk to Imran');
  assert.ok((row?.milk?.expected_litres ?? 0) > 0, 'and there is an allowance to compare it to');
});

test('a per-day allowance is clipped to today, so a running month is not a shortfall', () => {
  // Found by opening the harness on the 7th: the run defaults to the whole
  // current month, so 2 L/day read as "60 L due, 14 L taken" -- a 46 L gap
  // consisting almost entirely of days that had not happened.
  const { db, imran, imranJob, abdulJob } = farm();
  const dst = addDestination(db, {
    name: 'Imran milk', kind: 'staff', standing: true, person_id: imran.id,
    started_on: '2026-09-01', recorded_by: 'adnan',
  });
  for (const day of ['2026-09-01', '2026-09-02', '2026-09-03']) {
    saveDispatchSession(db, {
      occurred_on: day, session: 'morning',
      entries: [{ destination_id: dst.id, status: 'taken', litres: 2 }],
      provenance: PROV,
    });
  }

  const mid = payrollRun(db, '2026-09-01', '2026-09-30', '2026-09-03');
  const midRow = mid.permanent.find((r) => r.engagement.id === imranJob.id);
  assert.equal(midRow?.milk?.expected_litres, 6, '3 days elapsed at 2 L, not 30 days');
  assert.equal(midRow?.milk?.taken_litres, 6);
  assert.equal(midRow?.milk?.through_on, '2026-09-03');
  assert.equal(midRow?.milk?.partial, true);
  assert.equal(mid.through_on, '2026-09-03');

  // A SETTLED month is unaffected: asOf past to_on makes the clip a no-op and
  // the figure is the whole entitlement again.
  const done = payrollRun(db, '2026-09-01', '2026-09-30', '2026-10-05');
  const doneRow = done.permanent.find((r) => r.engagement.id === imranJob.id);
  assert.equal(doneRow?.milk?.expected_litres, 60);
  assert.equal(doneRow?.milk?.partial, false);
  assert.ok(abdulJob.id);
});

test('a MONTHLY allowance is not clipped -- 20 kg a month is not 4.6 kg by the 7th', () => {
  // Only a per-day entitlement accrues daily. Clipping a monthly one would
  // invent a proration, which is the thing §4.6 refuses to do for salaries.
  const { db, abdulJob } = farm();
  setTerm(db, {
    engagement_id: abdulJob.id, effective_from: '2026-09-01',
    cash_minor: 2_000_000, cash_period: 'month', recorded_by: 'adnan',
    benefits: [{ kind: 'milk', quantity: 30, unit: 'L', period: 'month' }],
  });
  const run = payrollRun(db, '2026-09-01', '2026-09-30', '2026-09-07');
  const row = run.permanent.find((r) => r.engagement.id === abdulJob.id);
  assert.equal(row?.milk?.expected_litres, 30, 'the whole month, not a seventh of it');
  assert.equal(row?.milk?.allowance_per_day, null);
});

test('an asOf before the range start clips to the start, never below it', () => {
  const { db, imran, imranJob } = farm();
  addDestination(db, {
    name: 'Imran milk', kind: 'staff', standing: true, person_id: imran.id,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  const run = payrollRun(db, '2026-09-01', '2026-09-30', '2026-08-01');
  const row = run.permanent.find((r) => r.engagement.id === imranJob.id);
  assert.equal(row?.milk?.expected_litres, 2, 'one day, not a negative number');
});

// ---------------------------------------------------------------------------
// The day board -- what still needs recording (overview.ts)
// ---------------------------------------------------------------------------

test('the day board counts a session done only when every expected row is answered', () => {
  const { db } = staffedHerd();
  // The fixture writes both sessions for every day up to AS_OF, so the day it
  // ends on is complete and the day after has nothing recorded at all.
  const done = dayBoard(db, AS_OF);
  for (const s of done.milking) assert.equal(s.complete, true, `milking ${s.session}`);
  for (const s of done.dispatch) assert.equal(s.complete, true, `dispatch ${s.session}`);

  const tomorrow = '2026-09-08';
  const next = dayBoard(db, tomorrow);
  assert.equal(next.milking[0].complete, false);
  assert.equal(next.milking[0].recorded, 0);
  assert.ok(next.milking[0].expected > 0, 'animals in milk are still expected tomorrow');
});

test('an empty farm reads as DONE, not as outstanding work', () => {
  // `0 of 0` must not render as a task. A landing page that always shows
  // something outstanding is one people stop reading.
  const db = fresh();
  const board = dayBoard(db, '2026-09-07');
  for (const s of board.milking) assert.deepEqual([s.expected, s.complete], [0, true]);
  for (const s of board.dispatch) assert.deepEqual([s.expected, s.complete], [0, true]);
  assert.equal(board.payroll.permanent, 0);
  assert.equal(board.payroll_previous, null);
});

test('the dispatch line counts STANDING destinations only', () => {
  // An occasional household that took nothing is not a gap -- absence is its
  // normal state -- so counting it would make the sheet permanently incomplete.
  const { db } = farm();
  addDestination(db, {
    name: 'Bashir', kind: 'dodhi', standing: true,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  addDestination(db, {
    name: 'Ali next door', kind: 'household', standing: false,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  const board = dayBoard(db, '2026-09-07');
  assert.equal(board.dispatch[0].expected, 1, 'the dodhi only');
});

test('the board flags LAST month unpaid, and stays quiet about this one', () => {
  // The current month is outstanding for the whole of it, which would make the
  // payroll line permanently amber and therefore permanently ignorable.
  const { db, imranJob, abdulJob } = farm();
  const board = dayBoard(db, '2026-09-07');
  assert.equal(board.payroll.outstanding, 2, 'September is outstanding, as it always is on the 7th');
  assert.ok(board.payroll_previous, 'and August is the one worth prompting about');
  assert.equal(board.payroll_previous?.from_on, '2026-08-01');

  saveRun(db, {
    from_on: '2026-08-01', to_on: '2026-08-31',
    entries: [
      { engagement_id: imranJob.id, amount_minor: RS_25K },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
    ],
    provenance: PROV,
  });
  assert.equal(
    dayBoard(db, '2026-09-07').payroll_previous, null,
    'once August is settled the prompt goes away entirely',
  );
});

test('month bounds are farm-local arithmetic, including a leap February', () => {
  assert.deepEqual(monthBounds('2026-09-07'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(monthBounds('2028-02-14'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(previousMonthBounds('2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(previousMonthBounds('2026-03-15'), { from: '2026-02-01', to: '2026-02-28' });
});
