
// ---------------------------------------------------------------------------
// A backtick inside a `template:` string, guarded rather than recorded again
// ---------------------------------------------------------------------------
//
// This bug has now cost FOUR occurrences across three cycles. Every time, the
// author wrote a component comment referring to something in code style --
// `Herd`, `@if (session.ready())`, `data: { writes: true }` -- inside a
// template, which is itself a template literal. The backtick closes the string
// and TypeScript then reports three or four syntax errors pointing at lines
// nowhere near the cause.
//
// REGISTRY_SALES.md §17.4 recorded it twice, REGISTRY_PAYROLL.md §16.3 a third
// time and said "noting it here so the next occurrence is the one that builds
// it". This is that. OPEN.md carried it as a standing item.
//
// A source-text check rather than an ESLint rule, for the reason invariant 13
// is one: it must fail in CI with no toolchain to configure, and the failure
// has to name the file and the line so it is fixed in seconds rather than
// bisected.

/**
 * Every component source in this directory, as TEXT.
 *
 * Read through Vite's raw glob rather than node:fs, because the browser-targeted
 * tsconfig this spec compiles under has no node types -- and moving the guard to
 * the server suite would put a check on frontend sources in the wrong workspace.
 */
interface RawGlob {
  glob(
    pattern: string,
    opts: { query: string; import: string; eager: true },
  ): Record<string, string>;
}

const RAW = (import.meta as unknown as RawGlob).glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function sources(): { file: string; text: string }[] {
  return Object.entries(RAW)
    .filter(([file]) => !file.endsWith('.spec.ts'))
    .map(([file, text]) => ({ file, text }));
}

/**
 * The lines inside a `template: \`...\`` literal that contain a backtick.
 *
 * Deliberately crude: it finds `template:` followed by a backtick, then walks
 * to the NEXT backtick and reports anything after it that is not the end of the
 * property. A cleverer parser would be a second implementation of TypeScript;
 * this one only has to be right about the one mistake people actually make.
 */
function offendingLines(text: string): number[] {
  const start = text.indexOf('template: `');
  if (start === -1) return [];
  const open = text.indexOf('`', start);
  const close = text.indexOf('`', open + 1);
  if (close === -1) return [];
  // A well-formed template ends with "`," or "`\n})" -- anything else means the
  // first backtick found was somebody's inline code quote.
  const after = text.slice(close + 1, close + 4);
  if (/^\s*[,)]/.test(after)) return [];
  return [text.slice(0, close).split('\n').length];
}

describe('component templates', () => {
  it('contain no backtick, because a template IS a template literal', () => {
    const bad: string[] = [];
    for (const { file, text } of sources()) {
      for (const line of offendingLines(text)) {
        bad.push(`${file}:${line} — a backtick inside template: closes the string`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('catches the mistake it is guarding against', () => {
    // Proves the check FIRES, not merely that it passes. Without this the guard
    // could be quietly broken by a refactor and would report clean forever --
    // the same reason every invariant has a test that corrupts a fixture.
    const broken = [
      '@Component({',
      '  template: `',
      '    <!-- see `Herd` for why -->',
      '    <div></div>',
      '  `,',
      '})',
    ].join('\n');
    expect(offendingLines(broken).length).toBe(1);

    const fine = ['@Component({', '  template: `', '    <div></div>', '  `,', '})'].join('\n');
    expect(offendingLines(fine)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No write control may be reachable without a recording session
// ---------------------------------------------------------------------------
//
// The shell used to enforce this for free by refusing to render anything at
// all. Now that reads are free, the guarantee is distributed across eleven
// call sites -- and a distributed guarantee with no check is one that holds
// until the next screen is added.
//
// The rule: a component that calls `session.provenance()` writes, so it must
// either render <app-session-required> beside its submit, or sit on a route
// that declares `writes: true` and is gated by the shell.
//
// `provenance()` throwing is the backstop, and the server refusing a body with
// no `recorded_by` is the one after that. This test is what keeps the operator
// from meeting either of them.

const ROUTE_GATED = new Set([
  // Pure write surfaces: the whole screen is a form, so the shell shows the
  // gate instead of it. See app.routes.ts `data: { writes: true }`.
  './animal-form.ts',
  './calving-form.ts',
]);

describe('write controls', () => {
  it('are all behind a recording session', () => {
    const unguarded: string[] = [];
    for (const { file, text } of sources()) {
      if (!text.includes('.provenance()')) continue;
      if (ROUTE_GATED.has(file)) continue;
      if (!text.includes('<app-session-required')) unguarded.push(file);
    }
    expect(unguarded).toEqual([]);
  });

  it('names every route-gated exception, so the list cannot rot silently', () => {
    // If one of these stops calling provenance(), or stops being a pure form,
    // the exemption is stale and should be removed rather than left standing.
    for (const file of ROUTE_GATED) {
      const src = sources().find((s) => s.file === file);
      expect(src, `${file} is exempted but does not exist`).toBeDefined();
      expect(src!.text).toContain('.provenance()');
    }
  });
});

// ---------------------------------------------------------------------------
// THE `display: block` GUARD IS NOT HERE, AND §9.2 EXPECTED IT TO BE
// ---------------------------------------------------------------------------
//
// UI_SYSTEM.md §9.2 says to add it to this file, and gives the mechanism:
//
//   "Reading `styles.css` as raw text works -- `'../../styles.css?raw'`, and
//    `?raw` bypasses the Tailwind pipeline to give the hand-maintained source."
//
// IT DOES NOT WORK IN THIS TOOLCHAIN. `import.meta.glob('../../*.css', { query:
// '?raw', ... })` resolves the key -- `../../styles.css` -- and hands back a
// module whose `default` is a string of LENGTH ZERO. Measured, not assumed:
// `@angular/build:unit-test` intercepts `.css` ahead of Vite's `?raw` handling
// and returns nothing for it. Every `.ts` raw glob in this file works, and the
// `.ts` half of the guard (scanning app.routes.ts for both route forms) works
// too; the stylesheet is the half that cannot be read from inside the suite.
//
// A guard that reads its input as '' does not fail -- it reports EVERY
// component as unlisted, which on the first run it duly did, all eleven of
// them. That is the §8.3 failure mode one layer along: "a stray backtick is a
// compile error, so ng test dies at the build step and the spec never runs; it
// only ever covered the rarer subset that still parses."
//
// So it lives in scripts/check-templates.mjs beside the backtick check, for the
// reason §8.3 gives for that one: it must fail in CI with no toolchain to
// configure, and the failure has to name the file so it is fixed in seconds.
// `npm run check:templates` runs ahead of the typecheck and both builds.
//
// What that script checks, so it is findable from here:
//   * every `app-…` selector under src/app/** that the router does not mount
//     has a `display: block` rule in styles.css
//   * the routed set is read from BOTH `loadComponent` and `component:`,
//     because RegistryShell is a static import and is exactly the component
//     carrying the flex and height chain
//   * it fires -- a synthetic unlisted selector is reported
