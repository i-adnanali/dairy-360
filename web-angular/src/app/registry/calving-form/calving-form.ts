import { DestroyRef } from '@angular/core';
import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
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
import { RegistryApi } from "../api";
import { FormState } from "../form-state";
import { Session } from "../session";
import { WriteLog, focusAfterWrite } from "../after-write";
import { CalfPicker } from "../calf-picker/calf-picker";
import { ChipGroup } from "../chip-group/chip-group";
import { IdentifierInput } from "../identifier-input/identifier-input";
import { Identifiers } from "../identifiers";
import { PrecisionDateControl, dateBlocker } from "../precision-date/precision-date";
import type { DateEntry, PrecisionDate } from "../precision-date/precision-date";
import type { CalfChoice } from "../calf-picker/calf-picker";
import type { CalvingOutcome, LinkCandidate, RegistrySex } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { ErrorText } from "../../ui/surface";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { SectionLabel } from "../../ui/text";
import { TextLink } from "../../ui/text";
import { Button } from "../../ui/button";

const FIELDS = ['dam_id', 'occurred_on', 'date_precision', 'calf', 'calf_sex', 'outcome'] as const;

@Component({
  selector: 'app-calving-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WriteLock,
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
  templateUrl: './calving-form.html',
  styleUrl: './calving-form.css',
})
export class CalvingForm {
  protected readonly damSearch = signal('');
  protected readonly filteredDams = computed(() => {
    const query = this.damSearch().trim().toLowerCase();
    return this.dams().filter(d => d.id === this.damId() || (d.id + ' ' + (d.name ?? '')).toLowerCase().includes(query));
  });
  protected writer!: ReturnType<typeof writerDraft>;
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
    dam: import("../types").AnimalDetail;
    calf: import("../types").AnimalDetail;
  }>();

  protected readonly dams = signal<LinkCandidate[]>([]);
  protected readonly candidateStatus = signal<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  protected readonly damError = signal('');
  protected readonly damsLoading = signal(true);
  private candidateSequence = 0;
  protected async loadDams() {
    if (!this.dams().length) this.damsLoading.set(true); this.damError.set('');
    try { this.dams.set(await this.api.damCandidates()); }
    catch (error) { this.damError.set(String(error)); }
    finally { this.damsLoading.set(false); }
  }
  protected retryCandidates() {
    const when = this.when(), sex = this.calfSex();
    if (when.status === 'complete' && sex !== null) void this.loadCandidates(this.damId(), sex, when.value);
  }
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
      this.candidateStatus() === 'loaded' && this.calfAnswered(),
  );

  protected readonly blockedReason = computed(() => {
    if (this.damId().length === 0) return 'Choose a dam.';
    const d = dateBlocker(this.when(), { label: 'calving date', required: true });
    if (d !== null) return d;
    // Named before the calf, because it is what the picker is waiting on.
    if (this.calfSex() === null) return 'Say whether the calf is female or male.';
    if (this.candidateStatus() === 'failed') return 'Retry the calf candidate lookup.';
    if (this.candidateStatus() !== 'loaded') return 'Wait for calf candidates to load.';
    if (!this.calfAnswered()) return 'Pick the calf, or say none of these.';
    return null;
  });

  private readonly picker = viewChild(CalfPicker);

  constructor() {
    inject(DestroyRef).onDestroy(() => ++this.candidateSequence);
    this.writer = writerDraft({
      name: 'Calving',
      fields: {
        damId: this.damId,
        when: this.when,
        calfSex: this.calfSex,
        outcome: this.outcome,
        calfChoice: this.calfChoice,
        calfAnswered: this.calfAnswered,
        calfName: this.calfName,
        sireRef: this.sireRef,
        observedBy: this.observedBy,
        allowDuplicate: this.allowDuplicate,
        overrideReason: this.overrideReason,
      },
      states: [this.state],
      afterRestore: () => {
        this.dateControls().forEach((c) => c.reset());
        this.picker()?.reset();
      },
    });

    void this.loadDams();
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
      ++this.candidateSequence;
      this.candidates.set([]);
      this.candidateStatus.set('idle');
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
    const sequence = ++this.candidateSequence;
    this.candidates.set([]);
    this.candidateStatus.set('loading');
    try {
      const candidates = await this.api.linkCandidates({ dam, calfSex,
        occurredOn: w.occurred_on, datePrecision: w.date_precision });
      if (sequence !== this.candidateSequence) return;
      this.candidates.set(candidates);
      this.candidateStatus.set('loaded');
    } catch {
      if (sequence === this.candidateSequence) this.candidateStatus.set('failed');
    }
  }

  protected async submit(): Promise<void> {
    if (this.state.submitting() || (!this.state.uncertain() && !this.canSubmit())) return;
    const entry = this.when();
    if (entry.status !== 'complete') return;
    // Belt and braces behind the disabled button: an unanswered calf sex must
    // never reach the wire as a guess.
    const calfSex = this.calfSex();
    if (calfSex === null) return;
    const w = entry.value;
    // Re-read candidates on submit in link mode so a stale list cannot be the
    // reason a link is attempted against an animal that has since changed.
    const r = await this.state.runRequest(
      () =>
        [
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
        ] as const,
      (request, key) => this.api.recordCalving(request[0], key),
    );
    this.allowDuplicate.set(false);
    if (r) {
      void this.loadDams();
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
      this.writer.accept();
    }
  }

  protected open(id: string): void {
    void this.router.navigate(['/animals', id]);
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
