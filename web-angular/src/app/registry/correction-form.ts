// Correct a calving's date. The paired (or triple) correction.
//
// Reached from an animal's record, not from a menu: the flow is pick animal ->
// see calvings -> pick one -> correct, because an event id is not something a
// human should type.

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { PrecisionDateControl } from './precision-date';
import type { PrecisionDate } from './precision-date';
import type { TimelineEvent } from './types';

const FIELDS = ['calving_event_id', 'occurred_on', 'date_precision'] as const;

@Component({
  selector: 'app-correction-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PrecisionDateControl],
  template: `
    <div class="space-y-4">
      <div class="rounded-xl border border-farm-300 bg-white p-4">
        <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">
          Which calving is the date wrong on?
        </div>
        @if (correctable().length === 0) {
          <p class="text-sm text-farm-600" data-role="no-calvings">
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
                <span class="text-xs text-farm-600">({{ c.date_precision }})</span>
                <span class="ml-auto font-mono text-xs text-farm-500">{{ c.id }}</span>
              </button>
            }
          </div>
        }
        @if (state.fieldError('calving_event_id'); as e) {
          <p class="mt-2 text-sm text-red-800" data-role="error-target">{{ e }}</p>
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
          <span class="mb-1 block text-xs font-medium text-farm-700">Why the change? (optional note)</span>
          <input data-role="notes" [value]="notes()" (input)="notes.set($any($event.target).value)"
            placeholder="e.g. remembered again on a second telling"
            class="w-full max-w-md rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
        </label>

        @if (state.formError(fields); as e) {
          <div class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="error-form">
            {{ e }}
          </div>
        }

        <!-- Keyed on the code, not nested in the form-level error: this refusal
             names occurred_on, so its message goes to the date control, and a
             button nested in that block would be unreachable. -->
        @if (state.hasCode('near_duplicate_calving')) {
          <div class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-role="override">
            The corrected date lands near another calving on this dam — check it first.
            <button type="button" data-role="allow-duplicate" (click)="allowDuplicate.set(true); submit()"
              class="ml-2 font-medium underline">Correct it anyway</button>
          </div>
        }

        <button type="button" data-role="submit" (click)="submit()" [disabled]="!canSubmit()"
          class="rounded-xl bg-farm-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-farm-300"
        >{{ state.submitting() ? 'Correcting…' : 'Apply correction' }}</button>
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
    </div>
  `,
})
export class CorrectionForm {
  readonly events = input.required<TimelineEvent[]>();
  readonly done = input<(() => void) | null>(null);

  private readonly api = inject(RegistryApi);
  private readonly session = inject(Session);

  protected readonly fields = FIELDS;
  protected readonly state = new FormState<{
    superseded: { calving_event_id: string; birth_event_id: string; departure_event_id: string | null };
  }>();

  protected readonly target = signal('');
  protected readonly when = signal<PrecisionDate | null>(null);
  protected readonly notes = signal('');
  protected readonly allowDuplicate = signal(false);

  /** Only EFFECTIVE calvings. A superseded one must be corrected at the chain's end. */
  protected readonly correctable = computed(() =>
    this.events().filter((e) => e.type === 'calving' && e.effective),
  );

  protected readonly canSubmit = computed(
    () => this.target().length > 0 && this.when() !== null && !this.state.submitting(),
  );

  protected async submit(): Promise<void> {
    const w = this.when();
    if (!w) return;
    const r = await this.state.run((key) =>
      this.api.correctCalving(this.target(), {
        occurred_on: w.occurred_on,
        occurred_time: w.occurred_time,
        date_precision: w.date_precision,
        notes: blank(this.notes()),
        allow_near_duplicate: this.allowDuplicate(),
        ...this.session.provenance(),
      }, key),
    );
    this.allowDuplicate.set(false);
    if (r) {
      this.target.set('');
      this.when.set(null);
      this.done()?.();
    }
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
