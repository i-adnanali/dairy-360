// Record a service, a heat, a pregnancy check, "nothing seen" or a loss:
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
  ElementRef,
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
import { saveOver } from '../save-over';
import { Session } from '../session';
import { SessionRequired } from '../session-required/session-required';
import { WriteLog } from '../after-write';
import { ChipGroup } from '../chip-group/chip-group';
import { IdentifierInput } from '../identifier-input/identifier-input';
import { Identifiers } from '../identifiers';
import { PrecisionDateControl, dateBlocker } from '../precision-date/precision-date';
import type { DateEntry, PrecisionDate } from '../precision-date/precision-date';
import { readableParts } from '../precision-display';
import type {
  AnimalDetail,
  CheckMethod,
  CheckResult,
  HeatSign,
  ServiceType,
  TimelineEvent,
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

export type BreedingKind = 'insemination' | 'pregnancy_check' | 'heat_observed' | 'null_observation' | 'abortion';

/** The warnings a breeding write can be saved over, and the flag each one sets. */
const OVERRIDES = {
  ambiguous_service: 'allow_ambiguous_service',
  early_check: 'allow_early_check',
  check_without_service: 'allow_check_without_service',
  no_heat_sign: 'allow_no_heat_sign',
  heat_after_positive: 'allow_heat_after_positive',
} as const;
type BreedingWarning = keyof typeof OVERRIDES;

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
  /**
   * The kind to open on (the Breeding page's buttons); null opens on none.
   * Read once, on init (and as the kind to return to after a save): changing
   * it later does not switch an open form.
   */
  readonly initialKind = input<BreedingKind | null>(null);
  readonly saved = input<((d: AnimalDetail) => void) | null>(null);
  /**
   * The effective event this form corrects, or null for a new event. Read once,
   * on init: the form opens on its kind (locked), prefilled with its values, and
   * the POST names it in `supersedes_id`. The original row is never changed.
   * The parent must remount the form after `saved`: a form left mounted would
   * still name the corrected event, and its next save would be refused as
   * already superseded.
   */
  readonly correcting = input<TimelineEvent | null>(null);

  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  protected readonly identifiers = inject(Identifiers);
  private readonly writeLog = inject(WriteLog);

  private readonly dateControl = viewChild(PrecisionDateControl);
  private readonly noticeMessages = viewChild<ElementRef<HTMLElement>>('noticeMessages');

  protected readonly fields = FIELDS;
  protected readonly kinds: { value: BreedingKind; label: string }[] = [
    { value: 'insemination', label: 'Record service' },
    { value: 'heat_observed', label: 'Record heat' },
    { value: 'pregnancy_check', label: 'Record check' },
    { value: 'null_observation', label: 'Nothing seen' },
    { value: 'abortion', label: 'Record a loss' },
  ];
  protected readonly saveLabel: Record<BreedingKind, string> = {
    insemination: 'Save service',
    heat_observed: 'Save heat',
    pregnancy_check: 'Save check',
    null_observation: 'Save',
    abortion: 'Save loss',
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
  /** While correcting, the event's kind is the only chip: the kind cannot change. */
  protected readonly kindOptions = computed(() => {
    const c = this.correcting();
    return c ? this.kinds.filter((o) => o.value === c.type) : this.kinds;
  });
  protected readonly correctingLine = computed(() => {
    const c = this.correcting();
    if (!c) return null;
    const word = CORRECTING_WORD[c.type as BreedingKind];
    const date = readableParts(c.occurred_on, c.date_precision).figure;
    return `Correcting the ${word} of ${date}. The original stays on her record.`;
  });
  /** The corrected event's date, handed to the date control to show and read back. */
  protected readonly initialDate = signal<PrecisionDate | null>(null);
  protected readonly dateResetKey = signal(0);
  /** Set until the date control hands back the prefilled date: that is the baseline. */
  private baselinePending = false;

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

  /** "Nothing seen" is dated to the day; a bull's stay and a loss have no time either. */
  protected readonly allowTime = computed(
    () => !this.bullExposure() && this.kind() !== 'null_observation' && this.kind() !== 'abortion',
  );

  /** The override notice: the warnings on screen, and what a save-over sends. */
  private readonly over = saveOver(this.state, OVERRIDES, this.noticeMessages);
  protected readonly warnings = this.over.warnings;
  protected readonly canSaveOver = this.over.canSaveOver;
  protected readonly lock = this.over.lock;

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
        // A correction's baseline is the event's date: show it again, not an empty field.
        if (this.correcting()) this.dateResetKey.update((n) => n + 1);
        else this.dateControl()?.reset();
      },
    });

    void this.identifiers.refresh();
  }

  /** Opening on a kind is where the form starts, not an unsaved change. */
  ngOnInit(): void {
    const c = this.correcting();
    if (c) {
      this.prefill(c);
      return;
    }
    const k = this.initialKind();
    if (k !== null && this.kind() === null) {
      this.kind.set(k);
      this.writer.accept();
    }
  }

  /**
   * A correction opens on the event's values, and those are where the form
   * starts, not an unsaved change. The date arrives from the date control after
   * it reads `initialDate`, so the baseline is taken then (see onDate).
   */
  private prefill(c: TimelineEvent): void {
    const p = c.payload;
    const str = <T extends string>(key: string): T | null =>
      typeof p[key] === 'string' ? (p[key] as T) : null;
    this.kind.set(c.type as BreedingKind);
    this.serviceType.set(str<ServiceType>('service_type'));
    this.exposureDays.set(typeof p['exposure_days'] === 'number' ? String(p['exposure_days']) : '');
    this.method.set(str<CheckMethod>('method'));
    this.result.set(str<CheckResult>('result'));
    this.sign.set(str<HeatSign>('sign'));
    this.watchedFor.set(str<WatchedFor>('watched_for'));
    this.observedBy.set(c.observed_by ?? '');
    this.initialDate.set({
      occurred_on: c.occurred_on,
      date_precision: c.date_precision,
      occurred_time: c.occurred_time,
    });
    this.baselinePending = true;
  }

  protected onDate(entry: DateEntry): void {
    this.when.set(entry);
    if (this.baselinePending && entry.status !== 'empty') {
      this.baselinePending = false;
      this.writer.accept();
    }
  }

  protected setKind(k: string): void {
    if (!this.correcting()) this.kind.set(k as BreedingKind);
  }

  /** Submit with the flags of the warnings on screen set, and only those. */
  protected saveOver(): void {
    if (!this.canSaveOver()) return;
    void this.submit(this.over.shown());
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
    const correcting = this.correcting();
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
            ...this.over.flags(allow),
            override_reason: blank(this.overrideReason()),
            ...(correcting ? { supersedes_id: correcting.id } : {}),
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
      this.writeLog.announce(
        correcting
          ? `Corrected the ${CORRECTING_WORD[k]} on ${this.animalId()}.`
          : `Recorded ${RECORDED[k]} on ${this.animalId()}.`,
      );
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
      case 'abortion':
        return {};
    }
  }
}

/** "Correcting the … of {date}" and "Corrected the … on {animal}". */
const CORRECTING_WORD: Record<BreedingKind, string> = {
  insemination: 'service',
  heat_observed: 'heat',
  pregnancy_check: 'pregnancy check',
  null_observation: '“nothing seen” entry',
  abortion: 'loss',
};

const RECORDED: Record<BreedingKind, string> = {
  insemination: 'a service',
  pregnancy_check: 'a pregnancy check',
  heat_observed: 'a heat',
  null_observation: 'nothing seen',
  abortion: 'a loss',
};

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
