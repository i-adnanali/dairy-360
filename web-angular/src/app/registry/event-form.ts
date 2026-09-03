// Append a life event: dry_off, departure, or note.

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { IdentifierInput } from './identifier-input';
import { Identifiers } from './identifiers';
import { PrecisionDateControl } from './precision-date';
import type { PrecisionDate } from './precision-date';
import type { AnimalDetail, EnterableEventType } from './types';

const FIELDS = ['animal_id', 'type', 'occurred_on', 'date_precision', 'occurred_time', 'reason', 'text'] as const;

@Component({
  selector: 'app-event-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IdentifierInput, PrecisionDateControl],
  template: `
    <div class="space-y-4">
      <div class="rounded-xl border border-farm-300 bg-white p-4">
        <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">What happened?</div>
        <div class="flex flex-wrap gap-2">
          @for (t of types; track t.value) {
            <button type="button" [attr.data-type]="t.value" (click)="type.set(t.value)"
              class="rounded-lg border px-3 py-1.5 text-sm"
              [class]="type() === t.value ? 'border-farm-600 bg-farm-600 text-white' : 'border-farm-300 bg-white text-farm-800'"
            >{{ t.label }}</button>
          }
        </div>
        <p class="mt-1.5 text-xs text-farm-600">
          A calving is not entered here — it creates an animal. Use the calving form.
        </p>
      </div>

      @if (type(); as t) {
        <app-precision-date
          [label]="'When?'"
          [error]="state.fieldError('occurred_on') ?? state.fieldError('date_precision') ?? state.fieldError('occurred_time')"
          (changed)="when.set($event)"
        />

        @if (t === 'dry_off') {
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-farm-700">Reason (optional)</span>
            <select data-role="reason" [value]="reason()" (change)="reason.set($any($event.target).value)"
              class="rounded-lg border border-farm-300 px-2 py-1.5 text-sm">
              <option value="">—</option>
              @for (r of dryOffReasons; track r) { <option [value]="r">{{ r }}</option> }
            </select>
          </label>
        }

        @if (t === 'departure') {
          <div class="rounded-xl border border-farm-300 bg-white p-4 space-y-3">
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">Reason (required)</span>
              <select data-role="reason" [value]="reason()" (change)="reason.set($any($event.target).value)"
                class="rounded-lg border border-farm-300 px-2 py-1.5 text-sm">
                <option value="">Choose…</option>
                @for (r of departureReasons; track r) { <option [value]="r">{{ r }}</option> }
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">To / cause (optional)</span>
              <input data-role="to" [value]="to()" (input)="to.set($any($event.target).value)"
                placeholder="who bought her, or what she died of"
                class="w-full max-w-md rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
            </label>
            <p class="text-xs text-farm-600">
              Departure is terminal. Nothing but a note can be recorded after it.
            </p>
          </div>
          @if (state.fieldError('reason'); as e) {
            <p class="text-sm text-red-800" data-role="error-reason">{{ e }}</p>
          }
        }

        @if (t === 'note') {
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-farm-700">Note (required)</span>
            <textarea data-role="text" rows="3" [value]="text()" (input)="text.set($any($event.target).value)"
              class="w-full rounded-lg border border-farm-300 px-2 py-1.5 text-sm"></textarea>
          </label>
          @if (state.fieldError('text'); as e) {
            <p class="text-sm text-red-800" data-role="error-text">{{ e }}</p>
          }
        }

        <app-identifier-input
          field="observed_by" label="Observed by"
          [value]="observedBy()" [suggestions]="identifiers.values().observed_by"
          (changed)="observedBy.set($event)"
        />

        @if (state.formError(fields); as e) {
          <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="error-form">{{ e }}</p>
        }

        <!-- The override sits OUTSIDE the form-level error block, keyed on the
             code: this refusal names occurred_on, so its message is bound to
             the date control and never reaches that block. Keeping the button
             there left it unreachable. -->
        @if (state.hasCode('animal_departed')) {
          <div class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-role="override">
            <p>
              If the event genuinely follows the departure, record it anyway — verification will
              flag it, which is the honest outcome.
            </p>
            <!-- Optional, and stays optional. Requiring prose to clear a guard
                 makes the guard a wall, and the operator types "yes" -- which
                 looks like a reason and is worse than a blank. -->
            <label class="mt-2 block">
              <span class="mb-1 block text-xs font-medium">
                Why, if you want it on the record <span class="font-normal">(optional)</span>
              </span>
              <input data-role="override_reason" [value]="overrideReason()"
                (input)="overrideReason.set($any($event.target).value)"
                placeholder="sold in May but stayed on the farm until August"
                class="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm" />
            </label>
            <button type="button" data-role="allow-after-departure"
              (click)="allowAfterDeparture.set(true); submit()"
              class="mt-2 font-medium underline">Record it anyway</button>
          </div>
        }

        <div class="flex items-center gap-3">
          <button type="button" data-role="submit" (click)="submit()" [disabled]="!canSubmit()"
            class="rounded-xl bg-farm-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-farm-300"
          >{{ state.submitting() ? 'Saving…' : 'Record ' + t }}</button>
          @if (!when()) {
            <span class="text-sm text-farm-600" data-role="blocked">Say how well you know the date, then enter it.</span>
          }
        </div>
      }
    </div>
  `,
})
export class EventForm {
  readonly animalId = input.required<string>();
  readonly saved = input<((d: AnimalDetail) => void) | null>(null);

  private readonly api = inject(RegistryApi);
  private readonly session = inject(Session);
  protected readonly identifiers = inject(Identifiers);

  protected readonly fields = FIELDS;
  protected readonly types: { value: EnterableEventType; label: string }[] = [
    { value: 'dry_off', label: 'Dried off' },
    { value: 'departure', label: 'Left the farm' },
    { value: 'note', label: 'Note' },
  ];
  protected readonly dryOffReasons = ['scheduled', 'low_yield', 'health', 'other'];
  protected readonly departureReasons = ['sold', 'died', 'culled', 'lost'];
  protected readonly state = new FormState<{ event_id: string; animal: AnimalDetail }>();

  protected readonly type = signal<EnterableEventType | null>(null);
  protected readonly when = signal<PrecisionDate | null>(null);
  protected readonly reason = signal('');
  protected readonly to = signal('');
  protected readonly text = signal('');
  protected readonly observedBy = signal('');
  protected readonly allowAfterDeparture = signal(false);
  protected readonly overrideReason = signal('');

  protected readonly canSubmit = computed(
    () => this.type() !== null && this.when() !== null && !this.state.submitting(),
  );

  constructor() {
    void this.identifiers.refresh();
  }

  protected async submit(): Promise<void> {
    const w = this.when();
    const t = this.type();
    if (!w || !t) return;
    const r = await this.state.run((key) =>
      this.api.addEvent({
        animal_id: this.animalId(),
        type: t,
        occurred_on: w.occurred_on,
        occurred_time: w.occurred_time,
        date_precision: w.date_precision,
        reason: blank(this.reason()),
        to: blank(this.to()),
        text: blank(this.text()),
        observed_by: blank(this.observedBy()),
        allow_after_departure: this.allowAfterDeparture(),
        override_reason: blank(this.overrideReason()),
        ...this.session.provenance(),
      }, key),
    );
    this.allowAfterDeparture.set(false);
    if (r) {
      this.saved()?.(r.animal);
      this.type.set(null);
      this.when.set(null);
      this.reason.set('');
      this.to.set('');
      this.text.set('');
      this.overrideReason.set('');
      void this.identifiers.refresh();
    }
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
