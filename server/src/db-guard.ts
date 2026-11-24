// Decides whether this process is running under node's test runner, so db.ts
// can refuse to open the farm's real dairy.db from a test.
//
// Pure, and deliberately free of any import from this repo: db-guard.test.ts
// loads it, and nothing a test loads may reach db.ts.
//
// The two signals, measured on node 22.3 with this repo's `tsx --test`:
//   - each test file runs in a child process whose env carries
//     NODE_TEST_CONTEXT (value `child-v8`; `child` with TAP output);
//   - the runner process itself has `--test` in process.execArgv (the child
//     does not).
// Neither is set by `npm run dev`, `npm start` or a `registry:*` command.
//
// Not covered: a test file run WITHOUT the runner (`tsx src/x.test.ts`) sets
// neither signal.

export function underTestRunner(env: NodeJS.ProcessEnv, execArgv: readonly string[]): boolean {
  if (env.NODE_TEST_CONTEXT) return true;
  return execArgv.includes('--test');
}
