// Enrol the single synthetic subject for the Cycle 7 FU-3 window.
//
//   npm run enroll:synthetic -w server
//
// See docs/Cycle7-fu3-double-take-validation.md § open decision 1 and
// double-take/enroll/README.md.
//
// ---------------------------------------------------------------------------
// HARD CONSTRAINT: never import `../db` (open decision 1, inherited from FU-1).
// ---------------------------------------------------------------------------
// `../db` opens dairy.db at module load, so an import alone breaks it. Asserted
// by captureIsolation.test.ts.
//
// WHY THIS IS A SCRIPT AND NOT THREE CURL COMMANDS IN A RUNBOOK
// -------------------------------------------------------------
// Because the obvious three-command version is WRONG in a way that fails
// silently. DeepStack's /face/recognize only sees subjects that were in the
// gallery when the PROCESS STARTED. Enrol, then query without restarting, and
// /face/list reports ["synthetic_1"] while /face/recognize returns
// userid:"unknown" confidence:0 on the very image just enrolled.
//
// A window run in that state produces a full capture of confidence: 0 rows --
// which would pass a naive "non-null confidence" check while proving nothing,
// and would silently reproduce the empty-gallery case this enrolment exists to
// escape. So the restart and the post-restart verification are part of the
// operation, not a step someone might remember.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ALLOWED_SUBJECT, checkGallery, checkRecognition } from './doubleTakeGuards';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ENROLL_DIR = path.join(REPO_ROOT, 'double-take', 'enroll');
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.frigate.yml');

const DEEPSTACK = process.env.DEEPSTACK_URL ?? 'http://127.0.0.1:5051';

/** Compose service name of the detector, for the restart. */
const DEEPSTACK_SERVICE = 'deepstack';

function findEnrollmentImage(): string {
  if (!existsSync(ENROLL_DIR)) {
    throw new Error(`${ENROLL_DIR} does not exist — see double-take/enroll/README.md`);
  }
  const images = readdirSync(ENROLL_DIR).filter((f) => /^synthetic_1\.(jpe?g|png)$/i.test(f));
  if (images.length === 0) {
    throw new Error(
      `no synthetic_1.jpg/.png in ${ENROLL_DIR}.\n` +
        'FU-3 enrols exactly one SYNTHETIC face; see double-take/enroll/README.md for\n' +
        'why it must not be a photograph of a real person, and what provenance to record.',
    );
  }
  if (images.length > 1) {
    throw new Error(`several candidate images in ${ENROLL_DIR}: ${images.join(', ')}`);
  }
  return path.join(ENROLL_DIR, images[0]);
}

/** Fail loudly if the provenance record is missing. The synthetic claim is the
 * entire basis on which enrolling a face here is acceptable, so an unrecorded
 * one is a real problem rather than untidiness. */
function assertProvenanceRecorded(): void {
  const p = path.join(ENROLL_DIR, 'PROVENANCE.txt');
  if (!existsSync(p)) {
    throw new Error(
      `${p} is missing.\n` +
        'Record where the enrolment image came from before enrolling it: "this face is\n' +
        'synthetic" is the only reason this is permitted, so it must be checkable.',
    );
  }
  const text = readFileSync(p, 'utf8');
  if (!/trainedAlgorithmicMedia/.test(text)) {
    console.warn(
      '\n  WARNING: PROVENANCE.txt records no verifiable synthetic-origin claim\n' +
        '  (no IPTC digitalSourceType "trainedAlgorithmicMedia"). The claim is then\n' +
        '  asserted rather than checkable. Continuing, but this should be fixed.\n',
    );
  }
}

async function post(endpoint: string, form?: FormData): Promise<Record<string, unknown>> {
  const res = await fetch(`${DEEPSTACK}${endpoint}`, {
    method: 'POST',
    body: form ?? new FormData(),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${endpoint} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function faceList(): Promise<Record<string, unknown>> {
  return post('/v1/vision/face/list');
}

async function recognize(imagePath: string): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append('image', new Blob([readFileSync(imagePath)]), path.basename(imagePath));
  return post('/v1/vision/face/recognize', form);
}

async function main(): Promise<void> {
  console.log('FU-3 synthetic enrolment');
  console.log('========================\n');

  const image = findEnrollmentImage();
  assertProvenanceRecorded();
  console.log(`  image:    ${path.relative(REPO_ROOT, image)}`);
  console.log(`  detector: ${DEEPSTACK}\n`);

  // --- 1. refuse to inherit a gallery that may hold a real person ----------
  const before = await faceList();
  const beforeSubjects = Array.isArray(before.faces) ? (before.faces as unknown[]) : [];
  const foreign = beforeSubjects.filter((s) => s !== ALLOWED_SUBJECT);
  if (foreign.length > 0) {
    throw new Error(
      `the gallery already holds ${foreign.map((s) => `"${String(s)}"`).join(', ')}.\n` +
        'FU-3 permits exactly one synthetic subject. Anything else may be a real\n' +
        "person's biometric template and must be removed deliberately, not overwritten\n" +
        `by this script. Delete it with:\n` +
        `  curl -X POST -F "userid=<name>" ${DEEPSTACK}/v1/vision/face/delete`,
    );
  }
  console.log(`  gallery before: [${beforeSubjects.map(String).join(', ') || 'empty'}]`);

  // --- 2. enrol ------------------------------------------------------------
  const form = new FormData();
  form.append('image', new Blob([readFileSync(image)]), path.basename(image));
  form.append('userid', ALLOWED_SUBJECT);
  const reg = await post('/v1/vision/face/register', form);
  if (reg.success !== true) {
    throw new Error(`enrolment failed: ${JSON.stringify(reg)}`);
  }
  console.log(`  registered as "${ALLOWED_SUBJECT}": ${String(reg.message ?? 'ok')}`);

  // --- 3. restart, because the gallery is only read at process start -------
  console.log('\n  restarting the detector (its gallery is loaded at process start,');
  console.log('  so without this every face comes back unknown/0) ...');
  execFileSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'restart', DEEPSTACK_SERVICE],
    { stdio: 'inherit' },
  );

  // Wait for it to answer again.
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      await faceList();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('detector did not come back after restart');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // --- 4. verify -- gallery contents AND actual recognition ----------------
  const gallery = checkGallery(await faceList());
  const recognition = checkRecognition(await recognize(image));

  console.log(`\n  gallery after:  [${gallery.subjects.join(', ') || 'empty'}]`);
  const problems = [...gallery.problems, ...recognition.problems];
  if (problems.length > 0) {
    console.error('\nFAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log('  recognition:    resolves "synthetic_1" on its own enrolment image\n');
  console.log('Ready. Next:');
  console.log('  npm run capture:doubletake -w server -- --minutes=20');
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
}
