// Shared write-form state: submitting, server refusals, and field binding.
//
// ---------------------------------------------------------------------------
// SERVER REFUSALS ARE THE VALIDATION
// ---------------------------------------------------------------------------
// There is no client-side re-implementation of the herd rules. The server
// already refuses a departure after a departure, a calving on a departed dam, a
// month-precision date on the 14th -- with prose written to teach an operator
// what to do. Re-deriving any of that here would produce two sets of rules that
// drift, and the client's copy would be the wrong one.
//
// So a form's job is: collect, submit, and put the server's message next to the
// right input. `field` names a DOMAIN COLUMN, which is why the controls are
// named after domain columns -- binding by string-matching the prose works
// right until someone rewords a message.
//
// The message is shown VERBATIM. Never rephrased, never truncated.
//
// ---------------------------------------------------------------------------
// AND THIS IS WHERE THE IDEMPOTENCY KEY LIVES
// ---------------------------------------------------------------------------
// One key per SUBMISSION ATTEMPT SEQUENCE, not per click and not per form.
// Minted lazily on the first submit, reused while a refusal is on screen,
// dropped on success so the next record is a new submission.
//
// That rule falls out of what the retry paths actually are:
//
//   retry after a network fault   -> same key. The one that matters: the first
//                                    request may have succeeded server-side and
//                                    failed in transit, and only a reused key
//                                    can tell the server those are one write.
//   failed submit, edit, resubmit -> same key, but the BODY changed, and the
//                                    server keys on (key, body) -- so it is
//                                    processed as new with no wiring here.
//   success, then the next animal -> key cleared, so a genuinely new record is
//                                    never mistaken for a replay of the last.
//
// TWO ALTERNATIVES REJECTED. Minting inside run() on every call gives a fresh
// key per click, which protects nothing. Deriving the key from the payload is
// tempting -- identical body, identical key, automatically -- but two distinct
// animals with no name, the same sex and the same arrival year post an
// IDENTICAL body, so the second would silently return the first's result and
// create nothing. That is the roster pass, not a hypothetical.
//
// What no client-side key can cover: a page refresh, or a second tab. Both get
// a fresh FormState. Stated in idempotency.ts alongside the server's own hole.

import { signal } from '@angular/core';
import { ApiError } from './api';

/** A key only has to be unique and opaque; it is never parsed. */
function newIdempotencyKey(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class FormState<T> {
  readonly submitting = signal(false);
  /** The last refusal, or null. */
  readonly error = signal<ApiError | null>(null);
  /** The last success, for the "what just happened" panel. */
  readonly result = signal<T | null>(null);
  /** Null between submissions; set for as long as one is being attempted. */
  private readonly key = signal<string | null>(null);

  /** The current attempt's key, minted on first use. Exposed for specs. */
  idempotencyKey(): string {
    const existing = this.key();
    if (existing !== null) return existing;
    const minted = newIdempotencyKey();
    this.key.set(minted);
    return minted;
  }

  /** The refusal message for one field, or null. */
  fieldError(field: string): string | null {
    const e = this.error();
    return e && e.isRefusal && e.field === field ? e.message : null;
  }

  /**
   * A refusal with no `field`, or one naming a field this form does not render.
   *
   * Shown at form level rather than dropped: a message that names an unknown
   * field is still the server telling the operator something true, and
   * swallowing it would leave a form that refuses to submit and says nothing.
   */
  formError(knownFields: readonly string[]): string | null {
    const e = this.error();
    if (!e) return null;
    if (!e.isRefusal) return e.message;
    if (e.field === undefined || !knownFields.includes(e.field)) return e.message;
    return null;
  }

  /**
   * True when the last refusal carries this code, wherever its message is bound.
   *
   * Needed because a refusal that has an override -- `animal_departed`,
   * `near_duplicate_calving` -- names a FIELD, so its message goes to that
   * control and never reaches the form-level block. Keying the override button
   * off formError() left it unreachable, which a form test caught: the message
   * appeared, the way past it did not.
   */
  hasCode(code: string): boolean {
    const e = this.error();
    return e !== null && e.isRefusal && e.code === code;
  }

  /**
   * The key is HANDED TO the callback rather than left for it to fetch.
   *
   * That is what makes forgetting it a compile error instead of an unprotected
   * write: every api write method takes the key as a required argument, so a
   * submit closure that ignores it does not typecheck.
   */
  async run(fn: (idempotencyKey: string) => Promise<T>): Promise<T | null> {
    this.submitting.set(true);
    this.error.set(null);
    const key = this.idempotencyKey();
    try {
      const r = await fn(key);
      this.result.set(r);
      // Success ends the attempt sequence. The next submit is a NEW record and
      // must not be recognised as a replay of this one.
      this.key.set(null);
      return r;
    } catch (e) {
      // Deliberately keeps the key: the next click is a retry of this same
      // write, and the request may already have landed.
      this.error.set(e instanceof ApiError ? e : new ApiError({ error: 'unknown', message: String(e) }, false));
      return null;
    } finally {
      this.submitting.set(false);
    }
  }

  reset(): void {
    this.error.set(null);
    this.result.set(null);
    this.key.set(null);
  }
}
