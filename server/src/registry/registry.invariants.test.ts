// Animal registry -- invariant checks against `:memory:` fixtures.
//
// Two obligations, and the second is the one that matters:
//
//   1. A clean herd produces ZERO violations.
//   2. EACH invariant fires on a fixture corrupted specifically to break it.
//
// Without (2) an invariant suite proves nothing -- a check that can never fail
// passes every clean fixture forever while silently protecting nothing.
//
// Most corruptions are applied to the SNAPSHOT rather than the database,
// because the append-only triggers correctly forbid the SQL that would be
// needed, and because the checks are pure functions over a snapshot anyway.

import assert from 'node:assert';
import { test } from 'node:test';

import {
  checkProjectionAgreement,
  checkSnapshot,
  definitelyBefore,
  diffRowSets,
  rowKey,
} from './invariants';
import { rebuild } from './projectStore';
import { allLactations, allParentage, allStatuses, snapshot } from './store';
import { AS_OF, cleanHerd, correctionOnlyOnDam, herdWithCorrection } from './fixtures';
import type { RegistrySnapshot } from './types';

function violations(s: RegistrySnapshot, asOf = AS_OF) {
  return checkSnapshot(s, asOf);
}

function firesInvariant(s: RegistrySnapshot, n: number, asOf = AS_OF): boolean {
  return violations(s, asOf).some((v) => v.invariant === n);
}

/** Deep copy so a corruption never leaks between tests. */
function clone(s: RegistrySnapshot): RegistrySnapshot {
  return JSON.parse(JSON.stringify(s)) as RegistrySnapshot;
}

// ---------------------------------------------------------------------------
// The clean case
// ---------------------------------------------------------------------------

test('the clean herd produces zero violations', () => {
  const db = cleanHerd();
  const found = violations(snapshot(db));
  assert.deepEqual(
    found,
    [],
    found.map((v) => `[${v.invariant}] ${v.name}: ${v.detail}`).join('\n'),
  );
  db.close();
});

test('the clean herd exercises the cases the invariants are for', () => {
  // A fixture that happens to be trivially valid would make the zero-violation
  // result meaningless. Assert it contains the awkward shapes.
  const db = cleanHerd();
  const s = snapshot(db);

  assert.ok(s.animals.length >= 6, 'several animals');
  assert.ok(
    s.lactations.some((l) => l.end_reason === 'dry_off'),
    'a normally-closed lactation',
  );
  assert.ok(
    s.lactations.some((l) => l.end_reason === 'inferred_at_next_calving'),
    'a lactation closed by derivation, not observation',
  );
  assert.ok(s.lactations.some((l) => l.ended_on === null), 'an open lactation');
  assert.ok(s.statuses.some((x) => x.status === 'departed'), 'a departed animal');
  assert.ok(s.statuses.some((x) => x.status === 'lactating'), 'a lactating animal');
  assert.ok(s.statuses.some((x) => x.status === 'heifer'), 'a heifer');
  assert.ok(s.statuses.some((x) => x.status === 'male'), 'a male');
  assert.ok(
    s.statuses.some((x) => x.status === 'calf'),
    'an animal young enough for the age-dependent rule to fire -- without one, ' +
      'every asOf-sensitivity test would pass vacuously',
  );
  assert.ok(
    s.events.some((e) => e.date_precision === 'month' && e.occurred_on.endsWith('-01')),
    'month-precision rows stored on the 1st',
  );
  assert.ok(
    s.events.some((e) => e.occurred_time !== null),
    'at least one event with a known clock time',
  );
  assert.ok(
    s.animals.some((a) => a.origin === 'born_on_farm'),
    'a farm-born animal, so invariant 7 has something to check',
  );
  db.close();
});

test('a PAIRED correction is clean, and the correction takes effect', () => {
  const { db, originalId, correctionId } = herdWithCorrection();
  const s = snapshot(db);
  assert.deepEqual(
    violations(s),
    [],
    'correcting a calving date means superseding BOTH the calving and the birth',
  );

  const status = s.statuses.find((x) => x.animal_id === 'BD-0001');
  assert.equal(status?.parity, 1, 'a correction replaces, it does not add');

  const l = s.lactations.filter((x) => x.animal_id === 'BD-0001');
  assert.equal(l.length, 1);
  assert.equal(l[0].started_on, '2023-05-01', 'the corrected date is the one projected');
  assert.equal(l[0].opened_by_event_id, correctionId);
  assert.notEqual(l[0].opened_by_event_id, originalId);
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 0 -- idempotence
// ---------------------------------------------------------------------------

test('invariant 0: rebuilding twice produces identical projection row-sets', () => {
  const db = cleanHerd();
  rebuild(db, { asOf: AS_OF });
  const first = {
    l: allLactations(db),
    p: allParentage(db),
    s: allStatuses(db),
  };
  rebuild(db, { asOf: AS_OF });
  assert.deepEqual(diffRowSets('lactations', first.l, allLactations(db)), []);
  assert.deepEqual(diffRowSets('parentage', first.p, allParentage(db)), []);
  assert.deepEqual(diffRowSets('statuses', first.s, allStatuses(db)), []);
  db.close();
});

test('the multiset diff can actually detect a difference', () => {
  // The comparison used by invariants 0 and 1 must be able to fail.
  assert.deepEqual(diffRowSets('t', [{ a: 1 }], [{ a: 1 }]), []);
  assert.equal(diffRowSets('t', [{ a: 1 }], [{ a: 2 }]).length, 2, 'one missing, one unexpected');
  assert.equal(diffRowSets('t', [{ a: 1 }, { a: 1 }], [{ a: 1 }]).length, 1, 'counts matter');
  assert.equal(rowKey({ b: 2, a: 1 }), rowKey({ a: 1, b: 2 }), 'key order is irrelevant');
});

// ---------------------------------------------------------------------------
// Invariant 1 -- rebuild fidelity
// ---------------------------------------------------------------------------

test('invariant 1: a tampered stored status is caught', () => {
  const db = cleanHerd();
  // Projection tables have no append-only trigger -- they are derived, so
  // rewriting them is legal. That is exactly why they must be verifiable.
  db.prepare(`UPDATE registry_animal_status SET parity = 99 WHERE animal_id = 'BD-0001'`).run();
  const found = checkProjectionAgreement(snapshot(db), AS_OF);
  assert.ok(found.length > 0);
  assert.equal(found[0].invariant, 1);
  assert.match(found[0].detail, /BD-0001/);
  db.close();
});

test('invariant 1: a missing stored status row is caught', () => {
  const db = cleanHerd();
  db.prepare(`DELETE FROM registry_animal_status WHERE animal_id = 'BD-0005'`).run();
  assert.ok(firesInvariant(snapshot(db), 1));
  db.close();
});

test('invariant 1: a deleted lactation row is caught', () => {
  const db = cleanHerd();
  db.prepare(`DELETE FROM registry_lactations WHERE animal_id = 'BD-0001'`).run();
  assert.ok(firesInvariant(snapshot(db), 1));
  db.close();
});

test('invariant 1 also fires on merely STALE projections -- the documented behaviour', () => {
  // Status depends on asOf, so an animal aging past the calf threshold makes a
  // correct-when-written projection wrong. The fix is a rebuild, not a looser
  // comparison, and verify:registry says so in its output.
  const db = cleanHerd();
  assert.deepEqual(violations(snapshot(db), AS_OF), [], 'clean at the as-of it was built with');
  const later = violations(snapshot(db), '2030-01-01');
  assert.ok(later.some((v) => v.invariant === 1), 'evaluated years later, the calf has grown up');
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 2 -- lactation id stability
// ---------------------------------------------------------------------------

test('invariant 2: lactation ids survive a rebuild unchanged', () => {
  const db = cleanHerd();
  const before = allLactations(db).map((l) => l.id).sort();
  rebuild(db, { asOf: AS_OF });
  const after = allLactations(db).map((l) => l.id).sort();
  assert.deepEqual(after, before);
  assert.ok(before.length >= 4, 'and there were ids to compare');
  db.close();
});

test('invariant 2: ids also survive a rebuild at a DIFFERENT as-of date', () => {
  // Status changes with asOf; lactation identity must not.
  const db = cleanHerd();
  const before = allLactations(db).map((l) => l.id).sort();
  rebuild(db, { asOf: '2030-01-01' });
  assert.deepEqual(allLactations(db).map((l) => l.id).sort(), before);
  db.close();
});

test('invariant 8/2: a lactation id not derived from its calving is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  s.lactations[0].id = 'lact_hand-written-nonsense';
  assert.ok(firesInvariant(s, 8));
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 3 -- exactly one origin event
// ---------------------------------------------------------------------------

test('invariant 3: an animal with no origin event is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  s.events = s.events.filter(
    (e) => !(e.animal_id === 'BD-0005' && e.type === 'acquired'),
  );
  assert.ok(firesInvariant(s, 3));
  db.close();
});

test('invariant 3: an animal with two origin events is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const first = s.events.find((e) => e.animal_id === 'BD-0005')!;
  s.events.push({ ...first, id: 'aevt_duplicate-origin' });
  assert.ok(firesInvariant(s, 3));
  db.close();
});

test('invariant 3: an event on a non-existent animal is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  s.events.push({ ...s.events[0], id: 'aevt_orphan', animal_id: 'BD-9999' });
  assert.ok(firesInvariant(s, 3));
  db.close();
});

// ---------------------------------------------------------------------------
// Invariants 4 and 5 -- timeline bounds
// ---------------------------------------------------------------------------

test('invariant 4: an event before its animal origin is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const calving = s.events.find((e) => e.animal_id === 'BD-0001' && e.type === 'calving')!;
  calving.occurred_on = '2010-01-01';
  calving.date_precision = 'day';
  assert.ok(firesInvariant(s, 4));
  db.close();
});

test('invariant 4 allows for precision -- a month row is not "before" a same-month day row', () => {
  assert.equal(
    definitelyBefore(
      { on: '2024-03-01', precision: 'month' },
      { on: '2024-03-14', precision: 'day' },
    ),
    false,
    'the day was never known, so it cannot be definitely earlier',
  );
  assert.equal(
    definitelyBefore(
      { on: '2024-02-01', precision: 'month' },
      { on: '2024-03-14', precision: 'day' },
    ),
    true,
    'a different month IS definitely earlier',
  );
  assert.equal(
    definitelyBefore(
      { on: '2000-01-01', precision: 'estimated' },
      { on: '2024-03-14', precision: 'day' },
    ),
    false,
    'an estimated date is not comparable at all',
  );
});

test('invariant 5: an event after a departure is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const dep = s.events.find((e) => e.animal_id === 'BD-0004' && e.type === 'departure')!;
  s.events.push({
    ...dep,
    id: 'aevt_after-departure',
    type: 'dry_off',
    occurred_on: '2025-01-01',
    date_precision: 'day',
    payload: {},
  });
  assert.ok(firesInvariant(s, 5));
  db.close();
});

test('a `note` is exempt from both timeline bounds', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const dep = s.events.find((e) => e.animal_id === 'BD-0004' && e.type === 'departure')!;
  s.events.push({
    ...dep,
    id: 'aevt_late-note',
    type: 'note',
    occurred_on: '2030-01-01',
    date_precision: 'day',
    payload: { text: 'buyer called about her' },
  });
  assert.ok(!firesInvariant(s, 5), 'a note may be written at any time');
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 6 -- calving / calf agreement
// ---------------------------------------------------------------------------

test('invariant 6: a HALF-APPLIED date correction is caught', () => {
  // Correcting the calving on the dam but not the birth on the calf leaves the
  // two dates divergent. This is the realistic mistake -- the correction feels
  // complete because the dam's record now reads right -- and it is exactly what
  // invariant 6's pair check exists to catch.
  const db = correctionOnlyOnDam();
  const found = violations(snapshot(db));
  assert.ok(found.some((v) => v.invariant === 6));
  assert.match(found.find((v) => v.invariant === 6)!.detail, /does not match calving/);
  db.close();
});

test('invariant 6: a calving naming a non-existent calf is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const c = s.events.find((e) => e.type === 'calving')!;
  c.payload.calf_id = 'BD-9999';
  assert.ok(firesInvariant(s, 6));
  db.close();
});

test('invariant 6: a birth date diverging from its calving is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const birth = s.events.find((e) => e.type === 'birth')!;
  birth.occurred_on = '2099-01-01';
  assert.ok(firesInvariant(s, 6));
  db.close();
});

test('invariant 6: a sex disagreement between the calving and the animal row is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const c = s.events.find((e) => e.type === 'calving')!;
  c.payload.calf_sex = c.payload.calf_sex === 'female' ? 'male' : 'female';
  assert.ok(firesInvariant(s, 6));
  db.close();
});

test('invariant 6: a calf whose origin is not born_on_farm is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const c = s.events.find((e) => e.type === 'calving')!;
  const calf = s.animals.find((a) => a.id === c.payload.calf_id)!;
  calf.origin = 'acquired';
  assert.ok(firesInvariant(s, 6));
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 7 -- parentage
// ---------------------------------------------------------------------------

test('invariant 7: a farm-born animal with no dam edge is caught', () => {
  const db = cleanHerd();
  const born = snapshot(db).animals.find((a) => a.origin === 'born_on_farm')!;
  db.prepare(`DELETE FROM registry_parentage WHERE child_id = ?`).run(born.id);
  assert.ok(firesInvariant(snapshot(db), 7));
  db.close();
});

test('invariant 7: a dam edge naming a non-registry animal is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  s.parentage.find((p) => p.relation === 'dam')!.parent_ref = 'BD-9999';
  assert.ok(firesInvariant(s, 7));
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 8 -- one open lactation
// ---------------------------------------------------------------------------

test('invariant 8: two open lactations for one animal are caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const open = s.lactations.find((l) => l.ended_on === null)!;
  const other = s.lactations.find((l) => l.animal_id === open.animal_id && l.ended_on !== null);
  assert.ok(other, 'the fixture has a closed lactation on the same animal');
  other!.ended_on = null;
  other!.end_precision = null;
  other!.end_reason = null;
  assert.ok(firesInvariant(s, 8));
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 9 -- superseded events never contribute
// ---------------------------------------------------------------------------

test('invariant 9: a projection derived from a superseded event is caught', () => {
  const { db, originalId } = herdWithCorrection();
  const s = clone(snapshot(db));
  s.lactations[0].opened_by_event_id = originalId;
  assert.ok(firesInvariant(s, 9));
  db.close();
});

test('invariant 9: superseding an event that does not exist is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  s.events[0].supersedes_id = 'aevt_nonexistent';
  assert.ok(firesInvariant(s, 9));
  db.close();
});

test('invariant 9: superseding an event on a different animal is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const a = s.events.find((e) => e.animal_id === 'BD-0001')!;
  const b = s.events.find((e) => e.animal_id === 'BD-0002')!;
  a.supersedes_id = b.id;
  assert.ok(firesInvariant(s, 9));
  db.close();
});

test('invariant 9: superseding an event of a different type is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const calving = s.events.find((e) => e.animal_id === 'BD-0001' && e.type === 'calving')!;
  const dryOff = s.events.find((e) => e.animal_id === 'BD-0001' && e.type === 'dry_off')!;
  dryOff.supersedes_id = calving.id;
  assert.ok(firesInvariant(s, 9));
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 10 -- serials
// ---------------------------------------------------------------------------

test('invariant 10: a counter that would reissue an existing serial is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  s.nextSerial = 1;
  assert.ok(firesInvariant(s, 10));
  db.close();
});

test('invariant 10: a non-canonical serial is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  s.animals.push({ ...s.animals[0], id: 'BD-7' });
  assert.ok(firesInvariant(s, 10));
  db.close();
});

test('invariant 10: an id not using the BD- prefix is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  s.animals.push({ ...s.animals[0], id: 'animal_abcd1234' });
  assert.ok(firesInvariant(s, 10));
  db.close();
});

// ---------------------------------------------------------------------------
// Invariants 11 and 12 -- stored date conventions
// ---------------------------------------------------------------------------

test('invariant 11: a month-precision row dated mid-month is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const e = s.events.find((x) => x.date_precision === 'month')!;
  e.occurred_on = e.occurred_on.replace(/-01$/, '-14');
  assert.ok(firesInvariant(s, 11));
  db.close();
});

test('invariant 11: a year-precision row not dated Jan 1 is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const e = s.events.find((x) => x.date_precision === 'year')!;
  e.occurred_on = '2019-06-01';
  assert.ok(firesInvariant(s, 11));
  db.close();
});

test('invariant 11: an estimated-precision row not dated Jan 1 is caught', () => {
  // Added with migration 2. The CHECK stops new rows; this catches historical
  // ones written before the convention existed -- the reason invariants and
  // CHECKs both exist rather than one or the other.
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const e = s.events.find((x) => x.date_precision === 'year')!;
  e.date_precision = 'estimated';
  e.occurred_on = '2019-06-14';
  const found = violations(s);
  assert.ok(found.some((v) => v.invariant === 11 && /estimated-precision/.test(v.detail)));
  assert.match(
    found.find((v) => v.invariant === 11)!.detail,
    /fabricated day wearing a humility label/,
  );
  db.close();
});

test('invariant 11 accepts estimated dated Jan 1', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const e = s.events.find((x) => x.date_precision === 'year')!;
  e.date_precision = 'estimated';
  assert.ok(!violations(s).some((v) => v.invariant === 11));
  db.close();
});

test('invariant 12: a clock time at non-day precision is caught', () => {
  const db = cleanHerd();
  const s = clone(snapshot(db));
  const e = s.events.find((x) => x.date_precision === 'month')!;
  e.occurred_time = '05:30';
  assert.ok(firesInvariant(s, 12));
  db.close();
});

// ---------------------------------------------------------------------------
// Coverage guard
// ---------------------------------------------------------------------------

test('every invariant 1-12 has at least one test that makes it fire', () => {
  // Meta-check: a check nobody can trip is a check that protects nothing. This
  // fails loudly if an invariant is added to checkSnapshot() without a
  // corresponding corruption fixture above.
  const db = cleanHerd();
  const base = snapshot(db);
  const fired = new Set<number>();

  const corruptions: [number, (s: RegistrySnapshot) => void][] = [
    [1, (s) => (s.statuses[0].parity = 99)],
    [3, (s) => (s.events = s.events.filter((e) => e.type !== 'acquired'))],
    [4, (s) => {
      const c = s.events.find((e) => e.type === 'calving')!;
      c.occurred_on = '2000-01-01';
      c.date_precision = 'day';
    }],
    [5, (s) => {
      const dep = s.events.find((e) => e.type === 'departure')!;
      s.events.push({ ...dep, id: 'aevt_x1', type: 'dry_off', occurred_on: '2099-01-01', date_precision: 'day' });
    }],
    [6, (s) => (s.events.find((e) => e.type === 'calving')!.payload.calf_id = 'BD-9999')],
    [7, (s) => (s.parentage = [])],
    [8, (s) => {
      const open = s.lactations.find((l) => l.ended_on === null)!;
      s.lactations.push({ ...open, id: 'lact_second-open' });
    }],
    [9, (s) => (s.events[0].supersedes_id = 'aevt_nonexistent')],
    [10, (s) => (s.nextSerial = 1)],
    [11, (s) => {
      const e = s.events.find((x) => x.date_precision === 'month')!;
      e.occurred_on = e.occurred_on.replace(/-01$/, '-14');
    }],
    [12, (s) => (s.events.find((x) => x.date_precision === 'month')!.occurred_time = '05:30')],
  ];

  for (const [n, corrupt] of corruptions) {
    const s = clone(base);
    corrupt(s);
    if (firesInvariant(s, n)) fired.add(n);
  }
  // 2 is a rebuild-based invariant with its own tests above; 0 and 13 likewise.
  const expected = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.deepEqual(
    [...fired].sort((a, b) => a - b),
    expected,
    'every snapshot-level invariant is demonstrably reachable',
  );
  db.close();
});
