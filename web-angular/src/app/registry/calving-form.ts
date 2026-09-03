// Record a calving. Pass two of the backfill.
//
// ---------------------------------------------------------------------------
// LINK vs MINT IS A QUERY, NOT A QUESTION
// ---------------------------------------------------------------------------
// This used to ask "is the calf already in the registry?" as a yes/no, warning
// that answering wrong creates a duplicate nothing can repair. Every word of
// that was true and it was still the wrong question: it asked the operator to
// recall the contents of a database one tab away, with an irreversible penalty,
// at hour two of a transcription session.
//
// The answer was always in the database. It is a list now -- see calf-picker.ts,
// which is a separate component because the animal workbench needs the same
// list with the dam fixed by context rather than chosen from a dropdown.
//
// The case that made the old question necessary has not gone away: pass one
// must enter a farm-born animal as `acquired` whenever its dam is still in the
// herd, because pass one has no calvings yet. So by pass two, some calves
// already exist. That is now something the list surfaces rather than something
// the operator must remember.
//
// The picker cannot be populated until the date is known, because eligibility
// depends on it -- an animal whose own history predates the proposed birth
// cannot be linked. So the order is still forced: precision, date, then the
// calf. That is the server's rule, not a UI preference.

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { CalfPicker } from './calf-picker';
import { PrecisionDateControl } from './precision-date';
import type { PrecisionDate } from './precision-date';
import type { CalfChoice } from './calf-picker';
import type { CalvingOutcome, LinkCandidate, RegistrySex } from './types';

const FIELDS = ['dam_id', 'occurred_on', 'date_precision', 'calf', 'calf_sex', 'outcome'] as const;

@Component({
  selector: 'app-calving-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CalfPicker, PrecisionDateControl],
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
          <select data-role="dam" [value]="damId()" (change)="setDam($any($event.target).value)"
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
        (changed)="setWhen($event)"
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

      <app-calf-picker
        [candidates]="candidates()"
        [ready]="canLoadCandidates()"
        [error]="state.fieldError('calf')"
        (changed)="onCalfChosen($event)"
      />

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
          <p>Far more likely a double entry than a real second calving — check the date first.</p>
          <label class="mt-2 block">
            <span class="mb-1 block text-xs font-medium">
              Why, if you want it on the record <span class="font-normal">(optional)</span>
            </span>
            <input data-role="override_reason" [value]="overrideReason()"
              (input)="overrideReason.set($any($event.target).value)"
              placeholder="twin born the following month, confirmed against the cycle card"
              class="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <button type="button" data-role="allow-duplicate" (click)="allowDuplicate.set(true); submit()"
            class="mt-2 font-medium underline">Record it anyway</button>
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
  /** Null until the picker is answered; then an id, or null for "create new". */
  protected readonly calfChoice = signal<CalfChoice>(null);
  protected readonly calfAnswered = signal(false);
  protected readonly calfName = signal<string | null>(null);
  protected readonly sireRef = signal('');
  protected readonly observedBy = signal('');
  protected readonly allowDuplicate = signal(false);
  protected readonly overrideReason = signal('');

  /** Eligibility depends on the date, so the picker waits for it. */
  protected readonly canLoadCandidates = computed(
    () => this.damId().length > 0 && this.when() !== null,
  );

  protected readonly canSubmit = computed(
    () =>
      !this.state.submitting() &&
      this.damId().length > 0 &&
      this.when() !== null &&
      this.calfAnswered(),
  );

  protected readonly blockedReason = computed(() => {
    if (this.damId().length === 0) return 'Choose a dam.';
    if (this.when() === null) return 'Say how well you know the calving date, then enter it.';
    if (!this.calfAnswered()) return 'Pick the calf, or say none of these.';
    return null;
  });

  private readonly picker = viewChild(CalfPicker);

  constructor() {
    void this.api.damCandidates().then((d) => this.dams.set(d));

    // The list has to ARRIVE ON ITS OWN now. It used to be fetched when the
    // operator clicked "yes -- link to it", and that click no longer exists:
    // the picker is on screen from the start, so an unfetched list would show
    // as "no animal has a birth date near this calving" -- which is a false
    // statement about the herd, and the exact wrong thing to tell someone
    // deciding whether to create a duplicate.
    effect(() => {
      const dam = this.damId();
      const w = this.when();
      const sex = this.calfSex();
      if (dam.length === 0 || w === null) return;
      void this.loadCandidates(dam, sex, w);
    });
  }

  /** Choosing a different dam invalidates both the list and anything picked from it. */
  protected setDam(id: string): void {
    this.damId.set(id);
    this.clearCalf();
  }

  protected setWhen(w: PrecisionDate | null): void {
    this.when.set(w);
    // Eligibility is a function of the date, so a changed date can turn the
    // picked animal ineligible. Dropping the choice forces a fresh look rather
    // than letting a stale selection ride to submit.
    this.clearCalf();
  }

  protected setCalfSex(s: RegistrySex): void {
    this.calfSex.set(s);
    this.clearCalf();
  }

  protected onCalfChosen(e: { choice: CalfChoice; name: string | null }): void {
    this.calfChoice.set(e.choice);
    this.calfAnswered.set(true);
    this.calfName.set(e.name);
  }

  private clearCalf(): void {
    this.calfChoice.set(null);
    this.calfAnswered.set(false);
    this.calfName.set(null);
    // The picker owns its own selection, so clearing the parent's copy alone
    // would leave a highlighted row that no longer means anything.
    this.picker()?.reset();
  }

  protected setOutcome(o: CalvingOutcome): void {
    this.outcome.set(o);
  }

  private async loadCandidates(
    dam: string,
    calfSex: RegistrySex,
    w: PrecisionDate,
  ): Promise<void> {
    const c = await this.api.linkCandidates({
      dam,
      calfSex,
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
    const r = await this.state.run((key) =>
      this.api.recordCalving({
        dam_id: this.damId(),
        occurred_on: w.occurred_on,
        occurred_time: w.occurred_time,
        date_precision: w.date_precision,
        calf_id: this.calfChoice(),
        calf_sex: this.calfSex(),
        calf_name: this.calfName(),
        outcome: this.outcome(),
        sire_ref: blank(this.sireRef()),
        observed_by: blank(this.observedBy()),
        allow_near_duplicate: this.allowDuplicate(),
        override_reason: blank(this.overrideReason()),
        ...this.session.provenance(),
      }, key),
    );
    this.allowDuplicate.set(false);
    if (r) {
      void this.api.damCandidates().then((d) => this.dams.set(d));
      // The calving just minted or linked an animal, so the list is stale and
      // the previous choice must not survive into the next record.
      this.clearCalf();
      this.overrideReason.set('');
      void this.loadCandidates(this.damId(), this.calfSex(), w);
    }
  }

  protected open(id: string): void {
    void this.router.navigate(['/animals', id]);
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
