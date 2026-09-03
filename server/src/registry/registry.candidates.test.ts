// Animal registry -- the link picker's match window and ranking.
//
// The window is a PURE function and is tested as one; the ranking is tested
// against the fixture herd, which already contains the two cases that matter:
// BD-0006 has no birth date at all, and BD-0005 has a year-precision one.
//
// What this replaces on the UI side is the question "is the calf already in the
// registry?", asked as a yes/no with a warning that a wrong answer creates an
// unrepairable duplicate. That asked the operator to recall the contents of a
// database one tab away, with an irreversible penalty, at hour two of a
// transcription session. The list is the query that question was standing in for.

import assert from 'node:assert';
import { test } from 'node:test';

import { recordCalving } from './calving';
import { AS_OF, RECALL, addAcquired, calve, cleanHerd, freshDb } from './fixtures';
import { rebuild } from './projectStore';
import {
  MATCH_WINDOW_DAYS,
  MATCH_WINDOW_YEARS,
  linkCandidates,
  withinMatchWindow,
} from './reads';
import type { DatePrecision } from './types';

const at = (on: string, precision: DatePrecision) => ({ on, precision });

// ---------------------------------------------------------------------------
// The window, by coarsest precision
// ---------------------------------------------------------------------------

test('both dates known to the day: a week either side', () => {
  const proposed = at('2023-06-14', 'day');
  assert.equal(withinMatchWindow(at('2023-06-14', 'day'), proposed), true, 'same day');
  assert.equal(withinMatchWindow(at('2023-06-21', 'day'), proposed), true, `+${MATCH_WINDOW_DAYS.day}`);
  assert.equal(withinMatchWindow(at('2023-06-07', 'day'), proposed), true, `-${MATCH_WINDOW_DAYS.day}`);
  assert.equal(withinMatchWindow(at('2023-06-22', 'day'), proposed), false, 'a day past the window');
  assert.equal(withinMatchWindow(at('2023-06-06', 'day'), proposed), false, 'a day before it');
});

test('either date known only to the month: 45 days, because that is what a month costs', () => {
  // Two month-precision dates both stored on the 1st can be 30 days apart and
  // still describe the same week. A day-grain window would hide the right
  // animal, which is the failure this whole list exists to prevent.
  const proposed = at('2023-06-01', 'month');
  assert.equal(withinMatchWindow(at('2023-05-01', 'month'), proposed), true, 'the month before');
  assert.equal(withinMatchWindow(at('2023-07-01', 'month'), proposed), true, 'the month after');
  assert.equal(withinMatchWindow(at('2023-06-20', 'day'), proposed), true, 'mixed grain widens');
  assert.equal(withinMatchWindow(at('2023-08-01', 'month'), proposed), false, 'two months out');
  assert.ok(MATCH_WINDOW_DAYS.month > MATCH_WINDOW_DAYS.day, 'coarser means wider');
});

test('either date known only to the year: the same calendar year, plus or minus one', () => {
  const proposed = at('2023-01-01', 'year');
  for (const y of ['2022', '2023', '2024']) {
    assert.equal(withinMatchWindow(at(`${y}-01-01`, 'year'), proposed), true, y);
  }
  assert.equal(withinMatchWindow(at('2021-01-01', 'year'), proposed), false, 'two years out');
  assert.equal(withinMatchWindow(at('2025-01-01', 'year'), proposed), false, 'two years out');
  assert.equal(MATCH_WINDOW_YEARS, 1);
});

test('a day-precision calving still matches a year-precision birth in the same year', () => {
  // The common backfill shape: the roster or pass one recorded "2023", and the
  // cycle card gives an exact calving date. Comparing at day grain would put
  // 2023-01-01 and 2023-06-14 five months apart and hide the animal.
  const proposed = at('2023-06-14', 'day');
  assert.equal(withinMatchWindow(at('2023-01-01', 'year'), proposed), true);
  assert.equal(withinMatchWindow(at('2021-01-01', 'year'), proposed), false);
});

test('an ESTIMATED date is compared at year grain, not refused outright', () => {
  // The deliberate divergence from definitelyBefore(), which declines to
  // compare an estimated date at all. That function proves a violation, so a
  // guess is not evidence. This one suggests a match, where a guess is exactly
  // what you want to act on.
  const proposed = at('2023-06-14', 'day');
  assert.equal(withinMatchWindow(at('2023-01-01', 'estimated'), proposed), true);
  assert.equal(withinMatchWindow(at('2024-01-01', 'estimated'), proposed), true, 'within a year');
  assert.equal(withinMatchWindow(at('2020-01-01', 'estimated'), proposed), false);
  // Symmetric: an estimated PROPOSED date behaves the same way.
  assert.equal(
    withinMatchWindow(at('2023-06-14', 'day'), at('2023-01-01', 'estimated')),
    true,
  );
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test('an animal with NO birth date ranks first among the eligible', () => {
  // The likeliest link target of all: the roster pass enters animals without a
  // birth date, and pass one enters a farm-born calf as `acquired` because
  // there are no calvings yet. A proximity filter would rank it nowhere.
  const db = cleanHerd();
  const cands = linkCandidates(db, {
    damId: 'BD-0001',
    calfSex: 'male',
    occurredOn: '2024-06-02',
    datePrecision: 'day',
  });

  const eligible = cands.filter((c) => c.eligible);
  assert.ok(eligible.length > 0, 'the fixture offers something linkable');
  assert.equal(eligible[0].id, 'BD-0006', 'the animal with no birth date leads');
  assert.equal(eligible[0].days_apart, null);
  assert.equal(eligible[0].within_match_window, true, 'unjudgeable is not hidden');
});

test('the eligible are ordered by absolute distance, closest first', () => {
  const db = cleanHerd();
  const cands = linkCandidates(db, {
    damId: 'BD-0001',
    calfSex: 'female',
    occurredOn: '2023-01-01',
    datePrecision: 'year',
  });

  const dated = cands.filter((c) => c.eligible && c.days_apart !== null);
  const distances = dated.map((c) => Math.abs(c.days_apart!));
  assert.deepEqual(
    distances,
    [...distances].sort((a, b) => a - b),
    'ascending by |days_apart|',
  );
});

test('ineligible animals are still returned, with their reason, below the eligible', () => {
  // Kept because an animal MISSING from a picker reads as data loss to the
  // person entering the herd, who stops and goes looking for it. Below,
  // because one at the top is a target the eye lands on and the hand cannot
  // click.
  const db = cleanHerd();
  const cands = linkCandidates(db, {
    damId: 'BD-0001',
    calfSex: 'female',
    occurredOn: '2024-06-02',
    datePrecision: 'day',
  });

  const herdSize = cands.length;
  assert.ok(herdSize >= 6, 'EVERY animal appears');

  const firstIneligible = cands.findIndex((c) => !c.eligible);
  if (firstIneligible !== -1) {
    assert.ok(
      cands.slice(firstIneligible).every((c) => !c.eligible),
      'once ineligible starts, it does not go back',
    );
  }
  for (const c of cands.filter((x) => !x.eligible)) {
    assert.ok(
      c.ineligible_reason !== null && c.ineligible_reason.length > 0,
      `${c.id} is greyed and says why`,
    );
  }

  const dam = cands.find((c) => c.id === 'BD-0001')!;
  assert.equal(dam.eligible, false);
  assert.match(dam.ineligible_reason!, /cannot be its own calf/);
});

test('the order is total and stable, so two calls agree', () => {
  const db = cleanHerd();
  const opts = {
    damId: 'BD-0001',
    calfSex: 'female' as const,
    occurredOn: '2024-06-02',
    datePrecision: 'day' as const,
  };
  assert.deepEqual(
    linkCandidates(db, opts).map((c) => c.id),
    linkCandidates(db, opts).map((c) => c.id),
  );
});

test('with no proposed date, nothing is judged and nothing is hidden', () => {
  // The endpoint tolerates a missing date. "Could not judge" must resolve
  // toward showing the animal, never toward hiding it.
  const db = cleanHerd();
  const cands = linkCandidates(db, { damId: 'BD-0001' });
  assert.ok(cands.length >= 6);
  assert.ok(cands.every((c) => c.days_apart === null));
  assert.ok(cands.every((c) => c.within_match_window));
});

test('days_apart is signed, so a UI can say "before" or "after"', () => {
  const db = cleanHerd();
  // BD-0005 was born 2023-01-01 (year precision). A calving proposed a year
  // later puts its birth date in the past.
  const cands = linkCandidates(db, {
    damId: 'BD-0001',
    calfSex: 'female',
    occurredOn: '2024-01-01',
    datePrecision: 'year',
  });
  const five = cands.find((c) => c.id === 'BD-0005')!;
  assert.equal(five.days_apart, 365, '2023-01-01 to 2024-01-01; 2023 is not a leap year');
});

// ---------------------------------------------------------------------------
// An animal that has calved is not a newborn
// ---------------------------------------------------------------------------

/** A dam, plus an acquired female who has a calving of her own. */
function herdWithAYoungDam(calfOwnCalving: string): ReturnType<typeof freshDb> {
  const db = freshDb();
  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    name: 'Bholi',
    acquired_on: '2016-01-01',
    acquired_precision: 'year',
    birth_on: '2012-01-01',
    birth_precision: 'estimated',
  });
  addAcquired(db, {
    id: 'BD-0002',
    sex: 'female',
    name: 'Bhoori',
    acquired_on: '2021-01-01',
    acquired_precision: 'year',
    birth_on: '2021-01-01',
    birth_precision: 'year',
  });
  calve(db, { dam_id: 'BD-0002', on: calfOwnCalving, precision: 'month' });
  rebuild(db, { asOf: AS_OF });
  return db;
}

test('the picker greys an animal that calved too soon after the proposed birth date', () => {
  // The demonstrated defect: this animal was returned ELIGIBLE, and
  // recordCalving accepted her, turning a lactating dam into a newborn calf
  // with every invariant still passing.
  const db = herdWithAYoungDam('2021-10-01');
  const cands = linkCandidates(db, {
    damId: 'BD-0001',
    calfSex: 'female',
    occurredOn: '2021-06-01',
    datePrecision: 'month',
  });

  const her = cands.find((c) => c.id === 'BD-0002')!;
  assert.equal(her.eligible, false);
  assert.match(her.ineligible_reason!, /conceived before it was born/);
  assert.match(her.ineligible_reason!, /2021-10-01/, 'it names the offending calving');
  db.close();
});

test('the picker still offers a dam whose own calvings are years later', () => {
  const db = herdWithAYoungDam('2025-03-01');
  const cands = linkCandidates(db, {
    damId: 'BD-0001',
    calfSex: 'female',
    occurredOn: '2021-06-01',
    datePrecision: 'month',
  });
  const her = cands.find((c) => c.id === 'BD-0002')!;
  assert.equal(her.eligible, true, 'a legitimate late reconciliation stays clickable');
  assert.equal(her.ineligible_reason, null);
  db.close();
});

// ---------------------------------------------------------------------------
// The picker and recordCalving must agree -- exhaustively
// ---------------------------------------------------------------------------

/**
 * The picker's contract is that `eligible` means "recordCalving will take
 * this", and it is asserted here directly rather than per-rule: every eligible
 * candidate links, every ineligible one is refused.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CATCHES, AND WHAT IT PROVABLY DOES NOT
 * ---------------------------------------------------------------------------
 * It catches DRIFT between two implementations of one rule set, which this
 * module has already shipped once: the first picker marked animals eligible
 * that recordCalving then refused, because it was missing the timeline rule.
 * Per-rule tests cannot see that, since each side is tested against its own
 * idea of the rule.
 *
 * It does NOT catch a rule that is wrong in BOTH places -- and that is not a
 * weakness to fix, it is the shape of the instrument. Measured: with the
 * gestation floor removed from the shared predicate, the three tests above go
 * red and this one stays GREEN, because the picker and recordCalving agree
 * perfectly on the wrong answer. Which is the third corollary in
 * REGISTRY_ENTRY_UX.md section 3 arriving again: a consistency check finds the
 * row that disagrees with its neighbours and is blind to a whole column that is
 * evenly false. The gestation bug was found by reading a screen and knowing the
 * animal was wrong, and nothing else was ever going to find it.
 *
 * So: this guards the seam, the tests above guard the rule, and neither
 * substitutes for the other.
 */
function assertPickerAgreesWithRecordCalving(
  label: string,
  herd: () => ReturnType<typeof freshDb>,
  opts: { damId: string; calfSex: 'female' | 'male'; occurredOn: string; datePrecision: DatePrecision },
): void {
  const probe = herd();
  const cands = linkCandidates(probe, opts);
  probe.close();

  assert.ok(cands.length >= 3, `${label}: the whole herd is judged`);
  assert.ok(
    cands.some((c) => c.eligible) && cands.some((c) => !c.eligible),
    `${label}: both verdicts occur, so neither branch passes vacuously`,
  );

  for (const c of cands) {
    // A fresh herd per attempt: recordCalving writes, and a link must not be
    // judged against a database an earlier link already changed.
    const db = herd();
    let refusal: (Error & { code?: string }) | null = null;
    try {
      recordCalving(db, {
        dam_id: opts.damId,
        occurred_on: opts.occurredOn,
        date_precision: opts.datePrecision,
        calf: { existing_id: c.id, sex: opts.calfSex, outcome: 'live' },
        provenance: RECALL,
        asOf: AS_OF,
      });
    } catch (e) {
      refusal = e as Error & { code?: string };
    }
    db.close();

    if (c.eligible) {
      assert.equal(
        refusal,
        null,
        `${label}: picker says ${c.id} is linkable, recordCalving refused: ${refusal?.message}`,
      );
    } else {
      assert.ok(
        refusal !== null,
        `${label}: picker greys ${c.id} (${c.ineligible_reason}), recordCalving accepted it`,
      );
    }
  }
}

test('every animal the picker calls eligible is one recordCalving accepts', () => {
  assertPickerAgreesWithRecordCalving('fixture herd', cleanHerd, {
    damId: 'BD-0001',
    calfSex: 'female',
    // Far from every existing calving in the fixture, so the dam's own
    // double-entry guard cannot confound the result.
    occurredOn: '2020-01-01',
    datePrecision: 'month',
  });
});

test('the two agree on a herd that exercises the gestation floor', () => {
  // The fixture herd never trips that rule at any date, so the seam over it
  // would otherwise be untested -- the case for which one side could gain the
  // rule and the other not.
  assertPickerAgreesWithRecordCalving(
    'young-dam herd',
    () => {
      const db = herdWithAYoungDam('2021-10-01');
      addAcquired(db, {
        id: 'BD-0009',
        sex: 'female',
        name: 'Chandni',
        acquired_on: '2020-01-01',
        acquired_precision: 'year',
      });
      rebuild(db, { asOf: AS_OF });
      return db;
    },
    { damId: 'BD-0001', calfSex: 'female', occurredOn: '2021-06-01', datePrecision: 'month' },
  );
});
