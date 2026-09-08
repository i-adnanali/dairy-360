// A backtick inside a `template:` string, checked BEFORE anything compiles.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS WHEN templates.spec.ts ALREADY DOES
// ---------------------------------------------------------------------------
// It does, and it cannot fire for the case it was built for.
//
// The bug: somebody writes a component comment referring to something in code
// style -- `Herd`, `@if (session.ready())` -- inside a template, which is
// itself a template literal. The backtick closes the string and TypeScript
// reports three or four syntax errors pointing at lines nowhere near the cause.
// REGISTRY_SALES.md §17.4 recorded it twice, REGISTRY_PAYROLL.md §16.3 a third
// time, and web-angular/src/app/registry/templates.spec.ts was built as the
// fourth response.
//
// That spec runs under `ng test`, which BUILDS the application first. A stray
// backtick is a compile error, so the build fails and the spec that would have
// named the file and the line never executes. Measured, not assumed: it
// happened during phase 4 of docs/UI_SYSTEM.md, produced eleven errors naming
// `numeric` and `flex`, and the guard printed nothing at all. The spec can only
// catch the subset of stray backticks that still parse as TypeScript -- which
// is the rarer half, and not the half that costs an afternoon.
//
// So the check moves ahead of the compiler. It reads source as TEXT with
// node:fs and needs no toolchain, which is the property invariant 13 asks for
// and the reason the original was a source-text check rather than an ESLint
// rule.
//
// ---------------------------------------------------------------------------
// WHY AT THE REPO ROOT
// ---------------------------------------------------------------------------
// templates.spec.ts's header rejected two homes: node:fs, because the
// browser-targeted tsconfig it compiles under has no node types, and the server
// suite, because that "would put a check on frontend sources in the wrong
// workspace". Both are right. scripts/ is the third option it did not consider
// -- it is not a workspace, it is where harness-seed.mjs already lives as
// explicitly-not-application-code, and node types are simply available here.
//
// templates.spec.ts KEEPS its copy of the rule. It is not redundant: it also
// asserts the check FIRES, by running its extractor over a known-bad string,
// and that self-test is what stops either implementation rotting into a
// function that reports clean forever.
//
//   node scripts/check-templates.mjs
//
// Covers src/app/**, not just registry/ -- the spec's glob is `./*.ts`, so
// nothing in components/ was ever covered by it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'web-angular/src/app';

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

/**
 * The line inside a `template: \`...\`` literal that carries a stray backtick.
 *
 * Deliberately crude, and the same shape as templates.spec.ts's version: find
 * `template:` followed by a backtick, walk to the NEXT backtick, and report
 * unless what follows is the end of the property. A cleverer parser would be a
 * second implementation of TypeScript; this one only has to be right about the
 * one mistake people actually make.
 */
function offendingLine(text) {
  const start = text.indexOf('template: `');
  if (start === -1) return null;
  const open = text.indexOf('`', start);
  const close = text.indexOf('`', open + 1);
  if (close === -1) return null;
  // A well-formed template ends with "`," or "`\n})".
  if (/^\s*[,)]/.test(text.slice(close + 1, close + 4))) return null;
  return text.slice(0, close).split('\n').length;
}

const bad = [];
for (const file of sources(ROOT)) {
  const line = offendingLine(readFileSync(file, 'utf8'));
  if (line !== null) bad.push(`${file}:${line}`);
}

if (bad.length > 0) {
  console.error('\nA backtick inside a `template:` string closes it early.');
  console.error('TypeScript will report several errors nowhere near the cause.\n');
  for (const where of bad) console.error(`  ${where}`);
  console.error('\nUse plain words or double quotes in template comments.\n');
  process.exit(1);
}

console.log(`component templates: ${sources(ROOT).length} files, no stray backticks`);
