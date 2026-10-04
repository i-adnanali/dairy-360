import { precisionParts } from "../precision-display";
import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
// Correct a calving's date. The paired (or triple) correction.
//
// Reached from an animal's record, not from a menu: the flow is pick animal ->
// see calvings -> pick one -> correct, because an event id is not something a
// human should type.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RegistryApi } from "../api";
import { FormState } from "../form-state";
import { Session } from "../session";
import { SessionRequired } from "../session-required/session-required";
import { WriteLog } from "../after-write";
import { PrecisionDateControl, dateBlocker } from "../precision-date/precision-date";
import type { DateEntry } from "../precision-date/precision-date";
import type { TimelineEvent } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { ErrorText } from "../../ui/surface";
import { FieldLabel } from "../../ui/text";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { SectionLabel } from "../../ui/text";
import { Button } from "../../ui/button";

const FIELDS = ['calving_event_id', 'occurred_on', 'date_precision'] as const;

@Component({
  selector: 'app-correction-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WriteLock,
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
  templateUrl: './correction-form.html',
  styleUrl: './correction-form.css',
})
export class CorrectionForm {
  constructor() {
    this.writer = writerDraft({
      name: 'Calving correction',
      fields: {
        target: this.target,
        when: this.when,
        notes: this.notes,
        allowDuplicate: this.allowDuplicate,
        overrideReason: this.overrideReason,
      },
      states: [this.state],
      afterRestore: () => {
        this.dateControl()?.reset();
      },
    });
  }

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

  readonly events = input.required<TimelineEvent[]>();
  readonly done = input<(() => void) | null>(null);

  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  private readonly writeLog = inject(WriteLog);
  private readonly dateControl = viewChild(PrecisionDateControl);

  protected readonly fields = FIELDS;
  protected readonly state = new FormState<{
    superseded: {
      calving_event_id: string;
      birth_event_id: string;
      departure_event_id: string | null;
    };
  }>();

  protected readonly target = signal('');
  protected readonly selected = computed(() => this.correctable().find(c => c.id === this.target()));
  protected dateLabel(on: string | null, precision: TimelineEvent['date_precision']) {
    const date = precisionParts(on, precision);
    return [date.figure, date.qualifier].filter(Boolean).join(' ');
  }
  protected proposedDate() {
    const entry = this.when();
    return entry.status === 'complete' ? this.dateLabel(entry.value.occurred_on, entry.value.date_precision) : 'Enter a complete corrected date';
  }
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
    const r = await this.state.runRequest(
      () =>
        [
          this.target(),
          {
            occurred_on: w.occurred_on,
            occurred_time: w.occurred_time,
            date_precision: w.date_precision,
            notes: blank(this.notes()),
            allow_near_duplicate: this.allowDuplicate(),
            override_reason: blank(this.overrideReason()),
            ...this.session.provenance(),
          },
        ] as const,
      (request, key) => this.api.correctCalving(request[0], request[1], key),
    );
    this.allowDuplicate.set(false);
    if (r) {
      this.target.set('');
      this.dateControl()?.reset();
      this.when.set({ status: 'empty' });
      this.overrideReason.set('');
      this.writeLog.announce('Correction written. The superseded events remain in the log.');
      this.done()?.();
      this.writer.accept();
    }
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
