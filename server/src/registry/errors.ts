// Animal registry -- domain errors, with a machine-readable code and field.
//
// PURE: no `../db`, no express.
//
// ---------------------------------------------------------------------------
// WHY A CODE AND A FIELD, WHEN THE MESSAGE ALREADY SAYS EVERYTHING
// ---------------------------------------------------------------------------
// The messages are the good part -- they were written to teach an operator what
// to do, and the entry UI is supposed to show them VERBATIM rather than
// rephrasing. But a form also has to put each message next to the input that
// caused it, and doing that from prose means string-matching the message. That
// works right up until someone improves the wording, at which point the
// matching silently stops and the message lands in the wrong place or nowhere.
//
// So: `code` is what a caller branches on, `field` is where the message goes,
// and `message` is the prose, unchanged. `toWire()` is the HTTP shape.
//
// A domain error is NOT a CLI error. CliError (cli.ts) is about arguments --
// missing flags, unparseable values -- and belongs to one transport. These are
// rules about the herd, and they hold whether the caller is a command, a route,
// or a future agent tool.

/** Stable identifiers. Callers branch on these; the prose may be reworded. */
export type RegistryErrorCode =
  // --- animals ---
  | 'unknown_animal'
  | 'unknown_dam'
  | 'dam_not_female'
  | 'animal_departed'
  | 'already_departed'
  | 'sex_mismatch'
  // --- events ---
  | 'unknown_event'
  | 'not_a_calving'
  | 'already_superseded'
  | 'no_origin_event'
  | 'already_has_birth'
  | 'inconsistent_pair'
  | 'event_before_origin'
  // --- calving ---
  | 'near_duplicate_calving'
  | 'self_calf'
  | 'link_requires_live'
  // Link mode: the target has a calving of its own less than a gestation after
  // the proposed birth date, so it would have conceived before it was born.
  // No `allow_*` companion, and deliberately so -- unlike near_duplicate_calving
  // and animal_departed this names something impossible rather than unusual,
  // so there is nothing for an operator to know better about.
  | 'calf_calved_too_soon'
  // --- milk yield (step 4) ---
  //
  // No `allow_*` companion, deliberately. Unlike near_duplicate_calving this
  // names something contradictory rather than unusual: an animal with no open
  // lactation on that date was not producing milk, so the row is either the
  // wrong animal or the wrong date, and both are fixed by correcting the input
  // rather than by insisting.
  | 'no_open_lactation'
  | 'empty_session'
  // --- sales, home use and the ledger (docs/REGISTRY_SALES.md) ---
  | 'unknown_destination'
  // Milk kept for the house is a DISPOSITION, not a sale. Pricing it, or paying
  // for it, would put the farm's own milk in somebody's balance.
  | 'not_billable'
  // A billable destination with no price agreement covering the date. Refused
  // rather than defaulted to zero: a free sale is a decision somebody has to
  // have made, and a silent zero is how it gets made by nobody.
  | 'no_price_in_force'
  // A dispatch dated outside the destination's active range -- either the wrong
  // date, or a buyer whose range needs correcting first.
  | 'destination_not_active'
  | 'untouched_standing_destination'
  // --- payload / dates ---
  | 'invalid_payload'
  | 'invalid_precision'
  | 'precision_not_defaulted'
  // --- transport ---
  //
  // The one code here that is NOT a rule about the herd. It is about the
  // REQUEST, and it lives in this union anyway because it has to reach a client
  // through the same `{ code, field, message }` wire shape as everything else --
  // a second error vocabulary for one case would mean every caller learning two.
  | 'missing_idempotency_key';

export interface WireError {
  error: RegistryErrorCode;
  /** The input this belongs next to, when there is one. */
  field?: string;
  /** The prose, verbatim. Never rewritten by a transport. */
  message: string;
}

/**
 * A rule about the herd was broken.
 *
 * Thrown by the domain core (entry.ts, calving.ts, events.ts) and mapped by
 * whichever transport is calling: the CLI prints `message`, an HTTP route
 * returns `toWire()` as a 400.
 */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly field?: string;

  constructor(code: RegistryErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.field = field;
  }

  toWire(): WireError {
    return this.field !== undefined
      ? { error: this.code, field: this.field, message: this.message }
      : { error: this.code, message: this.message };
  }
}

/**
 * Calving-specific errors.
 *
 * A subclass rather than a separate hierarchy: it keeps `instanceof
 * CalvingError` working for code that predates the codes, while giving every
 * calving refusal the same wire shape as every other domain refusal. There is
 * no behavioural difference -- the subclass exists for the name in stack traces
 * and for the callers that already narrow on it.
 */
export class CalvingError extends RegistryError {
  constructor(code: RegistryErrorCode, message: string, field?: string) {
    super(code, message, field);
    this.name = 'CalvingError';
  }
}

/** True for anything a transport should render as a 400 rather than a 500. */
export function isRegistryError(e: unknown): e is RegistryError {
  return e instanceof RegistryError;
}
