// Milk yield -- the rules, the roster, and the two findings that shaped the
// schema (docs/REGISTRY_MILKING.md).
//
// No database file and no API key: every test builds its own `:memory:` herd,
// the same property the rest of the registry suite holds.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { addAcquiredAnimal } from './entry';
import { appendLifeEvent } from './entry';
import { correctCalving, recordCalving } from './calving';
import { freshDb } from './fixtures';
import { checkSnapshot } from './invariants';
import {
  daysInMilk,
  deleteMilkings,
  lactationCovering,
  milkingReport,
  milkingRoster,
  milkingsForAnimal,
  comparableSession,
  saveMilkingSession,
} from './milking';
import { identifierValues } from './reads';
import { snapshot } from './store';
import type { Db } from './schema';
import type { LactationRow } from './types';

const P = { source_form: 'direct_entry' as const, recorded_by: 'zsf' };
const AS_OF = '2026-09-04';

/** A dam with one calving on `on`, so she is in milk from that date. */
function damInMilk(db: Db, on: string): string {
  const a = addAcquiredAnimal(db, {
    sex: 'female', acquired_on: '2020-01-01', date_precision: 'year',
    provenance: P, asOf: AS_OF,
  });
  recordCalving(db, {
    dam_id: a.animal_id, occurred_on: on, date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' }, provenance: P, asOf: AS_OF,
  });
  return a.animal_id;
}

const lactations = (db: Db, animal: string) =>
  db.prepare('SELECT * FROM registry_lactations WHERE animal_id = ? ORDER BY started_on')
    .all(animal) as LactationRow[];

// ---------------------------------------------------------------------------
// The findings the design rests on
// ---------------------------------------------------------------------------

test('FINDING 1: correcting a calving date changes its lactation id', () => {
  // Which is why yield carries no lactation_id foreign key. Three places in the
  // repo used to say it would; this is the demonstration that they were wrong.
  const db = freshDb();
  const dam = addAcquiredAnimal(db, {
    sex: 'female', acquired_on: '2020-01-01', date_precision: 'year', provenance: P, asOf: AS_OF,
  });
  const r = recordCalving(db, {
    dam_id: dam.animal_id, occurred_on: '2024-03-15', date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' }, provenance: P, asOf: AS_OF,
  });

  const before = lactations(db, dam.animal_id);
  assert.equal(before.length, 1);

  correctCalving(db, {
    calving_event_id: r.calving_event_id, occurred_on: '2024-04-15',
    date_precision: 'day', provenance: P, asOf: AS_OF,
  });

  const after = lactations(db, dam.animal_id);
  assert.equal(after.length, 1, 'still ONE lactation -- the same one');
  assert.notEqual(after[0].id, before[0].id, 'but its id changed');

  const orphan = db.prepare('SELECT COUNT(*) n FROM registry_lactations WHERE id = ?')
    .get(before[0].id) as { n: number };
  assert.equal(orphan.n, 0, 'and the old row is gone -- an FK would dangle');
});

test('FINDING 2: recording a calving re-cuts the PREVIOUS lactation, with no correction at all', () => {
  // The case that decides it. No supersession happens: a calving is simply
  // entered, and yield already written into the overlap changes which lactation
  // it belongs to. A stored key would not dangle -- it would be silently WRONG,
  // and no invariant could see it because both rows exist.
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');

  const first = lactations(db, dam)[0];
  assert.equal(first.ended_on, null, 'one open lactation');

  // Yield logged while that was the only open lactation.
  saveMilkingSession(db, {
    occurred_on: '2025-03-05', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 6 }],
    provenance: P,
  });

  // She calves again. Entered after the fact, which is ordinary.
  recordCalving(db, {
    dam_id: dam, occurred_on: '2025-03-01', date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' }, provenance: P, asOf: AS_OF,
  });

  const after = lactations(db, dam);
  assert.equal(after.length, 2);
  assert.equal(after[0].ended_on, '2025-03-01', 'the first lactation now ENDS at the new calving');

  // Derived by date range, the row follows the boundary automatically.
  const history = milkingsForAnimal(db, dam);
  assert.equal(history.length, 1);
  assert.equal(
    history[0].lactation_id,
    after[1].id,
    'the 2025-03-05 row now belongs to the SECOND lactation, without a migration',
  );
  assert.notEqual(history[0].lactation_id, first.id);
});

// ---------------------------------------------------------------------------
// lactationCovering -- the boundary rule
// ---------------------------------------------------------------------------

test('a dry-off day is INSIDE its lactation; a next-calving day is not', () => {
  // The two end reasons mean different things. Treating them alike would refuse
  // a milking taken on the morning of the day she was dried off.
  const base = { animal_id: 'BD-0001', opened_by_event_id: 'aevt_x', start_precision: 'day' } as const;
  const dried: LactationRow = {
    ...base, id: 'lact_a', started_on: '2024-01-01', ended_on: '2024-06-01',
    end_precision: 'day', end_reason: 'dry_off', closed_by_event_id: 'aevt_d',
  };
  const calved: LactationRow = {
    ...base, id: 'lact_b', started_on: '2024-01-01', ended_on: '2024-06-01',
    end_precision: 'day', end_reason: 'inferred_at_next_calving', closed_by_event_id: 'aevt_c',
  };

  assert.ok(lactationCovering([dried], '2024-06-01'), 'milked on the morning she was dried off');
  assert.equal(lactationCovering([calved], '2024-06-01'), null, 'the calving day opens the NEXT one');
  assert.equal(lactationCovering([dried], '2023-12-31'), null, 'before it started');
});

test('the comparable session is the SAME one, the day before', () => {
  // Never the chronologically previous milking. Yield depends on the interval
  // since the last one, and with variable milking times that interval is
  // unknown -- so an evening figure beside a morning one would make an ordinary
  // evening look like a collapse.
  assert.deepEqual(comparableSession('2026-03-10', 'evening'), {
    occurred_on: '2026-03-09', session: 'evening',
  });
  assert.deepEqual(comparableSession('2026-03-10', 'morning'), {
    occurred_on: '2026-03-09', session: 'morning',
  });
  // Across a month boundary, which is where hand-rolled date maths breaks.
  assert.deepEqual(comparableSession('2026-03-01', 'morning'), {
    occurred_on: '2026-02-28', session: 'morning',
  });
});

// ---------------------------------------------------------------------------
// The status vocabulary
// ---------------------------------------------------------------------------

test("'measured' requires a number and the others refuse one", () => {
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  const save = (entry: Record<string, unknown>) =>
    saveMilkingSession(db, {
      occurred_on: '2024-06-01', session: 'morning',
      entries: [{ animal_id: dam, ...entry } as never], provenance: P,
    });

  assert.throws(() => save({ status: 'measured' }), /needs yield_litres/);
  assert.throws(() => save({ status: 'milked_not_measured', yield_litres: 5 }), /contradiction/);
  assert.throws(() => save({ status: 'measured', yield_litres: -1 }), /cannot be negative/);
  assert.throws(() => save({ status: 'measured', yield_litres: 5, reason: 'sick' }), /only belongs with/);
  // The one that must work: milk taken, nobody weighed it.
  const r = save({ status: 'milked_not_measured' });
  assert.equal(r.milked_not_measured, 1);
  assert.equal(r.rows[0].yield_litres, null);
});

test('not_milked and milked_not_measured stay distinct in the report', () => {
  // Collapsing them is the failure the whole vocabulary exists to prevent: one
  // is a near-zero, the other is missing data.
  const db = freshDb();
  const a = damInMilk(db, '2024-01-01');
  const b = damInMilk(db, '2024-01-01');
  const c = damInMilk(db, '2024-01-01');

  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [
      { animal_id: a, status: 'measured', yield_litres: 7.5 },
      { animal_id: b, status: 'milked_not_measured' },
      { animal_id: c, status: 'not_milked', reason: 'under treatment' },
    ],
    provenance: P,
  });

  const s = snapshot(db);
  const rep = milkingReport(s.milkings, s.lactations);
  assert.equal(rep.measured, 1);
  assert.equal(rep.milked_not_measured, 1);
  assert.equal(rep.not_milked, 1);
  assert.equal(rep.complete_sessions, 1, 'every animal in milk has a row');
  assert.match(rep.caveat, /never blended/);
});

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

test('an animal with no lactation covering the date is REFUSED', () => {
  const db = freshDb();
  const heifer = addAcquiredAnimal(db, {
    sex: 'female', acquired_on: '2020-01-01', date_precision: 'year', provenance: P, asOf: AS_OF,
  });
  assert.throws(
    () =>
      saveMilkingSession(db, {
        occurred_on: '2024-06-01', session: 'morning',
        entries: [{ animal_id: heifer.animal_id, status: 'measured', yield_litres: 5 }],
        provenance: P,
      }),
    /no lactation covering/,
  );
});

test('the session is ALL ROWS OR NONE', () => {
  // A half-saved session would leave the operator unable to tell which animals
  // landed, and the completeness count silently wrong.
  const db = freshDb();
  const good = damInMilk(db, '2024-01-01');
  assert.throws(() =>
    saveMilkingSession(db, {
      occurred_on: '2024-06-01', session: 'morning',
      entries: [
        { animal_id: good, status: 'measured', yield_litres: 6 },
        { animal_id: 'BD-9999', status: 'measured', yield_litres: 6 },
      ],
      provenance: P,
    }),
  );
  const n = db.prepare('SELECT COUNT(*) n FROM registry_milkings').get() as { n: number };
  assert.equal(n.n, 0, 'the good row was rolled back with the bad one');
});

test('re-saving CORRECTS in place rather than adding a row', () => {
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  const first = saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 60 }], provenance: P,
  });
  assert.equal(first.updated, 0);

  const second = saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 6 }], provenance: P,
  });
  assert.equal(second.updated, 1, 'reported as a correction, not a create');

  const rows = milkingsForAnimal(db, dam);
  assert.equal(rows.length, 1, 'still one row -- a measurement is corrected, not superseded');
  assert.equal(rows[0].yield_litres, 6);
  assert.equal(rows[0].id, first.rows[0].id, 'and it keeps its id');
});

test('one animal twice in one session is refused', () => {
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  assert.throws(
    () =>
      saveMilkingSession(db, {
        occurred_on: '2024-06-01', session: 'morning',
        entries: [
          { animal_id: dam, status: 'measured', yield_litres: 6 },
          { animal_id: dam, status: 'measured', yield_litres: 7 },
        ],
        provenance: P,
      }),
    /appears twice/,
  );
});

test('an empty session is refused rather than written as nothing', () => {
  const db = freshDb();
  assert.throws(
    () =>
      saveMilkingSession(db, {
        occurred_on: '2024-06-01', session: 'morning', entries: [], provenance: P,
      }),
    /writes nothing/,
  );
});

test('the row milker overrides the session milker', () => {
  const db = freshDb();
  const a = damInMilk(db, '2024-01-01');
  const b = damInMilk(db, '2024-01-01');
  const r = saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning', observed_by: 'abdul',
    entries: [
      { animal_id: a, status: 'milked_not_measured' },
      { animal_id: b, status: 'milked_not_measured', observed_by: 'imran' },
    ],
    provenance: P,
  });
  assert.equal(r.rows.find((x) => x.animal_id === a)!.observed_by, 'abdul');
  assert.equal(r.rows.find((x) => x.animal_id === b)!.observed_by, 'imran');
  // recorded_by stays the app user in both cases.
  assert.ok(r.rows.every((x) => x.recorded_by === 'zsf'));
});

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

test('the roster is derived from lactations, not from the status projection', () => {
  // Which is what lets a PAST date show who was in milk THEN. Entering
  // yesterday evening is ordinary; a status-projection roster would show today's
  // herd against yesterday's date.
  const db = freshDb();
  const dried = damInMilk(db, '2024-01-01');
  const still = damInMilk(db, '2024-01-01');
  appendLifeEvent(db, {
    animal_id: dried, type: 'dry_off', occurred_on: '2024-08-01',
    date_precision: 'day', provenance: P, asOf: AS_OF,
  });

  const during = milkingRoster(db, { occurred_on: '2024-06-01', session: 'morning' });
  assert.deepEqual(during.rows.map((r) => r.animal_id).sort(), [dried, still].sort());

  const after = milkingRoster(db, { occurred_on: '2024-09-01', session: 'morning' });
  assert.deepEqual(after.rows.map((r) => r.animal_id), [still], 'the dried animal has left it');
});

test('the roster carries days in milk and the previous session', () => {
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 8 }], provenance: P,
  });

  // The comparable is YESTERDAY's morning, not this morning: comparing an
  // evening figure to a morning one is the pooling this module refuses.
  const evening = milkingRoster(db, { occurred_on: '2024-06-01', session: 'evening' });
  assert.equal(evening.rows[0].days_in_milk, 152, 'from 2024-01-01 to 2024-06-01');
  assert.equal(evening.rows[0].previous, null, 'no evening yesterday, and this morning does not count');
  assert.equal(evening.rows[0].recent_mean, null, 'the mean is per-session too');
  assert.equal(evening.rows[0].existing, null);

  saveMilkingSession(db, {
    occurred_on: '2024-06-02', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 9 }], provenance: P,
  });
  const morning = milkingRoster(db, { occurred_on: '2024-06-02', session: 'morning' });
  assert.equal(morning.rows[0].previous!.yield_litres, 8, "yesterday's MORNING");
  assert.equal(morning.rows[0].previous!.session, 'morning');
  assert.equal(morning.rows[0].existing!.yield_litres, 9, 'and today is already saved');
});

test('the recent mean uses MEASURED rows only', () => {
  // Averaging over milked_not_measured would be averaging over nothing, and
  // counting not_milked as a zero would drag the band down with days she was
  // never expected to give.
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 10 }], provenance: P,
  });
  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'evening',
    entries: [{ animal_id: dam, status: 'not_milked', reason: 'sick' }], provenance: P,
  });
  saveMilkingSession(db, {
    occurred_on: '2024-06-02', session: 'morning',
    entries: [{ animal_id: dam, status: 'milked_not_measured' }], provenance: P,
  });

  // Morning only, so the morning mean sees the 10 and the evening mean sees
  // nothing -- the not_milked evening contributes no zero to either.
  const morning = milkingRoster(db, { occurred_on: '2024-06-02', session: 'morning' });
  assert.equal(morning.rows[0].recent_mean, 10, 'not dragged toward zero');
  assert.equal(morning.rows[0].recent_n, 1);

  const evening = milkingRoster(db, { occurred_on: '2024-06-02', session: 'evening' });
  assert.equal(evening.rows[0].recent_mean, null, 'no measured EVENING to average');
});

test('an incomplete session is reported as incomplete', () => {
  const db = freshDb();
  const a = damInMilk(db, '2024-01-01');
  damInMilk(db, '2024-01-01'); // in milk, never recorded

  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: a, status: 'measured', yield_litres: 5 }], provenance: P,
  });

  const s = snapshot(db);
  const rep = milkingReport(s.milkings, s.lactations);
  assert.equal(rep.recent[0].expected, 2);
  assert.equal(rep.recent[0].recorded, 1);
  assert.equal(rep.complete_sessions, 0);
});

// ---------------------------------------------------------------------------
// Delete -- the repair path update-in-place leaves no other way to reach
// ---------------------------------------------------------------------------

test('a session entered against the wrong date can be removed', () => {
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 5 }], provenance: P,
  });
  assert.equal(deleteMilkings(db, { occurred_on: '2024-06-01', session: 'evening' }), 0);
  assert.equal(deleteMilkings(db, { occurred_on: '2024-06-01', session: 'morning' }), 1);
  assert.equal(milkingsForAnimal(db, dam).length, 0);
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

test('a clean herd with yield has no violations', () => {
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 6 }], provenance: P,
  });
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), []);
});

test('invariant 14 fires when a lactation moves out from under a row', () => {
  // The row was legitimate when written. A backdated dry-off is what makes it
  // wrong, and no constraint can see that -- only recomputing can.
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 6 }], provenance: P,
  });
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), []);

  appendLifeEvent(db, {
    animal_id: dam, type: 'dry_off', occurred_on: '2024-03-01',
    date_precision: 'day', provenance: P, asOf: AS_OF,
  });

  const violations = checkSnapshot(snapshot(db), AS_OF).filter((x) => x.invariant === 14);
  assert.equal(violations.length, 1);
  assert.match(violations[0].detail, /no lactation covering/);
});

test('invariant 17 fires on a row whose status and yield disagree', () => {
  // Written past the write boundary AND past the CHECK, to prove the invariant
  // is a real third layer rather than a restatement of them.
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'morning',
    entries: [{ animal_id: dam, status: 'measured', yield_litres: 6 }], provenance: P,
  });

  const s = snapshot(db);
  const corrupted = {
    ...s,
    milkings: [{ ...s.milkings[0], status: 'not_milked' as const }],
  };
  const violations = checkSnapshot(corrupted, AS_OF).filter((x) => x.invariant === 17);
  assert.equal(violations.length, 1);
});

test('the milker is offered by the datalist on the next session', () => {
  // Milk rows will be the overwhelming majority of observed_by, so reading only
  // the event log would mean the person named on a thousand rows is not offered
  // on the next one -- which is how `imran` and `Imran` become two people.
  const db = freshDb();
  const dam = damInMilk(db, '2024-01-01');
  assert.equal(identifierValues(db).observed_by.includes('imran'), false);

  saveMilkingSession(db, {
    occurred_on: '2024-06-01', session: 'evening', observed_by: 'imran',
    entries: [{ animal_id: dam, status: 'milked_not_measured' }], provenance: P,
  });

  assert.ok(identifierValues(db).observed_by.includes('imran'));
});

test('daysInMilk counts calendar days across a month boundary', () => {
  const l = {
    id: 'lact_x', animal_id: 'BD-0001', opened_by_event_id: 'aevt_x',
    started_on: '2024-02-27', start_precision: 'day' as const,
    ended_on: null, end_precision: null, end_reason: null, closed_by_event_id: null,
  };
  assert.equal(daysInMilk(l, '2024-03-01'), 3, '2024 is a leap year');
});
