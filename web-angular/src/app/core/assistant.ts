// Is the assistant panel open, and what is it looking at.
//
// docs/UI_SYSTEM.md §13.1 and §13.2. Phase 6b.
//
// ---------------------------------------------------------------------------
// PERSISTED PER SESSION, NOT PER ROUTE, AND NOT FOREVER
// ---------------------------------------------------------------------------
// §13.1: "Default closed. State persisted per session, not per route."
//
// PER ROUTE would mean the panel opening and closing as somebody moves between
// the roster and the herd list, which is the opposite of a consultation -- you
// ask a question, then you go and look at the thing, and the panel should still
// be there when you get back.
//
// PER SESSION means `sessionStorage` and not `localStorage`, which is the
// narrower choice of the two and deliberate. theme.ts explains why it persists
// while session.ts refuses to, and the rule it draws is about PROVENANCE: a
// remembered theme cannot mis-attribute a record. A remembered panel cannot
// either -- but it is a working posture rather than a preference, and a person
// who closed it on Tuesday has said nothing about Wednesday. sessionStorage
// dies with the tab, which is the right lifetime for "am I consulting right
// now".
//
// Every access is wrapped: a private window, or a browser set to block site
// data, THROWS on `sessionStorage` rather than returning null. theme.spec.ts
// pins the same behaviour for its own reads, including that a junk stored value
// is refused rather than passed through.

import { Injectable, computed, effect, signal } from '@angular/core';

const KEY = 'dairy360.assistant.open';

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'true';
  } catch {
    // Blocked storage is not an error worth surfacing -- it means the panel
    // starts closed, which is the default anyway.
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class Assistant {
  /** §13.1: default closed. */
  readonly open = signal(read());

  /**
   * The route the panel is reading, as §13.2's context line.
   *
   * Set by the shell, which is the only thing that knows the activated route.
   * A signal rather than a Router read in here so the service stays testable
   * without a RouterTestingModule, and so the WORDING lives beside the routes
   * it describes.
   */
  readonly context = signal<string | null>(null);

  /** `Reading BD-0003`, or nothing at all when the route says nothing useful. */
  readonly contextLine = computed(() => {
    const c = this.context();
    return c === null || c.length === 0 ? null : `Reading ${c}`;
  });

  constructor() {
    effect(() => {
      const open = this.open();
      try {
        sessionStorage.setItem(KEY, String(open));
      } catch {
        // Nothing to do and nothing to tell anybody: the panel still works,
        // it just will not be remembered.
      }
    });
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }
}
