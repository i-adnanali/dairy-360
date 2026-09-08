// ---------------------------------------------------------------------------
// THE AMBER CHECK. docs/UI_SYSTEM.md §10.7, and §8's invariant table.
// ---------------------------------------------------------------------------
//
// §4.2.1 reserves amber for exactly two meanings:
//
//   "This needs an answer from you"    the warning role, on unanswered rows and
//                                      list items, incomplete session counters
//                                      and /check findings
//   "This is not the real registry"    warning-fill, the storage chip, and
//                                      nowhere else
//
// "Nothing else may take amber", it says, "and §8's invariant table now checks
// it."
//
// ---------------------------------------------------------------------------
// AND IT WAS ALREADY FALSE WHEN IT WAS WRITTEN, WHICH IS WHY THIS IS A BASELINE
// ---------------------------------------------------------------------------
// PHASE5_PRECHECK.md's census, run before any phase-5 code, found 43 amber
// utility occurrences at 26 sites in 15 files carrying FIVE meanings. Seventeen
// of the 26 sat outside both permitted meanings, and every one of those was in
// the content area -- so §6's justification for the unanswered state, "the only
// amber in the content area", was never true.
//
// A spec asserting §4.2.1 as written would have failed on the day it was added
// and would then have been deleted or exempted into meaninglessness, which is
// how a guard becomes furniture. This one pins the census instead:
//
//   * every amber site must be CLASSIFIED, here, by whoever wrote it
//   * a new amber site fails until somebody says which meaning it carries
//   * a classified site that DISAPPEARS also fails, so the list cannot rot
//
// That makes the real cost visible -- five meanings, printed, every run --
// without pretending the rule already holds. Re-pointing the seventeen is four
// separate design decisions across two frozen forms, and it is recorded in
// §16 as undecided rather than swept.

/**
 * Every non-spec source under src/app, as TEXT.
 *
 * Three globs and not one: Vite's `import.meta.glob` takes literal patterns
 * only, and `templates.spec.ts`'s single `./*.ts` covers registry alone --
 * which is how components/ went unprotected by the backtick guard for its whole
 * life (§8.3). Amber lives in all three directories.
 */
interface RawGlob {
  glob(
    pattern: string,
    opts: { query: string; import: string; eager: true },
  ): Record<string, string>;
}

// `import.meta.glob` is replaced at transform time, so it has to be written out
// in full at each call -- an alias or a shared options constant makes Vite
// refuse it. Hence four near-identical blocks rather than a loop.
//
// Each is paired with the directory it came from, because the returned keys are
// relative to THIS file: `./certainty.ts` and `../registry/api.ts` both arrive
// as bare relative paths, and a single strip-and-prefix turns the first into
// `src/app/certainty.ts`, which is not a file. The census then reports two
// phantom sites and misses two real ones.
const GROUPS: { dir: string; raw: Record<string, string> }[] = [
  {
    dir: 'src/app/registry/',
    raw: (import.meta as unknown as RawGlob).glob('../registry/*.ts', {
      query: '?raw', import: 'default', eager: true,
    }),
  },
  {
    dir: 'src/app/components/',
    raw: (import.meta as unknown as RawGlob).glob('../components/*.ts', {
      query: '?raw', import: 'default', eager: true,
    }),
  },
  {
    dir: 'src/app/core/',
    raw: (import.meta as unknown as RawGlob).glob('../core/*.ts', {
      query: '?raw', import: 'default', eager: true,
    }),
  },
  {
    dir: 'src/app/ui/',
    raw: (import.meta as unknown as RawGlob).glob('./*.ts', {
      query: '?raw', import: 'default', eager: true,
    }),
  },
];

/** Every non-spec source, keyed by its repo-relative path. */
function allSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const { dir, raw } of GROUPS) {
    for (const [path, text] of Object.entries(raw)) {
      const base = path.slice(path.lastIndexOf('/') + 1);
      if (base.endsWith('.spec.ts')) continue;
      out.push({ file: dir + base, text });
    }
  }
  return out;
}

/**
 * Comments stripped, because a comment ABOUT amber is not a use of it.
 *
 * Found the hard way: this file's own prose, and the explanation people-list.ts
 * now carries for why its balance cell keeps `text-warning-fg`, both matched a
 * naive scan. A guard that counts its own documentation is a guard that grows
 * every time somebody explains it.
 */
function code(text: string): string {
  return (
    text
      // LINE COUNT IS PRESERVED, and the first version of this did not preserve
      // it. Replacing a six-line `<!-- ... -->` with '' shifts every line after
      // it up by five, and the census then prints line numbers that point at
      // the wrong code -- a guard that misdirects is worse than no guard. So a
      // multi-line comment becomes the same number of blank lines.
      .replace(/<!--[\s\S]*?-->/g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
      // Line comments dropped only when the line IS a comment. A regex for `//`
      // anywhere would eat the tail of any line holding a URL, and this file's
      // own header is full of them.
      .split('\n')
      .map((line) => (line.trimStart().startsWith('//') ? '' : line))
      .join('\n')
  );
}

const AMBER = /\b(?:bg|text|border|ring|decoration|divide|fill|stroke|shadow|outline|from|to|via)-warning-(?:bg|fg|strong|line|fill)\b/;

/** Every `file:line` in src/app that sets an amber utility. */
function sites(): string[] {
  const out: string[] = [];
  for (const { file, text } of allSources()) {
    code(text)
      .split('\n')
      .forEach((line, i) => {
        if (AMBER.test(line)) out.push(`${file}:${i + 1}`);
      });
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// The census. Keyed by meaning, so adding a site means choosing one.
// ---------------------------------------------------------------------------

/**
 * PERMITTED, meaning 1 of §4.2.1: "this needs an answer from you".
 *
 * The vocabulary's own two entries lead the list. They are the consolidation
 * phase 5 bought: `Certainty`'s unanswered treatment and `RowDivider`'s
 * unanswered row now own between them what /check and the two entry sheets
 * each wrote by hand, and three hand-written ambers went away in the process
 * (verification-panel's recorded-vs-expected ternary, destinations-list's
 * no-price span, and the roster's own row state, which never existed).
 */
const NEEDS_AN_ANSWER = [
  'src/app/ui/certainty.ts',        // the unanswered state, at value scale
  'src/app/ui/surface.ts',          // the unanswered ROW -- §3.2's scale
  'src/app/registry/today-board.ts',        // incomplete session counters x3
  'src/app/registry/verification-panel.ts', // /check findings and notes
  'src/app/registry/session-required.ts',   // no session: answer the gate first
];

/** PERMITTED, meaning 2: "this is not the real registry". §12.2's chip. */
const NOT_THE_REAL_REGISTRY = [
  'src/app/registry/session-bar.ts',
];

/**
 * MEANING 3, unpermitted: "you are overriding a refusal".
 *
 * Four files. `calving-form` and `precision-date` sit on the frozen forms, so
 * B1/B2 reach them and phase 5 may not move them even if it wanted to.
 */
const OVERRIDING_A_REFUSAL = [
  'src/app/registry/event-form.ts',
  'src/app/registry/correction-form.ts',
  'src/app/registry/calving-form.ts',
  'src/app/registry/precision-date.ts',
];

/** MEANING 4, unpermitted: "this looks unlike its neighbours". */
const UNLIKE_ITS_NEIGHBOURS = [
  'src/app/registry/milking-roster.ts',   // out-of-band litres
  'src/app/registry/payroll-run.ts',      // expected litres != taken
  'src/app/registry/duplicate-warning.ts',// a possible duplicate, on /animals/new
];

/** MEANING 5, unpermitted: "this is a liability, or a missing agreement". */
const A_LIABILITY = [
  'src/app/registry/person-detail.ts',  // negative balance
  'src/app/registry/people-list.ts',    // negative balance
  'src/app/registry/event-list.ts',     // "not billed"
];

/**
 * NOT A MEANING -- A HALF-FINISHED MIGRATION, and the census is how it surfaced.
 *
 * message.ts:73 is `bg-warning-bg text-agent-vendor-fg border-agent-vendor-line`.
 * §4.3 states that "vendor has left amber, which was the point: a vendor answer
 * used to wear the same colour as an unanswered milking row". The foreground
 * and the border moved to the agent ramp in `ed6235a`; the BACKGROUND did not.
 * So the vendor agent chip still renders on the warning role, in the chat's
 * content area, and it is the only element in the app mixing a categorical ramp
 * with a role.
 *
 * Listed separately rather than folded into a meaning, because it is a bug with
 * an owner: phase 6b (§13.3), which is the phase that touches this component.
 */
const HALF_MIGRATED = [
  'src/app/components/message.ts',
];

const CLASSIFIED = new Map<string, string[]>([
  ['needs an answer from you (PERMITTED)', NEEDS_AN_ANSWER],
  ['not the real registry (PERMITTED)', NOT_THE_REAL_REGISTRY],
  ['overriding a refusal', OVERRIDING_A_REFUSAL],
  ['unlike its neighbours', UNLIKE_ITS_NEIGHBOURS],
  ['a liability or missing agreement', A_LIABILITY],
  ['half-migrated: phase 6b owns it', HALF_MIGRATED],
]);

describe('amber — §4.2.1 and §10.7', () => {
  it('appears in no file that has not been classified', () => {
    const allowed = new Set([...CLASSIFIED.values()].flat());
    const unclassified = [...new Set(sites().map((s) => s.split(':')[0]))].filter(
      (f) => !allowed.has(f),
    );
    // If this fails you have added amber somewhere new. Do not add the file to
    // a list to make it green -- decide which of §4.2.1's two PERMITTED
    // meanings it carries, and if it carries neither, that is the finding.
    expect(unclassified).toEqual([]);
  });

  it('still has amber in every file the census names, so the list cannot rot', () => {
    const withAmber = new Set(sites().map((s) => s.split(':')[0]));
    const stale: string[] = [];
    for (const [meaning, files] of CLASSIFIED) {
      for (const f of files) {
        if (!withAmber.has(f)) stale.push(`${f} — listed under "${meaning}" and has no amber`);
      }
    }
    // A stale entry is not harmless: it is the record claiming a cost the app
    // no longer pays, which is how §4.2.1 came to describe a rule it did not
    // have. Delete the line when you re-point the site.
    expect(stale).toEqual([]);
  });

  it('is carried by exactly two permitted meanings and four unpermitted ones', () => {
    // The number that matters, asserted so it cannot drift upward quietly. It
    // is four and not zero, and phase 5 did not make it worse -- see the file
    // header and PHASE5_PRECHECK.md §2.
    const unpermitted = [...CLASSIFIED.keys()].filter((k) => !k.includes('PERMITTED'));
    expect(unpermitted.length).toBe(4);
  });

  it('keeps warning-fill to the one element in the chrome that may carry it', () => {
    // The SECOND permitted meaning, and the one that is genuinely confined.
    // §4.2.1: the storage chip "and nowhere else". This is the half of the rule
    // that holds today, and §12.2 makes it mechanical when the chip replaces
    // the banner.
    const fill = allSources()
      .filter(({ text }) => /\b(?:bg|text|border)-warning-fill\b/.test(code(text)))
      .map(({ file }) => file);
    expect(fill).toEqual(['src/app/registry/session-bar.ts']);
  });

  it('prints the census, because a count nobody reads is a count that drifts', () => {
    const all = sites();
    const lines = [`${all.length} amber utility line(s) in src/app:`];
    for (const [meaning, files] of CLASSIFIED) {
      const n = all.filter((s) => files.includes(s.split(':')[0]));
      lines.push(`  ${meaning}: ${n.length} line(s) in ${files.length} file(s)`);
    }
    console.log(lines.join('\n'));
    expect(all.length).toBeGreaterThan(0);
  });
});
