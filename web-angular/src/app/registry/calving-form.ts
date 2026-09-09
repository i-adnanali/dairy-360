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
// The picker cannot be populated until the date AND the calf's sex are known,
// because eligibility depends on both -- an animal whose own history predates
// the proposed birth cannot be linked, and neither can one recorded as the
// other sex. So the order is still forced: dam, date, sex, then the calf. That
// is the server's rule, not a UI preference.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { WriteLog, focusAfterWrite } from './after-write';
import { CalfPicker } from './calf-picker';
import { ChipGroup } from './chip-group';
import { IdentifierInput } from './identifier-input';
import { Identifiers } from './identifiers';
import { PrecisionDateControl, dateBlocker } from './precision-date';
import type { DateEntry, PrecisionDate } from './precision-date';
import type { CalfChoice } from './calf-picker';
import type { CalvingOutcome, LinkCandidate, RegistrySex } from './types';
import { Card } from '../ui/surface';
import { ErrorPanel } from '../ui/surface';
import { ErrorText } from '../ui/surface';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { PageHeading } from '../ui/heading';
import { SectionLabel } from '../ui/text';
import { TextLink } from '../ui/text';
import { Button } from '../ui/button';

const FIELDS = ['dam_id', 'occurred_on', 'date_precision', 'calf', 'calf_sex', 'outcome'] as const;

@Component({
  selector: 'app-calving-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    CalfPicker,
    Card,
    ChipGroup,
    ErrorPanel,
    ErrorText,
    HelpText,
    IdentifierInput,
    PageHeading,
    PrecisionDateControl,
    RouterLink,
    SectionLabel,
    TextInput,
    TextLink,
  ],
  template: `
    <!-- A real <form>: Enter submits from any text field. -->
    <form class="mx-auto max-w-2xl space-y-4" (submit)="onSubmit($event)">
      <header>
        <h2 appPageHeading>Record a calving</h2>
        <p appHelp class="mt-1">
          Enter calvings oldest first. Each one creates its calf, so in order means a farm-born
          animal exists before anything refers to it.
        </p>
      </header>

      <!-- dam -->
      <div appCard>
        <div appSectionLabel legend>Dam</div>
        @if (dams().length === 0) {
          <!-- Was a dead end with no way out, while /herd's empty state already
               linked to /add. The asymmetry was the bug: the same nothing-yet
               state, one screen offering the next step and the other not. -->
          <p appHelp data-role="no-dams">
            No females in the registry yet — a calving needs a dam.
            <a routerLink="/animals/new" data-role="no-dams-cta" appTextLink tone="strong"
              >Add an acquired animal</a
            >, and it will be here when you come back.
          </p>
        } @else {
          <select
            #firstField
            data-role="dam"
            [value]="damId()"
            (change)="setDam($any($event.target).value)"
            appInput
            class="w-full max-w-sm"
          >
            <option value="">Choose a dam…</option>
            @for (d of dams(); track d.id) {
              <option [value]="d.id" [disabled]="!d.eligible">
                {{ d.id }}{{ d.name ? ' — ' + d.name : ''
                }}{{ d.eligible ? '' : ' (' + d.ineligible_reason + ')' }}
              </option>
            }
          </select>
        }
        @if (state.fieldError('dam_id'); as e) {
          <p appErrorText class="mt-2" data-role="error-dam">{{ e }}</p>
        }
      </div>

      <app-precision-date
        label="When did she calve?"
        [error]="state.fieldError('occurred_on') ?? state.fieldError('date_precision')"
        (changed)="setWhen($event)"
      />

      <!-- calf sex + outcome, needed before the picker can judge eligibility -->
      <div class="rounded-xl border border-line bg-surface-raised p-4 space-y-4">
        <div>
          <div appSectionLabel legend>Calf sex</div>
          <app-chip-group
            name="calf-sex"
            label="Calf sex"
            [options]="sexChips"
            [value]="calfSex()"
            (changed)="setCalfSex($any($event))"
          />
        </div>

        <div>
          <div appSectionLabel legend>Outcome</div>
          <app-chip-group
            name="outcome"
            label="Outcome"
            [options]="outcomes"
            [value]="outcome()"
            (changed)="setOutcome($any($event))"
          />
          <p class="mt-1.5 text-xs text-content-muted">
            A calf that did not live is still recorded as an animal, still opens the lactation, and
            still counts toward parity and the calving interval.
          </p>
          @if (outcome() !== 'live') {
            <p
              class="mt-1.5 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-content-primary"
              data-role="outcome-warning"
            >
              If you are unsure whether this calf survived, record it as <strong>live</strong>. Live
              → died is repairable with a departure event; the reverse is not, and would leave the
              animal permanently departed.
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

      <app-identifier-input
        field="sire_ref"
        label="Sire reference"
        [value]="sireRef()"
        [suggestions]="identifiers.values().sire_ref"
        (changed)="sireRef.set($event)"
      />

      <app-identifier-input
        field="observed_by"
        label="Observed by"
        [value]="observedBy()"
        [suggestions]="identifiers.values().observed_by"
        (changed)="observedBy.set($event)"
      />

      @if (state.formError(fields); as e) {
        <div appErrorPanel data-role="error-form">
          {{ e }}
        </div>
      }

      <!-- Keyed on the code, not nested in the form-level error: this refusal
           names occurred_on, so its message goes to the date control. -->
      @if (state.hasCode('near_duplicate_calving')) {
        <div
          class="override-notice rounded-lg bg-surface-sunken px-3 py-2 text-sm text-content-primary"
          data-role="override"
        >
          <p>Far more likely a double entry than a real second calving — check the date first.</p>
          <label class="mt-2 block">
            <span class="mb-1 block text-xs font-medium">
              Why, if you want it on the record <span class="font-normal">(optional)</span>
            </span>
            <input
              data-role="override_reason"
              [value]="overrideReason()"
              (input)="overrideReason.set($any($event.target).value)"
              placeholder="twin born the following month, confirmed against the cycle card"
              class="w-full rounded-lg border border-line-strong bg-surface-raised px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            data-role="allow-duplicate"
            (click)="allowDuplicate.set(true); submit()"
            class="mt-2 font-medium underline"
          >
            Record it anyway
          </button>
        </div>
      }

      <div class="flex items-center gap-3">
        <button
          type="submit"
          data-role="submit"
          [appButtonDisabled]="!canSubmit()"
          appButton
          reason="calving-submit-reason"
        >
          {{ state.submitting() ? 'Saving…' : 'Record calving' }}
        </button>
        @if (blockedReason(); as r) {
          <span appHelp data-role="blocked" id="calving-submit-reason">{{ r }}</span>
        }
      </div>

      @if (state.result(); as r) {
        <div class="rounded-xl border border-success-line bg-success-bg p-4" data-role="result">
          <p class="text-sm font-medium text-success-strong">
            Calf {{ r.calf_id }}{{ r.linked ? ' — linked, not created' : ' — created' }}
          </p>
          @if (r.superseded_origin_event_id) {
            <p class="mt-1 text-sm text-success-fg">
              Its “acquired” origin was superseded; its birth date is now the calving date,
              replacing what pass one estimated.
            </p>
          }
          <p class="mt-1 text-sm text-success-fg">
            Dam is now <span class="font-mono">{{ r.dam.status?.status }}</span
            >, parity {{ r.dam.status?.parity }}
          </p>
          <div class="mt-2 flex gap-3 text-sm font-medium text-success-strong underline">
            <button type="button" (click)="open(r.dam.animal.id)">Open dam</button>
            <button type="button" (click)="open(r.calf_id)">Open calf</button>
          </div>
        </div>
      }
      <p class="mt-2 text-xs text-content-muted">
        Cmd/Ctrl+Enter saves from a field when the record is ready.
      </p>
    </form>
  `,
})
export class CalvingForm {
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

  private readonly api = inject(RegistryApi);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  protected readonly identifiers = inject(Identifiers);
  private readonly writeLog = inject(WriteLog);

  private readonly firstField = viewChild<ElementRef<HTMLSelectElement>>('firstField');
  private readonly dateControls = viewChildren(PrecisionDateControl);

  protected readonly fields = FIELDS;
  protected readonly sexChips = [
    { value: 'female', label: 'female' },
    { value: 'male', label: 'male' },
  ];
  protected readonly outcomes: { value: CalvingOutcome; label: string }[] = [
    { value: 'live', label: 'Live' },
    { value: 'stillborn', label: 'Stillborn' },
    { value: 'died_within_24h', label: 'Died within 24h' },
  ];
  protected readonly state = new FormState<{
    calf_id: string;
    linked: boolean;
    superseded_origin_event_id: string | null;
    dam: import('./types').AnimalDetail;
    calf: import('./types').AnimalDetail;
  }>();

  protected readonly dams = signal<LinkCandidate[]>([]);
  protected readonly candidates = signal<LinkCandidate[]>([]);

  protected readonly damId = signal('');
  protected readonly when = signal<DateEntry>({ status: 'empty' });
  /**
   * NO DEFAULT, and this one is a defect fix rather than a preference.
   *
   * `female` was pre-selected here on the same reasoning /add's `sex` carries
   * one -- a strong prior, a field re-answered on every record. Neither half
   * holds for a calf. Consecutive acquired animals genuinely arrive in same-sex
   * runs (a batch purchase); consecutive calvings are a coin flip, so there is
   * no prior to lean on.
   *
   * And the consequence is worse than a wrong column, because this value is not
   * only recorded -- it FILTERS THE PICKER. `linkCandidates` marks an animal
   * ineligible when its sex disagrees (reads.ts), so an unanswered default
   * greys out the right calf and leaves "create a new animal" as the only path
   * the operator can take. That mints the duplicate CalfPicker exists to
   * prevent, from a question nobody was asked.
   *
   * So it starts null, the picker waits for it alongside the dam and the date,
   * and it CLEARS after a write -- carrying the last calf's sex forward would
   * rebuild the same default from record two onward.
   */
  protected readonly calfSex = signal<RegistrySex | null>(null);
  protected readonly outcome = signal<CalvingOutcome>('live');
  /** Null until the picker is answered; then an id, or null for "create new". */
  protected readonly calfChoice = signal<CalfChoice>(null);
  protected readonly calfAnswered = signal(false);
  protected readonly calfName = signal<string | null>(null);
  protected readonly sireRef = signal('');
  protected readonly observedBy = signal('');
  protected readonly allowDuplicate = signal(false);
  protected readonly overrideReason = signal('');

  /**
   * Eligibility depends on the date AND the sex, so the picker waits for both.
   *
   * Sex is a precondition rather than a filter applied afterwards: a list built
   * without it would show animals the server will refuse, and one built with a
   * guessed sex would hide animals it will accept. Neither is a list worth
   * putting in front of someone deciding whether to create a duplicate.
   */
  protected readonly canLoadCandidates = computed(
    () => this.damId().length > 0 && this.when().status === 'complete' && this.calfSex() !== null,
  );

  protected readonly canSubmit = computed(
    () =>
      !this.state.submitting() &&
      this.damId().length > 0 &&
      this.when().status === 'complete' &&
      this.calfSex() !== null &&
      this.calfAnswered(),
  );

  protected readonly blockedReason = computed(() => {
    if (this.damId().length === 0) return 'Choose a dam.';
    const d = dateBlocker(this.when(), { label: 'calving date', required: true });
    if (d !== null) return d;
    // Named before the calf, because it is what the picker is waiting on.
    if (this.calfSex() === null) return 'Say whether the calf is female or male.';
    if (!this.calfAnswered()) return 'Pick the calf, or say none of these.';
    return null;
  });

  private readonly picker = viewChild(CalfPicker);

  constructor() {
    void this.api.damCandidates().then((d) => this.dams.set(d));
    void this.identifiers.refresh();

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
      if (dam.length === 0 || w.status !== 'complete' || sex === null) return;
      void this.loadCandidates(dam, sex, w.value);
    });
  }

  /** Choosing a different dam invalidates both the list and anything picked from it. */
  protected setDam(id: string): void {
    this.damId.set(id);
    this.clearCalf();
  }

  protected setWhen(w: DateEntry): void {
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

  private async loadCandidates(dam: string, calfSex: RegistrySex, w: PrecisionDate): Promise<void> {
    const c = await this.api.linkCandidates({
      dam,
      calfSex,
      occurredOn: w.occurred_on,
      datePrecision: w.date_precision,
    });
    this.candidates.set(c);
  }

  protected async submit(): Promise<void> {
    const entry = this.when();
    if (entry.status !== 'complete') return;
    // Belt and braces behind the disabled button: an unanswered calf sex must
    // never reach the wire as a guess.
    const calfSex = this.calfSex();
    if (calfSex === null) return;
    const w = entry.value;
    // Re-read candidates on submit in link mode so a stale list cannot be the
    // reason a link is attempted against an animal that has since changed.
    const r = await this.state.run((key) =>
      this.api.recordCalving(
        {
          dam_id: this.damId(),
          occurred_on: w.occurred_on,
          occurred_time: w.occurred_time,
          date_precision: w.date_precision,
          calf_id: this.calfChoice(),
          calf_sex: calfSex,
          calf_name: this.calfName(),
          outcome: this.outcome(),
          sire_ref: blank(this.sireRef()),
          observed_by: blank(this.observedBy()),
          allow_near_duplicate: this.allowDuplicate(),
          override_reason: blank(this.overrideReason()),
          ...this.session.provenance(),
        },
        key,
      ),
    );
    this.allowDuplicate.set(false);
    if (r) {
      void this.api.damCandidates().then((d) => this.dams.set(d));
      // The calving just minted or linked an animal, so the list is stale and
      // the previous choice must not survive into the next record.
      this.clearCalf();
      this.overrideReason.set('');
      void this.identifiers.refresh();

      // THE DAM SURVIVES, deliberately. A cycle card is one animal's whole
      // history, so the next calving entered is almost always the same dam's
      // next one -- clearing her would mean re-picking her from a dropdown
      // between every calving, which is the round trip this exists to remove.
      //
      // THE CALF SEX DOES NOT, for the reason on its signal. Clearing it also
      // makes the stale candidate list unreachable rather than merely unshown,
      // so it is emptied here instead of refetched -- the effect repopulates it
      // once the dam, the date and the sex are all answered again.
      for (const c of this.dateControls()) c.reset();
      this.when.set({ status: 'empty' });
      this.calfSex.set(null);
      this.candidates.set([]);
      this.sireRef.set('');
      this.observedBy.set('');
      this.writeLog.announce(
        `Wrote a calving on ${this.damId()} — calf ${r.calf_id}${r.linked ? ', linked' : ', created'}. Ready for the next.`,
      );
      focusAfterWrite(this.firstField()?.nativeElement);
    }
  }

  protected open(id: string): void {
    void this.router.navigate(['/animals', id]);
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
