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

import { signal } from '@angular/core';
import { ApiError } from './api';

export class FormState<T> {
  readonly submitting = signal(false);
  /** The last refusal, or null. */
  readonly error = signal<ApiError | null>(null);
  /** The last success, for the "what just happened" panel. */
  readonly result = signal<T | null>(null);

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

  async run(fn: () => Promise<T>): Promise<T | null> {
    this.submitting.set(true);
    this.error.set(null);
    try {
      const r = await fn();
      this.result.set(r);
      return r;
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError({ error: 'unknown', message: String(e) }, false));
      return null;
    } finally {
      this.submitting.set(false);
    }
  }

  reset(): void {
    this.error.set(null);
    this.result.set(null);
  }
}
