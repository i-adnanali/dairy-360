// Record a service or a pregnancy check: POST /breeding/events.
//
// Built on the event form's structure (FormState, its override notice,
// writerDraft, PrecisionDateControl, ChipGroup, WriteLock), not a second
// badge, date or override system. The three breeding warnings are saved over
// the way a departed animal is: the server names the warning by its code, and
// the button sets only that warning's flag for one submit.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { writerDraft } from '../writer-draft';
import { WriteLock } from '../write-lock';
import { RegistryApi } from '../api';
import { FormState } from '../form-state';
import { Session } from '../session';
import { SessionRequired } from '../session-required/session-required';
import { WriteLog } from '../after-write';
import { ChipGroup } from '../chip-group/chip-group';
import { IdentifierInput } from '../identifier-input/identifier-input';
import { Identifiers } from '../identifiers';
import { PrecisionDateControl, dateBlocker } from '../precision-date/precision-date';
import type { DateEntry } from '../precision-date/precision-date';
import type { AnimalDetail, CheckMethod, CheckResult, ServiceType } from '../types';
import { Card } from '../../ui/surface';
import { ErrorPanel } from '../../ui/surface';
import { ErrorText } from '../../ui/surface';
import { FieldLabel } from '../../ui/text';
import { HelpText } from '../../ui/text';
import { TextInput } from '../../ui/input';
import { SectionLabel } from '../../ui/text';
import { Button } from '../../ui/button';

type BreedingKind = 'insemination' | 'pregnancy_check';

/** The three warnings a breeding write can be saved over, and the flag each one sets. */
const OVERRIDES = {
  ambiguous_service: 'allow_ambiguous_service',
  early_check: 'allow_early_check',
  check_without_service: 'allow_check_without_service',
} as const;
type BreedingWarning = keyof typeof OVERRIDES;
const WARNINGS = Object.keys(OVERRIDES) as BreedingWarning[];

const FIELDS = [
  'occurred_on',
  'date_precision',
  'occurred_time',
  'exposure_days',
  'observed_by',
] as const;

@Component({
  selector: 'app-breeding-form',
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
  templateUrl: './breeding-form.html',
  styleUrl: './breeding-form.css',
})
export class BreedingForm {
  protected writer!: ReturnType<typeof writerDraft>;
  /** The native submit event, as in the event form: no FormsModule here. */
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

  protected readonly fields = FIELDS;
  protected readonly kinds: { value: BreedingKind; label: string }[] = [
    { value: 'insemination', label: 'Record service' },
    { value: 'pregnancy_check', label: 'Record check' },
  ];
  protected readonly serviceTypes: { value: ServiceType; label: string }[] = [
    { value: 'ai', label: 'AI' },
    { value: 'natural_observed', label: 'Bull, seen' },
    { value: 'bull_exposure', label: 'Bull running with her' },
  ];
  protected readonly methods: { value: CheckMethod; label: string }[] = [
    { value: 'palpation', label: 'By hand' },
    { value: 'ultrasound', label: 'Ultrasound' },
    { value: 'pag', label: 'PAG blood' },
    { value: 'progesterone', label: 'Progesterone' },
  ];
  protected readonly results: { value: CheckResult; label: string }[] = [
    { value: 'positive', label: 'Pregnant' },
    { value: 'negative', label: 'Not pregnant' },
  ];
  protected readonly state = new FormState<{ event_id: string; animal: AnimalDetail }>();

  protected readonly kind = signal<BreedingKind | null>(null);
  protected readonly serviceType = signal<ServiceType | null>(null);
  protected readonly exposureDays = signal('');
  protected readonly method = signal<CheckMethod | null>(null);
  protected readonly result = signal<CheckResult | null>(null);
  protected readonly when = signal<DateEntry>({ status: 'empty' });
  protected readonly observedBy = signal('');
  protected readonly overrideReason = signal('');
  /** The one warning saved over on the next submit; cleared after every submit. */
  private readonly allow = signal<BreedingWarning | null>(null);

  protected readonly bullExposure = computed(
    () => this.kind() === 'insemination' && this.serviceType() === 'bull_exposure',
  );

  /** The warning the server just named, if the last refusal was one of the three. */
  protected readonly warning = computed<BreedingWarning | null>(
    () => WARNINGS.find((c) => this.state.hasCode(c)) ?? null,
  );

  private readonly days = computed(() => {
    const v = this.exposureDays().trim();
    return /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : null;
  });

  protected readonly blockedReason = computed(() => {
    const k = this.kind();
    if (k === 'insemination' && this.serviceType() === null) return 'Choose how she was served.';
    if (k === 'pregnancy_check' && this.method() === null) return 'Choose how she was checked.';
    if (k === 'pregnancy_check' && this.result() === null) return 'Choose the result.';
    const date = dateBlocker(this.when(), { label: 'date', required: true });
    if (date) return date;
    if (this.bullExposure() && this.days() === null) {
      return 'Enter the days he stayed, as a whole number.';
    }
    return null;
  });

  protected readonly canSubmit = computed(
    () => this.kind() !== null && this.blockedReason() === null && !this.state.submitting(),
  );

  constructor() {
    this.writer = writerDraft({
      name: 'Breeding event',
      fields: {
        kind: this.kind,
        serviceType: this.serviceType,
        exposureDays: this.exposureDays,
        method: this.method,
        result: this.result,
        when: this.when,
        observedBy: this.observedBy,
        overrideReason: this.overrideReason,
      },
      states: [this.state],
      afterRestore: () => {
        this.dateControl()?.reset();
      },
    });

    void this.identifiers.refresh();
  }

  /** Set only the flag for the warning on screen, and submit. */
  protected saveOver(): void {
    this.allow.set(this.warning());
    void this.submit();
  }

  protected async submit(): Promise<void> {
    const entry = this.when();
    const k = this.kind();
    if (entry.status !== 'complete' || !k || this.blockedReason() !== null) return;
    const w = entry.value;
    const bull = this.bullExposure();
    const allow = this.allow();
    const r = await this.state.runRequest(
      () =>
        [
          {
            animal_id: this.animalId(),
            type: k,
            occurred_on: w.occurred_on,
            occurred_time: bull ? null : w.occurred_time,
            date_precision: w.date_precision,
            payload:
              k === 'insemination'
                ? { service_type: this.serviceType(), exposure_days: bull ? this.days() : null }
                : { method: this.method(), result: this.result() },
            observed_by: blank(this.observedBy()),
            allow_ambiguous_service: allow === 'ambiguous_service',
            allow_early_check: allow === 'early_check',
            allow_check_without_service: allow === 'check_without_service',
            override_reason: blank(this.overrideReason()),
            ...this.session.provenance(),
          },
        ] as const,
      (request, key) => this.api.recordBreedingEvent(request[0], key),
    );
    this.allow.set(null);
    if (r) {
      this.kind.set(null);
      this.serviceType.set(null);
      this.exposureDays.set('');
      this.method.set(null);
      this.result.set(null);
      this.overrideReason.set('');
      this.observedBy.set('');
      void this.identifiers.refresh();
      this.dateControl()?.reset();
      this.when.set({ status: 'empty' });
      this.writer.accept();
      this.saved()?.(r.animal);
      this.writeLog.announce(
        k === 'insemination'
          ? `Recorded a service on ${this.animalId()}.`
          : `Recorded a pregnancy check on ${this.animalId()}.`,
      );
    }
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
