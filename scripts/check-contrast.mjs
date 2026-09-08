#!/usr/bin/env node
/*
 * WCAG contrast over the token layer, both modes.
 *
 * docs/UI_SYSTEM.md §9.6 recorded this as debt: "Contrast ratios have not been
 * computed for any pair. Spot-checked only ... This is a script, not a
 * judgement call: 60-odd pairs, the WCAG formula, failures printed."
 *
 * It reads web-angular/src/styles.css as the source of truth -- the `:root` and
 * `.dark` blocks -- so it cannot drift from the values that render.
 *
 * ---------------------------------------------------------------------------
 * THE TIERS ARE THE WHOLE DESIGN OF THIS SCRIPT
 * ---------------------------------------------------------------------------
 * A first draft checked every plausible pair at 4.5 or 3 and printed a hundred
 * failures, most of which were the script misreading WCAG rather than the
 * palette failing it. A report nobody believes is worse than no report, so the
 * thresholds are now mapped to the success criterion that actually applies:
 *
 *   TEXT      SC 1.4.3, 4.5:1. A foreground that carries words, on every
 *             background it can land on. NOTHING in this app qualifies for the
 *             large-text exemption: the biggest type is PageHeading's
 *             `text-lg font-semibold` = 18px/600 = 13.5pt bold, and the
 *             exemption starts at 14pt bold. So 4.5 applies everywhere, which
 *             is a simplification worth stating rather than rediscovering.
 *
 *   FOCUS     SC 1.4.11 / 2.4.11, 3:1. The focus ring against what it is drawn
 *             over.
 *
 *   MARK      SC 1.4.11, 3:1. Non-text that CARRIES MEANING: the two status
 *             dots, the pending dot, the selected-chip boundary, an input's
 *             own border. From phase 5 on this includes --certainty-rule,
 *             because §6.3 makes the dotted underline the mark that carries
 *             "approximate" when hue is gone.
 *
 *   INFO      No criterion. Decorative hairlines, and a tinted role panel's
 *             fill against the page. 1.4.11 exempts decoration, and a panel is
 *             identified by its border and its words, not by a 2%-tint fill.
 *             Printed with its ratio and never failed -- deleting these rows
 *             would hide real information, and failing them would be wrong.
 *
 * Two passes over the pairs themselves: the relationships the token layer
 * DECLARES by naming, and the ones the app RENDERS -- every class string in
 * src/app/** that sets a text colour and a background together. The second
 * pass is what catches a pairing nobody meant to create.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CSS = join(ROOT, 'web-angular/src/styles.css');
const APP = join(ROOT, 'web-angular/src/app');

const TEXT = { t: 4.5, tier: 'TEXT', crit: 'SC 1.4.3' };
const FOCUS = { t: 3, tier: 'FOCUS', crit: 'SC 1.4.11/2.4.11' };
const MARK = { t: 3, tier: 'MARK', crit: 'SC 1.4.11' };
const INFO = { t: 0, tier: 'INFO', crit: 'decorative' };

// --- the token layer -------------------------------------------------------

/** Pull one `{ ... }` block's `--name: r g b;` declarations into a map. */
function tokens(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no ${selector} block in styles.css`);
  const open = css.indexOf('{', at);
  let depth = 0, end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) { end = i; break; }
  }
  const out = new Map();
  for (const m of css.slice(open + 1, end).matchAll(/--([\w-]+)\s*:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return out;
}

const css = readFileSync(CSS, 'utf8');
const LIGHT = tokens(css, '\n:root {');
// `.dark` overrides `:root`; anything it does not name inherits.
const DARK = new Map([...LIGHT, ...tokens(css, '\n.dark {')]);

// --- WCAG ------------------------------------------------------------------

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function ratio(a, b) {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');

// --- pass 1: the pairs the token layer declares -----------------------------

const SURFACES = ['surface-page', 'surface-raised', 'surface-sunken'];

function declaredPairs() {
  const p = [];
  const add = (fg, bg, kind, label) => p.push({ fg, bg, ...kind, label });

  for (const bg of SURFACES) {
    // Text that carries words. text-disabled is here because §6/§4.5 make it
    // the FIFTH CERTAINTY STATE from phase 5 on -- a no-record en dash is
    // content, not a greyed-out control, and 1.4.3's disabled-control
    // exemption does not reach it.
    for (const fg of ['text-primary', 'text-heading', 'text-secondary', 'text-muted',
                      'text-subtle', 'text-disabled']) {
      add(fg, bg, TEXT, 'body text');
    }
    for (const fg of ['certainty-known', 'certainty-approx', 'certainty-absent']) {
      add(fg, bg, TEXT, 'certainty state (§6)');
    }
    add('certainty-rule', bg, MARK, 'the dotted rule -- carries "approximate" in greyscale');
    add('focus-ring', bg, FOCUS, 'the focus ring');
    add('border-selected', bg, MARK, 'the selected chip/card/tab boundary');
    add('border-default', bg, MARK, "an input's own border");
    // INFO, not MARK, and the code is why: chat-panel.ts:72 puts this dot
    // immediately beside the literal word "Thinking...", so the state is
    // available in text and 1.4.11 does not reach the dot.
    add('mark-pending', bg, INFO, "the chat's pending dot, beside the word Thinking");
    add('fill-brand', bg, MARK, 'a primary button against the page');
    add('border-strong', bg, INFO, 'a strong rule');
    add('border-subtle', bg, INFO, 'a hairline rule');
    add('border-hairline', bg, INFO, 'a hairline rule');
    add('divider', bg, INFO, 'a divider');
  }

  for (const role of ['danger', 'warning', 'success']) {
    add(`${role}-fg`, `${role}-bg`, TEXT, `${role} role`);
    add(`${role}-strong`, `${role}-bg`, TEXT, `${role}, one stop stronger`);
    add(`${role}-line`, `${role}-bg`, INFO, `${role} panel border`);
    for (const bg of SURFACES) add(`${role}-bg`, bg, INFO, `${role} panel fill on the page`);
  }
  add('danger-soft', 'danger-bg', TEXT, 'danger-soft (tool-call chip)');
  add('danger-soft', 'surface-raised', TEXT, 'danger-soft on a card');
  add('success-line-soft', 'success-bg', INFO, 'the softer success rule');
  // Also INFO: tool-call-chip.ts renders `{{ call().status }}` as words right
  // beside the dot, so the dot is redundant with text rather than the only
  // carrier of the state.
  for (const bg of SURFACES) {
    add('success-dot', bg, INFO, 'the tool-call OK dot, beside the status word');
    add('danger-dot', bg, INFO, 'the tool-call error dot, beside the status word');
  }

  // warning-fill is a BACKGROUND -- the harness banner, §12.2's storage chip.
  add('warning-strong', 'warning-fill', TEXT, 'the harness banner');
  add('warning-fg', 'warning-fill', TEXT, 'the harness banner, softer fg');
  // INFO: the banner says "harness - in memory" in words on itself, and
  // §12.2's chip keeps that text. The amber is emphasis, not the message.
  for (const bg of SURFACES) add('warning-fill', bg, INFO, 'the harness banner against the chrome');

  for (const a of ['dairy', 'vendor', 'both']) {
    add(`agent-${a}-fg`, `agent-${a}-bg`, TEXT, `the ${a} agent chip`);
    add(`agent-${a}-line`, `agent-${a}-bg`, INFO, `the ${a} chip border`);
    add(`agent-${a}-bg`, 'surface-raised', INFO, `the ${a} chip fill on a card`);
  }

  add('writelog-fg', 'writelog-bg', TEXT, 'the write-log bar (B3)');
  add('writelog-line', 'writelog-bg', INFO, 'the write-log rule');
  for (const bg of SURFACES) add('writelog-bg', bg, INFO, 'the write-log bar on the page');

  add('text-on-fill', 'fill-brand', TEXT, 'a primary button');
  add('text-on-fill', 'fill-brand-hover', TEXT, 'a primary button, hovered');
  add('text-secondary', 'fill-badge', TEXT, 'a status badge');
  add('text-muted', 'fill-badge', TEXT, 'a status badge, muted');
  // NOT what a refused button renders. button.ts:136 uses
  // `bg-surface-sunken text-content-disabled`, and --fill-brand-disabled has
  // ZERO consumers in src/app -- a dead token the document still lists.
  // Checked anyway so its deadness is on the record.
  add('text-disabled', 'fill-brand-disabled', INFO, 'DEAD TOKEN: no consumer in src/app');
  return p;
}

// --- pass 2: the pairs the app renders --------------------------------------

const UTILITY = new Map([
  ['surface-page', 'surface-page'], ['surface-raised', 'surface-raised'],
  ['surface-sunken', 'surface-sunken'],
  ['content-primary', 'text-primary'], ['content-heading', 'text-heading'],
  ['content-secondary', 'text-secondary'], ['content-muted', 'text-muted'],
  ['content-subtle', 'text-subtle'], ['content-disabled', 'text-disabled'],
  ['content-onFill', 'text-on-fill'],
  ['brand', 'fill-brand'], ['brand-hover', 'fill-brand-hover'],
  ['brand-disabled', 'fill-brand-disabled'], ['brand-badge', 'fill-badge'],
  ['danger-bg', 'danger-bg'], ['danger-fg', 'danger-fg'],
  ['danger-soft', 'danger-soft'], ['danger-strong', 'danger-strong'],
  ['warning-bg', 'warning-bg'], ['warning-fg', 'warning-fg'],
  ['warning-strong', 'warning-strong'], ['warning-fill', 'warning-fill'],
  ['success-bg', 'success-bg'], ['success-fg', 'success-fg'],
  ['success-strong', 'success-strong'],
  ['agent-dairy-bg', 'agent-dairy-bg'], ['agent-dairy-fg', 'agent-dairy-fg'],
  ['agent-vendor-bg', 'agent-vendor-bg'], ['agent-vendor-fg', 'agent-vendor-fg'],
  ['agent-both-bg', 'agent-both-bg'], ['agent-both-fg', 'agent-both-fg'],
  ['writelog-bg', 'writelog-bg'], ['writelog-fg', 'writelog-fg'],
  ['certainty-known', 'certainty-known'], ['certainty-approx', 'certainty-approx'],
  ['certainty-absent', 'certainty-absent'], ['certainty-rule', 'certainty-rule'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/*
 * Deliberately narrow: only a class string that names a background AND a text
 * colour. A text colour whose background comes from an ancestor cannot be
 * resolved by reading one line, and guessing would produce a list nobody
 * trusts -- pass 1's matrix covers those against all three surfaces.
 */
function renderedPairs() {
  const found = new Map();
  for (const file of walk(APP)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const bgs = [...line.matchAll(/\bbg-([A-Za-z][A-Za-z-]*)\b/g)].map((m) => m[1]);
      const fgs = [...line.matchAll(/\btext-([A-Za-z][A-Za-z-]*)\b/g)].map((m) => m[1]);
      for (const bg of bgs) for (const fg of fgs) {
        const bgTok = UTILITY.get(bg), fgTok = UTILITY.get(fg);
        if (!bgTok || !fgTok) continue;
        const key = `${fgTok}|${bgTok}`;
        if (!found.has(key)) found.set(key, []);
        found.get(key).push(`${relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  return found;
}

// --- report -----------------------------------------------------------------

const rows = [];
function check(mode, map, pair, where) {
  const a = map.get(pair.fg), b = map.get(pair.bg);
  if (!a || !b) { rows.push({ mode, ...pair, missing: true, where }); return; }
  const r = ratio(a, b);
  rows.push({ mode, ...pair, r, a, b, pass: pair.t === 0 || r >= pair.t, where });
}

const declared = declaredPairs();
const rendered = renderedPairs();
for (const [mode, map] of [['light', LIGHT], ['dark', DARK]]) {
  for (const pair of declared) check(mode, map, pair, 'declared');
  for (const [key, sites] of rendered) {
    const [fg, bg] = key.split('|');
    if (declared.some((d) => d.fg === fg && d.bg === bg)) continue;
    check(mode, map, { fg, bg, ...TEXT, label: `undeclared pairing, ${sites.length} site(s)` },
          sites.join(', '));
  }
}

const fmt = (n) => n.toFixed(2).padStart(6);
const graded = rows.filter((x) => x.t > 0);
const failures = graded.filter((x) => !x.pass);

console.log(`\nWCAG contrast over the token layer`);
console.log(`  ${graded.length} graded checks (TEXT/FOCUS/MARK), ${failures.length} failures`);
console.log(`  ${rows.length - graded.length} INFO rows, reported and never failed\n`);

for (const mode of ['light', 'dark']) {
  const f = failures.filter((x) => x.mode === mode);
  console.log(`--- ${mode.toUpperCase()}: ${f.length} failure(s) ---`);
  for (const x of f) {
    console.log(`  ${x.tier.padEnd(5)} ${fmt(x.r)}:1  needs ${x.t}  (${x.crit})`);
    console.log(`        ${x.fg} ${hex(x.a)}  on  ${x.bg} ${hex(x.b)}`);
    console.log(`        ${x.label}${x.where === 'declared' ? '' : '\n        ' + x.where}`);
  }
  console.log('');
}

if (process.argv.includes('--all')) {
  for (const mode of ['light', 'dark']) {
    console.log(`--- ${mode.toUpperCase()}, every pair ---`);
    for (const x of rows.filter((y) => y.mode === mode)) {
      if (x.missing) { console.log(`  ????  ${x.fg} on ${x.bg} -- token missing`); continue; }
      const verdict = x.t === 0 ? 'info' : x.pass ? 'ok  ' : 'FAIL';
      console.log(`  ${verdict} ${x.tier.padEnd(5)} ${fmt(x.r)}:1  ${x.fg} on ${x.bg}  -- ${x.label}`);
    }
    console.log('');
  }
}

// AAA is reported, never failed: 12-14px on a working surface all day is a
// case FOR 7:1, but this system never committed to it and saying so is honest.
const aaa = graded.filter((x) => x.tier === 'TEXT' && x.pass && x.r < 7);
console.log(`TEXT pairs passing AA but under AAA (7:1): ${aaa.length}`);

process.exit(failures.length > 0 && !process.argv.includes('--report') ? 1 : 0);
