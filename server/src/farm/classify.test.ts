// Unit tests for the pure classification core (Cycle 5; see
// docs/FARM_MONITOR.md). Runs under plain `npm test -w server`: node:test via
// tsx, no database, no API key, no running server -- the same bar ingest.test.ts
// meets, and the reason classify.ts holds no `../db` import.
//
// These assert the RULES against the real scenario library, not against
// hand-picked numbers: the fixtures imported below are the same consts the
// Cycle 4 generator replays, so a scenario edit that invalidates a threshold
// fails here rather than silently drifting.

import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { FarmEvent } from '@dairy/shared';
import {
  CONFIDENCE,
  FARM_TZ,
  RECURRENCE,
  RESTRICTED_ZONES,
  RULE,
  WORK_HOURS,
  farmDayBoundsUtc,
  farmLocalDate,
  isOffHours,
  lookbackStartIso,
  scoreEvent,
} from './classify';
import {
  ENROLLED_IDENTITIES,
  LOW_CONFIDENCE_MATCH,
  NIGHT_VISITOR_UNKNOWN,
  NORMAL_WEEKDAY,
  RECURRING_UNKNOWN_VISITOR,
  SCENARIOS,
  UNKNOWN_CLUSTER_A1,
  ZONES,
} from './scenarios';

// --- helpers ----------------------------------------------------------------

type Scorable = Pick<FarmEvent, 'zone' | 'event_type' | 'confidence' | 'occurred_at'>;

/** An instant at a given farm-local wall time. Built by searching rather than
 * by assuming an offset, so these tests never encode UTC+5 as a literal. */
function atFarmLocal(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const targetMin = h * 60 + m;
  // Farm-local midnight, then step forward to the requested minute.
  const { startIso } = farmDayBoundsUtc(date);
  return new Date(new Date(startIso).getTime() + targetMin * 60_000).toISOString();
}

const IN_HOURS = atFarmLocal('2026-08-10', '09:00');
const OFF_HOURS = atFarmLocal('2026-08-10', '02:14');

function ev(over: Partial<Scorable> = {}): Scorable {
  return {
    zone: ZONES.gate,
    event_type: 'detection',
    confidence: 0.9,
    occurred_at: IN_HOURS,
    ...over,
  };
}

// --- constants sanity -------------------------------------------------------

test('MATCH_CONFIDENT separates the scenario library cleanly', () => {
  // Every face_match confidence the fixtures declare, on the stored 0..1 scale.
  const faceConfidences = Object.values(SCENARIOS).flatMap((s) =>
    (s.expect.rows ?? [])
      .filter((r) => r.event_type === 'face_match')
      .map((r) => r.confidence as number),
  );
  const below = faceConfidences.filter((c) => c < CONFIDENCE.MATCH_CONFIDENT);
  const above = faceConfidences.filter((c) => c >= CONFIDENCE.MATCH_CONFIDENT);

  assert.deepEqual(below, [0.386], 'only low-confidence-match falls below threshold');
  assert.equal(above.length, 4, 'the other four face matches are confident');
  // The band the threshold must sit inside.
  assert.ok(CONFIDENCE.MATCH_CONFIDENT > Math.max(...below));
  assert.ok(CONFIDENCE.MATCH_CONFIDENT <= Math.min(...above));
});

test('MATCH_CONFIDENT is not applied to detection rows', () => {
  // Detection scores in the library straddle the threshold; the lowest is 0.72.
  const detectionConfidences = Object.values(SCENARIOS).flatMap((s) =>
    (s.expect.rows ?? [])
      .filter((r) => r.event_type === 'detection')
      .map((r) => r.confidence as number),
  );
  const belowThreshold = detectionConfidences.filter((c) => c < CONFIDENCE.MATCH_CONFIDENT);
  assert.ok(belowThreshold.length > 0, 'the library really does have sub-threshold detections');

  // Every one of them must still score routine in an unrestricted zone.
  for (const confidence of belowThreshold) {
    const v = scoreEvent(ev({ event_type: 'detection', confidence }));
    assert.equal(v.severity, 'routine', `detection at ${confidence} must stay routine`);
  }
});

test('RECURRENCE compares occurrence number, not prior count', () => {
  const unknown = { event_type: 'unknown_cluster' as const, confidence: 0.09 };
  // priorSightingCount -> expected severity, per Decision 3's gradient.
  assert.equal(scoreEvent(ev(unknown), 0).severity, 'notable', 'occurrence 1');
  assert.equal(scoreEvent(ev(unknown), 1).severity, 'notable', 'occurrence 2');
  assert.equal(scoreEvent(ev(unknown), 2).severity, 'urgent', 'occurrence 3');
  assert.equal(scoreEvent(ev(unknown), 5).severity, 'urgent', 'occurrence 6');

  // The off-by-one this guards against: comparing the raw prior count would
  // make occurrence 1 routine and occurrence 3 merely notable.
  assert.equal(scoreEvent(ev(unknown), 0).occurrenceNumber, 1);
  assert.equal(scoreEvent(ev(unknown), 2).occurrenceNumber, RECURRENCE.URGENT_AFTER);
});

test('LOOKBACK_DAYS covers recurring-unknown-visitor with real margin', () => {
  const offsets = RECURRING_UNKNOWN_VISITOR.events
    .filter((e) => e.source === 'double_take')
    .map((e) => e.offsetMs);
  assert.equal(offsets.length, 3, 'three unknown_cluster sightings');

  const spanDays = (Math.max(...offsets) - Math.min(...offsets)) / 86_400_000;
  assert.ok(
    RECURRENCE.LOOKBACK_DAYS > spanDays,
    `lookback ${RECURRENCE.LOOKBACK_DAYS}d must exceed the ${spanDays}d sighting span`,
  );
  // Not "barely": require a wide margin so a scenario edit has room.
  assert.ok(
    RECURRENCE.LOOKBACK_DAYS - spanDays >= 14,
    `margin ${RECURRENCE.LOOKBACK_DAYS - spanDays}d should be comfortable, not marginal`,
  );

  // And the window really does reach back past the oldest sighting.
  const newest = atFarmLocal('2026-08-10', '01:40');
  const oldest = new Date(new Date(newest).getTime() - spanDays * 86_400_000).toISOString();
  assert.ok(lookbackStartIso(newest) < oldest, 'oldest sighting falls inside the window');
});

test('RESTRICTED_ZONES excludes gate, which recurring-unknown-visitor needs', () => {
  assert.ok(RESTRICTED_ZONES.has(ZONES.feedStore), 'feed_store is restricted');
  // Load-bearing: recurring-unknown-visitor fires in gate at 01:40 (off-hours).
  // If gate were restricted, rule 1 would make occurrence 1 urgent and destroy
  // the notable -> urgent gradient.
  assert.ok(!RESTRICTED_ZONES.has(ZONES.gate), 'gate must NOT be restricted');
  assert.equal(RECURRING_UNKNOWN_VISITOR.startTime, '01:40:00');
});

// --- farm-local time --------------------------------------------------------

test('off-hours is computed in FARM_TZ, not host-local', () => {
  assert.equal(FARM_TZ, 'Asia/Karachi');

  // Each scenario's declared start time, judged in farm-local terms.
  const expectations: [string, boolean][] = [
    ['05:30', false], // normal-weekday, absent-employee
    ['06:00', false], // camera-dropout
    ['19:20', false], // low-confidence-match -- inside 04:00-20:00
    ['02:14', true], // night-visitor-unknown
    ['01:40', true], // recurring-unknown-visitor
  ];
  for (const [hhmm, expected] of expectations) {
    assert.equal(
      isOffHours(atFarmLocal('2026-08-10', hhmm)),
      expected,
      `${hhmm} farm-local off-hours should be ${expected}`,
    );
  }
});

test('WORK_HOURS boundaries are inclusive of start, exclusive of end', () => {
  assert.equal(isOffHours(atFarmLocal('2026-08-10', WORK_HOURS.start)), false);
  assert.equal(isOffHours(atFarmLocal('2026-08-10', WORK_HOURS.end)), true);
  assert.equal(isOffHours(atFarmLocal('2026-08-10', '03:59')), true);
  assert.equal(isOffHours(atFarmLocal('2026-08-10', '19:59')), false);
});

test('farm-local date and day bounds round-trip', () => {
  const { startIso, endIso } = farmDayBoundsUtc('2026-08-10');
  assert.equal(farmLocalDate(startIso), '2026-08-10', 'start is inside the day');
  assert.equal(farmLocalDate(endIso), '2026-08-11', 'end is the next day, exclusive');
  // A 01:40 farm-local instant belongs to its farm date even though, at UTC+5,
  // its UTC form is the previous calendar day.
  const earlyHours = atFarmLocal('2026-08-10', '01:40');
  assert.equal(farmLocalDate(earlyHours), '2026-08-10');
  assert.ok(earlyHours < startIso === false, 'still at/after farm midnight');
  assert.equal(new Date(endIso).getTime() - new Date(startIso).getTime(), 86_400_000);
});

// --- priority order (Decision 8) -------------------------------------------

test('rule 1 overrides recurrence and confidence, for any event_type', () => {
  const restricted = { zone: ZONES.feedStore, occurred_at: OFF_HOURS };

  // A detection with no identity at all.
  const detection = scoreEvent(ev({ ...restricted, event_type: 'detection', confidence: 0.81 }));
  assert.equal(detection.severity, 'urgent');
  assert.equal(detection.reason, RULE.RESTRICTED_OFF_HOURS);

  // An unknown cluster on its FIRST occurrence -- rule 2 alone would say
  // notable; rule 1 must win.
  const firstSighting = scoreEvent(
    ev({ ...restricted, event_type: 'unknown_cluster', confidence: 0.084 }),
    0,
  );
  assert.equal(firstSighting.severity, 'urgent');
  assert.equal(firstSighting.reason, RULE.RESTRICTED_OFF_HOURS);

  // A confident face match -- rule 3 would say routine; rule 1 must win.
  const confident = scoreEvent(
    ev({ ...restricted, event_type: 'face_match', confidence: 0.97 }),
  );
  assert.equal(confident.severity, 'urgent');
  assert.equal(confident.reason, RULE.RESTRICTED_OFF_HOURS);
});

test('restricted zone during work hours is not urgent on rule 1 alone', () => {
  const v = scoreEvent(
    ev({ zone: ZONES.feedStore, event_type: 'detection', confidence: 0.81, occurred_at: IN_HOURS }),
  );
  assert.equal(v.severity, 'routine', 'the zone alone is not the anomaly');
});

test('off-hours in an unrestricted zone is not urgent on rule 1 alone', () => {
  const v = scoreEvent(
    ev({ zone: ZONES.gate, event_type: 'detection', confidence: 0.84, occurred_at: OFF_HOURS }),
  );
  assert.equal(v.severity, 'routine', 'the hour alone is not the anomaly');
});

test('rule 3 fires only for face_match below threshold', () => {
  const low = scoreEvent(ev({ event_type: 'face_match', confidence: 0.386 }));
  assert.equal(low.severity, 'notable');
  assert.equal(low.reason, RULE.LOW_CONFIDENCE_MATCH);

  const high = scoreEvent(ev({ event_type: 'face_match', confidence: 0.942 }));
  assert.equal(high.severity, 'routine');
  assert.equal(high.reason, RULE.ROUTINE);

  // A face_match with no confidence at all is not evidence of a bad match.
  const none = scoreEvent(ev({ event_type: 'face_match', confidence: null }));
  assert.equal(none.severity, 'routine');
});

test('a null zone never matches a restricted zone', () => {
  const v = scoreEvent(ev({ zone: null, event_type: 'detection', occurred_at: OFF_HOURS }));
  assert.equal(v.severity, 'routine');
});

// --- whole-scenario traces (Decision 8's table) -----------------------------

/** Score a scenario's expected rows in declaration order, threading occurrence
 * numbers per cluster identity the way classifyEvent would. */
function traceScenario(name: string, startHhmm: string): string[] {
  const scenario = SCENARIOS[name];
  const seen = new Map<string, number>();
  return (scenario.expect.rows ?? []).map((row) => {
    const identity = row.identity ?? null;
    let prior = 0;
    if (row.event_type === 'unknown_cluster' && identity) {
      prior = seen.get(identity) ?? 0;
      seen.set(identity, prior + 1);
    }
    return scoreEvent(
      {
        zone: row.zone ?? null,
        event_type: row.event_type as FarmEvent['event_type'],
        confidence: row.confidence ?? null,
        occurred_at: atFarmLocal('2026-08-10', startHhmm),
      },
      prior,
    ).severity;
  });
}

test('normal-weekday: every row routine', () => {
  assert.deepEqual(traceScenario(NORMAL_WEEKDAY.name, '05:30'), [
    'routine',
    'routine',
    'routine',
    'routine',
    'routine',
  ]);
});

test('night-visitor-unknown: all three rows urgent', () => {
  assert.deepEqual(traceScenario(NIGHT_VISITOR_UNKNOWN.name, '02:14'), [
    'urgent',
    'urgent',
    'urgent',
  ]);
});

test('recurring-unknown-visitor: notable at 1, urgent by 3', () => {
  // Declaration order is detection, cluster, detection, cluster, detection,
  // cluster -- so the clusters land at indices 1, 3, 5.
  assert.deepEqual(traceScenario(RECURRING_UNKNOWN_VISITOR.name, '01:40'), [
    'routine',
    'notable',
    'routine',
    'notable',
    'routine',
    'urgent',
  ]);
});

test('low-confidence-match: detection routine, face match notable', () => {
  assert.deepEqual(traceScenario(LOW_CONFIDENCE_MATCH.name, '19:20'), ['routine', 'notable']);
});

test('camera-dropout and absent-employee produce no per-event flags', () => {
  for (const [name, hhmm] of [
    ['camera-dropout', '06:00'],
    ['absent-employee', '05:30'],
  ] as const) {
    const severities = traceScenario(name, hhmm);
    assert.ok(
      severities.every((s) => s === 'routine'),
      `${name} must flag nothing per-event; got ${severities.join(', ')}`,
    );
  }
});

// --- fixture guards ---------------------------------------------------------

test('the cluster id shared across two scenarios is still shared', () => {
  // This is WHY per-scenario reset is a standing rule (Decision 2). If a future
  // edit gives each scenario its own cluster id, that rule can relax -- and
  // this test should be the thing that notices.
  const usesA1 = Object.values(SCENARIOS).filter((s) =>
    (s.expect.rows ?? []).some((r) => r.identity === UNKNOWN_CLUSTER_A1),
  );
  assert.equal(usesA1.length, 2, 'unknown_a1 still appears in exactly two scenarios');
});

test('absent-employee asserts an enrolled identity is missing', () => {
  const absent = SCENARIOS['absent-employee'].expect.absentIdentities ?? [];
  assert.deepEqual(absent, ['employee_3']);
  for (const id of absent) {
    assert.ok(ENROLLED_IDENTITIES.has(id), `${id} must be enrolled for absence to mean anything`);
  }
});
