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
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { canEstimate, parseDateEntry } from "../date-parse";
import type { DateEntry, PrecisionDate } from "../date-parse";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { FieldLabel } from "../../ui/text";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";

let nextDateId = 0;

export type { DateEntry, PrecisionDate } from "../date-parse";

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
  imports: [Card, ErrorPanel, FieldLabel, HelpText, TextInput],
  templateUrl: './precision-date.html',
  styleUrl: './precision-date.css',
})
export class PrecisionDateControl {
  protected readonly errorId = 'precision-error-' + ++nextDateId;
  protected readonly incompleteId = this.errorId + '-incomplete';
  readonly label = input('Date');
  readonly initialValue = input<PrecisionDate | null>(null);
  readonly resetKey = input<string | number>(0);
  readonly allowTime = input(true);
  private readonly initializationError = signal('');
  readonly raw = computed(() => ({
    text: this.text(),
    time: this.time(),
    estimated: this.estimated(),
  }));
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
    this.initializationError()
      ? { status: 'incomplete', message: this.initializationError() }
      : parseDateEntry(this.text(), {
          // Held but not applied where it cannot apply: the parser ignores it above
          // a year, so a stale tick cannot alter a month or a day.
          estimated: this.estimated(),
          time: this.allowTime() ? this.time() : '',
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
    effect(() => {
      this.resetKey();
      untracked(() => this.initialize(this.initialValue()));
    });
    effect(() => {
      if (this.precision() !== 'day' || !this.allowTime()) this.time.set('');
    });
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
  setText(text: string) {
    this.initializationError.set('');
    this.text.set(text);
  }
  private initialize(value: PrecisionDate | null) {
    this.reset();
    if (!value) return;
    const [year, month, day] = value.occurred_on.split('-');
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const text =
      value.date_precision === 'day'
        ? `${Number(day)} ${months[Number(month) - 1]} ${year}`
        : value.date_precision === 'month'
          ? `${months[Number(month) - 1]} ${year}`
          : year;
    const parsed = parseDateEntry(text, {
      estimated: value.date_precision === 'estimated',
      time: value.occurred_time ?? '',
    });
    this.text.set(text);
    this.estimated.set(value.date_precision === 'estimated');
    this.time.set(value.occurred_time ?? '');
    if (
      parsed.status !== 'complete' ||
      parsed.value.occurred_on !== value.occurred_on ||
      parsed.value.date_precision !== value.date_precision ||
      parsed.value.occurred_time !== (value.occurred_time ?? null) ||
      (!this.allowTime() && !!value.occurred_time)
    ) {
      this.initializationError.set(
        'The saved date cannot be represented without changing its precision or time. Resolve the date before saving.',
      );
    }
  }
  reset(): void {
    this.initializationError.set('');
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
