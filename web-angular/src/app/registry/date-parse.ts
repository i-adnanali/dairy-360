// Read a date the way it was typed, and infer how well it is known.
//
// ---------------------------------------------------------------------------
// PRECISION IS DERIVED FROM THE KEYSTROKES, NOT CHOSEN FROM A CONTROL
// ---------------------------------------------------------------------------
// The old control asked "how well do you know this date?" first and then showed
// only the inputs that answer allowed. That was epistemically right and cost two
// clicks per date, twice per form, on a job that is otherwise pure typing.
//
// This does the same work from the other end. `2019` can only mean a year;
// `mar 2019` can only mean a month; `6 Jul 2023` can only mean a day. The
// precision is a fact about what was typed, so it does not need to be asked --
// but it DOES need to be shown back, because an inference the operator cannot
// see is a default by another name.
//
// ---------------------------------------------------------------------------
// THE INFERENCE CANNOT BE OVERRIDDEN UPWARD, AND THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// There is no control anywhere that says "actually treat this as an exact day".
// If the text says `mar 2019`, the day is not in it, and letting someone assert
// day precision over it would rebuild the exact fabrication the empty-fields fix
// closed -- a confident date nothing downstream can detect as false. To get day
// precision you type a day. Retyping is the escape hatch, and it is the only one.
//
// PURE, and no dependency: the repo has no date library and this adds none.
// `time.ts` has `farmToday()` only. Being pure is what lets date-parse.spec.ts
// exercise every form without a component or a browser.

import type { DatePrecision } from './types';

/** Exactly what the old segmented control emitted, so consumers are unchanged. */
export interface PrecisionDate {
  occurred_on: string;
  date_precision: DatePrecision;
  occurred_time: string | null;
}

/**
 * What the text amounts to. THREE STATES, not two, and the third is the point.
 *
 * `empty` and `incomplete` were both `null` under the old contract, so a form
 * could not tell a date nobody began from one someone abandoned. On an OPTIONAL
 * date that difference is the whole bug: the operator types a birth year, the
 * parse fails, the form sends `birth_on: null`, and the record is
 * indistinguishable from never having typed anything. A fabricated date is at
 * least visible to whoever reads the row later; a vanished one is visible to
 * nobody, ever.
 */
export type DateEntry =
  | { status: 'empty' }
  | { status: 'incomplete'; message: string }
  | { status: 'complete'; value: PrecisionDate; reading: string };

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Full name or any unambiguous prefix of at least three letters. */
function monthFromName(raw: string): number | null {
  const v = raw.trim().toLowerCase();
  if (v.length < 3) return null;
  const hits = MONTHS.map((m, i) => (m.startsWith(v) ? i + 1 : 0)).filter((n) => n > 0);
  return hits.length === 1 ? hits[0] : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The message for an ambiguous numeric date, which is REFUSED and never guessed.
 *
 * Refused UNIFORMLY, including the cases that happen to be unambiguous like
 * `25/12/2023`, because accepting those teaches a habit that breaks silently the
 * first time the day is under 13. The farm is in Pakistan, where DD/MM is the
 * convention; the tooling is US-influenced, where MM/DD is. A wrong guess
 * produces a date that passes every check in this system.
 */
export const AMBIGUOUS_MESSAGE =
  'Ambiguous — 06/07/2023 could be June or July, and guessing wrong produces a date ' +
  'nothing can detect as wrong. Type the month as a word (6 Jul 2023) or use 2023-07-06.';

const UNPARSED_MESSAGE =
  'Not a date this understands. Try 2019, Mar 2019, 6 Jul 2023, or 2023-07-06.';

/** How the reading is described back, per precision. */
export function readingFor(p: DatePrecision, on: string): string {
  switch (p) {
    case 'day':
      return `reading as an exact day — ${on}`;
    case 'month':
      return `reading as month only — ${on.slice(0, 7)}, stored as the 1st`;
    case 'year':
      return `reading as year only — ${on.slice(0, 4)}, stored as January 1`;
    case 'estimated':
      return `reading as an estimated year — ${on.slice(0, 4)}, stored as January 1`;
  }
}

interface Parts {
  year: number;
  month: number | null;
  day: number | null;
}

/** The grammar, in order. Order matters: ISO is matched before the slash form. */
function match(text: string): Parts | 'ambiguous' | null {
  const t = text.trim().replace(/\s+/g, ' ');

  // 2019
  let m = /^(\d{4})$/.exec(t);
  if (m) return { year: +m[1], month: null, day: null };

  // 2019-03
  m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m) return { year: +m[1], month: +m[2], day: null };

  // 2023-07-06 (ISO). Before the slash rule, so a leading 4-digit year is never
  // treated as ambiguous -- ISO is the unambiguous escape the message offers.
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };

  // Mar 2019 / March 2019
  m = /^([A-Za-z]{3,})\.? (\d{4})$/.exec(t);
  if (m) {
    const mo = monthFromName(m[1]);
    return mo === null ? null : { year: +m[2], month: mo, day: null };
  }

  // 2019 Mar
  m = /^(\d{4}) ([A-Za-z]{3,})\.?$/.exec(t);
  if (m) {
    const mo = monthFromName(m[2]);
    return mo === null ? null : { year: +m[1], month: mo, day: null };
  }

  // 6 Jul 2023
  m = /^(\d{1,2}) ([A-Za-z]{3,})\.?,? (\d{4})$/.exec(t);
  if (m) {
    const mo = monthFromName(m[2]);
    return mo === null ? null : { year: +m[3], month: mo, day: +m[1] };
  }

  // Jul 6 2023 / Jul 6, 2023
  m = /^([A-Za-z]{3,})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m) {
    const mo = monthFromName(m[1]);
    return mo === null ? null : { year: +m[3], month: mo, day: +m[2] };
  }

  // Any all-numeric separated form. Refused, not guessed.
  if (/^\d{1,4}[/.\- ]\d{1,2}[/.\- ]\d{1,4}$/.test(t)) return 'ambiguous';

  return null;
}

/**
 * Parse `text` into a stored date and its precision.
 *
 * `estimated` is a MODIFIER on a bare year, never a parse result: it is the one
 * thing the text cannot say, because "I am guessing" is a claim about the
 * operator's knowledge rather than about the characters. It is legal only where
 * the parse yielded a year, which keeps the January-1 storage convention intact
 * and needs no migration -- see docs/REGISTRY.md on why `estimated` and `year`
 * store identically and must not be merged.
 */
export function parseDateEntry(
  text: string,
  opts: { estimated?: boolean; time?: string | null } = {},
): DateEntry {
  if (text.trim().length === 0) return { status: 'empty' };

  const parts = match(text);
  if (parts === 'ambiguous') return { status: 'incomplete', message: AMBIGUOUS_MESSAGE };
  if (parts === null) return { status: 'incomplete', message: UNPARSED_MESSAGE };

  const { year, month, day } = parts;
  if (year < 1900 || year > 2200) {
    return { status: 'incomplete', message: `${year} is not a plausible year.` };
  }
  if (month !== null && (month < 1 || month > 12)) {
    return { status: 'incomplete', message: `There is no month ${month}.` };
  }
  if (month !== null && day !== null) {
    const max = daysInMonth(year, month);
    if (day < 1 || day > max) {
      return {
        status: 'incomplete',
        message: `${MONTHS[month - 1].replace(/^./, (c) => c.toUpperCase())} ${year} has ${max} days.`,
      };
    }
  }

  const precision: DatePrecision =
    day !== null ? 'day' : month !== null ? 'month' : opts.estimated === true ? 'estimated' : 'year';

  // The storage convention, applied here so the form never sends a date the
  // server would have to normalize or refuse: month -> the 1st, year and
  // estimated -> January 1.
  const occurred_on =
    precision === 'day'
      ? `${year}-${pad(month!)}-${pad(day!)}`
      : precision === 'month'
        ? `${year}-${pad(month!)}-01`
        : `${year}-01-01`;

  const time = opts.time ?? '';
  return {
    status: 'complete',
    value: {
      occurred_on,
      date_precision: precision,
      // A time cannot exist above day precision -- there is no such thing as
      // knowing the hour but not the day -- so it cannot leak out even if a
      // stale value were held.
      occurred_time: precision === 'day' && time.length > 0 ? time : null,
    },
    reading: readingFor(precision, occurred_on),
  };
}

/**
 * Whether the estimated modifier can apply to what was typed.
 *
 * False for a month or a day, because `estimated` stores January 1 and a
 * specific day at estimated precision is a fabricated day wearing a humility
 * label -- the write boundary rejects it by name. The checkbox is disabled with
 * that reason rather than hidden, so the answer is visible before it is needed.
 */
export function canEstimate(text: string): boolean {
  const parts = match(text);
  if (parts === null || parts === 'ambiguous') return false;
  return parts.month === null && parts.day === null;
}
