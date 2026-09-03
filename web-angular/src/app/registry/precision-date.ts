// Precision-before-date control.
//
// ---------------------------------------------------------------------------
// THE POINT: choosing precision CHANGES WHICH INPUTS EXIST
// ---------------------------------------------------------------------------
// Not "pick a date, then qualify it". The order is deliberate and structural:
//
//   nothing chosen -> no date input at all
//   day            -> a full date, plus an optional time
//   month          -> year + month only. There is no day field to fill in.
//   year           -> year only.
//   estimated      -> year only, labelled as inferred.
//
// "Type a full date, then downgrade the precision" is how a month-precision row
// ends up dated the 14th, and it is unreachable here because the day input does
// not exist once you have said you do not know the day. The server rejects such
// a row three ways over (CHECK, write boundary, invariant 11); this makes it
// impossible to compose in the first place.
//
// Emitting nothing until a precision is chosen mirrors NOT NULL with no
// default: there is no state of this control that produces a date without a
// precision.
//
// The value it emits is already in the storage convention -- month gives the
// 1st, year and estimated give January 1 -- so the form never sends a date the
// server would have to normalize or refuse.
//
// ---------------------------------------------------------------------------
// AND THE PARTS THEMSELVES START EMPTY. Do not "helpfully" prefill them.
// ---------------------------------------------------------------------------
// These three fields used to initialise to the current year, January and the
// 1st. That made this control -- the one built to stop a guess reading as a
// known date -- the single easiest way to write one. Proven by execution, three
// separate ways:
//
//   choose 'day', touch nothing   -> emitted 2026-01-01 at day precision
//   choose 'day', type only 2019  -> emitted 2019-01-01 at day precision
//   choose 'year', then clear it  -> emitted 0000-01-01
//
// Every one of those satisfies the schema CHECKs, assertDatePrecision() and
// invariant 11, because none of them is INCONSISTENT -- they are merely false,
// and no invariant can detect a date that is more precise than the memory
// behind it. The preview line was the only thing standing between the first one
// and the log.
//
// A backfill year has no strong prior whatsoever, which puts these fields on
// the "lie" side of the defaults rule (docs/REGISTRY.md, "The defaults rule"):
// a wrong sex is a mistake, a wrong-but-confident date is a lie. So the control
// emits null until every part the chosen precision NEEDS has actually been
// typed, and says which part is missing in the meantime.

import {
  ChangeDetectionStrategy, Component, computed, effect, input, output, signal,
} from '@angular/core';
import type { DatePrecision } from './types';

export interface PrecisionDate {
  occurred_on: string;
  date_precision: DatePrecision;
  occurred_time: string | null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

@Component({
  selector: 'app-precision-date',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="rounded-xl border border-farm-300 bg-white p-4">
      <legend class="px-2 text-sm font-medium text-farm-800">{{ label() }}</legend>

      <!-- Step one, always. No date input exists until this is answered. -->
      <div>
        <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">
          How well do you know this date?
        </div>
        <div class="flex flex-wrap gap-2" role="radiogroup" [attr.aria-label]="label()">
          @for (p of choices; track p.value) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="precision() === p.value"
              [attr.data-precision]="p.value"
              (click)="choose(p.value)"
              class="rounded-lg border px-3 py-1.5 text-sm transition"
              [class]="
                precision() === p.value
                  ? 'border-farm-600 bg-farm-600 text-white'
                  : 'border-farm-300 bg-white text-farm-800 hover:border-farm-400'
              "
            >
              {{ p.label }}
            </button>
          }
        </div>
        <p class="mt-1.5 text-xs text-farm-600">{{ hint() }}</p>
      </div>

      @if (precision(); as p) {
        <div class="mt-4 flex flex-wrap items-end gap-3">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-farm-700">Year</span>
            <input
              type="number" data-role="year" min="1900" max="2200" placeholder="—"
              [value]="year() ?? ''" (input)="year.set(numOrNull($any($event.target).value))"
              class="w-24 rounded-lg border border-farm-300 px-2 py-1.5 text-sm"
            />
          </label>

          @if (p === 'day' || p === 'month') {
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">Month</span>
              <select
                data-role="month" [value]="month() ?? ''"
                (change)="month.set(numOrNull($any($event.target).value))"
                class="rounded-lg border border-farm-300 px-2 py-1.5 text-sm"
              >
                <!-- The empty option is the initial state, not a prompt to
                     dismiss: an unchosen month must not read as January. -->
                <option value="">—</option>
                @for (m of months; track m.n) {
                  <option [value]="m.n">{{ m.name }}</option>
                }
              </select>
            </label>
          }

          <!-- The day field EXISTS ONLY at day precision. This absence is the
               whole mechanism: there is no way to type a day and then say you
               did not know it. -->
          @if (p === 'day') {
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">Day</span>
              <input
                type="number" data-role="day" min="1" [max]="daysInMonth()" placeholder="—"
                [value]="day() ?? ''" (input)="day.set(numOrNull($any($event.target).value))"
                class="w-20 rounded-lg border border-farm-300 px-2 py-1.5 text-sm"
              />
            </label>

            <!-- Likewise the time: there is no such thing as knowing the hour
                 but not the day, so this input cannot exist above day precision. -->
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">
                Time <span class="font-normal text-farm-500">(optional)</span>
              </span>
              <input
                type="time" data-role="time"
                [value]="time()" (input)="time.set($any($event.target).value)"
                class="rounded-lg border border-farm-300 px-2 py-1.5 text-sm"
              />
            </label>
          }
        </div>

        <!-- One or the other, never both: either the date is complete and this
             says exactly what will be stored, or it is not and this says what
             is still needed. A preview of a partly-typed date would be the
             prefill bug wearing a different hat. -->
        @if (missing().length === 0) {
          <p class="mt-3 text-sm" data-role="preview">
            <span class="text-farm-600">Will be recorded as</span>
            <span class="ml-1 font-mono font-medium text-farm-900">{{ stored() }}</span>
            <span class="ml-1 text-farm-700">({{ p }})</span>
          </p>
        } @else {
          <p class="mt-3 text-sm text-farm-600" data-role="incomplete">
            No date yet — still needs the {{ missingLabel() }}.
          </p>
        }
      }

      @if (error(); as e) {
        <p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="error">
          {{ e }}
        </p>
      }
    </fieldset>
  `,
})
export class PrecisionDateControl {
  readonly label = input('Date');
  /** Server refusal text for this control's field, shown verbatim. */
  readonly error = input<string | null>(null);
  readonly changed = output<PrecisionDate | null>();

  protected readonly choices: { value: DatePrecision; label: string }[] = [
    { value: 'day', label: 'Exact day' },
    { value: 'month', label: 'Month only' },
    { value: 'year', label: 'Year only' },
    { value: 'estimated', label: 'Estimated' },
  ];
  protected readonly months = MONTHS.map((name, i) => ({ n: i + 1, name }));

  protected readonly precision = signal<DatePrecision | null>(null);
  // All three EMPTY. See the header -- prefilling these is how this control
  // became the easiest way in the app to write a fabricated exact date.
  protected readonly year = signal<number | null>(null);
  protected readonly month = signal<number | null>(null);
  protected readonly day = signal<number | null>(null);
  protected readonly time = signal('');

  /**
   * An empty numeric input is NOT zero.
   *
   * The old handlers were `+$any($event.target).value`, and `+''` is 0 -- which
   * is how clearing the year produced `0000-01-01` instead of withdrawing the
   * date. A blank field means "not entered", and only null can say that.
   */
  protected numOrNull(v: string): number | null {
    const t = v.trim();
    if (t.length === 0) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  protected readonly hint = computed(() => {
    switch (this.precision()) {
      case null:
        return 'Choose one before entering a date. There is no default — a default is how “exact day” gets applied to a guess.';
      case 'day':
        return 'The date is known.';
      case 'month':
        return 'The month is known, the day is not. Stored as the 1st.';
      case 'year':
        return 'The year is known. Stored as January 1.';
      case 'estimated':
        return 'Even the year is inferred — an age judged by dentition, say. Stored as January 1, and reported separately from a known year.';
    }
  });

  /** 31 while the month is unknown, so the day input is not wrongly clamped. */
  protected readonly daysInMonth = computed(() => {
    const y = this.year();
    const m = this.month();
    if (y === null || m === null) return 31;
    return new Date(y, m, 0).getDate();
  });

  /**
   * The parts the chosen precision needs and does not yet have.
   *
   * This is the whole mechanism. Precision decides which inputs EXIST (see the
   * header); this decides whether the ones that exist have been answered. A
   * date is emitted only when the list is empty.
   */
  protected readonly missing = computed<string[]>(() => {
    const p = this.precision();
    if (p === null) return [];
    const out: string[] = [];
    if (this.year() === null) out.push('year');
    if ((p === 'day' || p === 'month') && this.month() === null) out.push('month');
    if (p === 'day' && this.day() === null) out.push('day');
    return out;
  });

  protected readonly missingLabel = computed(() => {
    const m = this.missing();
    return m.length <= 1 ? m.join('') : `${m.slice(0, -1).join(', ')} and ${m[m.length - 1]}`;
  });

  /**
   * The date in the storage convention the server expects, or '' when the parts
   * are not all in. Never partially composed: a missing part is not a zero.
   */
  protected readonly stored = computed(() => {
    if (this.missing().length > 0) return '';
    const y = String(this.year()).padStart(4, '0');
    switch (this.precision()) {
      case 'day':
        return `${y}-${pad(this.month()!)}-${pad(Math.min(this.day()!, this.daysInMonth()))}`;
      case 'month':
        return `${y}-${pad(this.month()!)}-01`;
      case 'year':
      case 'estimated':
        return `${y}-01-01`;
      default:
        return '';
    }
  });

  /**
   * The emitted value. NULL until a precision is chosen AND every part that
   * precision needs has been typed -- there is no state of this control that
   * yields a date without one, or a date with an invented part, which is what
   * mirrors NOT NULL with no default.
   *
   * Note this retracts: clearing the year on a complete date emits null again
   * rather than leaving the parent holding the last good value.
   */
  readonly value = computed<PrecisionDate | null>(() => {
    const p = this.precision();
    if (p === null || this.missing().length > 0) return null;
    return {
      occurred_on: this.stored(),
      date_precision: p,
      // A time can only exist at day precision, so it cannot leak out above it
      // even if a stale value were somehow held.
      occurred_time: p === 'day' && this.time().length > 0 ? this.time() : null,
    };
  });

  constructor() {
    // One effect over the computed value, rather than an emit() call in every
    // input handler -- which is how one handler ends up forgetting to call it
    // and the parent silently keeps a stale date.
    effect(() => {
      this.changed.emit(this.value());
    });
  }

  protected choose(p: DatePrecision): void {
    this.precision.set(p);
    // Leaving day precision clears the time: it cannot be stored above day, so
    // carrying it would send the server something it refuses.
    if (p !== 'day') this.time.set('');
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
