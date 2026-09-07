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
  labourReport,
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

test('every view-branching enum is represented in the fixture herd', () => {
  // GENERALIZED FROM A REAL MISS: cleanHerd() produced no animal with status
  // `dry` -- one of six -- so a sixth of the herd table would have been built
  // against data that never exercised it. The rule that replaces noticing:
  // ANY enum a view branches on must have every value present here.
  //
  // Where a value is deliberately absent, it is listed with the reason, so the
  // gap is a decision rather than an oversight.
  const db = cleanHerd();
  const s = snapshot(db);

  const statuses = new Set(s.statuses.map((r) => r.status));
  for (const v of ['departed', 'calf', 'lactating', 'dry', 'heifer', 'male']) {
    assert.ok(statuses.has(v as never), `status '${v}' is represented`);
  }

  const types = new Set(s.events.map((e) => e.type));
  for (const v of ['birth', 'acquired', 'calving', 'dry_off', 'departure', 'note']) {
    assert.ok(types.has(v as never), `event type '${v}' is represented`);
  }

  const precisions = new Set(s.events.map((e) => e.date_precision));
  for (const v of ['day', 'month', 'year', 'estimated']) {
    assert.ok(precisions.has(v as never), `date precision '${v}' is represented`);
  }

  const endReasons = new Set(s.lactations.map((l) => l.end_reason).filter((r) => r !== null));
  for (const v of ['dry_off', 'inferred_at_next_calving']) {
    assert.ok(endReasons.has(v as never), `lactation end reason '${v}' is represented`);
  }
  assert.ok(s.lactations.some((l) => l.end_reason === null), 'and an open lactation');

  // DELIBERATELY NOT FULLY COVERED, with reasons:
  //
  //   SourceForm -- the fixture uses `recall` and `daily_herd_sheet`, the two a
  //     real backfill actually produces. `cycle_card`, `direct_entry` and
  //     `import` would be invented rows; no view branches on the value beyond
  //     printing it, and the histogram groups whatever it finds.
  //   CalvingOutcome -- `live` and `stillborn` are present. `died_within_24h`
  //     takes the identical code path (recordCalving branches on `!== 'live'`)
  //     and is covered directly in registry.calving.test.ts.
  //   ParentCertainty -- only `known` is reachable in this cycle; nothing
  //     writes `unknown` yet. Recorded as a fidelity gap in REGISTRY.md.
  const forms = new Set(s.events.map((e) => e.source_form));
  assert.ok(forms.has('recall') && forms.has('daily_herd_sheet'), 'both realistic forms');
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

// ---------------------------------------------------------------------------
// 18-22. Milk sales, home use and the ledger
// ---------------------------------------------------------------------------

/**
 * A snapshot carrying the three-buyer farm and one day of sales.
 *
 * Built by hand rather than through the write boundary, because that is the
 * point: every corruption below is something the write boundary already
 * refuses, and the invariants exist to catch rows that got in some other way --
 * a hand-written INSERT, or a rule that did not exist when the row was written.
 */
function salesSnapshot(): RegistrySnapshot {
  const dest = (
    id: string,
    name: string,
    kind: string,
    billable: boolean,
    standing: boolean,
  ) => ({
    id, name, kind, billable, standing, contact: null,
    started_on: '2026-01-01', ended_on: null, note: null,
    recorded_by: 'adnan', recorded_at: 't',
    // NULL, not absent. A real row out of SQLite has person_id === null, and
    // invariant 28 tests `person_id !== null` -- an omitted field here reads as
    // "names a person" and makes the whole fixture dirty.
    person_id: null,
  });
  return {
    animals: [], events: [], lactations: [], parentage: [], statuses: [], milkings: [],
    people: [], engagements: [], terms: [], benefits: [],
    wagePeriods: [], wagePayments: [],
    nextSerial: 1,
    destinations: [
      dest('dst_dodhi', 'Bashir', 'dodhi', true, true),
      dest('dst_home', 'Home', 'home', false, true),
    ] as never,
    prices: [
      {
        id: 'prc_1', destination_id: 'dst_dodhi', effective_from: '2026-01-01',
        price_minor: 700_000, price_unit_litres: 40, recorded_by: 'adnan',
        recorded_at: 't', note: null,
      },
    ],
    dispatches: [
      {
        id: 'dsp_1', destination_id: 'dst_dodhi', occurred_on: '2026-02-01',
        session: 'morning', status: 'taken', litres: 40,
        price_minor: 700_000, price_unit_litres: 40, reason: null, occurred_time: null,
        observed_by: null, recorded_by: 'adnan', recorded_at: 't',
        source_form: 'direct_entry', note: null,
      },
      {
        id: 'dsp_2', destination_id: 'dst_home', occurred_on: '2026-02-01',
        session: 'morning', status: 'taken', litres: 3,
        price_minor: null, price_unit_litres: null, reason: null, occurred_time: null,
        observed_by: null, recorded_by: 'adnan', recorded_at: 't',
        source_form: 'direct_entry', note: null,
      },
    ] as never,
    payments: [
      {
        id: 'pay_1', destination_id: 'dst_dodhi', occurred_on: '2026-02-28',
        amount_minor: 700_000, method: 'cash', reference: null, observed_by: null,
        recorded_by: 'adnan', recorded_at: 't', note: null,
      },
    ] as never,
  };
}

test('a clean sales snapshot produces zero violations', () => {
  // The null case first: without it, every assertion below could be firing for
  // the wrong reason.
  assert.deepEqual(violations(salesSnapshot()), []);
});

test('EVERY sales invariant is demonstrably reachable', () => {
  // The same shape as the corruption sweep above, and for the same reason: an
  // invariant that cannot fire is worse than no invariant, because it reads as
  // coverage.
  const fired = new Set<number>();
  const corruptions: [number, (s: RegistrySnapshot) => void][] = [
    // 18 -- two rows for one destination in one session.
    [18, (s) => s.dispatches.push({ ...s.dispatches[0], id: 'dsp_dup' })],
    // 19 -- 'taken' with no litres.
    [19, (s) => {
      s.dispatches[0].litres = null;
    }],
    // 19 -- half a price: a rate with no lot size is a 40x error waiting.
    [19, (s) => {
      s.dispatches[0].price_unit_litres = null;
    }],
    // 19 -- home milk carrying a price, which would reach a balance.
    [19, (s) => {
      s.dispatches[1].price_minor = 700_000;
      s.dispatches[1].price_unit_litres = 40;
    }],
    // 20 -- a dispatch after the buyer stopped.
    [20, (s) => {
      s.destinations[0].ended_on = '2026-01-15';
    }],
    // 20 -- a payment outside the range.
    [20, (s) => {
      s.destinations[0].ended_on = '2026-02-01';
    }],
    // 21 -- billed with no agreement behind the figure.
    [21, (s) => {
      s.prices = [];
    }],
    // 21 -- two agreements on one date, so which one wins is silent.
    [21, (s) => s.prices.push({ ...s.prices[0], id: 'prc_dup' })],
    // 22 -- home priced.
    [22, (s) => s.prices.push({ ...s.prices[0], id: 'prc_home', destination_id: 'dst_home' })],
    // 22 -- home paid.
    [22, (s) => s.payments.push({ ...s.payments[0], id: 'pay_home', destination_id: 'dst_home' })],
    // 22 -- a negative cash payment wearing the wrong label.
    [22, (s) => {
      s.payments[0].amount_minor = -700_000;
    }],
    // 22 -- a signed adjustment with nothing said about it.
    [22, (s) => {
      s.payments[0].method = 'adjustment';
      s.payments[0].amount_minor = -700_000;
      s.payments[0].note = null;
    }],
  ];

  for (const [n, corrupt] of corruptions) {
    const s = salesSnapshot();
    corrupt(s);
    assert.ok(
      firesInvariant(s, n),
      `a corruption meant to trip invariant ${n} produced no violation`,
    );
    fired.add(n);
  }
  assert.deepEqual([...fired].sort((a, b) => a - b), [18, 19, 20, 21, 22]);
});

test('a dispatch or payment naming an unknown destination is caught', () => {
  const s = salesSnapshot();
  s.dispatches[0].destination_id = 'dst_ghost';
  assert.ok(firesInvariant(s, 20));

  const t = salesSnapshot();
  t.payments[0].destination_id = 'dst_ghost';
  assert.ok(firesInvariant(t, 22));
});

test('a billable dispatch that captured NO price is caught', () => {
  // Distinct from invariant 21: the agreement exists, but the row never picked
  // it up, so it is billed at nothing.
  const s = salesSnapshot();
  s.dispatches[0].price_minor = null;
  s.dispatches[0].price_unit_litres = null;
  assert.ok(firesInvariant(s, 19));
});

test('an empty registry has nothing to say about sales', () => {
  // The sales half stands alone from the herd, so a database with buyers and no
  // animals -- and one with animals and no buyers -- must both be clean.
  const s = salesSnapshot();
  s.destinations = [];
  s.prices = [];
  s.dispatches = [];
  s.payments = [];
  assert.deepEqual(violations(s), []);
});

// ---------------------------------------------------------------------------
// 23-28. People, engagements, packages and the wage ledger
// ---------------------------------------------------------------------------

/**
 * A snapshot carrying two salaried staff, one dihari, and one month paid.
 *
 * Built BY HAND rather than through the write boundary, for the reason
 * salesSnapshot() gives: every corruption below is something the write boundary
 * already refuses, and the invariants exist to catch rows that got in some
 * other way -- a hand-written INSERT, or a rule that did not exist when the row
 * was written.
 */
function labourSnapshot(): RegistrySnapshot {
  const s = salesSnapshot();
  s.people = [
    { id: 'per_imran', identifier: 'imran', name: 'Imran', contact: null, note: null,
      recorded_by: 'adnan', recorded_at: 't' },
    { id: 'per_rashid', identifier: 'rashid', name: 'Rashid', contact: null, note: null,
      recorded_by: 'adnan', recorded_at: 't' },
  ] as never;
  s.engagements = [
    { id: 'eng_imran', person_id: 'per_imran', kind: 'permanent', role: 'milker',
      started_on: '2026-01-01', ended_on: null, end_reason: null, note: null,
      recorded_by: 'adnan', recorded_at: 't' },
    { id: 'eng_rashid', person_id: 'per_rashid', kind: 'daily', role: null,
      started_on: '2026-01-01', ended_on: null, end_reason: null, note: null,
      recorded_by: 'adnan', recorded_at: 't' },
  ] as never;
  s.terms = [
    { id: 'trm_imran', engagement_id: 'eng_imran', effective_from: '2026-01-01',
      cash_minor: 2_500_000, cash_period: 'month', recorded_by: 'adnan',
      recorded_at: 't', note: null },
    { id: 'trm_rashid', engagement_id: 'eng_rashid', effective_from: '2026-01-01',
      cash_minor: 120_000, cash_period: 'day', recorded_by: 'adnan',
      recorded_at: 't', note: null },
  ] as never;
  s.benefits = [
    { id: 'ben_milk', term_id: 'trm_imran', kind: 'milk', quantity: 2, unit: 'L',
      period: 'day', note: null },
    { id: 'ben_room', term_id: 'trm_imran', kind: 'accommodation', quantity: null,
      unit: null, period: null, note: null },
  ] as never;
  s.wagePeriods = [
    { id: 'wag_1', engagement_id: 'eng_imran', kind: 'wage', from_on: '2026-09-01',
      to_on: '2026-09-30', amount_minor: 2_500_000, observed_by: null,
      recorded_by: 'adnan', recorded_at: 't', source_form: 'direct_entry', note: null },
    { id: 'wag_2', engagement_id: 'eng_rashid', kind: 'wage', from_on: '2026-09-14',
      to_on: '2026-09-14', amount_minor: 120_000, observed_by: null,
      recorded_by: 'adnan', recorded_at: 't', source_form: 'direct_entry', note: null },
  ] as never;
  s.wagePayments = [
    { id: 'wpy_1', person_id: 'per_imran', occurred_on: '2026-10-02',
      amount_minor: 2_500_000, method: 'cash', reference: null, observed_by: null,
      recorded_by: 'adnan', recorded_at: 't', note: null },
  ] as never;
  return s;
}

test('the labour fixture is clean', () => {
  assert.deepEqual(violations(labourSnapshot()), []);
});

test('an empty labour half has nothing to say', () => {
  // Labour stands alone from the herd AND from sales, so a database with staff
  // and no buyers -- and one with buyers and no staff -- must both be clean.
  const s = labourSnapshot();
  s.people = [];
  s.engagements = [];
  s.terms = [];
  s.benefits = [];
  s.wagePeriods = [];
  s.wagePayments = [];
  assert.deepEqual(violations(s), []);
});

test('invariant 23 catches two packages effective the same day', () => {
  const s = labourSnapshot();
  s.terms.push({ ...s.terms[0], id: 'trm_dup', cash_minor: 2_600_000 });
  assert.ok(firesInvariant(s, 23));
});

test('invariant 23 catches a wage period with no agreement behind it', () => {
  const s = labourSnapshot();
  s.terms = s.terms.filter((t) => t.engagement_id !== 'eng_imran');
  assert.ok(firesInvariant(s, 23));
});

test('invariant 23 EXEMPTS a bonus, which is a decision rather than a rate', () => {
  const s = labourSnapshot();
  s.terms = [];
  s.wagePeriods = [
    { ...s.wagePeriods[0], id: 'wag_bonus', kind: 'bonus',
      from_on: '2026-09-20', to_on: '2026-09-20', amount_minor: 500_000 },
  ] as never;
  assert.equal(firesInvariant(s, 23), false);
});

test('invariant 24 catches overlapping wage periods -- the one hard rule', () => {
  const s = labourSnapshot();
  s.wagePeriods.push({
    ...s.wagePeriods[0], id: 'wag_overlap',
    from_on: '2026-09-15', to_on: '2026-10-15',
  });
  assert.ok(firesInvariant(s, 24));
});

test('invariant 24 does NOT fire on adjacent periods', () => {
  const s = labourSnapshot();
  s.wagePeriods.push({
    ...s.wagePeriods[0], id: 'wag_oct',
    from_on: '2026-10-01', to_on: '2026-10-31',
  });
  assert.equal(firesInvariant(s, 24), false);
});

test('invariant 25 catches a half-specified benefit', () => {
  const half = labourSnapshot();
  half.benefits[0].unit = null;
  assert.ok(firesInvariant(half, 25));

  const noPeriod = labourSnapshot();
  noPeriod.benefits[0].period = null;
  assert.ok(firesInvariant(noPeriod, 25));

  const unlabelled = labourSnapshot();
  unlabelled.benefits[1].kind = 'other';
  assert.ok(firesInvariant(unlabelled, 25));
});

test('invariant 26 catches every dangling labour reference', () => {
  for (const corrupt of [
    (s: RegistrySnapshot) => { s.engagements[0].person_id = 'per_ghost'; },
    (s: RegistrySnapshot) => { s.terms[0].engagement_id = 'eng_ghost'; },
    (s: RegistrySnapshot) => { s.benefits[0].term_id = 'trm_ghost'; },
    (s: RegistrySnapshot) => { s.wagePeriods[0].engagement_id = 'eng_ghost'; },
    (s: RegistrySnapshot) => { s.wagePayments[0].person_id = 'per_ghost'; },
  ]) {
    const s = labourSnapshot();
    corrupt(s);
    assert.ok(firesInvariant(s, 26), 'a dangling reference must be reported');
  }
});

test('invariant 27 catches a signed cash payment and an unexplained adjustment', () => {
  const negative = labourSnapshot();
  negative.wagePayments[0].amount_minor = -100;
  assert.ok(firesInvariant(negative, 27));

  const bare = labourSnapshot();
  bare.wagePayments[0].method = 'adjustment';
  bare.wagePayments[0].note = null;
  assert.ok(firesInvariant(bare, 27));
});

test('invariant 28 catches every way a staff destination can disagree', () => {
  const staff = (over: Record<string, unknown>) => {
    const s = labourSnapshot();
    s.destinations.push({
      id: 'dst_staff', name: 'Imran milk', kind: 'staff', billable: false, standing: true,
      contact: null, started_on: '2026-01-01', ended_on: null, note: null,
      recorded_by: 'adnan', recorded_at: 't', person_id: 'per_imran', ...over,
    } as never);
    return s;
  };
  assert.deepEqual(violations(staff({})), [], 'the well-formed case is clean');
  assert.ok(firesInvariant(staff({ person_id: null }), 28), 'staff with no person');
  assert.ok(firesInvariant(staff({ kind: 'household' }), 28), 'a person on a non-staff kind');
  assert.ok(firesInvariant(staff({ billable: true }), 28), 'billable staff milk');
  assert.ok(firesInvariant(staff({ person_id: 'per_ghost' }), 28), 'an unknown person');
});

test('invariant 28 catches two milk destinations for one person', () => {
  // Then "what did they take" has two answers.
  const s = labourSnapshot();
  for (const id of ['dst_staff_a', 'dst_staff_b']) {
    s.destinations.push({
      id, name: `Imran milk ${id}`, kind: 'staff', billable: false, standing: true,
      contact: null, started_on: '2026-01-01', ended_on: null, note: null,
      recorded_by: 'adnan', recorded_at: 't', person_id: 'per_imran',
    } as never);
  }
  assert.ok(firesInvariant(s, 28));
});

// ---------------------------------------------------------------------------
// The report lines -- NOT violations, deliberately
// ---------------------------------------------------------------------------

test('overlapping stints are a report line and NOT a violation', () => {
  // The farm asked for overlapping engagements. If either half of this test
  // flips, the model has stopped being what was asked for.
  const s = labourSnapshot();
  s.engagements.push({
    ...s.engagements[0], id: 'eng_imran_night', kind: 'daily',
    role: 'night watchman', started_on: '2026-06-01',
  });
  assert.deepEqual(violations(s), [], 'not a violation');
  const report = labourReport(s, '2026-09-07');
  assert.ok(report.some((l) => l.kind === 'overlapping_engagements'));
  assert.ok(report.some((l) => l.kind === 'multiple_open_engagements'));
});

test('a wage period after somebody left is a report line, not a violation', () => {
  // A final settlement two weeks after leaving looks exactly like this.
  const s = labourSnapshot();
  s.engagements[0].ended_on = '2026-08-31';
  s.engagements[0].end_reason = 'went home';
  assert.deepEqual(violations(s), []);
  assert.ok(
    labourReport(s, '2026-09-07').some((l) => l.kind === 'wage_period_outside_engagement'),
  );
});

test('a figure differing from the agreement is reported, never refused', () => {
  // Expected for any month with leave. The direct analogue of a dispatch billed
  // at a deliberate discount.
  const s = labourSnapshot();
  s.wagePeriods[0].amount_minor = 2_200_000;
  assert.deepEqual(violations(s), []);
  const line = labourReport(s, '2026-09-07').find((l) => l.kind === 'amount_differs_from_term');
  assert.match(line?.detail ?? '', /2200000 for 2026-09-01/);
  assert.match(line?.detail ?? '', /Expected whenever there was leave/);
});

test('an identifier on a record that matches no person is a worklist line', () => {
  // It will name the vet and whoever sold the farm a buffalo. That is the point:
  // it is a list of people to consider adding, not a defect list.
  const s = labourSnapshot();
  s.milkings = [
    { id: 'mlk_1', animal_id: 'BD-0001', occurred_on: '2026-09-01', session: 'morning',
      status: 'measured', yield_litres: 5, reason: null, occurred_time: null,
      observed_by: 'Imran', recorded_by: 'adnan', recorded_at: 't',
      source_form: 'direct_entry', note: null },
    { id: 'mlk_2', animal_id: 'BD-0001', occurred_on: '2026-09-02', session: 'morning',
      status: 'measured', yield_litres: 5, reason: null, occurred_time: null,
      observed_by: 'dr_khan', recorded_by: 'adnan', recorded_at: 't',
      source_form: 'direct_entry', note: null },
  ] as never;
  const report = labourReport(s, '2026-09-07');
  const unknown = report.filter((l) => l.kind === 'unknown_identifier');
  assert.equal(unknown.length, 1, "'Imran' matches 'imran' case-insensitively and is not listed");
  assert.match(unknown[0].detail, /'dr_khan' appears on 1 record/);
});

test('the report is silent until there is somebody on file', () => {
  // Before registry_people has a single row, every identifier in history would
  // be "unknown" -- which would be a page of noise on the first visit.
  const s = labourSnapshot();
  s.people = [];
  s.engagements = [];
  s.terms = [];
  s.benefits = [];
  s.wagePeriods = [];
  s.wagePayments = [];
  s.milkings = [
    { id: 'mlk_1', animal_id: 'BD-0001', occurred_on: '2026-09-01', session: 'morning',
      status: 'measured', yield_litres: 5, reason: null, occurred_time: null,
      observed_by: 'somebody', recorded_by: 'adnan', recorded_at: 't',
      source_form: 'direct_entry', note: null },
  ] as never;
  assert.deepEqual(labourReport(s, '2026-09-07'), []);
});
