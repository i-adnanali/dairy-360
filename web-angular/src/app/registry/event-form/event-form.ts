import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
// Append a life event: dry_off, departure, or note.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { RegistryApi } from "../api";
import { FormState } from "../form-state";
import { Session } from "../session";
import { SessionRequired } from "../session-required/session-required";
import { WriteLog, focusAfterWrite } from "../after-write";
import { ChipGroup } from "../chip-group/chip-group";
import { IdentifierInput } from "../identifier-input/identifier-input";
import { Identifiers } from "../identifiers";
import { PrecisionDateControl, dateBlocker } from "../precision-date/precision-date";
import type { DateEntry } from "../precision-date/precision-date";
import type { AnimalDetail, EnterableEventType } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { ErrorText } from "../../ui/surface";
import { FieldLabel } from "../../ui/text";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { SectionLabel } from "../../ui/text";
import { Button } from "../../ui/button";

const FIELDS = [
  'animal_id',
  'type',
  'occurred_on',
  'date_precision',
  'occurred_time',
  'reason',
  'text',
] as const;

@Component({
  selector: 'app-event-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WriteLock,
    Button,
    Card,
    ChipGroup,
    ErrorPanel,
    ErrorText,
    FieldLabel,
    HelpText,
    IdentifierInput,
    PrecisionDateControl,
    SectionLabel,
    SessionRequired,
    TextInput,
  ],
  templateUrl: './event-form.html',
  styleUrl: './event-form.css',
})
export class EventForm {
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

  readonly animalId = input.required<string>();
  readonly saved = input<((d: AnimalDetail) => void) | null>(null);

  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  protected readonly identifiers = inject(Identifiers);
  private readonly writeLog = inject(WriteLog);

  private readonly dateControl = viewChild(PrecisionDateControl);
  private readonly typeGroup = viewChild<ElementRef<HTMLElement>>('typeGroup');

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
  protected readonly when = signal<DateEntry>({ status: 'empty' });
  protected readonly reason = signal('');
  protected readonly to = signal('');
  protected readonly text = signal('');
  protected readonly observedBy = signal('');
  protected readonly allowAfterDeparture = signal(false);
  protected readonly overrideReason = signal('');

  protected readonly canSubmit = computed(
    () => this.type() !== null && this.blockedReason() === null && !this.state.submitting(),
  );

  protected readonly blockedReason = computed(() =>
    dateBlocker(this.when(), { label: 'date', required: true }),
  );

  constructor() {
    this.writer = writerDraft({
      name: 'Animal event',
      fields: {
        type: this.type,
        when: this.when,
        reason: this.reason,
        to: this.to,
        text: this.text,
        observedBy: this.observedBy,
        allowAfterDeparture: this.allowAfterDeparture,
        overrideReason: this.overrideReason,
      },
      states: [this.state],
      afterRestore: () => {
        this.dateControl()?.reset();
      },
    });

    void this.identifiers.refresh();
  }

  protected async submit(): Promise<void> {
    const entry = this.when();
    const t = this.type();
    if (entry.status !== 'complete' || !t) return;
    const w = entry.value;
    const r = await this.state.runRequest(
      () =>
        [
          {
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
          },
        ] as const,
      (request, key) => this.api.addEvent(request[0], key),
    );
    this.allowAfterDeparture.set(false);
    if (r) {
      this.type.set(null);
      this.when.set({ status: 'empty' });
      this.reason.set('');
      this.to.set('');
      this.text.set('');
      this.overrideReason.set('');
      void this.identifiers.refresh();
      this.dateControl()?.reset();
      this.when.set({ status: 'empty' });
      this.observedBy.set('');
      this.writer.accept();
      this.saved()?.(r.animal);
      this.writeLog.announce(`Recorded a ${t} on ${this.animalId()}.`);
    }
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
