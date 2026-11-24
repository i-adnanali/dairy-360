// Refuses to let db.ts open the farm's real dairy.db from a test.
//
// Pure, and deliberately free of any import from this repo: db-guard.test.ts
// loads it, and nothing a test loads may reach db.ts.
//
// The signals, measured with this repo's `tsx --test` on node 22.3.0 and on
// 22.22.3 (the version in .nvmrc):
//   - by default each test file runs in a child process whose env carries
//     NODE_TEST_CONTEXT (value `child-v8`; `child` with TAP output), and the
//     child's execArgv has no `--test`;
//   - the runner process itself has `--test` in process.execArgv.
// With `--experimental-test-isolation=none` (22.22.3; the flag does not exist
// on 22.3.0) the test file runs IN the runner process, NODE_TEST_CONTEXT is
// unset, and `--test` in execArgv is the only signal that catches it.
// Neither signal is set by `npm run dev`, `npm start` or a `registry:*` command.
//
// Not covered: a test file run WITHOUT the runner (`tsx src/x.test.ts`) sets
// neither signal.

export function underTestRunner(env: NodeJS.ProcessEnv, execArgv: readonly string[]): boolean {
  if (env.NODE_TEST_CONTEXT) return true;
  return execArgv.includes('--test');
}

/** Throws when running under the test runner; does nothing otherwise. */
export function refuseUnderTestRunner(
  dbPath: string,
  env: NodeJS.ProcessEnv,
  execArgv: readonly string[],
): void {
  if (!underTestRunner(env, execArgv)) return;
  throw new Error(
    `Refusing to open ${dbPath}: the real farm database must never be opened from a test. ` +
      'Pass the test an in-memory database handle instead.',
  );
}
