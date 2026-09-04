// Test-discovery wiring guard.
//
// ---------------------------------------------------------------------------
// THE PROBLEM THIS EXISTS FOR
// ---------------------------------------------------------------------------
// `npm test -w server` used to be `tsx --test src/**/*.test.ts`, UNQUOTED. npm
// runs scripts through sh, where `**` is not globstar, so it expanded to
// `src/<dir>/<file>.test.ts` -- exactly two levels. That excluded
// src/agent/__tests__/regression*.test.ts, which is what you want, but only by
// accident of shell semantics.
//
// The accident cut both ways:
//   - A test placed one level deeper (src/registry/__tests__/x.test.ts) would
//     never run, and would report nothing. A silent skip forever.
//   - Quoting the glob to "fix" it hands globbing to node, which DOES recurse,
//     and pulls in the three regression files. Those import ../db at module
//     level (opening the database) and, without RUN_REGRESSION and an API key,
//     emit `ok N - ... # SKIP` -- which the TAP summary counts as passing. CI
//     would report a green run for a suite that never executed.
//
// node 22 has no --test-exclude-pattern; --test-name-pattern and
// --test-skip-pattern filter by TEST NAME and still load the file, so neither
// solves it.
//
// So the script ENUMERATES its directories, and this test asserts the
// enumeration is complete: every *.test.ts under src/ is either covered by a
// pattern in the script or on the excluded list below WITH a reason. Both
// failure modes -- a new directory nobody added, and a regression file that
// drifted into a covered directory -- become loud instead of silent.

import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const SRC = path.join(__dirname);
const PKG = path.join(__dirname, '..', 'package.json');

/**
 * Test files deliberately NOT run by `npm test`, each with the reason.
 *
 * These are the live-model regression suites. They cost API credits, need
 * ANTHROPIC_API_KEY and RUN_REGRESSION=1, and are run by `npm run
 * test:regression` -- which CI invokes as a SEPARATE, secret-gated step so that
 * an absent key skips the step visibly rather than reporting skips as passes.
 */
const EXCLUDED: Record<string, string> = {
  'agent/__tests__/regression.test.ts': 'live-model suite: API-gated, run by test:regression:core',
  'agent/__tests__/regression.cap.test.ts': 'live-model suite: API-gated, run by test:regression:cap',
  'agent/__tests__/regression.fallback.test.ts':
    'live-model suite: API-gated, run by test:regression:fallback',
  'agent/__tests__/registryPrecision.test.ts':
    'live-model eval: API-gated, run by test:regression:registry. Asserts on the ' +
    'assistant PROSE (does it pool a measured calving interval with an approximate ' +
    'one?), which no unit test can check -- see docs/REGISTRY_TOOLS.md.',
};

/** Every *.test.ts under src/, as a path relative to src/, using forward slashes. */
function allTestFiles(dir = SRC, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...allTestFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.test.ts')) {
      out.push(rel);
    }
  }
  return out.sort();
}

/** The `src/...` patterns the test script passes to tsx. */
function scriptPatterns(): string[] {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { scripts: Record<string, string> };
  return pkg.scripts.test
    .split(/\s+/)
    .filter((t) => t.startsWith('src/'))
    .map((t) => t.replace(/^src\//, ''));
}

/** Does `src/<rel>` match a `<dir>/*.test.ts`-shaped pattern? */
function matches(rel: string, pattern: string): boolean {
  const pDir = path.posix.dirname(pattern);
  const fDir = path.posix.dirname(rel);
  // Every pattern is a single-level `<dir>/*.test.ts` (or `*.test.ts` at src/).
  return pDir === fDir && pattern.endsWith('*.test.ts') && rel.endsWith('.test.ts');
}

test('every test file is either run by `npm test` or explicitly excluded with a reason', () => {
  const patterns = scriptPatterns();
  assert.ok(patterns.length > 0, 'the test script names at least one src/ pattern');

  const unaccounted = allTestFiles().filter(
    (f) => !patterns.some((p) => matches(f, p)) && !(f in EXCLUDED),
  );

  assert.deepEqual(
    unaccounted,
    [],
    'These test files are in NEITHER the npm test patterns NOR the excluded list, so they\n' +
      'run nowhere and report nothing:\n' +
      unaccounted.map((f) => `  src/${f}`).join('\n') +
      '\n\nEither add their directory to the "test" script in server/package.json, or add\n' +
      'them to EXCLUDED in this file with the reason they must not run there.',
  );
});

test('every excluded file still exists, so the list cannot rot', () => {
  // A stale exclusion is how a file gets silently un-excluded after a rename:
  // the entry stops matching anything and the renamed file falls through to the
  // check above -- which is fine -- but a REMOVED file leaves a misleading
  // entry claiming something is deliberately not run.
  const present = new Set(allTestFiles());
  const missing = Object.keys(EXCLUDED).filter((f) => !present.has(f));
  assert.deepEqual(missing, [], `EXCLUDED names files that no longer exist: ${missing.join(', ')}`);
});

test('no excluded file sits in a directory `npm test` covers', () => {
  // The dangerous drift: moving a regression file into src/registry/ or
  // src/tools/ would make `npm test` pick it up, load ../db, and report its
  // API-gated skips as passes.
  const patterns = scriptPatterns();
  const captured = Object.keys(EXCLUDED).filter((f) => patterns.some((p) => matches(f, p)));
  assert.deepEqual(
    captured,
    [],
    'These files are marked excluded but WOULD be run by the npm test patterns:\n' +
      captured.map((f) => `  src/${f}`).join('\n') +
      '\n\nWithout an API key they emit `ok ... # SKIP`, which the TAP summary counts as\n' +
      'a pass -- so CI would report green for a suite that never ran.',
  );
});

test('the test script does not use an unquoted `**` glob', () => {
  // Guards the specific regression: someone "tidying" the enumerated list back
  // into src/**/*.test.ts reintroduces dependence on shell glob semantics, and
  // whether that is safe depends on whether the string ends up quoted.
  const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { scripts: Record<string, string> };
  assert.ok(
    !pkg.scripts.test.includes('**'),
    'the "test" script uses a `**` glob again. Unquoted, sh does not treat it as\n' +
      'globstar and it silently means one level; quoted, node recurses and pulls in the\n' +
      'API-gated regression suite. Enumerate the directories instead.',
  );
});

test('the regression suites are reachable through their own scripts', () => {
  // The other half of the contract: excluding them from `npm test` is only
  // correct because something else runs them.
  const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { scripts: Record<string, string> };
  const regressionScripts = Object.entries(pkg.scripts).filter(([k]) =>
    k.startsWith('test:regression'),
  );
  for (const excluded of Object.keys(EXCLUDED)) {
    const file = path.posix.basename(excluded);
    assert.ok(
      regressionScripts.some(([, cmd]) => cmd.includes(file)),
      `src/${excluded} is excluded from \`npm test\` but no test:regression:* script runs it`,
    );
  }
});
