// What happens after a successful write, so the next record can be typed
// without reaching for the mouse.
//
// ---------------------------------------------------------------------------
// THIS IS THE PART THAT DECIDES WHETHER A ROSTER PASS IS NEEDED
// ---------------------------------------------------------------------------
// Twenty animals through a form is not twenty times eight fields. It is twenty
// ROUND TRIPS -- submit, wait, read the result, clear the fields, put the cursor
// back, scroll up -- and a list is one continuous typing motion. The field count
// was the wrong measure; the round trip is the thing.
//
// So the round trip is what this collapses. After a write:
//
//   1. The per-animal fields CLEAR. Session-level facts do not, and neither do
//      fields with a strong prior (sex) -- consecutive animals in a backfill are
//      usually the same sex, and re-answering it twenty times is the tax the
//      defaults rule exists to avoid.
//   2. FOCUS RETURNS to the first field of the next record, so the operator's
//      hands never leave the keyboard.
//   3. The write is ANNOUNCED, in a live region and in a persistent line. The
//      cleared form is itself ambiguous -- it looks the same as a form that was
//      never filled -- so something has to say which serial was written, and it
//      has to say it without being looked for.
//
// Before this, none of the three happened: /add kept the last animal's values,
// left focus on the submit button, and reported success only in a panel below
// the fold. Submitting twice in a row would have produced a near-duplicate,
// which is now also caught by the duplicate warning -- but a form that invites
// the mistake is not fixed by a warning about it.

import { Injectable, signal } from '@angular/core';

/**
 * The announcement of the last successful write.
 *
 * A signal rather than a transient toast: the operator may look up several
 * seconds later, and a message that has already faded is one they have to
 * reconstruct from the herd list. It is replaced by the next write, not timed
 * out.
 *
 * A root service rather than per-form state, so the registry shell can render
 * one live region for every surface -- and so item 8's "last five written" strip
 * has something to extend instead of something to replace.
 */
@Injectable({ providedIn: 'root' })
export class WriteLog {
  readonly last = signal<string | null>(null);
  /** Bumped on every write, so `aria-live` re-announces an identical message. */
  readonly seq = signal(0);

  announce(message: string): void {
    this.last.set(message);
    this.seq.update((n) => n + 1);
  }

  clear(): void {
    this.last.set(null);
  }
}

/**
 * Put the caret in the first field of the next record.
 *
 * Deferred a frame on purpose. The success path clears signals that the template
 * reacts to, and focusing before that render can land on an element Angular is
 * about to replace -- at which point focus falls to `document.body` and the next
 * keystroke goes nowhere. Measured, not assumed: without the defer the caret is
 * lost on /add every time.
 */
export function focusAfterWrite(el: HTMLElement | null | undefined): void {
  if (!el) return;
  requestAnimationFrame(() => {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
  });
}
