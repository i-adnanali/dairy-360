// Correct a calving's date. The paired (or triple) correction.
//
// Reached from an animal's record, not from a menu: the flow is pick animal ->
// see calvings -> pick one -> correct, because an event id is not something a
// human should type.

import {
  ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild,
} from '@angular/core';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog } from './after-write';
import { PrecisionDateControl, dateBlocker } from './precision-date';
import type { DateEntry } from './precision-date';
import type { TimelineEvent } from './types';
import { Card } from '../ui/surface';
import { ErrorPanel } from '../ui/surface';
import { ErrorText } from '../ui/surface';
import { FieldLabel } from '../ui/text';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { SectionLabel } from '../ui/text';
import { Button } from '../ui/button';

const FIELDS = ['calving_event_id', 'occurred_on', 'date_precision'] as const;

@Component({
  selector: 'app-correction-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    Card,
    ErrorPanel,
    ErrorText,
    FieldLabel,
    HelpText,
    PrecisionDateControl,
    SectionLabel,
    SessionRequired,
    TextInput,
  ],
  template: `
    <form class="space-y-4" (submit)="onSubmit($event)">
      <div appCard>
        <div appSectionLabel legend>
          Which calving is the date wrong on?
        </div>
        @if (correctable().length === 0) {
          <p appHelp data-role="no-calvings">
            No effective calvings on this animal to correct.
          </p>
        } @else {
          <div class="space-y-1" data-role="calvings">
            @for (c of correctable(); track c.id) {
              <button type="button" [attr.data-calving]="c.id" (click)="target.set(c.id)"
                class="flex w-full items-baseline gap-3 rounded-lg border px-3 py-2 text-left text-sm"
                [class]="target() === c.id ? 'border-farm-600 bg-farm-100' : 'border-farm-300 bg-white hover:border-farm-400'"
              >
                <span class="font-medium">{{ c.occurred_on }}</span>
                <span appHelp size="xs">({{ c.date_precision }})</span>
                <span class="ml-auto font-mono text-xs text-farm-500">{{ c.id }}</span>
              </button>
            }
          </div>
        }
        @if (state.fieldError('calving_event_id'); as e) {
          <p appErrorText class="mt-2" data-role="error-target">{{ e }}</p>
        }
      </div>

      @if (target()) {
        <app-precision-date
          label="What is the date actually?"
          [error]="state.fieldError('occurred_on') ?? state.fieldError('date_precision')"
          (changed)="when.set($event)"
        />

        <div class="rounded-lg bg-farm-100 px-3 py-2 text-xs text-farm-700">
          Both halves are written together: a superseding calving on the dam and a superseding
          birth on the calf. If the calf did not live, its departure moves too — the three are
          the same physical fact. The old events stay in the log, marked superseded.
        </div>

        <label class="block">
          <span appFieldLabel>Why the change? (optional note)</span>
          <input data-role="notes" [value]="notes()" (input)="notes.set($any($event.target).value)"
            placeholder="e.g. remembered again on a second telling" appInput class="w-full max-w-md" />
        </label>

        @if (state.formError(fields); as e) {
          <div appErrorPanel data-role="error-form">
            {{ e }}
          </div>
        }

        <!-- Keyed on the code, not nested in the form-level error: this refusal
             names occurred_on, so its message goes to the date control, and a
             button nested in that block would be unreachable. -->
        @if (state.hasCode('near_duplicate_calving')) {
          <div class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-role="override">
            <p>The corrected date lands near another calving on this dam — check it first.</p>
            <label class="mt-2 block">
              <span class="mb-1 block text-xs font-medium">
                Why, if you want it on the record <span class="font-normal">(optional)</span>
              </span>
              <input data-role="override_reason" [value]="overrideReason()"
                (input)="overrideReason.set($any($event.target).value)"
                class="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm" />
            </label>
            <button type="button" data-role="allow-duplicate" (click)="allowDuplicate.set(true); submit()"
              class="mt-2 font-medium underline">Correct it anyway</button>
          </div>
        }

        @if (session.ready()) {
          <button type="submit" data-role="submit" [appButtonDisabled]="!canSubmit()" appButton
          >{{ state.submitting() ? 'Correcting…' : 'Apply correction' }}</button>
        } @else {
          <app-session-required what="a correction" />
        }
      }

      @if (state.result(); as r) {
        <div class="rounded-xl border border-green-300 bg-green-50 p-4 text-sm" data-role="result">
          <p class="font-medium text-green-900">Correction applied</p>
          <ul class="mt-1 space-y-0.5 text-green-800">
            <li>superseded calving <span class="font-mono text-xs">{{ r.superseded.calving_event_id }}</span></li>
            <li>superseded birth <span class="font-mono text-xs">{{ r.superseded.birth_event_id }}</span></li>
            @if (r.superseded.departure_event_id) {
              <li>superseded departure <span class="font-mono text-xs">{{ r.superseded.departure_event_id }}</span></li>
            }
          </ul>
          <p class="mt-2 text-green-800">
            The event list below shows both the old and the new — check it reads the way you meant.
          </p>
        </div>
      }
    </form>
  `,
})
export class CorrectionForm {
  /**
   * The NATIVE submit event, not FormsModule's `ngSubmit`.
   *
   * `(ngSubmit)` is an output on the `NgForm` directive, so without importing
   * FormsModule it binds to nothing at all -- the form falls through to a real
   * browser submission and the page reloads. Caught by the specs, which saw
   * zero requests. The native event needs `preventDefault()` for the same
   * reason, and avoids pulling in a forms library this app does not otherwise
   * use.
   */
  protected onSubmit(e: Event): void {
    e.preventDefault();
    this.submit();
  }

  readonly events = input.required<TimelineEvent[]>();
  readonly done = input<(() => void) | null>(null);

  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  private readonly writeLog = inject(WriteLog);
  private readonly dateControl = viewChild(PrecisionDateControl);

  protected readonly fields = FIELDS;
  protected readonly state = new FormState<{
    superseded: { calving_event_id: string; birth_event_id: string; departure_event_id: string | null };
  }>();

  protected readonly target = signal('');
  protected readonly when = signal<DateEntry>({ status: 'empty' });
  protected readonly notes = signal('');
  protected readonly allowDuplicate = signal(false);
  protected readonly overrideReason = signal('');

  /** Only EFFECTIVE calvings. A superseded one must be corrected at the chain's end. */
  protected readonly correctable = computed(() =>
    this.events().filter((e) => e.type === 'calving' && e.effective),
  );

  protected readonly canSubmit = computed(
    () =>
      this.target().length > 0 &&
      dateBlocker(this.when(), { label: 'corrected date', required: true }) === null &&
      !this.state.submitting(),
  );

  protected async submit(): Promise<void> {
    const entry = this.when();
    if (entry.status !== 'complete') return;
    const w = entry.value;
    if (!w) return;
    const r = await this.state.run((key) =>
      this.api.correctCalving(this.target(), {
        occurred_on: w.occurred_on,
        occurred_time: w.occurred_time,
        date_precision: w.date_precision,
        notes: blank(this.notes()),
        allow_near_duplicate: this.allowDuplicate(),
        override_reason: blank(this.overrideReason()),
        ...this.session.provenance(),
      }, key),
    );
    this.allowDuplicate.set(false);
    if (r) {
      this.target.set('');
      this.dateControl()?.reset();
      this.when.set({ status: 'empty' });
      this.overrideReason.set('');
      this.writeLog.announce('Correction written. The superseded events remain in the log.');
      this.done()?.();
    }
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
