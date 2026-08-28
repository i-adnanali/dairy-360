// Tests for the FU-3 capture preconditions (see doubleTakeGuards.ts).
//
// The recognition guard in particular is worth testing hard: it exists because
// a gallery-contents check ALONE passes while recognition is silently broken,
// which was observed for real during the FU-3 smoke test.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  ALLOWED_SUBJECT,
  checkGallery,
  checkRecognition,
  retentionProblems,
} from './doubleTakeGuards';

const EXAMPLE = path.join(
  __dirname, '..', '..', '..', 'double-take', 'config.example.yml',
);

// --- retention config -------------------------------------------------------

test('retention: the committed example config passes', () => {
  assert.deepEqual(retentionProblems(readFileSync(EXAMPLE, 'utf8')), []);
});

test('retention: an omitted save: key is an error, not a pass', () => {
  // The upstream default is TRUE, so silence means "writes face crops".
  const yaml = `
detect:
  match:
    base64: false
  unknown:
    base64: false
detectors:
  deepstack:
    url: http://deepstack:5000
`;
  const problems = retentionProblems(yaml);
  assert.ok(
    problems.some((p) => p.includes('save')),
    `an absent save: key must be reported, got: ${JSON.stringify(problems)}`,
  );
});

test('retention: save: true and base64: box are both caught', () => {
  const yaml = `
detect:
  match:
    save: true
    base64: box
  unknown:
    save: false
    base64: false
detectors:
  deepstack:
    url: x
`;
  const problems = retentionProblems(yaml);
  assert.ok(problems.some((p) => p.includes('save must be false')));
  assert.ok(problems.some((p) => p.includes('base64 must be false')));
});

test('retention: a commented-out setting cannot satisfy the check', () => {
  // Negative control for the comment stripping. Without it, the prose in
  // config.example.yml ("# save: false is the important one") would itself
  // match and the guard would pass on a config that never sets it.
  const yaml = `
detect:
  match:
    # save: false
    # base64: false
  unknown:
    # save: false
    # base64: false
detectors:
  # deepstack:
`;
  const problems = retentionProblems(yaml);
  assert.ok(problems.length >= 3, `comments satisfied the guard: ${JSON.stringify(problems)}`);
  assert.ok(problems.some((p) => p.includes('deepstack')));
});

test('retention: a rekognition block is caught', () => {
  const yaml = `
detect:
  match: {save: false, base64: false}
  unknown: {save: false, base64: false}
detectors:
  deepstack:
    url: x
  rekognition:
    collection_id: double-take
`;
  // Note the inline-map form above deliberately does NOT match the scalar
  // scan, so this case also proves the guard fails closed on a config style it
  // does not understand rather than passing it.
  const problems = retentionProblems(yaml);
  assert.ok(problems.some((p) => p.includes('rekognition')));
});

// --- gallery ----------------------------------------------------------------

test('gallery: exactly the synthetic subject passes', () => {
  const v = checkGallery({ success: true, faces: [ALLOWED_SUBJECT] });
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.deepEqual(v.subjects, [ALLOWED_SUBJECT]);
});

test('gallery: an EMPTY gallery is a failure, not a safe default', () => {
  const v = checkGallery({ success: true, faces: [] });
  assert.equal(v.ok, false);
  assert.ok(
    v.problems.some((p) => p.includes('confidence=0')),
    'the empty-gallery failure must explain WHY empty is bad, not just that it is',
  );
});

test('gallery: any other subject blocks the capture', () => {
  const v = checkGallery({ success: true, faces: [ALLOWED_SUBJECT, 'employee_1'] });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.includes('employee_1')));
});

test('gallery: a failed list response does not read as an empty gallery', () => {
  const v = checkGallery({ success: false });
  assert.equal(v.ok, false);
});

// --- recognition ------------------------------------------------------------

test('recognition: a real match passes', () => {
  const v = checkRecognition({
    success: true,
    predictions: [{ userid: ALLOWED_SUBJECT, confidence: 1 }],
  });
  assert.deepEqual(v, { ok: true, problems: [] });
});

test('recognition: THE RESTART TRAP — enrolled but unrecognised', () => {
  // Exactly what DeepStack returned during the FU-3 smoke test after enrolling
  // without restarting: /face/list said ["synthetic_1"], /face/recognize said
  // unknown/0 on the same image. A capture gated only on the gallery would have
  // run a whole window of confidence: 0 rows.
  const v = checkRecognition({
    success: true,
    predictions: [{ userid: 'unknown', confidence: 0 }],
  });
  assert.equal(v.ok, false);
  assert.ok(
    v.problems.some((p) => p.includes('restart')),
    'the failure must name the restart trap — it is not guessable from the symptom',
  );
});

test('recognition: no face detected is distinguished from no match', () => {
  const v = checkRecognition({ success: true, predictions: [] });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.includes('no face detected')));
});

test('recognition: a zero-confidence self-match is rejected', () => {
  // userid is right but the embedding model returned nothing meaningful.
  const v = checkRecognition({
    success: true,
    predictions: [{ userid: ALLOWED_SUBJECT, confidence: 0 }],
  });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.includes('embedding model')));
});
