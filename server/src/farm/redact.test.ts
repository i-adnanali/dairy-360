// Tests for the Double Take capture's biometric redactor (Cycle 7 FU-3).
//
// This is the mechanical half of the slice's non-negotiable success condition:
// "no raw face crop from a real, unconsented individual survives the capture".
// The condition is enforced by redact.ts and asserted here -- not by a comment
// and not by a manual cleanup step, following the precedent
// captureIsolation.test.ts set for the DB-isolation decision.
//
// Two properties matter equally and are both tested:
//   1. image bytes never survive; and
//   2. the SHAPE is preserved, because a redactor that corrupted the shape
//      would silently invalidate the deltas list the slice exists to produce.

import assert from 'node:assert';
import { test } from 'node:test';
import {
  MAX_STRING_LENGTH,
  REDACTED,
  containsInlineImage,
  redactBiometrics,
} from './redact';
import { shapePaths } from './payloadShape';

/** A base64 JPEG is tens of thousands of chars; this stands in for one. */
const FAKE_IMAGE = 'data:image/jpeg;base64,'.concat('/9j/4AAQSkZJRgABAQ'.repeat(400));

/** A real `double-take/cameras/<camera>` payload, as reconstructed from Double
 * Take's own source in the FU-3 validation pass -- including the undocumented
 * `checks` and `personCount` fields. */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1787000000.123456-abcdef',
    duration: 2.11,
    timestamp: '2026-08-28T07:41:03.512Z',
    attempts: 3,
    camera: 'test_street_cam',
    zones: [],
    matches: [],
    misses: [],
    unknowns: [
      {
        name: 'unknown',
        confidence: 32.5,
        match: false,
        box: { top: 227, left: 485, width: 445, height: 579 },
        checks: ['confidence too low: 32.5 < 40'],
        type: 'latest',
        duration: 0.84,
        detector: 'deepstack',
        filename: 'dcb772de-d8e8-4074-9bce-15dbba5955c5.jpg',
        base64: null,
      },
    ],
    personCount: 1,
    counts: { person: 1, match: 0, miss: 0, unknown: 1 },
    ...over,
  };
}

/** Deep-clone via JSON, so mutation of the input is detectable. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// --- image bytes never survive ---------------------------------------------

test('redact: a base64 face image is replaced', () => {
  const p = payload();
  (p.unknowns as Record<string, unknown>[])[0].base64 = FAKE_IMAGE;

  const r = redactBiometrics(p);
  assert.equal(r.byKey, 1);
  assert.equal(r.byLength, 0);
  assert.deepEqual(r.paths, ['unknowns[].base64']);

  const out = r.value as typeof p;
  assert.equal((out.unknowns as Record<string, unknown>[])[0].base64, REDACTED);
  assert.equal(containsInlineImage(out), false);
});

test('redact: base64 is caught in every array a face can arrive in', () => {
  const face = (over: Record<string, unknown>) => ({
    name: 'x', confidence: 1, match: false, box: {}, base64: FAKE_IMAGE, ...over,
  });
  const p = payload({
    matches: [face({ name: 'synthetic_1' })],
    misses: [face({ name: 'synthetic_1' })],
    unknowns: [face({ name: 'unknown' }), face({ name: 'unknown' })],
    // the double-take/matches/<name> and /matches/unknown topics use singulars
    match: face({ name: 'synthetic_1' }),
    unknown: face({ name: 'unknown' }),
  });

  const r = redactBiometrics(p);
  assert.equal(r.byKey, 6, 'every base64 across arrays and singulars');
  assert.equal(containsInlineImage(r.value), false);
});

test('redact: a long string is caught even under an unexpected key', () => {
  // Belt and braces: a future field carrying image data under another name.
  const p = payload({ thumbnail_we_have_never_seen: FAKE_IMAGE });
  const r = redactBiometrics(p);
  assert.equal(r.byKey, 0);
  assert.equal(r.byLength, 1, 'caught by length, not by key');
  assert.deepEqual(r.paths, ['thumbnail_we_have_never_seen']);
  assert.equal(containsInlineImage(r.value), false);
});

test('redact: the length rule leaves realistic payload strings alone', () => {
  // Every string in a real payload is short: ids, uuids, camera names, a
  // `checks` sentence. FU-1 measured Frigate's longest at under 200 chars.
  const r = redactBiometrics(payload());
  assert.equal(r.byKey, 0);
  assert.equal(r.byLength, 0);
  assert.deepEqual(r.paths, []);
});

test('redact: the length threshold is applied at the boundary, not approximately', () => {
  const under = { s: 'a'.repeat(MAX_STRING_LENGTH) };
  const over = { s: 'a'.repeat(MAX_STRING_LENGTH + 1) };
  assert.equal(redactBiometrics(under).byLength, 0);
  assert.equal(redactBiometrics(over).byLength, 1);
});

// --- shape is preserved ----------------------------------------------------

test('redact: SHAPE is preserved exactly -- the deltas list stays valid', () => {
  const p = payload();
  (p.unknowns as Record<string, unknown>[])[0].base64 = FAKE_IMAGE;

  const before = shapePaths(p);
  const after = shapePaths(redactBiometrics(p).value);

  assert.deepEqual(
    [...after.entries()].sort(),
    [...before.entries()].sort(),
    'redaction changed the shape — the capture would report deltas caused by ' +
      'this module rather than by Double Take',
  );
  // Specifically: base64 must still be reported as a string, not absent/null.
  assert.equal(after.get('unknowns[].base64'), 'string');
});

test('redact: base64:null is left as null, not rewritten', () => {
  // This is the real shape of an instance with base64 disabled. Replacing it
  // with a string would fabricate a type_changed delta against the documented
  // `"base64": null`.
  const r = redactBiometrics(payload());
  const out = r.value as ReturnType<typeof payload>;
  assert.equal((out.unknowns as Record<string, unknown>[])[0].base64, null);
  assert.equal(shapePaths(out).get('unknowns[].base64'), 'null');
});

test('redact: the input is not mutated', () => {
  const p = payload();
  (p.unknowns as Record<string, unknown>[])[0].base64 = FAKE_IMAGE;
  const snapshot = clone(p);
  redactBiometrics(p);
  assert.deepEqual(p, snapshot, 'redactBiometrics mutated its argument');
});

test('redact: non-redacted values survive byte-identically', () => {
  const p = payload();
  (p.unknowns as Record<string, unknown>[])[0].base64 = FAKE_IMAGE;
  const out = redactBiometrics(p).value as Record<string, unknown>;

  const strip = (v: Record<string, unknown>) => {
    const c = clone(v);
    (c.unknowns as Record<string, unknown>[])[0].base64 = null;
    return c;
  };
  const expected = strip(p);
  const actual = strip(out);
  assert.deepEqual(actual, expected, 'something other than base64 changed');
});

// --- the guard is not vacuous ----------------------------------------------

test('containsInlineImage: detects what the redactor is meant to remove', () => {
  // Negative control. If this returned false on un-redacted input, every
  // assertion above would pass vacuously.
  const p = payload();
  (p.unknowns as Record<string, unknown>[])[0].base64 = FAKE_IMAGE;
  assert.equal(containsInlineImage(p), true, 'the detector does not detect');
  assert.equal(containsInlineImage(payload()), false, 'false positive on a clean payload');
  assert.equal(containsInlineImage({ deep: [{ base64: FAKE_IMAGE }] }), true);
  assert.equal(containsInlineImage({ s: 'a'.repeat(MAX_STRING_LENGTH + 1) }), true);
});

test('containsInlineImage: the sentinel itself is not flagged', () => {
  assert.equal(containsInlineImage({ base64: REDACTED }), false);
});
