// Guard for the Cycle 7 capture stack's docker-compose project isolation.
// See docs/cycle-7-live-camera-validation.md.
//
// WHY THIS TEST EXISTS
// --------------------
// docker-compose.frigate.yml and docker-compose.langfuse.yml sit in the same
// directory. Compose derives a project name from the directory when a file does
// not declare one, so without `name:` BOTH files resolved to the same project --
// the directory's name -- and then `docker compose -f docker-compose.frigate.yml
// ps` reports the Langfuse containers as orphans, `down --remove-orphans`
// deletes the observability stack, and `down -v` reaches for Langfuse's network.
//
// That happened once for real. The fix was `name: frigate-capture` in
// docker-compose.frigate.yml; docker-compose.langfuse.yml pins one too now, so
// the directory fallback is unreachable from either file. This test asserts the
// property rather than the names, so it keeps holding across a rename -- it
// compares each file's resolved project against `path.basename(REPO_ROOT)`
// rather than against a hardcoded `dairy-agent`.
//
// This test exists so a THIRD occurrence fails here
// instead of at the moment someone loses their Langfuse data.
//
// WHAT THIS TEST CANNOT CATCH
// ---------------------------
// Compose's project-name precedence is, highest first:
//
//   1. the `-p` / `--project-name` command-line flag
//   2. the COMPOSE_PROJECT_NAME environment variable
//   3. the top-level `name:` in the compose file
//   4. the base name of the project directory
//
// So `name:` is only third. This test covers levels 2, 3 and 4 -- it asserts the
// file declares a name, that the name is unique across compose files, and that
// nothing in .env/.env.example sets COMPOSE_PROJECT_NAME (which would silently
// override the file and is invisible at the call site).
//
// It CANNOT cover level 1: `docker compose -p dairy-360 -f
// docker-compose.frigate.yml down` overrides `name:` by design and will target
// Langfuse's project. Never pass `-p` to the frigate stack. There is no reason
// to: the file names its own project.

import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FRIGATE_FILE = 'docker-compose.frigate.yml';

/** Top-level `name:` of a compose file, or null when it declares none.
 *
 * A hand-rolled scan rather than a YAML parser: the repo has no yaml
 * dependency, and "unindented, uncommented `name:` at column 0" is precisely
 * the thing being asserted. Anything indented is a service-level key and must
 * NOT count -- a `name:` nested under a service would be a false pass. */
function projectName(file: string): string | null {
  const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const hits = text
    .split('\n')
    .filter((l) => /^name:/.test(l))
    .map((l) => l.slice('name:'.length).trim().replace(/^["']|["']$/g, ''));
  assert.ok(hits.length <= 1, `${file} declares ${hits.length} top-level name: keys`);
  return hits[0] ?? null;
}

function composeFiles(): string[] {
  return readdirSync(REPO_ROOT).filter((f) => /^docker-compose[.\w-]*\.ya?ml$/.test(f));
}

test('the frigate capture stack declares its own compose project name', () => {
  const name = projectName(FRIGATE_FILE);
  assert.ok(
    name,
    `${FRIGATE_FILE} has no top-level "name:". Without it Compose uses the ` +
      'directory name and the stack shares a project with docker-compose.langfuse.yml, ' +
      'which puts the Langfuse containers one --remove-orphans away from deletion.',
  );
  assert.notEqual(
    name,
    path.basename(REPO_ROOT),
    'the declared project name matches the directory name, so it provides no isolation',
  );
});

test('no two compose files resolve to the same project name', () => {
  const files = composeFiles();
  assert.ok(files.length >= 2, `expected several compose files, found: ${files.join(', ')}`);

  const dirName = path.basename(REPO_ROOT);
  const byProject = new Map<string, string[]>();
  for (const f of files) {
    // A file with no `name:` falls back to the directory name -- that fallback
    // is the collision, so model it rather than skipping the file.
    const project = projectName(f) ?? dirName;
    byProject.set(project, [...(byProject.get(project) ?? []), f]);
  }

  const collisions = [...byProject].filter(([, fs]) => fs.length > 1);
  assert.deepEqual(
    collisions,
    [],
    `compose files sharing one project: ${collisions
      .map(([p, fs]) => `${p} <- ${fs.join(' + ')}`)
      .join('; ')}`,
  );
});

test('no env file sets COMPOSE_PROJECT_NAME, which would override name:', () => {
  // Compose auto-loads .env from the project directory, and
  // COMPOSE_PROJECT_NAME outranks the file's own `name:`. A single line in .env
  // would therefore undo the isolation with nothing visible at the call site --
  // and the capture runbook sources .env into the shell before running compose,
  // which would export it too.
  for (const envFile of ['.env', '.env.example']) {
    const full = path.join(REPO_ROOT, envFile);
    if (!existsSync(full)) continue;
    const offending = readFileSync(full, 'utf8')
      .split('\n')
      .filter((l) => /^\s*COMPOSE_PROJECT_NAME\s*=/.test(l));
    assert.deepEqual(
      offending.map(() => envFile),
      [],
      `${envFile} sets COMPOSE_PROJECT_NAME, which silently overrides the ` +
        `"name:" in ${FRIGATE_FILE} and re-creates the Langfuse project collision`,
    );
  }
});
