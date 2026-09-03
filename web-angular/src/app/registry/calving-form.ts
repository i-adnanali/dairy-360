// Record a calving. Pass two of the backfill.
//
// ---------------------------------------------------------------------------
// LINK vs MINT IS AN EXPLICIT QUESTION
// ---------------------------------------------------------------------------
// "Is the calf already in the registry?" is asked outright, with no default,
// because it is the flag most likely to be got wrong and the one where getting
// it wrong creates a DUPLICATE ANIMAL -- a duplicate origin event, and nothing
// able to repair either.
//
// It happens for a reason that is easy to miss while entering: pass one must
// enter a farm-born animal as `acquired` whenever its dam is still in the herd,
// because pass one has no calvings yet. So by pass two, some calves already
// exist. Inferring the answer from a blank field would make the common case
// silent.
//
// The picker cannot be populated until the date is known, because eligibility
// depends on it -- an animal whose own history predates the proposed birth
// cannot be linked. So the order is forced: precision, date, then the calf
// question. That is the server's rule, not a UI preference.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { PrecisionDateControl } from './precision-date';
import type { PrecisionDate } from './precision-date';
import type { CalvingOutcome, LinkCandidate, RegistrySex } from './types';

const FIELDS = ['dam_id', 'occurred_on', 'date_precision', 'calf', 'calf_sex', 'outcome'] as const;

type CalfMode = 'new' | 'existing';

@Component({
  selector: 'app-calving-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PrecisionDateControl],
  template: `
    <div class="mx-auto max-w-2xl space-y-4">
      <header>
        <h2 class="text-lg font-semibold text-farm-900">Record a calving</h2>
        <p class="mt-1 text-sm text-farm-600">
          Enter calvings oldest first. Each one creates its calf, so in order means a farm-born
          animal exists before anything refers to it.
        </p>
      </header>

      <!-- dam -->
      <div class="rounded-xl border border-farm-300 bg-white p-4">
        <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">Dam</div>
        @if (dams().length === 0) {
          <p class="text-sm text-farm-600" data-role="no-dams">
            No females in the registry yet. Add one first.
          </p>
        } @else {
          <select data-role="dam" [value]="damId()" (change)="damId.set($any($event.target).value)"
            class="w-full max-w-sm rounded-lg border border-farm-300 px-2 py-1.5 text-sm">
            <option value="">Choose a dam…</option>
            @for (d of dams(); track d.id) {
              <option [value]="d.id" [disabled]="!d.eligible">
                {{ d.id }}{{ d.name ? ' — ' + d.name : '' }}{{ d.eligible ? '' : ' (' + d.ineligible_reason + ')' }}
              </option>
            }
          </select>
        }
        @if (state.fieldError('dam_id'); as e) {
          <p class="mt-2 text-sm text-red-800" data-role="error-dam">{{ e }}</p>
        }
      </div>

      <app-precision-date
        label="When did she calve?"
        [error]="state.fieldError('occurred_on') ?? state.fieldError('date_precision')"
        (changed)="when.set($event)"
      />

      <!-- calf sex + outcome, needed before the picker can judge eligibility -->
      <div class="rounded-xl border border-farm-300 bg-white p-4 space-y-4">
        <div>
          <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">Calf sex</div>
          <div class="flex gap-2">
            @for (s of sexes; track s) {
              <button type="button" [attr.data-calf-sex]="s" (click)="setCalfSex(s)"
                class="rounded-lg border px-3 py-1.5 text-sm capitalize"
                [class]="calfSex() === s ? 'border-farm-600 bg-farm-600 text-white' : 'border-farm-300 bg-white text-farm-800'"
              >{{ s }}</button>
            }
          </div>
        </div>

        <div>
          <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">Outcome</div>
          <div class="flex flex-wrap gap-2">
            @for (o of outcomes; track o.value) {
              <button type="button" [attr.data-outcome]="o.value" (click)="setOutcome(o.value)"
                class="rounded-lg border px-3 py-1.5 text-sm"
                [class]="outcome() === o.value ? 'border-farm-600 bg-farm-600 text-white' : 'border-farm-300 bg-white text-farm-800'"
              >{{ o.label }}</button>
            }
          </div>
          <p class="mt-1.5 text-xs text-farm-600">
            A calf that did not live is still recorded as an animal, still opens the lactation, and
            still counts toward parity and the calving interval.
          </p>
          @if (outcome() !== 'live') {
            <p class="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-role="outcome-warning">
              If you are unsure whether this calf survived, record it as <strong>live</strong>.
              Live → died is repairable with a departure event; the reverse is not, and would
              leave the animal permanently departed.
            </p>
          }
        </div>
      </div>

      <!-- THE explicit question -->
      <div class="rounded-xl border border-farm-300 bg-white p-4">
        <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">
          Is the calf already in the registry?
        </div>
        <p class="mb-2 text-xs text-farm-600">
          It will be if you entered it in pass one — which you had to, if its dam was already here.
          Answering “new” for an animal that already exists creates a duplicate that cannot be repaired.
        </p>
        <div class="flex gap-2">
          <button type="button" data-role="mode-new" (click)="setMode('new')"
            class="rounded-lg border px-3 py-1.5 text-sm"
            [class]="mode() === 'new' ? 'border-farm-600 bg-farm-600 text-white' : 'border-farm-300 bg-white text-farm-800'"
          >No — create it</button>
          <button type="button" data-role="mode-existing" (click)="setMode('existing')"
            class="rounded-lg border px-3 py-1.5 text-sm"
            [class]="mode() === 'existing' ? 'border-farm-600 bg-farm-600 text-white' : 'border-farm-300 bg-white text-farm-800'"
          >Yes — link to it</button>
        </div>

        @if (mode() === 'new') {
          <label class="mt-3 block">
            <span class="mb-1 block text-xs font-medium text-farm-700">Calf name (optional)</span>
            <input data-role="calf_name" [value]="calfName()" (input)="calfName.set($any($event.target).value)"
              class="w-full max-w-xs rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
          </label>
        }

        @if (mode() === 'existing') {
          @if (!canLoadCandidates()) {
            <p class="mt-3 text-sm text-farm-600" data-role="candidates-blocked">
              Choose the dam and the calving date first — which animals can be linked depends on
              the date, because an animal's birth cannot postdate its own history.
            </p>
          } @else if (candidates().length === 0) {
            <p class="mt-3 text-sm text-farm-600" data-role="candidates-empty">
              No animals in the registry to link to.
            </p>
          } @else {
            <div class="mt-3 space-y-1" data-role="candidates">
              @for (c of candidates(); track c.id) {
                <button type="button" [attr.data-candidate]="c.id" [disabled]="!c.eligible"
                  (click)="calfId.set(c.id)"
                  class="flex w-full items-baseline gap-2 rounded-lg border px-3 py-2 text-left text-sm"
                  [class]="
                    calfId() === c.id
                      ? 'border-farm-600 bg-farm-100'
                      : c.eligible
                        ? 'border-farm-300 bg-white hover:border-farm-400'
                        : 'border-farm-200 bg-farm-50 text-farm-400 cursor-not-allowed'
                  "
                >
                  <span class="font-mono">{{ c.id }}</span>
                  <span>{{ c.name ?? '—' }}</span>
                  <span class="text-xs">{{ c.sex }}</span>
                  @if (!c.eligible) {
                    <span class="ml-auto text-xs italic" data-role="reason">{{ c.ineligible_reason }}</span>
                  }
                </button>
              }
            </div>
            <p class="mt-2 text-xs text-farm-500">
              Animals that cannot be linked are shown greyed with the reason, rather than hidden —
              an animal missing from this list would read as data loss.
            </p>
          }
          @if (state.fieldError('calf'); as e) {
            <p class="mt-2 text-sm text-red-800" data-role="error-calf">{{ e }}</p>
          }
        }
      </div>

      <label class="block">
        <span class="mb-1 block text-xs font-medium text-farm-700">Sire reference (optional, free text)</span>
        <input data-role="sire_ref" [value]="sireRef()" (input)="sireRef.set($any($event.target).value)"
          class="w-full max-w-md rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
      </label>

      <label class="block">
        <span class="mb-1 block text-xs font-medium text-farm-700">
          Observed by <span class="font-normal text-farm-500">(optional)</span>
        </span>
        <input data-role="observed_by" [value]="observedBy()" (input)="observedBy.set($any($event.target).value)"
          class="w-full max-w-xs rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
      </label>

      @if (state.formError(fields); as e) {
        <div class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="error-form">
          {{ e }}
        </div>
      }

      <!-- Keyed on the code, not nested in the form-level error: this refusal
           names occurred_on, so its message goes to the date control. -->
      @if (state.hasCode('near_duplicate_calving')) {
        <div class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-role="override">
          Far more likely a double entry than a real second calving — check the date first.
          <button type="button" data-role="allow-duplicate" (click)="allowDuplicate.set(true); submit()"
            class="ml-2 font-medium underline">Record it anyway</button>
        </div>
      }

      <div class="flex items-center gap-3">
        <button type="button" data-role="submit" (click)="submit()" [disabled]="!canSubmit()"
          class="rounded-xl bg-farm-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-farm-300"
        >{{ state.submitting() ? 'Saving…' : 'Record calving' }}</button>
        @if (blockedReason(); as r) {
          <span class="text-sm text-farm-600" data-role="blocked">{{ r }}</span>
        }
      </div>

      @if (state.result(); as r) {
        <div class="rounded-xl border border-green-300 bg-green-50 p-4" data-role="result">
          <p class="text-sm font-medium text-green-900">
            Calf {{ r.calf_id }}{{ r.linked ? ' — linked, not created' : ' — created' }}
          </p>
          @if (r.superseded_origin_event_id) {
            <p class="mt-1 text-sm text-green-800">
              Its “acquired” origin was superseded; its birth date is now the calving date,
              replacing what pass one estimated.
            </p>
          }
          <p class="mt-1 text-sm text-green-800">
            Dam is now <span class="font-mono">{{ r.dam.status?.status }}</span>,
            parity {{ r.dam.status?.parity }}
          </p>
          <div class="mt-2 flex gap-3 text-sm font-medium text-green-900 underline">
            <button type="button" (click)="open(r.dam.animal.id)">Open dam</button>
            <button type="button" (click)="open(r.calf_id)">Open calf</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class CalvingForm {
  private readonly api = inject(RegistryApi);
  private readonly router = inject(Router);
  private readonly session = inject(Session);

  protected readonly fields = FIELDS;
  protected readonly sexes: RegistrySex[] = ['female', 'male'];
  protected readonly outcomes: { value: CalvingOutcome; label: string }[] = [
    { value: 'live', label: 'Live' },
    { value: 'stillborn', label: 'Stillborn' },
    { value: 'died_within_24h', label: 'Died within 24h' },
  ];
  protected readonly state = new FormState<{
    calf_id: string; linked: boolean; superseded_origin_event_id: string | null;
    dam: import('./types').AnimalDetail; calf: import('./types').AnimalDetail;
  }>();

  protected readonly dams = signal<LinkCandidate[]>([]);
  protected readonly candidates = signal<LinkCandidate[]>([]);

  protected readonly damId = signal('');
  protected readonly when = signal<PrecisionDate | null>(null);
  protected readonly calfSex = signal<RegistrySex>('female');
  protected readonly outcome = signal<CalvingOutcome>('live');
  protected readonly mode = signal<CalfMode | null>(null);
  protected readonly calfId = signal('');
  protected readonly calfName = signal('');
  protected readonly sireRef = signal('');
  protected readonly observedBy = signal('');
  protected readonly allowDuplicate = signal(false);

  /** Eligibility depends on the date, so the picker waits for it. */
  protected readonly canLoadCandidates = computed(
    () => this.damId().length > 0 && this.when() !== null,
  );

  protected readonly canSubmit = computed(() => {
    if (this.state.submitting()) return false;
    if (this.damId().length === 0 || this.when() === null) return false;
    if (this.mode() === null) return false;
    if (this.mode() === 'existing' && this.calfId().length === 0) return false;
    return true;
  });

  protected readonly blockedReason = computed(() => {
    if (this.damId().length === 0) return 'Choose a dam.';
    if (this.when() === null) return 'Say how well you know the calving date, then enter it.';
    if (this.mode() === null) return 'Answer whether the calf is already in the registry.';
    if (this.mode() === 'existing' && this.calfId().length === 0) return 'Pick the calf.';
    return null;
  });

  constructor() {
    void this.api.damCandidates().then((d) => this.dams.set(d));
  }

  protected setCalfSex(s: RegistrySex): void {
    this.calfSex.set(s);
    this.calfId.set('');
    void this.refreshCandidates();
  }

  protected setOutcome(o: CalvingOutcome): void {
    this.outcome.set(o);
  }

  protected setMode(m: CalfMode): void {
    this.mode.set(m);
    if (m === 'existing') void this.refreshCandidates();
    else this.calfId.set('');
  }

  private async refreshCandidates(): Promise<void> {
    const w = this.when();
    if (!this.canLoadCandidates() || !w) return;
    const c = await this.api.linkCandidates({
      dam: this.damId(),
      calfSex: this.calfSex(),
      occurredOn: w.occurred_on,
      datePrecision: w.date_precision,
    });
    this.candidates.set(c);
  }

  protected async submit(): Promise<void> {
    const w = this.when();
    if (!w) return;
    // Re-read candidates on submit in link mode so a stale list cannot be the
    // reason a link is attempted against an animal that has since changed.
    const r = await this.state.run(() =>
      this.api.recordCalving({
        dam_id: this.damId(),
        occurred_on: w.occurred_on,
        occurred_time: w.occurred_time,
        date_precision: w.date_precision,
        calf_id: this.mode() === 'existing' ? this.calfId() : null,
        calf_sex: this.calfSex(),
        calf_name: this.mode() === 'new' ? blank(this.calfName()) : null,
        outcome: this.outcome(),
        sire_ref: blank(this.sireRef()),
        observed_by: blank(this.observedBy()),
        allow_near_duplicate: this.allowDuplicate(),
        ...this.session.provenance(),
      }),
    );
    this.allowDuplicate.set(false);
    if (r) {
      void this.api.damCandidates().then((d) => this.dams.set(d));
      void this.refreshCandidates();
    }
  }

  protected open(id: string): void {
    void this.router.navigate(['/animals', id]);
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
