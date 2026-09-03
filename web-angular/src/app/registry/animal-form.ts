// Add an acquired animal. Pass one of the backfill.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { DuplicateWarning } from './duplicate-warning';
import { IdentifierInput } from './identifier-input';
import { Identifiers } from './identifiers';
import { PrecisionDateControl, dateBlocker } from './precision-date';
import type { DateEntry } from './precision-date';
import type { AnimalDetail, RegistrySex } from './types';

const FIELDS = ['sex', 'occurred_on', 'date_precision', 'birth_on', 'birth_precision'] as const;

@Component({
  selector: 'app-animal-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DuplicateWarning, IdentifierInput, PrecisionDateControl],
  template: `
    <div class="mx-auto max-w-2xl">
      <header class="mb-4">
        <h2 class="text-lg font-semibold text-farm-900">Add an acquired animal</h2>
        <p class="mt-1 text-sm text-farm-600">
          Only animals that arrived from elsewhere. A farm-born animal is created by its dam's
          calving — record the calving instead, and it appears as a consequence.
        </p>
      </header>

      <div class="space-y-4">
        <div class="rounded-xl border border-farm-300 bg-white p-4">
          <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">Sex</div>
          <div class="flex gap-2">
            @for (s of sexes; track s) {
              <button
                type="button" [attr.data-sex]="s" (click)="sex.set(s)"
                class="rounded-lg border px-3 py-1.5 text-sm capitalize"
                [class]="sex() === s ? 'border-farm-600 bg-farm-600 text-white' : 'border-farm-300 bg-white text-farm-800'"
              >{{ s }}</button>
            }
          </div>
          @if (state.fieldError('sex'); as e) {
            <p class="mt-2 text-sm text-red-800" data-role="error-sex">{{ e }}</p>
          }

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">Name (optional)</span>
              <input data-role="name" [value]="name()" (input)="name.set($any($event.target).value)"
                class="w-full rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
            </label>
            <app-identifier-input
              field="acquired_from" label="Acquired from"
              [value]="from()" [suggestions]="identifiers.values().acquired_from"
              (changed)="from.set($event)"
            />
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">Post no. (optional)</span>
              <input data-role="post_no" [value]="postNo()" (input)="postNo.set($any($event.target).value)"
                class="w-full rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">Ear tag (optional)</span>
              <input data-role="tag_no" [value]="tagNo()" (input)="tagNo.set($any($event.target).value)"
                class="w-full rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <p class="mt-2 text-xs text-farm-500">
            Post number and ear tag are attributes, not identity — both change over an animal's life.
          </p>
        </div>

        <!-- Placed directly under the identity fields it watches, not near the
             submit button: the useful moment is while the name is still being
             typed, not after the decision to save has been made. -->
        <app-duplicate-warning
          [name]="name()" [postNo]="postNo()" [tagNo]="tagNo()" [sex]="sex()"
          [refreshToken]="writes()"
        />

        <app-precision-date
          label="When did it arrive on the farm?"
          [error]="state.fieldError('occurred_on') ?? state.fieldError('date_precision')"
          (changed)="acquired.set($event)"
        />

        <!-- explain=false: the no-default rationale is one sentence and it is
             identical on both controls, so printing it twice on one page trains
             the reader to skip it. Said once, above. -->
        <app-precision-date
          label="Birth date — optional, but not its precision"
          [explain]="false"
          [error]="state.fieldError('birth_on') ?? state.fieldError('birth_precision')"
          (changed)="birth.set($event)"
        />
        <p class="-mt-2 px-1 text-xs text-farm-600">
          Leave the birth date blank if you do not know it. Without one the animal shows as
          heifer or male even if it is visibly a calf — the age rule has no date to test. An
          estimated year is the fix: type the year and tick the guess box.
        </p>

        <app-identifier-input
          field="observed_by" label="Observed by"
          [value]="observedBy()" [suggestions]="identifiers.values().observed_by"
          (changed)="observedBy.set($event)"
        />

        @if (state.formError(fields); as e) {
          <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="error-form">{{ e }}</p>
        }

        <div class="flex items-center gap-3">
          <button
            type="button" data-role="submit" (click)="submit()" [disabled]="!canSubmit()"
            class="rounded-xl bg-farm-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-farm-300"
          >{{ state.submitting() ? 'Saving…' : 'Add animal' }}</button>
          @if (blockedReason(); as r) {
            <span class="text-sm text-farm-600" data-role="blocked">{{ r }}</span>
          }
        </div>

        @if (state.result(); as r) {
          <div class="rounded-xl border border-green-300 bg-green-50 p-4" data-role="result">
            <p class="text-sm font-medium text-green-900">
              Added {{ r.animal_id }}{{ r.animal.animal.name ? ' — ' + r.animal.animal.name : '' }}
            </p>
            <p class="mt-1 text-sm text-green-800">
              Status <span class="font-mono">{{ r.animal.status?.status }}</span>,
              birth
              <span class="font-mono">{{
                r.animal.status?.birth_on
                  ? r.animal.status?.birth_on + ' (' + r.animal.status?.birth_precision + ')'
                  : 'unknown'
              }}</span>
            </p>
            <button type="button" (click)="open(r.animal_id)"
              class="mt-2 text-sm font-medium text-green-900 underline">Open its record</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class AnimalForm {
  private readonly api = inject(RegistryApi);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  protected readonly identifiers = inject(Identifiers);

  protected readonly fields = FIELDS;
  protected readonly sexes: RegistrySex[] = ['female', 'male'];
  protected readonly state = new FormState<{ animal_id: string; animal: AnimalDetail }>();

  protected readonly sex = signal<RegistrySex>('female');
  protected readonly name = signal('');
  protected readonly from = signal('');
  protected readonly postNo = signal('');
  protected readonly tagNo = signal('');
  protected readonly observedBy = signal('');
  protected readonly acquired = signal<DateEntry>({ status: 'empty' });
  protected readonly birth = signal<DateEntry>({ status: 'empty' });
  /**
   * Bumped after each write so the duplicate query re-runs.
   *
   * The fields usually do not change between a successful submit and the next
   * record, so nothing else would re-trigger it -- and the animal just created
   * is exactly the one worth matching against if the operator submits again.
   */
  protected readonly writes = signal(0);

  /**
   * THE BIRTH DATE IS OPTIONAL AND STILL BLOCKS WHEN HALF-TYPED.
   *
   * That asymmetry is the point. `required` decides only whether an EMPTY field
   * blocks; a field with text in it that does not parse blocks either way,
   * because the alternative is sending `birth_on: null` for a birth year the
   * operator typed -- a record indistinguishable from one where nothing was
   * entered. A fabrication is visible to the next reader; a disappearance is
   * visible to nobody.
   */
  protected readonly blockedReason = computed(
    () =>
      dateBlocker(this.acquired(), { label: 'arrival date', required: true }) ??
      dateBlocker(this.birth(), { label: 'birth date', required: false }),
  );

  protected readonly canSubmit = computed(
    () => this.blockedReason() === null && !this.state.submitting(),
  );

  constructor() {
    void this.identifiers.refresh();
  }

  protected async submit(): Promise<void> {
    const a = this.acquired();
    const b = this.birth();
    // Belt and braces behind the disabled button: an incomplete optional date
    // must never reach the wire as a null.
    if (a.status !== 'complete' || b.status === 'incomplete') return;
    await this.state.run((key) =>
      this.api.addAnimal({
        sex: this.sex(),
        name: blank(this.name()),
        acquired_on: a.value.occurred_on,
        date_precision: a.value.date_precision,
        birth_on: b.status === 'complete' ? b.value.occurred_on : null,
        birth_precision: b.status === 'complete' ? b.value.date_precision : null,
        from: blank(this.from()),
        post_no: blank(this.postNo()),
        tag_no: blank(this.tagNo()),
        observed_by: blank(this.observedBy()),
        ...this.session.provenance(),
      }, key),
    );
    // Refreshed AFTER the write, so a name typed on this animal is offered on
    // the next one. That is the whole point of the datalist.
    void this.identifiers.refresh();
    this.writes.update((n) => n + 1);
  }

  protected open(id: string): void {
    void this.router.navigate(['/animals', id]);
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
