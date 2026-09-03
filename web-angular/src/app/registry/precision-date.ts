// One date field. Type what you know; the precision follows from it.
//
// ---------------------------------------------------------------------------
// WHAT THIS REPLACED, AND WHAT SURVIVED THE REPLACEMENT
// ---------------------------------------------------------------------------
// A four-way segmented control asked "how well do you know this date?" first,
// and then rendered only the inputs that answer permitted -- no day field once
// you had said you did not know the day. That was epistemically right, and it is
// the property that had to survive: there must be no way to type a full date and
// then downgrade the precision, because that is how a month-precision row ends
// up dated the 14th.
//
// It survives INVERTED. Precision is no longer asked, it is READ: `2019` can
// only mean a year, `mar 2019` can only mean a month, `6 Jul 2023` can only mean
// a day. The day is unreachable at month precision for the simplest possible
// reason -- you did not type one. And the cost is one field and no clicks, on a
// job that is otherwise pure typing.
//
// THE INFERENCE IS SHOWN BACK, ALWAYS, because an inference the operator cannot
// see is a default by another name. And it cannot be overridden upward: there is
// no control that says "treat this as an exact day". To get day precision you
// type a day. That is the whole guarantee, and retyping is its only escape.
//
// ---------------------------------------------------------------------------
// THREE STATES OUT, NOT TWO
// ---------------------------------------------------------------------------
// This used to emit `PrecisionDate | null`, where null meant both "nothing
// typed" and "not enough typed". A form could not tell those apart, so on an
// OPTIONAL date the second one vanished: the operator typed a birth year, the
// form sent `birth_on: null`, and the record became indistinguishable from one
// where nothing was typed at all. A fabricated date is at least visible to
// whoever reads the row later; a vanished one is visible to nobody, ever.
//
// So the output is a `DateEntry`: empty | incomplete | complete. A parent blocks
// submit on `incomplete` whether the date is required or not -- via
// dateBlocker() below, which is shared so three forms cannot disagree about the
// one case they would each get wrong alone.

import {
  ChangeDetectionStrategy, Component, computed, effect, input, output, signal,
} from '@angular/core';
import { canEstimate, parseDateEntry } from './date-parse';
import type { DateEntry, PrecisionDate } from './date-parse';

export type { DateEntry, PrecisionDate } from './date-parse';

/**
 * The submit blocker for one date field, or null when it is not blocking.
 *
 * Shared rather than reimplemented per form, because the OPTIONAL case is
 * exactly where a form gets it wrong by treating `incomplete` as "nothing
 * entered" -- which is the bug the three-state contract exists to close.
 *
 * `required` only decides whether EMPTY blocks. `incomplete` blocks either way.
 */
export function dateBlocker(
  entry: DateEntry,
  opts: { label: string; required: boolean },
): string | null {
  if (entry.status === 'incomplete') {
    return `The ${opts.label} is not understood yet — finish it or clear it.`;
  }
  if (entry.status === 'empty' && opts.required) {
    return `Enter the ${opts.label}.`;
  }
  return null;
}

@Component({
  selector: 'app-precision-date',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="rounded-xl border border-farm-300 bg-white p-4">
      <legend class="px-2 text-sm font-medium text-farm-800">{{ label() }}</legend>

      <div class="flex flex-wrap items-end gap-3">
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-farm-700">Date</span>
          <input
            data-role="date-text"
            [value]="text()"
            (input)="text.set($any($event.target).value)"
            placeholder="2019, Mar 2019, or 6 Jul 2023"
            class="w-56 rounded-lg border border-farm-300 px-2 py-1.5 text-sm"
          />
        </label>

        <!-- Only at day precision, and only because a day was typed. There is
             no such thing as knowing the hour but not the day. -->
        @if (precision() === 'day') {
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

      <!-- Disabled rather than hidden where it cannot apply, so the reason is
           readable before it is needed. 'estimated' stores January 1, so it can
           only qualify a bare year -- a specific day at estimated precision is a
           fabricated day wearing a humility label, and the write boundary
           rejects it by name. -->
      <label class="mt-3 flex items-start gap-2 text-sm"
        [class]="canEstimate() ? 'cursor-pointer text-farm-800' : 'text-farm-400'">
        <input type="checkbox" data-role="estimated" class="mt-0.5"
          [checked]="estimated()" [disabled]="!canEstimate()"
          (change)="estimated.set($any($event.target).checked)" />
        <span>
          Even the year is a guess
          @if (!canEstimate()) {
            <span class="italic" data-role="estimated-why">
              — only applies to a bare year, since an estimate is stored as January 1
            </span>
          }
        </span>
      </label>

      @switch (entry().status) {
        @case ('complete') {
          <p class="mt-3 text-sm" data-role="reading">
            <span class="text-farm-600">Reading this as</span>
            <span class="ml-1 font-medium text-farm-900">{{ readingText() }}</span>
          </p>
          <p class="mt-1 text-xs text-farm-500" data-role="reading-escape">
            Not what you meant? Type it more precisely — <span class="font-mono">Mar 2019</span> for
            a month, <span class="font-mono">6 Jul 2023</span> for a day. Nothing here can claim a
            day you did not type.
          </p>
        }
        @case ('incomplete') {
          <p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-role="incomplete">{{ incompleteMessage() }}</p>
        }
        @default {
          <p class="mt-3 text-xs text-farm-600" data-role="hint">
            {{ explain()
              ? 'The precision is read from what you type and shown back — there is no default, because a default is how “exact day” gets applied to a guess.'
              : 'The precision is read from what you type and shown back.' }}
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
  /**
   * Whether to carry the full no-default RATIONALE, not just the instruction.
   *
   * One sentence, identical on every control, so a page with two date fields
   * printed it verbatim twice -- and a reader who has met it once reads past it
   * the second time, which is how the sentences that matter stop being read.
   * Defaults true so a single-control form keeps it without asking.
   */
  readonly explain = input(true);

  /** empty | incomplete | complete. See the header for why three and not two. */
  readonly changed = output<DateEntry>();

  protected readonly text = signal('');
  protected readonly time = signal('');
  protected readonly estimated = signal(false);

  protected readonly canEstimate = computed(() => canEstimate(this.text()));

  readonly entry = computed<DateEntry>(() =>
    parseDateEntry(this.text(), {
      // Held but not applied where it cannot apply: the parser ignores it above
      // a year, so a stale tick cannot alter a month or a day.
      estimated: this.estimated(),
      time: this.time(),
    }),
  );

  protected readonly precision = computed(() => {
    const e = this.entry();
    return e.status === 'complete' ? e.value.date_precision : null;
  });

  protected readonly readingText = computed(() => {
    const e = this.entry();
    return e.status === 'complete' ? e.reading : '';
  });

  protected readonly incompleteMessage = computed(() => {
    const e = this.entry();
    return e.status === 'incomplete' ? e.message : '';
  });

  constructor() {
    // One effect over the computed value, rather than an emit() in every input
    // handler -- which is how one handler ends up forgetting to call it and the
    // parent silently keeps a stale date.
    effect(() => {
      this.changed.emit(this.entry());
    });
  }

  /**
   * Clear the field, for a parent starting the next record.
   *
   * The control owns its text, so a parent clearing only its own copy of the
   * emitted value would leave the date on screen -- the same trap CalfPicker's
   * reset() exists for.
   */
  reset(): void {
    this.text.set('');
    this.time.set('');
    this.estimated.set(false);
  }

  /** The completed value, or null. For a parent that only wants the happy path. */
  readonly value = computed<PrecisionDate | null>(() => {
    const e = this.entry();
    return e.status === 'complete' ? e.value : null;
  });
}
