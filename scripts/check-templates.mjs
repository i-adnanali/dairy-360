// Two source-text checks that run BEFORE anything compiles.
//
//   1. a backtick inside a `template:` string
//   2. every non-routed component host has `display: block` in styles.css
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
//
// ---------------------------------------------------------------------------
// CHECK 2 IS HERE BECAUSE IT CANNOT BE DONE IN THE SUITE. Phase 6a, §9.2.
// ---------------------------------------------------------------------------
// §9.2 assigns the `display: block` guard to templates.spec.ts and says
// "reading styles.css as raw text works -- '../../styles.css?raw'". It does
// not, in this toolchain. `import.meta.glob` resolves the KEY and hands back a
// module whose `default` is a string of length zero: `@angular/build:unit-test`
// intercepts `.css` ahead of Vite's `?raw` handling. Measured, not assumed --
// the first run of the guard reported all eleven listed components as missing.
//
// Which is check 1's failure mode one layer along. A guard that reads its input
// as '' does not fail; it reports everything, or nothing, and either way it has
// stopped checking. So it moves here, where node:fs simply reads the file.
//
// WHAT IT IS FOR. A component host is `display: inline` by default and VERTICAL
// MARGINS DO NOT APPLY TO INLINE BOXES, so every `space-y-*` container holding a
// component as a direct child silently contributes nothing above it. On
// /animals/new the whole page had collapsed to zero gaps, and the symptom was
// reported as a paragraph OVERLAPPING a label -- the boxes never intersected,
// the label simply had no top margin. styles.css carries the fix as one
// hand-maintained selector list and its own plea to keep it updated.
//
// <app-session-required> is why this is a check rather than a comment: 12 call
// sites, absent from the list for its whole life, seven of them outside a flex
// parent where CSS would have blockified the child anyway. It was found by
// diffing the list against the components that exist -- which is this check,
// done by hand once.

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

// ---------------------------------------------------------------------------
// Check 2: the `display: block` list
// ---------------------------------------------------------------------------

const STYLES = 'web-angular/src/styles.css';
const ROUTES = 'web-angular/src/app/app.routes.ts';

/** Every `selector: 'app-…'` under src/app/**, with the file that declares it. */
function declaredSelectors(files) {
  const out = [];
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/selector:\s*'(app-[a-z0-9-]+)'/g)) {
      out.push({ file, selector: m[1] });
    }
  }
  return out;
}

/**
 * The component classes the route table mounts -- from BOTH forms.
 *
 * This is the hole §9.2 found in its own sketch and it is worth stating in
 * code. Thirteen of the fourteen routes are
 * `loadComponent: () => import('...').then((m) => m.TodayBoard)`. RegistryShell
 * is `component: RegistryShell` from a STATIC import, and it is precisely the
 * one styles.css singles out as carrying the flex and height chain the scroll
 * container depends on. A scan reading only `loadComponent` would report the
 * shell as unlisted and send somebody to "fix" the one element whose absence
 * from the list is deliberate and correct.
 */
function routedClasses(text) {
  const names = new Set();
  for (const m of text.matchAll(/m\.([A-Z][A-Za-z0-9_]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/\bcomponent:\s*([A-Z][A-Za-z0-9_]*)/g)) names.add(m[1]);
  return names;
}

/**
 * Does styles.css give this selector a `display: block` rule?
 *
 * `[,{]` and not an end-of-line anchor, which is the subtlety that bit the
 * first version. The block is a comma-separated selector LIST, so every member
 * but the last reads `app-foo,` on its own line -- and the last reads
 * `app-foo {`, because it is the one the brace follows. An end-anchored pattern
 * finds every member except the last, and the last is currently
 * app-session-required: the one the file's own comment holds up as the latent
 * case that went unnoticed for its whole life.
 *
 * Comments are stripped first, so prose ABOUT a component does not count as a
 * rule for it. styles.css names several in its commentary, <app-chat-panel>
 * included.
 */
function hasBlockRule(css, selector) {
  return new RegExp(`^\\s*${selector}\\s*[,{]`, 'm').test(css);
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// ---------------------------------------------------------------------------
// Run both
// ---------------------------------------------------------------------------

const files = sources(ROOT);
const problems = [];

for (const file of files) {
  const line = offendingLine(readFileSync(file, 'utf8'));
  if (line !== null) problems.push({ kind: 'backtick', where: `${file}:${line}` });
}

if (problems.length > 0) {
  console.error('\nA backtick inside a `template:` string closes it early.');
  console.error('TypeScript will report several errors nowhere near the cause.\n');
  for (const p of problems) console.error(`  ${p.where}`);
  console.error('\nUse plain words or double quotes in template comments.\n');
  process.exit(1);
}

const css = stripComments(readFileSync(STYLES, 'utf8'));
const routesText = readFileSync(ROUTES, 'utf8');
const routed = routedClasses(routesText);

// The check cannot be allowed to pass because it read nothing -- the exact
// failure that put it in this file. Both inputs are asserted before use.
if (css.length < 1000 || !css.includes('display: block')) {
  console.error(`\n${STYLES} read as ${css.length} bytes with no display:block. Aborting.\n`);
  process.exit(1);
}
if (!routed.has('RegistryShell')) {
  console.error('\napp.routes.ts: `component:` scan found no RegistryShell. Aborting.\n');
  process.exit(1);
}

/** A file exports one of the routed classes, so its host is router-mounted. */
const routedFiles = new Set(
  files.filter((file) => {
    const text = readFileSync(file, 'utf8');
    return [...routed].some((n) => new RegExp(`export class ${n}\\b`).test(text));
  }),
);

const unlisted = declaredSelectors(files)
  .filter(({ file, selector }) => !routedFiles.has(file) && !hasBlockRule(css, selector))
  .map(({ file, selector }) => `${file}  declares ${selector}`);

// Proves the check FIRES, in the same breath as running it. Same discipline as
// templates.spec.ts's self-test: a scan that can only pass is a scan nobody can
// trust, and this one has already had two bugs that made it pass or fail
// wholesale.
if (hasBlockRule(css, 'app-not-a-real-component')) {
  console.error('\nthe display:block check matches anything. Aborting.\n');
  process.exit(1);
}
if (!hasBlockRule(css, 'app-session-required')) {
  console.error('\nthe display:block check cannot see the LAST selector in the list.\n');
  process.exit(1);
}

if (unlisted.length > 0) {
  console.error('\nA component host is `display: inline` by default, and vertical');
  console.error('margins do not apply to inline boxes -- so every space-y-* gap above');
  console.error('one of these is contributing nothing. It fails silently and looks');
  console.error('like a spacing bug.\n');
  for (const where of unlisted) console.error(`  ${where}`);
  console.error(`\nAdd them to the selector list in ${STYLES}.\n`);
  process.exit(1);
}

const guarded = declaredSelectors(files).filter(({ file }) => !routedFiles.has(file)).length;
console.log(`component templates: ${files.length} files, no stray backticks`);
console.log(`component hosts: ${guarded} non-routed, all with display:block; ${routed.size} routed`);
