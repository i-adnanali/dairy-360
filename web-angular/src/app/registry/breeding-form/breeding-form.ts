// Record a service, a heat, a pregnancy check or "nothing seen":
// POST /breeding/events.
//
// Built on the event form's structure (FormState, its override notice,
// writerDraft, PrecisionDateControl, ChipGroup, WriteLock), not a second
// badge, date or override system. The breeding warnings are saved over the way
// a departed animal is: the server names each warning by its code, and the
// button sets only the flags of the warnings on screen, for one submit.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
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
import type {
  AnimalDetail,
  CheckMethod,
  CheckResult,
  HeatSign,
  ServiceType,
  WatchedFor,
} from '../types';
import { Card } from '../../ui/surface';
import { ErrorPanel } from '../../ui/surface';
import { ErrorText } from '../../ui/surface';
import { FieldLabel } from '../../ui/text';
import { HelpText } from '../../ui/text';
import { TextInput } from '../../ui/input';
import { SectionLabel } from '../../ui/text';
import { Button } from '../../ui/button';

type BreedingKind = 'insemination' | 'pregnancy_check' | 'heat_observed' | 'null_observation';

/** The warnings a breeding write can be saved over, and the flag each one sets. */
const OVERRIDES = {
  ambiguous_service: 'allow_ambiguous_service',
  early_check: 'allow_early_check',
  check_without_service: 'allow_check_without_service',
  no_heat_sign: 'allow_no_heat_sign',
  heat_after_positive: 'allow_heat_after_positive',
} as const;
type BreedingWarning = keyof typeof OVERRIDES;
const WARNINGS = Object.keys(OVERRIDES) as BreedingWarning[];
const isWarning = (code: string): code is BreedingWarning =>
  (WARNINGS as string[]).includes(code);

/** Two or more warnings fired at once come back under this code, each listed. */
const SEVERAL = 'breeding_warnings';

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
export class BreedingForm implements OnInit {
  protected writer!: ReturnType<typeof writerDraft>;
  /** The native submit event, as in the event form: no FormsModule here. */
  protected onSubmit(e: Event): void {
    e.preventDefault();
    this.submit();
  }

  readonly animalId = input.required<string>();
  /** The kind to open on (the Breeding page's buttons); null opens on none. */
  readonly initialKind = input<BreedingKind | null>(null);
  readonly saved = input<((d: AnimalDetail) => void) | null>(null);

  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  protected readonly identifiers = inject(Identifiers);
  private readonly writeLog = inject(WriteLog);

  private readonly dateControl = viewChild(PrecisionDateControl);

  protected readonly fields = FIELDS;
  protected readonly kinds: { value: BreedingKind; label: string }[] = [
    { value: 'insemination', label: 'Record service' },
    { value: 'heat_observed', label: 'Record heat' },
    { value: 'pregnancy_check', label: 'Record check' },
    { value: 'null_observation', label: 'Nothing seen' },
  ];
  protected readonly saveLabel: Record<BreedingKind, string> = {
    insemination: 'Save service',
    heat_observed: 'Save heat',
    pregnancy_check: 'Save check',
    null_observation: 'Save',
  };
  protected readonly signs: { value: HeatSign; label: string }[] = [
    { value: 'standing', label: 'Standing' },
    { value: 'mucus', label: 'Mucus' },
    { value: 'restless', label: 'Restless' },
    { value: 'other', label: 'Other' },
  ];
  protected readonly watchedFors: { value: WatchedFor; label: string }[] = [
    { value: 'heat', label: 'Heat' },
    { value: 'pregnancy_check', label: 'Pregnancy check' },
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
  protected readonly sign = signal<HeatSign | null>(null);
  protected readonly watchedFor = signal<WatchedFor | null>(null);
  protected readonly when = signal<DateEntry>({ status: 'empty' });
  protected readonly observedBy = signal('');
  protected readonly overrideReason = signal('');

  protected readonly bullExposure = computed(
    () => this.kind() === 'insemination' && this.serviceType() === 'bull_exposure',
  );

  /** "Nothing seen" is dated to the day; a bull's stay has no time either. */
  protected readonly allowTime = computed(
    () => !this.bullExposure() && this.kind() !== 'null_observation',
  );

  /**
   * Every warning the last refusal carried: the listed ones under
   * `breeding_warnings`, or the single one named by its own code (whose body
   * may list it too, or not). Empty when the refusal is not a warning.
   */
  protected readonly warnings = computed<{ check: string; message: string }[]>(() => {
    const e = this.state.error();
    if (!e || !e.isRefusal) return [];
    if (e.code === SEVERAL) return e.warnings ?? [];
    if (!isWarning(e.code)) return [];
    return e.warnings?.length ? e.warnings : [{ check: e.code, message: e.message }];
  });

  /** The codes on screen that have a flag: exactly what a save-over sets. */
  private readonly shownCodes = computed(() =>
    this.warnings()
      .map((w) => w.check)
      .filter(isWarning),
  );

  /**
   * What WriteLock sees. A warning is shown once, in the override notice, so
   * WriteLock is not handed it to print again as a red line of its own.
   */
  protected readonly lock = {
    locked: () => this.state.locked(),
    uncertain: () => this.state.uncertain(),
    error: () => (this.warnings().length > 0 ? null : this.state.error()),
  };

  private readonly days = computed(() => {
    const v = this.exposureDays().trim();
    return /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : null;
  });

  protected readonly blockedReason = computed(() => {
    const k = this.kind();
    if (k === 'insemination' && this.serviceType() === null) return 'Choose how she was served.';
    if (k === 'pregnancy_check' && this.method() === null) return 'Choose how she was checked.';
    if (k === 'pregnancy_check' && this.result() === null) return 'Choose the result.';
    if (k === 'heat_observed' && this.sign() === null) return 'Choose what you saw.';
    if (k === 'null_observation' && this.watchedFor() === null) {
      return 'Choose what was watched for.';
    }
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
        sign: this.sign,
        watchedFor: this.watchedFor,
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

  /** Opening on a kind is where the form starts, not an unsaved change. */
  ngOnInit(): void {
    const k = this.initialKind();
    if (k !== null && this.kind() === null) {
      this.kind.set(k);
      this.writer.accept();
    }
  }

  /** Submit with the flags of the warnings on screen set, and only those. */
  protected saveOver(): void {
    void this.submit(this.shownCodes());
  }

  /**
   * `allow` is an argument, not form state: a flag held between calls survived
   * a save-over that sent nothing (an early return) and rode on the next plain save.
   */
  protected async submit(allow: readonly BreedingWarning[] = []): Promise<void> {
    const entry = this.when();
    const k = this.kind();
    if (entry.status !== 'complete' || !k || this.blockedReason() !== null) return;
    const w = entry.value;
    const bull = this.bullExposure();
    const timed = this.allowTime();
    const r = await this.state.runRequest(
      () =>
        [
          {
            animal_id: this.animalId(),
            type: k,
            occurred_on: w.occurred_on,
            occurred_time: timed ? w.occurred_time : null,
            date_precision: w.date_precision,
            payload: this.payload(k, bull),
            observed_by: blank(this.observedBy()),
            ...Object.fromEntries(WARNINGS.map((c) => [OVERRIDES[c], allow.includes(c)])),
            override_reason: blank(this.overrideReason()),
            ...this.session.provenance(),
          },
        ] as const,
      (request, key) => this.api.recordBreedingEvent(request[0], key),
    );
    if (r) {
      this.kind.set(this.initialKind());
      this.serviceType.set(null);
      this.exposureDays.set('');
      this.method.set(null);
      this.result.set(null);
      this.sign.set(null);
      this.watchedFor.set(null);
      this.overrideReason.set('');
      this.observedBy.set('');
      void this.identifiers.refresh();
      this.dateControl()?.reset();
      this.when.set({ status: 'empty' });
      this.writer.accept();
      this.saved()?.(r.animal);
      this.writeLog.announce(`Recorded ${RECORDED[k]} on ${this.animalId()}.`);
    }
  }

  private payload(k: BreedingKind, bull: boolean): Record<string, unknown> {
    switch (k) {
      case 'insemination':
        return { service_type: this.serviceType(), exposure_days: bull ? this.days() : null };
      case 'pregnancy_check':
        return { method: this.method(), result: this.result() };
      case 'heat_observed':
        return { sign: this.sign() };
      case 'null_observation':
        return { watched_for: this.watchedFor() };
    }
  }
}

const RECORDED: Record<BreedingKind, string> = {
  insemination: 'a service',
  pregnancy_check: 'a pregnancy check',
  heat_observed: 'a heat',
  null_observation: 'nothing seen',
};

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
