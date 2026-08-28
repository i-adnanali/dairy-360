// Retention/config guard for the Cycle 7 FU-3 Double Take stack.
// See docs/Cycle7-fu3-double-take-validation.md, finding 6 layer (b).
//
// WHY THIS TEST EXISTS
// --------------------
// FU-3 points a face recogniser at a street-facing camera, so it processes the
// faces of members of the public who have not consented. The slice's
// non-negotiable success condition is that no face crop or embedding from such
// a person survives the capture window.
//
// Three of the settings that make that true are ORDINARY-LOOKING CONFIG LINES:
//
//   detect.match.save        default TRUE  -> writes face crops, purged after 168h
//   detect.unknown.save      default TRUE  -> writes face crops, purged after 8h
//   detect.*.base64          default false -> puts image bytes in the MQTT payload
//
// Two of those DEFAULT TO ON. So the privacy posture here is not "we did not
// enable anything dangerous" -- it is "we explicitly turned off things that are
// on by default", which is exactly the kind of statement that a later edit, a
// merge, or a copy-paste from upstream docs silently reverses.
//
// The other half is `detectors.rekognition`: adding that one key would ship
// strangers' faces to a cloud service. Its absence is a security property, and
// absences are precisely what nobody notices breaking.
//
// This asserts all of it against the COMMITTED example config and the compose
// file, the same way captureStack.test.ts asserts compose project isolation --
// by reading the files, with no yaml dependency and nothing running.
//
// WHAT THIS TEST CANNOT CATCH
// ---------------------------
// It reads `double-take/config.example.yml`, not the gitignored
// `double-take/config.yml` that Double Take actually loads (that file does not
// exist on a fresh clone, so a test requiring it would fail for everyone else).
// If the two drift, this guard is checking the wrong file -- so
// `capture:doubletake` re-checks the LIVE instance's effective config at
// runtime, and refuses to capture if it disagrees. Config-file guard here,
// live guard there; neither alone is enough.

import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DT_CONFIG = path.join(REPO_ROOT, 'double-take', 'config.example.yml');
const COMPOSE = path.join(REPO_ROOT, 'docker-compose.frigate.yml');

const read = (p: string): string => readFileSync(p, 'utf8');

/** Strip comments so a setting mentioned in prose cannot satisfy an assertion.
 * Without this, the long explanatory comment above `save: false` would itself
 * match a naive regex and the guard would pass on a config that sets the
 * opposite. */
function withoutComments(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

/** Value of a `key: value` line at any indentation, comments removed. */
function settings(text: string, key: string): string[] {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)\\s*$`, 'gm');
  return [...withoutComments(text).matchAll(re)].map((m) => m[1]);
}

// --- retention: the crops must never be written -----------------------------

// ---------------------------------------------------------------------------
// READ THIS BEFORE TRUSTING THE NEXT TEST.
// ---------------------------------------------------------------------------
// It asserts the CONFIG SAYS crops are disabled. It does NOT prove no crop is
// written, and for `detect.match.save` upstream actively disagrees:
//
//   process.util.js:67  ->  if (foundMatch || (UNKNOWN.SAVE && totalFaces))
//
// `MATCH.SAVE` is never consulted, so any face clearing the match threshold has
// its crop written whatever this setting says. Measured during Cycle 7 FU-3:
// 7 crops in /.storage/matches/ and 3 in /.storage/latest/ with BOTH save keys
// false. Tracked as docs/cycle-7-followups.md § FU-6.
//
// The test is still worth having -- it pins the intent, catches a config that
// drifts back to the upstream default, and `unknown.save` genuinely does work.
// But "this test passes" must not be read as "no face crop exists on disk".
test('double take config disables face-crop saving for BOTH match and unknown', () => {
  const cfg = read(DT_CONFIG);
  const saves = settings(cfg, 'save');

  assert.equal(
    saves.length,
    2,
    `expected exactly two "save:" settings (detect.match and detect.unknown), found ${saves.length}. ` +
      'Both default to TRUE upstream, so a missing one is a config that writes ' +
      "strangers' face crops to disk.",
  );
  assert.deepEqual(
    saves,
    ['false', 'false'],
    'a "save: true" would make Double Take write a face crop per detection into ' +
      'its .storage volume (purged only after 8h/168h) — the exact artifact this ' +
      'slice must not produce',
  );
});

test('double take config keeps image bytes out of the MQTT payload', () => {
  const b64 = settings(read(DT_CONFIG), 'base64');
  assert.equal(b64.length, 2, `expected two "base64:" settings, found ${b64.length}`);
  assert.deepEqual(
    b64,
    ['false', 'false'],
    'base64: true (or "box") embeds a face image in every published payload, ' +
      'which the capture would then write to a JSONL file on disk',
  );
});

// --- no cloud detector ------------------------------------------------------

test('double take config declares NO cloud detector', () => {
  const cfg = withoutComments(read(DT_CONFIG));

  // Only detectors present as keys under `detectors:` are active upstream
  // (config.js iterates Object.entries(CONFIG.detectors)), so absence is the
  // off switch and presence alone would enable it.
  assert.ok(
    !/^\s*rekognition\s*:/m.test(cfg),
    'detectors.rekognition is present. That is AWS Rekognition — enabling it ' +
      'transmits the faces of non-consenting members of the public to a third-party ' +
      'cloud service. It is excluded categorically for this slice, not merely ' +
      'deprioritised.',
  );

  assert.ok(
    /^\s*deepstack\s*:/m.test(cfg),
    'no deepstack detector configured — Double Take returns 400 "no detectors ' +
      'configured" and publishes nothing at all',
  );
});

test('double take does not write identities back onto Frigate events', () => {
  assert.deepEqual(
    settings(read(DT_CONFIG), 'update_sub_labels'),
    ['false'],
    'update_sub_labels: true would attach a recognised name to a stranger\'s event ' +
      "record inside Frigate's own database, outside everything this slice controls",
  );
});

// --- storage must be destroyable -------------------------------------------

test('biometric storage is on named volumes, never bind-mounted into the repo', () => {
  const compose = withoutComments(read(COMPOSE));

  for (const [service, mount] of [
    ['deepstack', '/datastore'],
    ['double-take', '/.storage'],
  ] as const) {
    // The line must be `- <name>:<path>`, not `- ./something:<path>`.
    //
    // Anchored at the END of the mount path (allowing a :ro/:rw suffix) so that
    // a bind of a FILE INSIDE the volume -- `./double-take/config.yml:
    // /.storage/config/config.yml` -- is not mistaken for bind-mounting the
    // whole storage directory. That config bind is both necessary and harmless:
    // it carries configuration, not biometric data.
    const bind = new RegExp(
      `^\\s*-\\s*\\.{0,2}/[^:\\n]*:${mount.replace('.', '\\.')}(:r[ow])?\\s*$`,
      'm',
    );
    assert.ok(
      !bind.test(compose),
      `${service}'s ${mount} is bind-mounted from the host. That puts face ` +
        'embeddings/crops inside the working tree, one `git add -A` away from being ' +
        'committed to a public repo, and it survives `down -v`.',
    );

    const named = new RegExp(`^\\s*-\\s*(\\w[\\w-]*):${mount.replace('.', '\\.')}`, 'm');
    const m = named.exec(compose);
    assert.ok(m, `${service} does not mount ${mount} as a named volume`);

    assert.ok(
      new RegExp(`^\\s{2}${m![1]}\\s*:\\s*$`, 'm').test(compose),
      `volume "${m![1]}" is used but not declared under top-level volumes:, so ` +
        '`down -v` would not remove it',
    );
  }
});

test('the double take UI and the detector are not exposed beyond loopback', () => {
  const compose = withoutComments(read(COMPOSE));
  const published = [...compose.matchAll(/^\s*-\s*'([^']*:)?(\d+):(\d+)'/gm)];

  assert.ok(published.length > 0, 'no published ports found — has the compose format changed?');
  for (const p of published) {
    assert.equal(
      p[1],
      '127.0.0.1:',
      `port ${p[2]} is published on all interfaces. Every service in this stack is ` +
        'unauthenticated for the window; publishing one to the LAN exposes a face ' +
        'recogniser and an anonymous broker to the whole network.',
    );
  }
});

// --- the enrolment subject --------------------------------------------------

test('the enrolment image is gitignored but its provenance is not', () => {
  const gitignore = read(path.join(REPO_ROOT, '.gitignore'));

  assert.ok(
    /^double-take\/enroll\/\*$/m.test(gitignore),
    'double-take/enroll/* is not gitignored — an enrolled face image could be ' +
      'committed to a public repo',
  );
  assert.ok(
    /^!double-take\/enroll\/PROVENANCE\.txt$/m.test(gitignore),
    'PROVENANCE.txt is not un-ignored. It carries no image data and it is the only ' +
      'durable record of why enrolling this face was acceptable — the image is ' +
      'destroyed after the window, the justification should outlive it.',
  );

  // The provenance record must actually make the synthetic claim checkable,
  // rather than just asserting it. IPTC's digitalSourceType is the machine-
  // readable form of "this was generated, not photographed".
  const prov = path.join(REPO_ROOT, 'double-take', 'enroll', 'PROVENANCE.txt');
  if (existsSync(prov)) {
    assert.match(
      read(prov),
      /trainedAlgorithmicMedia/,
      'PROVENANCE.txt does not record a verifiable synthetic-origin claim. ' +
        '"It is synthetic" is the entire basis on which enrolling this face is ' +
        'acceptable, so it must be checkable rather than taken on trust.',
    );
  }
});
