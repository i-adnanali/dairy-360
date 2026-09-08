#!/usr/bin/env node
/*
 * The fourteen screens, in both themes, over CDP.
 *
 * docs/UI_SYSTEM.md §10.5 has carried this as a RECIPE since phase 0 and every
 * phase re-implemented it by hand. §16 listed "Phase 5's greyscale acceptance
 * has never been tested", and a recipe is why: the acceptance for §6 is that
 * the five certainty states are distinguishable IN GREYSCALE, and that is not
 * something anybody re-derives correctly at eleven at night. So it is a script.
 *
 * Usage, with `npm run harness:app` already up on :4200:
 *
 *   node scripts/shoot-screens.mjs                    both themes
 *   node scripts/shoot-screens.mjs --grey             both themes, desaturated
 *   node scripts/shoot-screens.mjs --only=check,milk  a subset, by screen key
 *   node scripts/shoot-screens.mjs --out=shots/phase5
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS §10.5 SAYS WILL GO WRONG, AND DO
 * ---------------------------------------------------------------------------
 * 1. THE DOCUMENT NEVER SCROLLS. The shell is `flex h-full flex-col` and
 *    <main> owns the scroll, so `Page.getLayoutMetrics` reports the viewport on
 *    every screen and a naive full-page capture is the fold. "The first attempt
 *    produced fourteen identical 900px crops before this was noticed." The fix
 *    is to grow the VIEWPORT until main stops scrolling, then capture.
 *
 * 2. THE THEME LEAKS. `system` is the default, so without forcing both the
 *    stored choice and the emulated media query the baseline picks up whatever
 *    the host OS happens to prefer that week.
 *
 * 3. THE TWO WRITE ROUTES CANNOT BE REACHED BY A PAGE LOAD. Session persists
 *    nothing by design, so a reload lands on SessionGate. The gate has to be
 *    driven and then navigation has to happen CLIENT-SIDE, or the session dies
 *    with the load.
 *
 * A fourth, learned here: --force-device-scale-factor=1 matters as much as the
 * width. On a retina host Chrome captures at 2x by default and a pixel diff
 * against a 1x baseline reports every pixel as changed.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.APP_URL ?? 'http://localhost:4200';
/*
 * 1440 is §10.5's baseline width and every stored comparison is against it, so
 * --width is for verifying a breakpoint rather than for shooting a baseline.
 * §13.1's 1100px is the app's only one.
 */
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1440);
const START_HEIGHT = 900;
const MAX_HEIGHT = 6000;

const args = process.argv.slice(2);
const flag = (n) => args.some((a) => a === `--${n}`);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=').slice(1).join('=');

const GREY = flag('grey');
const OUT = opt('out', GREY ? 'shots/grey' : 'shots');
const ONLY = opt('only', '').split(',').filter(Boolean);
/*
 * One ad-hoc route, for a state the fixture does not produce on its own.
 *
 * The roster's unanswered row is the case: the seed saves today's session, so
 * every row arrives answered and §6's fifth state never renders. A roster for a
 * date with no saved session shows it --
 *   --path=/milk/milking?on=2026-12-25 --key=milking-unanswered
 * -- and the same hatch reaches any query-string state worth a picture.
 */
const AD_HOC = opt('path', '');
const AD_HOC_KEY = opt('key', 'ad-hoc');
/*
 * Open the assistant panel before capturing (§13.1).
 *
 * It is default closed and its state lives in sessionStorage, so a capture that
 * did not ask for it would photograph the closed state on every screen -- which
 * is the right default and useless as a picture of the panel.
 */
const OPEN_ASSISTANT = flag('assistant');

/*
 * The fourteen. Twelve free plus the two frozen forms, and `chat` is the
 * fourteenth -- which is why phase 6a's route move has to be captured here too.
 *
 * `gate: true` marks the two that need a recording session in hand before the
 * route will render anything but SessionGate.
 */
const SCREENS = [
  { key: 'today', path: '/' },
  { key: 'animals', path: '/animals' },
  { key: 'animal-detail', path: '/animals/BD-0001' },
  { key: 'animal-new', path: '/animals/new', gate: true, frozen: true },
  { key: 'calving-new', path: '/animals/calvings/new', gate: true, frozen: true },
  { key: 'milking', path: '/milk/milking' },
  { key: 'dispatch', path: '/milk/dispatch' },
  { key: 'buyers', path: '/milk/buyers' },
  { key: 'buyer-detail', path: '/milk/buyers/:first' },
  { key: 'payroll', path: '/labour/payroll' },
  { key: 'people', path: '/labour/people' },
  { key: 'person-detail', path: '/labour/people/:first' },
  { key: 'check', path: '/check' },
  { key: 'chat', path: '/chat' },
];

// --- a minimal CDP client --------------------------------------------------
//
// Node 22 has a global WebSocket, so there is no dependency here at all. That
// is deliberate: a verification script that needs `npm i` before it runs is a
// script that does not get run.

class CDP {
  #ws; #id = 0; #pending = new Map(); #listeners = new Map();

  static async attach(port) {
    for (let i = 0; i < 100; i++) {
      try {
        const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
        const page = list.find((t) => t.type === 'page');
        if (page) return new CDP(page.webSocketDebuggerUrl);
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Chrome never opened its debugging port');
  }

  constructor(url) {
    this.#ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.#ws.onopen = res;
      this.#ws.onerror = rej;
    });
    this.#ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== undefined) {
        const p = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (!p) return;
        msg.error ? p.reject(new Error(`${msg.error.message} (${p.method})`)) : p.resolve(msg.result);
        return;
      }
      for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params);
    };
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(fn);
  }

  once(method, fn) {
    const wrapped = (p) => {
      const list = this.#listeners.get(method) ?? [];
      const i = list.indexOf(wrapped);
      if (i >= 0) list.splice(i, 1);
      fn(p);
    };
    this.on(method, wrapped);
  }

  close() { this.#ws.close(); }
}

/** Run an expression in the page and return its value. */
async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'page threw');
  return result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Navigate and wait for the load event.
 *
 * `Page.navigate` immediately followed by `Page.reload` fails with "Not
 * attached to an active page": the first cross-origin hop off about:blank swaps
 * the renderer, and the reload lands in the gap. Chrome is launched pointed at
 * the app instead (see main), so every navigation here is same-origin -- and
 * one navigate is enough, because `addScriptToEvaluateOnNewDocument` runs on it
 * and a reload was only ever there to make sure it did.
 */
async function load(cdp, url) {
  const loaded = new Promise((res) => {
    const off = () => res();
    cdp.once('Page.loadEventFired', off);
    setTimeout(off, 8000);
  });
  await cdp.send('Page.navigate', { url });
  await loaded;
}

/** Wait until the page settles: the router has run and no request is in flight. */
async function settle(cdp) {
  await evaluate(cdp, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  for (let i = 0; i < 60; i++) {
    const loading = await evaluate(
      cdp,
      `!!document.querySelector('[data-role="loading"]') ||
       document.body.textContent.includes('Loading…')`,
    );
    if (!loading) break;
    await sleep(100);
  }
  await sleep(150);
}

// --- theme -----------------------------------------------------------------

/**
 * Both halves, before the first navigation.
 *
 * `theme.ts` reads localStorage on construction, so seeding the key after the
 * app boots would need a reload -- and a reload is what kills the session on
 * the two gated screens. `setEmulatedMedia` covers the `system` path and
 * anything that reads `prefers-color-scheme` directly.
 */
async function forceTheme(cdp, mode) {
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: mode },
      // The pulse in chat-panel animates indefinitely while the model streams,
      // and styles.css honours this setting. Freezing it makes the capture
      // deterministic rather than nearly-deterministic.
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('dairy360.theme', ${JSON.stringify(mode)}); } catch {}`,
  });
}

/**
 * GREYSCALE, and it is done in the page rather than to the PNG.
 *
 * Post-processing the file would prove the same thing, but doing it live means
 * you can also open the browser and LOOK -- which is what actually finds a pair
 * of states that have collapsed into one grey. `grayscale(1)` on the root is
 * the same transform a monochrome display applies.
 *
 * It is applied to <html> and not <body> so the page's own background goes with
 * it; a desaturated body over a coloured html paints a grey card on a tinted
 * ground and reads as a bug in the capture.
 */
async function applyGrey(cdp) {
  await evaluate(cdp, `
    (() => {
      let s = document.getElementById('__grey');
      if (!s) { s = document.createElement('style'); s.id = '__grey'; document.head.append(s); }
      s.textContent = 'html { filter: grayscale(1) !important; }';
      return true;
    })()
  `);
}

// --- the session gate ------------------------------------------------------

/**
 * Fill in the gate WHERE IT ALREADY IS, which turns out to need no hop at all.
 *
 * §10.2 says to drive the gate and then "navigate CLIENT-SIDE, or the session
 * dies with the reload", which is right about reloads and wrong about the
 * route. registry-shell.ts:154 renders <app-session-gate /> INSIDE <main> in
 * place of the outlet when `writeOnlyRoute() && !session.ready()` -- so
 * /animals/new already shows the gate, and the moment the session opens the
 * shell swaps the gate for the routed form with the URL untouched. Loading the
 * target route directly is both simpler and closer to what a person does.
 *
 * The first version of this looked for `[data-role="start-session"]`, which
 * lives on the session BAR (session-bar.ts:59) and is the button that opens the
 * gate on a non-write route. On a write-only route there is nothing to open.
 * It reported "!! GATE STILL SHOWING" on both frozen forms, which is exactly
 * what that warning is for.
 *
 * `acknowledge-target` is ticked when it is present: `canStart()` requires it
 * only for a real database, and it is absent against the harness -- but a
 * capture run against a real registry should still get past the gate rather
 * than silently photographing it.
 */
async function openSession(cdp) {
  const ok = await evaluate(cdp, `
    (async () => {
      const q = (s) => document.querySelector(s);
      const click = (el) => el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
      const tick = () => new Promise((r) => setTimeout(r, 80));

      if (!q('[data-role="gate"]')) {
        const open = q('[data-role="start-session"]');
        if (!open) return 'no gate and no way to open one';
        click(open); await tick();
      }
      if (!q('[data-role="gate"]')) return 'the gate never rendered';

      const chip = q('[data-role="gate"] [data-chip]');
      if (!chip) return 'no source-form chip';
      click(chip); await tick();

      const by = q('[data-role="recorded-by"]');
      if (!by) return 'no recorded-by input';
      by.value = 'adnan';
      by.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();

      const ack = q('[data-role="acknowledge-target"]');
      if (ack && !ack.checked) {
        ack.checked = true;
        ack.dispatchEvent(new Event('change', { bubbles: true }));
        await tick();
      }

      const start = q('[data-role="start"]');
      if (!start) return 'no start button';
      if (start.getAttribute('aria-disabled') === 'true') return 'start is still refused';
      click(start); await tick(); await tick();
      return q('[data-role="gate"]') ? 'the gate is still up after start' : true;
    })()
  `);
  if (ok !== true) throw new Error(`session gate: ${ok}`);
}

/** Navigate without a page load, so the session survives. */
async function navigateInApp(cdp, path) {
  await evaluate(cdp, `
    (() => {
      const a = document.createElement('a');
      a.href = ${JSON.stringify(path)};
      document.body.append(a);
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      a.remove();
      return location.pathname;
    })()
  `);
  await settle(cdp);
  const at = await evaluate(cdp, 'location.pathname');
  if (at !== path) {
    // A router link click can be swallowed if nothing is listening; fall back to
    // the History API, which Angular's router also observes.
    await evaluate(cdp, `history.pushState({}, '', ${JSON.stringify(path)});
      dispatchEvent(new PopStateEvent('popstate'));`);
    await settle(cdp);
  }
}

// --- capture ---------------------------------------------------------------

/**
 * Grow the viewport until <main> stops scrolling, then shoot.
 *
 * The loop is the whole point (see the header). It ends on equality rather than
 * on a fixed number of tries so a screen that genuinely needs 3000px gets it,
 * and it caps out so a runaway layout does not ask for a 40MB PNG.
 *
 * IT MEASURES <main>, WHICH IS SLIGHTLY WRONG WITH --assistant BELOW 1100px.
 * The panel then covers the whole content area, so the height is chosen by the
 * table hidden beneath it and the capture carries empty space under the panel.
 * The picture is still true -- it is not measuring the wrong ELEMENT, it is
 * measuring the element that owns the scroll -- and fixing it would mean the
 * driver knowing which overlay is up, which is more coupling than a screenshot
 * tool should have.
 */
async function capture(cdp, file) {
  let height = START_HEIGHT;
  for (let i = 0; i < 12; i++) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(120);
    const m = await evaluate(cdp, `
      (() => {
        const main = document.querySelector('main') ?? document.scrollingElement;
        return { s: main.scrollHeight, c: main.clientHeight };
      })()
    `);
    if (m.s <= m.c || height >= MAX_HEIGHT) break;
    height = Math.min(MAX_HEIGHT, height + (m.s - m.c) + 8);
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(data, 'base64'));
  return height;
}

// --- run -------------------------------------------------------------------

async function firstId(kind) {
  const path = kind === 'buyer' ? 'destinations' : 'people';
  try {
    const rows = await fetch(`http://localhost:4000/api/registry/${path}`).then((r) => r.json());
    const list = Array.isArray(rows) ? rows : (rows.rows ?? rows.people ?? rows.destinations ?? []);
    return list[0]?.id ?? list[0]?.person_id ?? list[0]?.destination_id ?? null;
  } catch { return null; }
}

async function main() {
  const health = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false);
  if (!health) {
    console.error(`No app on ${BASE}. Start it with: npm run harness:app`);
    process.exit(1);
  }

  // The per-run UUIDs §10.2 warns about: buyer and person ids move every time
  // the harness restarts, so they are resolved now rather than hard-coded.
  const buyer = await firstId('buyer');
  const person = await firstId('person');
  const screens = (AD_HOC ? [{ key: AD_HOC_KEY, path: AD_HOC }] : SCREENS)
    .filter((s) => ONLY.length === 0 || ONLY.some((o) => s.key.includes(o)))
    .map((s) => ({
      ...s,
      path: s.path
        .replace(':first', s.key.startsWith('buyer') ? (buyer ?? '') : (person ?? '')),
    }))
    // Drops a screen whose :first id could not be resolved -- NOT the today
    // board, whose path is exactly '/'. The first version of this filter tested
    // `endsWith('/')` and quietly shot thirteen screens instead of fourteen.
    .filter((s) => !s.path.includes(':') && s.path !== '');

  mkdirSync(OUT, { recursive: true });
  const profile = `/tmp/dairy360-shots-profile`;
  rmSync(profile, { recursive: true, force: true });

  const port = 9333;
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--font-render-hinting=none',
    // A retina host captures at 2x without this, and every pixel then differs
    // from a 1x baseline.
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${START_HEIGHT}`,
    '--no-first-run',
    '--disable-extensions',
    // Pointed at the app, not about:blank: the first hop off about:blank is
    // cross-origin, swaps the renderer, and detaches the page target mid-flight.
    BASE + '/',
  ], { stdio: 'ignore' });

  const cdp = await CDP.attach(port);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const written = [];
  try {
    for (const mode of ['light', 'dark']) {
      await forceTheme(cdp, mode);

      for (const screen of screens) {
        // A fresh load per screen, then the gate driven and a CLIENT-SIDE hop
        // for the two that need a session. Doing it per screen rather than once
        // costs a second and buys independence: a failure on one screen cannot
        // leave the next one holding a half-open gate.
        await load(cdp, BASE + screen.path);
        await settle(cdp);
        if (screen.gate) {
          await openSession(cdp);
          await settle(cdp);
        }
        if (OPEN_ASSISTANT) {
          // ENSURE open, do not TOGGLE. The panel's state lives in
          // sessionStorage and survives a page load, so a blind click opened it
          // on the first screen and closed it again on the second -- which is
          // the persistence working exactly as §13.1 specifies, and a bug in
          // the driver rather than in the app.
          await evaluate(cdp, `
            (() => {
              if (document.querySelector('[data-role="assistant-panel"]')) return true;
              const t = document.querySelector('[data-role="assistant-toggle"]');
              if (!t) return 'no toggle';
              t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              return true;
            })()
          `);
          // The panel @defers its chat panel, so the chunk has to arrive before
          // there is anything to photograph.
          for (let i = 0; i < 60; i++) {
            const up = await evaluate(cdp, `!!document.querySelector('app-composer textarea, app-composer input')`);
            if (up) break;
            await sleep(100);
          }
          await sleep(200);
        }
        if (GREY) await applyGrey(cdp);

        const file = join(OUT, `${screen.key}.${mode}${GREY ? '.grey' : ''}.png`);
        const h = await capture(cdp, file);
        const gateShowing = await evaluate(
          cdp, `!!document.querySelector('[data-role="start-session"], [data-role="start"]')`,
        );
        const note = screen.gate && gateShowing ? '  !! GATE STILL SHOWING' : '';
        written.push(file);
        console.log(`  ${mode.padEnd(5)} ${screen.key.padEnd(14)} ${String(h).padStart(4)}px${note}`);
      }
    }
  } finally {
    cdp.close();
    chrome.kill();
  }
  console.log(`\n${written.length} PNG(s) in ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
