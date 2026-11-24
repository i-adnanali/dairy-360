// The guard that keeps every test away from the farm's real dairy.db.
//
// This file must never load db.ts, not even inside try/catch: loading it opens
// and migrates the real file. db.ts is checked here as TEXT only.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { underTestRunner } from './db-guard';

// execArgv as tsx sets it, measured on node 22.3 / this repo's tsx.
const TSX = [
  '--require',
  '/repo/node_modules/tsx/dist/preflight.cjs',
  '--import',
  'file:///repo/node_modules/tsx/dist/loader.mjs',
];

test('a test file run by the test runner is detected by NODE_TEST_CONTEXT', () => {
  // The value node gives each test file's child process (measured: child-v8).
  assert.equal(underTestRunner({ NODE_TEST_CONTEXT: 'child-v8' }, TSX), true);
  assert.equal(underTestRunner({ NODE_TEST_CONTEXT: 'child' }, []), true);
});

test('the test runner process itself is detected by --test in execArgv', () => {
  assert.equal(underTestRunner({}, [...TSX, '--test']), true);
  assert.equal(underTestRunner({}, ['--test']), true);
});

test('a plain run (npm run dev, npm start, a registry command) is not a test', () => {
  assert.equal(underTestRunner({}, TSX), false);
  assert.equal(underTestRunner({}, []), false);
  assert.equal(underTestRunner({ NODE_TEST_CONTEXT: '' }, TSX), false);
});

test('db.ts refuses under the test runner before it opens the file', () => {
  const src = readFileSync(path.join(__dirname, 'db.ts'), 'utf8');
  const guard = src.indexOf('underTestRunner(process.env, process.execArgv)');
  const open = src.indexOf('new Database(');
  assert.ok(guard >= 0, 'db.ts calls the guard');
  assert.ok(open >= 0, 'db.ts still opens the file somewhere');
  assert.ok(guard < open, 'the guard runs before new Database(');
  assert.match(src, /from '\.\/db-guard'/, 'db.ts takes the guard from db-guard.ts');
});

test('db-guard.ts does not load db.ts', () => {
  const src = readFileSync(path.join(__dirname, 'db-guard.ts'), 'utf8');
  assert.doesNotMatch(src, /from '\.\/db'|require\('\.\/db'\)/);
});
