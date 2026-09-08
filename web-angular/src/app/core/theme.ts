// Light, dark, or whatever the OS says. Phase 3 of docs/UI_SYSTEM.md.
//
// ---------------------------------------------------------------------------
// THREE STATES, NOT TWO, AND `system` IS THE DEFAULT
// ---------------------------------------------------------------------------
// A two-way toggle cannot express "follow the OS", so the first time an
// operator touches it they lose that forever -- and on a farm the answer
// genuinely changes between a morning round on a bright veranda and entering
// the evening session indoors. `system` is not a fallback here; it is the
// setting most people should stay on.
//
// ---------------------------------------------------------------------------
// THIS ONE IS PERSISTED, AND session.ts IS NOT -- THE RULE IS NOT INCONSISTENT
// ---------------------------------------------------------------------------
// session.ts refuses to persist anything and says why: "the tripwire list for
// this cycle forbids local state that outlives a page load, and a remembered
// `recorded_by` is exactly how a second person's entries get attributed to the
// first." That rule is about PROVENANCE. A remembered theme cannot mis-attribute
// a record to anybody; the worst it can do is show the wrong colours to the
// next person at the same machine, who can see that and change it.
//
// Section 8 asks for the toggle to be persisted, so it is. Recorded here
// because the two files sitting side by side with opposite answers about
// localStorage looks like drift, and it is not.
//
// ---------------------------------------------------------------------------
// `color-scheme` IS THE HALF PEOPLE FORGET
// ---------------------------------------------------------------------------
// The `.dark` class restyles what this app draws. It does nothing for what the
// BROWSER draws: scrollbars, the date picker's calendar (eleven `<input
// type="date"` sites), the select dropdown, autofill backgrounds, spellcheck
// underlines. Those follow `color-scheme`, and without it a dark page opens a
// blinding white calendar over itself.

import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'dairy360.theme';
const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

@Injectable({ providedIn: 'root' })
export class Theme {
  /** What the operator chose. `system` defers to the OS. */
  readonly mode = signal<ThemeMode>(read());

  /**
   * What the OS currently says, tracked live.
   *
   * Live because a machine can switch itself at sunset, and an app that only
   * read the query at startup would sit in the wrong scheme until reloaded.
   */
  private readonly prefersDark = signal(matchDark()?.matches ?? false);

  /** The scheme actually being rendered, after `system` is resolved. */
  readonly resolved = computed<'light' | 'dark'>(() => {
    // A local, so TypeScript narrows. Calling `this.mode()` twice in a ternary
    // reads as two unrelated ThemeMode values and the union never collapses.
    const mode = this.mode();
    if (mode === 'system') return this.prefersDark() ? 'dark' : 'light';
    return mode;
  });

  constructor() {
    const query = matchDark();
    // `addEventListener` on a MediaQueryList is the modern form; Safari before
    // 14 only had `addListener`. Guarded rather than assumed, because the
    // failure is silent -- the theme simply stops following the OS.
    query?.addEventListener?.('change', (e) => this.prefersDark.set(e.matches));

    effect(() => {
      const scheme = this.resolved();
      const root = document.documentElement;
      root.classList.toggle('dark', scheme === 'dark');
      // Not `dark light` -- naming one scheme is what makes native controls
      // commit. See the header.
      root.style.colorScheme = scheme;
    });

    effect(() => {
      const mode = this.mode();
      try {
        localStorage.setItem(KEY, mode);
      } catch {
        // Private browsing, or storage disabled. The toggle still works for
        // this page load; it just will not be remembered. Not worth telling
        // anybody about, and definitely not worth throwing over.
      }
    });
  }

  /** Advance system -> light -> dark -> system. One control, three states. */
  cycle(): void {
    const next = MODES[(MODES.indexOf(this.mode()) + 1) % MODES.length];
    this.mode.set(next);
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
  }
}

function matchDark(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

/**
 * The stored choice, or `system`.
 *
 * Validated against the union rather than cast: the value is user-writable --
 * anybody can open devtools and put `banana` in there -- and a bad one would
 * otherwise flow into `resolved()` and out to `classList.toggle`.
 */
function read(): ThemeMode {
  try {
    const raw = localStorage.getItem(KEY);
    return MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : 'system';
  } catch {
    return 'system';
  }
}
