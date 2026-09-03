// Animal registry -- shared CLI argument handling for the backfill commands.
//
// PURE: no `../db`, so registry.cli.test.ts exercises every parsing and
// refusal rule with no database.
//
// Follows the repo convention exactly: `--flag=value` split on the first `=`,
// hand-parsed from process.argv.slice(2), no arg-parsing library. Same shape as
// simulate.ts / captureMqtt.ts / verifyDoubleTakeShape.ts.
//
// ---------------------------------------------------------------------------
// THE RULE THIS MODULE EXISTS TO ENFORCE
// ---------------------------------------------------------------------------
// Decision doc §11: "Precision is never defaulted. The backfill input requires
// an explicit precision value per date. A missing precision is an error, not a
// `day`."
//
// So there is no code path here that supplies a precision. requirePrecision()
// throws with an explanation rather than falling back, and the same applies to
// provenance: `--source-form` and `--recorded-by` are required too, because a
// defaulted `recall` would make a sheet-transcribed event indistinguishable
// from a remembered one, which is the same class of dishonesty in a different
// column.

import { DATE_PRECISIONS, SOURCE_FORMS } from './types';
import type { DatePrecision, Provenance, SourceForm } from './types';

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export type Flags = Map<string, string | true>;

/**
 * Parse `--flag=value` and bare `--flag` into a map.
 *
 * Splits on the FIRST `=` only, so a value may itself contain one -- notes and
 * source refs realistically do ("--notes=weight=41kg").
 */
export function parseFlags(argv: string[]): Flags {
  const flags: Flags = new Map();
  for (const raw of argv) {
    // `-h` is the one short flag this repo uses -- rebuild.ts and
    // verifyRegistry.ts both accept it, so the shared parser must too, or the
    // registry commands would be the only ones where it fails.
    if (raw === '-h') {
      flags.set('help', true);
      continue;
    }
    if (!raw.startsWith('--')) {
      throw new CliError(`expected a --flag=value argument, got '${raw}'`);
    }
    const eq = raw.indexOf('=');
    if (eq === -1) {
      flags.set(raw.slice(2), true);
      continue;
    }
    const name = raw.slice(2, eq);
    if (name.length === 0) throw new CliError(`malformed argument '${raw}'`);
    flags.set(name, raw.slice(eq + 1));
  }
  return flags;
}

/** Reject any flag the command does not declare, so a typo is not ignored. */
export function rejectUnknownFlags(flags: Flags, allowed: readonly string[]): void {
  const unknown = [...flags.keys()].filter(
    (k) => !allowed.includes(k) && k !== 'help' && k !== 'h',
  );
  if (unknown.length > 0) {
    throw new CliError(
      `unknown flag(s) ${unknown.map((k) => `--${k}`).join(', ')}\n` +
        `allowed: ${allowed.map((k) => `--${k}`).join(', ')}`,
    );
  }
}

export function wantsHelp(flags: Flags): boolean {
  return flags.has('help') || flags.has('h');
}

/** A required string flag. A bare `--flag` with no value is an error, not true. */
export function requireStr(flags: Flags, name: string, hint: string): string {
  const v = flags.get(name);
  if (v === undefined) {
    throw new CliError(`--${name} is required (${hint})`);
  }
  if (v === true || v.length === 0) {
    throw new CliError(`--${name} needs a value (${hint})`);
  }
  return v;
}

export function optStr(flags: Flags, name: string): string | null {
  const v = flags.get(name);
  if (v === undefined) return null;
  if (v === true) throw new CliError(`--${name} needs a value`);
  return v.length === 0 ? null : v;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function requireDate(flags: Flags, name: string, hint: string): string {
  const v = requireStr(flags, name, hint);
  if (!DATE_RE.test(v)) {
    throw new CliError(`--${name} must be YYYY-MM-DD, got '${v}'`);
  }
  return v;
}

export function optDate(flags: Flags, name: string): string | null {
  const v = optStr(flags, name);
  if (v === null) return null;
  if (!DATE_RE.test(v)) {
    throw new CliError(`--${name} must be YYYY-MM-DD, got '${v}'`);
  }
  return v;
}

/**
 * Precision, required, never defaulted.
 *
 * The long message is deliberate. This is the refusal an operator will hit most
 * often, and the useful thing to tell them is not "flag missing" but what to
 * put there when they genuinely do not know the date.
 */
export function requirePrecision(flags: Flags, name = 'precision'): DatePrecision {
  const v = flags.get(name);
  if (v === undefined || v === true || v.length === 0) {
    throw new CliError(
      `--${name} is REQUIRED and is never defaulted.\n` +
        `  One of: ${DATE_PRECISIONS.join(' | ')}\n` +
        '\n' +
        '  A default is how `day` gets applied to a guess. If you do not know the exact\n' +
        '  date, say so -- that is what this flag is for:\n' +
        '    --precision=day        the date is known\n' +
        '    --precision=month      the month is known; pass the 1st of that month\n' +
        '    --precision=year       the year is known; pass January 1\n' +
        '    --precision=estimated  even the year is inferred (e.g. age from dentition)\n' +
        '\n' +
        '  An animal born `estimated 2021` is more useful than one born a confident,\n' +
        '  fabricated `2021-04-12`, because only the first can be corrected without\n' +
        '  someone first discovering it was wrong.',
    );
  }
  if (!(DATE_PRECISIONS as readonly string[]).includes(v)) {
    throw new CliError(
      `--${name}='${v}' is not a precision. One of: ${DATE_PRECISIONS.join(' | ')}`,
    );
  }
  return v as DatePrecision;
}

/** Optional precision, but still never defaulted when its date is present. */
export function optPrecision(flags: Flags, name: string): DatePrecision | null {
  const v = optStr(flags, name);
  if (v === null) return null;
  if (!(DATE_PRECISIONS as readonly string[]).includes(v)) {
    throw new CliError(
      `--${name}='${v}' is not a precision. One of: ${DATE_PRECISIONS.join(' | ')}`,
    );
  }
  return v as DatePrecision;
}

/**
 * Provenance, all four columns, with the two NOT NULL ones required.
 *
 * `--source-form` is required rather than defaulted to `recall`. Defaulting
 * would be safe in the honesty direction, but it would also silently label a
 * sheet-transcribed event as remembered, and the whole point of the column is
 * that the two are distinguishable.
 */
export function requireProvenance(flags: Flags): Provenance {
  const sourceForm = requireStr(
    flags,
    'source-form',
    `one of ${SOURCE_FORMS.join(' | ')} -- 'recall' for anything reconstructed from memory`,
  );
  if (!(SOURCE_FORMS as readonly string[]).includes(sourceForm)) {
    throw new CliError(
      `--source-form='${sourceForm}' is not valid. One of: ${SOURCE_FORMS.join(' | ')}`,
    );
  }
  return {
    source_form: sourceForm as SourceForm,
    source_ref: optStr(flags, 'source-ref'),
    observed_by: optStr(flags, 'observed-by'),
    recorded_by: requireStr(
      flags,
      'recorded-by',
      'who typed this in -- a stable identifier, not a display name',
    ),
  };
}

/** Flag names every date-and-provenance command shares. */
export const PROVENANCE_FLAGS = [
  'source-form',
  'source-ref',
  'observed-by',
  'recorded-by',
] as const;

/**
 * Run a CLI main(), printing a CliError as a message rather than a stack.
 *
 * An operator entering herd data by hand should see "--precision is REQUIRED"
 * and the explanation, not twenty lines of V8 frames. Anything that is NOT a
 * CliError still throws with its stack, because that is a bug rather than a
 * usage problem.
 */
export function runCli(main: () => void): void {
  try {
    main();
  } catch (e) {
    if (e instanceof CliError) {
      console.error(`\n${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }
}
