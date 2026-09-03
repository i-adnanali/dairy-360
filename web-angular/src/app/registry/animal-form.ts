// Add an acquired animal. Pass one of the backfill.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { PrecisionDateControl } from './precision-date';
import type { PrecisionDate } from './precision-date';
import type { AnimalDetail, RegistrySex } from './types';

const FIELDS = ['sex', 'occurred_on', 'date_precision', 'birth_on', 'birth_precision'] as const;

@Component({
  selector: 'app-animal-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PrecisionDateControl],
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
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">Acquired from (optional)</span>
              <input data-role="from" [value]="from()" (input)="from.set($any($event.target).value)"
                class="w-full rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
            </label>
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

        <app-precision-date
          label="When did it arrive on the farm?"
          [error]="state.fieldError('occurred_on') ?? state.fieldError('date_precision')"
          (changed)="acquired.set($event)"
        />

        <app-precision-date
          label="Birth date — optional, but not its precision"
          [error]="state.fieldError('birth_on') ?? state.fieldError('birth_precision')"
          (changed)="birth.set($event)"
        />
        <p class="-mt-2 px-1 text-xs text-farm-600">
          Leave the birth date blank if you do not know it. Without one the animal shows as
          heifer or male even if it is visibly a calf — the age rule has no date to test. An
          estimated year is the fix, and saying it is estimated makes that safe.
        </p>

        <label class="block">
          <span class="mb-1 block text-xs font-medium text-farm-700">
            Observed by <span class="font-normal text-farm-500">(optional — leave blank unless someone actually saw it)</span>
          </span>
          <input data-role="observed_by" [value]="observedBy()" (input)="observedBy.set($any($event.target).value)"
            class="w-full max-w-xs rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
        </label>

        @if (state.formError(fields); as e) {
          <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="error-form">{{ e }}</p>
        }

        <div class="flex items-center gap-3">
          <button
            type="button" data-role="submit" (click)="submit()" [disabled]="!canSubmit()"
            class="rounded-xl bg-farm-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-farm-300"
          >{{ state.submitting() ? 'Saving…' : 'Add animal' }}</button>
          @if (!acquired()) {
            <span class="text-sm text-farm-600" data-role="blocked">
              Say how well you know the arrival date, then enter it.
            </span>
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

  protected readonly fields = FIELDS;
  protected readonly sexes: RegistrySex[] = ['female', 'male'];
  protected readonly state = new FormState<{ animal_id: string; animal: AnimalDetail }>();

  protected readonly sex = signal<RegistrySex>('female');
  protected readonly name = signal('');
  protected readonly from = signal('');
  protected readonly postNo = signal('');
  protected readonly tagNo = signal('');
  protected readonly observedBy = signal('');
  protected readonly acquired = signal<PrecisionDate | null>(null);
  protected readonly birth = signal<PrecisionDate | null>(null);

  /**
   * Submitting without a precision is IMPOSSIBLE, not merely refused: the
   * button is disabled until the arrival date's precision is chosen, because
   * the control emits null until then.
   */
  protected readonly canSubmit = computed(
    () => this.acquired() !== null && !this.state.submitting(),
  );

  protected async submit(): Promise<void> {
    const a = this.acquired();
    if (!a) return;
    const b = this.birth();
    await this.state.run((key) =>
      this.api.addAnimal({
        sex: this.sex(),
        name: blank(this.name()),
        acquired_on: a.occurred_on,
        date_precision: a.date_precision,
        birth_on: b?.occurred_on ?? null,
        birth_precision: b?.date_precision ?? null,
        from: blank(this.from()),
        post_no: blank(this.postNo()),
        tag_no: blank(this.tagNo()),
        observed_by: blank(this.observedBy()),
        ...this.session.provenance(),
      }, key),
    );
  }

  protected open(id: string): void {
    void this.router.navigate(['/animals', id]);
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
