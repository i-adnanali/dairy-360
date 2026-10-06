import { attachmentBase64, revisionLines, vaccinationRows, type HealthBoard, type HealthRevision, type VaccinationRound, type VaccinationRow } from '../health-workflows';
import type { HerdRow } from '../types';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithdrawalNotices } from "../withdrawal-notices/withdrawal-notices";
import { precisionParts } from "../precision-display";
import { FormState } from "../form-state";
import { PrecisionDateControl, DateEntry, PrecisionDate, dateBlocker } from "../precision-date/precision-date";
import { DraftRegistry } from "../draft-registry";
import { LocalPagination } from "../../ui/local-pagination/local-pagination";
import { SessionRequired } from "../session-required/session-required";
import {
  Component,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { RegistryApi } from "../api";
import { Session } from "../session";
import { ShellActions } from "../navigation";
import { farmToday } from "../today";
import { HEALTH_FIELDS, healthLabel, healthWords, type HealthRecord, type HealthEntityRecord, type HealthEditorDraft } from "../health-model";
import { Button } from "../../ui/button";
import { TextInput } from "../../ui/input";
import { Card, ErrorPanel } from "../../ui/surface";
import { PageHeading } from "../../ui/heading";
import { FieldLabel, HelpText } from "../../ui/text";

@Component({
  selector: 'app-health-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WithdrawalNotices,
    PrecisionDateControl,
    LocalPagination,
    SessionRequired,
    FormsModule,
    RouterLink,
    Button,
    TextInput,
    Card,
    ErrorPanel,
    PageHeading,
    FieldLabel,
    HelpText,
  ],

  templateUrl: './health-page.html',
  styleUrl: './health-page.css',
})
export class HealthPage {
  private api = inject(RegistryApi);
  protected session = inject(Session);
  private shell = inject(ShellActions);
  private route = inject(ActivatedRoute);
  protected board = signal<HealthBoard | null>(null);
  protected animals = signal<HerdRow[]>([]);
  protected records = signal<HealthRecord[]>([]);
  protected catalog = signal<Record<string, HealthRecord[]>>({});
  protected error = signal('');
  protected conflictRecord = signal<HealthRecord | null>(null);
  protected notice = signal('');
  protected busy = signal(false);
  protected revisions = signal<HealthRevision[]>([]);
  protected fields = HEALTH_FIELDS;
  protected showDoseExceptions = false;
  protected showField(key: string) {
    if (this.editEntity !== 'administrations') return true;
    if (this.form[key] || this.writeState.fieldError(key)) return true;
    if (key === 'unknown_reason') return !!this.form.details_unknown;
    if (key === 'external_history_reason' || key === 'duplicate_reason') return this.showDoseExceptions;
    return true;
  }
  protected entities = Object.keys(HEALTH_FIELDS);
  protected entity = 'visits';
  protected editEntity = 'visits';
  protected form: HealthEditorDraft = {};
  protected editing: HealthRecord | null = null;
  protected editorOpen = false;
  protected referenceSearch: Record<string, string> = {};
  protected filteredOptions(reference: string, key: string) {
    const search = (this.referenceSearch[key] ?? '').trim().toLowerCase();
    return this.options(reference).filter(r => r.id === this.form[key] || this.label(r).toLowerCase().includes(search));
  }
  protected roundSearch = '';
  protected selectedRoundCount() { return Object.values(this.roundRows).filter((r) => !!r.disposition).length; }
  protected roundMatches(a: {id: string; name?: string | null}) {
    return !!this.roundRows[a.id]?.disposition || (a.id + ' ' + (a.name ?? '')).toLowerCase().includes(this.roundSearch.trim().toLowerCase());
  }
  protected on = farmToday();
  protected animalFilter = '';
  protected taskFilter = '';
  protected standingFilter = '';
  protected readonly standings = ['overdue', 'due', 'upcoming'] as const;
  protected assigneeFilter = '';
  protected targets = ['milk_withdrawal', 'meat_withdrawal'] as const;
  protected actionTask: HealthRecord | null = null;
  protected action = 'defer';
  protected actionReason = '';
  protected newDue = '';
  protected roundOpen = false;
  protected round: VaccinationRound = {};
  protected roundRows: Record<string, VaccinationRow> = {};
  protected roundConfirmed = false;
  private draftBaseline = '';
  protected savedView = false;
  protected dateGeneration = 0;
  protected initialDate: PrecisionDate | null = null;
  protected dateEntry: DateEntry = { status: 'empty' };
  protected readonly writeState = new FormState<any>();
  protected uploadStatus = '';
  private pendingAttachment: File | null = null;
  private retryAction: (() => Promise<void>) | null = null;
  protected locked() {
    return this.busy() || this.writeState.uncertain();
  }
  private setDate() {
    if (this.form.occurred_on) this.form.occurred_time ??= null;
    this.initialDate = this.form.occurred_on && this.form.date_precision
      ? {
          occurred_on: this.form.occurred_on,
          date_precision: this.form.date_precision,
          occurred_time: this.form.occurred_time ?? null,
        }
      : null;
    this.dateEntry = this.initialDate
      ? { status: 'complete', value: this.initialDate, reading: '' }
      : { status: 'empty' };
    this.dateGeneration++;
  }
  protected dateChanged(entry: DateEntry) {
    this.dateEntry = entry;
    if (entry.status === 'complete') Object.assign(this.form, entry.value);
    else if (entry.status === 'empty') {
      delete this.form.occurred_on;
      delete this.form.date_precision;
      delete this.form.occurred_time;
    }
  }
  protected beginCorrection() {
    if (!this.locked()) {
      this.savedView = false;
      setTimeout(() => this.focusEditor());
    }
  }
  protected meaningfulChange() {
    if (!this.editing) return this.hasUnsavedChanges();
    const payload = (value: HealthEditorDraft) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key]) =>
                ![
                  'correction_reason',
                  'recorded_by',
                  'source_form',
                  'recorded_at',
                  'updated_at',
                  'revision',
                ].includes(key),
            )
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
    return (
      payload({ ...this.form, occurred_time: this.form.occurred_time ?? null }) !==
      payload({ ...this.editing, occurred_time: this.editing['occurred_time'] ?? null })
    );
  }
  private async write<T>(path: string, body: unknown): Promise<T> {
    const value = await this.writeState.runRequest(
      () => ({ path, body }),
      (request, key) => this.api.healthWrite<T>(request.path, request.body, key),
    );
    if (value === null) throw this.writeState.error();
    return value as T;
  }
  protected label = healthLabel;
  protected words = healthWords;
  private readonly drafts = inject(DraftRegistry);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private loadGeneration = 0;
  private sourceOpened: string | null = null;
  private editorOrigin: HTMLElement | null = null;
  constructor() {
    inject(DestroyRef).onDestroy(() => ++this.loadGeneration);
    this.drafts.register(
      {
        owner: 'health',
        context: () => this.editEntity + '/' + (this.editing?.id ?? 'new'),
        description: () =>
          this.writeState.uncertain() ? 'The health save outcome is unknown. Resolve it before leaving.' : this.locked() ? 'The health record is being saved. Wait for its result.' : (this.roundOpen ? 'Vaccination round' : this.actionTask ? 'Health task change' : this.editEntity === 'administrations' ? 'Dose record' : this.entityLabel(this.editEntity, true)) + (this.form.animal_id ? ' for ' + this.form.animal_id : '') + ': these changes have not been saved.',
        snapshot: () =>
          JSON.stringify([
            this.form,
            this.round,
            this.roundRows,
            this.roundConfirmed,
            this.action,
            this.actionReason,
            this.newDue,
          ]),
        baseline: () => this.draftBaseline,
        dirty: () => this.hasUnsavedChanges(),
        pending: () => this.locked(),
        unresolved: () => this.writeState.uncertain(),
        discard: () => this.resetDrafts(),
        replaces: (url) => new URL(url, 'http://local').pathname !== '/animals/health',
      },
      inject(DestroyRef),
    );
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(() => { void this.load(); });
  }
  ngDoCheck() {
    this.drafts.syncUnload();
  }
  protected async load() {
    const generation = ++this.loadGeneration;
    this.error.set('');
    try {
      const [b, a, ...lists] = await Promise.all([
        this.api.healthGet<HealthBoard>('health/board?on=' + this.on),
        this.api.herd(),
        ...this.entities.map((e) => this.api.healthGet<HealthEntityRecord[]>('health/' + e)),
      ]);
      if (generation !== this.loadGeneration) return;
      this.board.set(b);
      this.animals.set(a);
      const c: Record<string, HealthRecord[]> = {};
      this.entities.forEach((e, i) => (c[e] = lists[i] as HealthRecord[]));
      this.catalog.set(c);
      this.records.set(c[this.entity]);
      const record = this.route.snapshot.queryParamMap.get('record');
      if (record && record !== this.sourceOpened) {
        const source = c['administrations']?.find((r) => r.id === record);
        if (source) {
          if (await this.edit(source, () => generation === this.loadGeneration)) this.sourceOpened = record;
        }
        else this.notice.set('The source recorded dose is not available in the current records.');
      }
      if (!record) this.sourceOpened = null;
      if (generation !== this.loadGeneration) return;
      for (const animal of a) this.roundRows[animal.id] ??= { disposition: '' };
    } catch (e) {
      if (generation !== this.loadGeneration) return;
      this.error.set(String(e));
    }
  }
  protected loadRecords() {
    this.records.set(this.catalog()[this.entity] ?? []);
  }
  protected visibleTasks() {
    return (this.board()?.tasks ?? [])
      .filter(
        (t) =>
          (this.standingFilter ? t.standing === this.standingFilter : t.status === 'pending') &&
          (!this.animalFilter || t.animal_id === this.animalFilter) &&
          (!this.taskFilter || t.kind === this.taskFilter) &&
          (!this.standingFilter || t.standing === this.standingFilter) &&
          (!this.assigneeFilter ||
            String(t.assignee ?? '')
              .toLowerCase()
              .includes(this.assigneeFilter.toLowerCase())),
      )
      .sort((a, b) => {
        const rank: Record<string, number> = { overdue: 0, due: 1, upcoming: 2 };
        return (
          (rank[a.standing] ?? 3) - (rank[b.standing] ?? 3) ||
          String(a.due_on).localeCompare(String(b.due_on)) ||
          String(a.due_time ?? '').localeCompare(String(b.due_time ?? '')) ||
          String(a.id).localeCompare(String(b.id))
        );
      });
  }
  protected openSource(id: string) {
    const source = this.catalog()['administrations']?.find((r) => r.id === id);
    if (source) void this.edit(source);
    else this.notice.set('The source recorded dose is not available in the current records.');
  }
  protected entityLabel(entity: string, singular = false) {
    const labels: Record<string, [string, string]> = {
      visits: ['Veterinary visits', 'veterinary visit'],
      examinations: ['Examinations', 'examination'],
      cases: ['Health cases', 'health case'],
      products: ['Medicines and vaccines', 'medicine or vaccine'],
      plans: ['Treatment and vaccination plans', 'treatment or vaccination plan'],
      tasks: ['Scheduled tasks', 'scheduled task'],
      administrations: ['Recorded doses', 'recorded dose'],
      results: ['Test results', 'test result'],
      costs: ['Health costs', 'health cost'],
    };
    return labels[entity]?.[singular ? 1 : 0] ?? this.words(entity);
  }
  protected taskKind(kind: string) {
    return (
      ({ administration: 'Dose', recheck: 'Recheck', test: 'Test' } as Record<string, string>)[
        kind
      ] ?? this.words(kind)
    );
  }
  protected taskStatus(status: string) {
    return (
      (
        {
          due: 'Due today',
          overdue: 'Overdue',
          upcoming: 'Upcoming',
          completed: 'Completed',
          cancelled: 'Cancelled',
          missed: 'Missed',
          deferred: 'Deferred',
        } as Record<string, string>
      )[status] ?? this.words(status)
    );
  }
  protected visibleRecords() {
    return this.records().filter(
      (r) => !this.animalFilter || !r.animal_id || r.animal_id === this.animalFilter,
    );
  }
  protected options(ref: string): HealthRecord[] {
    if (ref === 'animals')
      return this.animals().map((a) => ({
        id: a.id,
        name: a.name,
        animal_id: a.id,
        entity: 'animal',
        revision: 0,
        title: a.name || 'Unnamed',
      }));
    return (this.catalog()[ref] ?? []).filter(
      (r) =>
        !r.archived &&
        (!this.form.animal_id || !r.animal_id || r.animal_id === this.form.animal_id),
    );
  }
  protected async create(entity: string, initial: HealthEditorDraft = {}) {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return false;
    this.resetDrafts();
    this.showDoseExceptions = false;
    this.editorOrigin = document.activeElement as HTMLElement;
    this.editEntity = entity;
    this.editing = null;
    this.savedView = false;
    this.form = {
      ...initial,
      animal_id: initial['animal_id'] ?? this.animalFilter,
      attachment_ids: [],
      milk_withdrawal: { state: 'unknown' },
      meat_withdrawal: { state: 'unknown' },
    };
    this.setDate();
    this.draftBaseline = JSON.stringify(this.form);
    this.referenceSearch = {};
    this.editorOpen = true;
    this.changeDetector.markForCheck();

    this.error.set('');
    setTimeout(() => this.focusEditor());
    return true;
  }
  protected async edit(r: HealthRecord, stillCurrent = () => true) {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return false;
    if (!stillCurrent()) return false;
    this.resetDrafts();
    this.showDoseExceptions = false;
    this.editorOrigin = document.activeElement as HTMLElement;
    this.editEntity = r.entity;
    this.editing = structuredClone(r);
    this.savedView = true;
    this.form = structuredClone(r);
    this.form.correction_reason = '';
    this.setDate();
    this.draftBaseline = JSON.stringify(this.form);
    this.referenceSearch = {};
    this.editorOpen = true;
    this.changeDetector.markForCheck();

    setTimeout(() => this.focusEditor());
    return true;
  }
  hasUnsavedChanges() {
    return (
      this.pendingAttachment !== null ||
      (this.editorOpen &&
        (JSON.stringify(this.form) !== this.draftBaseline ||
          this.dateEntry.status === 'incomplete')) ||
      (this.roundOpen &&
        (this.roundConfirmed ||
          Object.keys(this.round).length > 0 ||
          Object.values(this.roundRows).some((r) =>
            Object.values(r).some((value) => value !== '' && value != null),
          ))) ||
      !!(this.actionTask && (this.action !== 'defer' || this.actionReason || this.newDue))
    );
  }
  canLeave() {
    return this.drafts.request((p) => p.owner === 'health');
  }
  private resetDrafts() {
    this.editorOpen = false;
    this.actionTask = null;
    this.roundOpen = false;
    this.pendingAttachment = null;
    this.uploadStatus = '';
    this.form = {};
    this.dateEntry = { status: 'empty' };
    this.savedView = false;
    this.round = {};
    this.roundConfirmed = false;
    this.roundRows = Object.fromEntries(this.animals().map((a) => [a.id, { disposition: '' }]));
    this.action = 'defer';
    this.actionReason = '';
    this.newDue = '';

    this.changeDetector.markForCheck();
  }
  private focusEditor() {
    const editor = document.getElementById('health-editor');
    editor?.scrollIntoView?.({ block: 'nearest' });
    const target =
      editor?.querySelector<HTMLElement>('h3') ??
      editor?.querySelector<HTMLElement>('input, select, textarea');
    if (target) {
      if (target.tagName === 'H3') target.tabIndex = -1;
      target.focus();
    }
  }
  protected async closeDrafts() {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.showDoseExceptions = false;
    this.editorOrigin?.focus();
  }
  protected closeEditor() {
    return this.closeDrafts();
  }
  protected async openRound() {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.showDoseExceptions = false;
    this.editorOrigin = document.activeElement as HTMLElement;
    this.roundOpen = true;
    setTimeout(() => document.querySelector<HTMLElement>('#health-round select')?.focus());
  }
  protected async openAction(t: HealthRecord) {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.showDoseExceptions = false;
    this.editorOrigin = document.activeElement as HTMLElement;
    this.actionTask = t;
    setTimeout(() => document.querySelector<HTMLElement>('#health-action select')?.focus());
  }
  protected referenceChanged(key: string) {
    if (key === 'product_id') {
      const p = this.catalog()['products']?.find((p) => p.id === this.form.product_id);
      if (p) {
        this.form.product_name = p.name ?? undefined;
        this.form.kind = p.kind;
      }
    }
  }
  private provenance() {
    if (!this.session.ready()) {
      this.session.requestSetup();
      throw new Error('Start a recording session, then save again.');
    }
    return { recorded_by: this.session.recordedBy(), source_form: this.session.sourceForm() };
  }
  protected retryLast() {
    if (this.retryAction) return this.run(this.retryAction);
    return Promise.resolve();
  }
  private async run(fn: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const action = this.writeState.uncertain() && this.retryAction ? this.retryAction : fn;
      this.retryAction = action;
      await action();
      this.retryAction = null;
      this.shell.refresh();
    } catch (e) {
      this.error.set(String(e));
      if (this.uploadStatus.startsWith('Uploading'))
        this.uploadStatus = this.writeState.uncertain()
          ? 'Upload outcome unknown. Retry the same request to recover the attachment before linking it.'
          : 'Upload failed. The attachment has not been linked to this record.';
      setTimeout(() => document.querySelector<HTMLElement>('[role=alert]')?.focus());
    } finally {
      this.busy.set(false);
    }
  }
  protected async save() {
    if (!this.writeState.uncertain()) {
      if (this.savedView || !this.meaningfulChange()) return;
      if (this.fields[this.editEntity].some((f) => f.key === 'date_precision')) {
        const error = dateBlocker(this.dateEntry, { label: 'record date', required: true });
        if (error) {
          this.error.set(error);
          this.focusEditor();
          return;
        }
      }
    }
    await this.run(async () => {
      const b: Record<string, unknown> = { ...this.form, ...this.provenance(), expected_revision: this.editing?.revision };
      if (this.editEntity === 'costs' && b['amount_minor'] === '')
        b['amount_minor'] = null;
      if (this.editEntity === 'costs' && b['amount_minor'] === undefined)
        b['amount_minor'] = null;

      const r = await this.write<HealthRecord>(
        'health/' + this.editEntity + (this.editing ? '/' + this.editing.id + '/revise' : ''),
        b,
      );

      this.editing = r;
      this.form = structuredClone(r);
      this.form.correction_reason = '';
      this.savedView = true;
      this.setDate();
      this.draftBaseline = JSON.stringify(this.form);
      this.notice.set('Record saved.');
      await this.load();
    });
  }
  protected async voidRecord() {
    await this.run(async () => {
      if (!this.editing) return;
      if (!this.form.correction_reason?.trim()) throw new Error('Enter the reason before voiding.');
      if (
        !this.writeState.uncertain() &&
        !(await this.drafts.confirm(
          'Void this record?',
          this.label(this.editing) +
            ' · ' +
            (this.editing.occurred_on ?? this.editing.due_on ?? '') +
            '. Its history will remain available.',
          'Void record',
        ))
      )
        return;
      await this.write('health/' + this.editEntity + '/' + this.editing.id + '/void', {
        ...this.provenance(),
        reason: this.form.correction_reason,
        expected_revision: this.editing.revision,
      });
      this.editorOpen = false;
      this.notice.set('Record voided; audit history retained.');
      await this.load();
    });
  }
  protected async complete(t: HealthRecord) {
    const created = await this.create(t.kind === 'administration' ? 'administrations' : 'results', {
      animal_id: t.animal_id,
      task_id: t.id,
      plan_id: t.plan_id,
      visit_id: t.visit_id,
      product_id: t.product_id,
      kind: t.kind === 'test' ? 'test' : t.kind === 'recheck' ? 'follow_up' : undefined,
    });
    if (created) this.referenceChanged('product_id');
  }
  protected async saveAction() {
    await this.run(async () => {
      if (!this.actionTask) return;

      await this.write('health/tasks/' + this.actionTask.id + '/actions', {
        ...this.provenance(),
        expected_revision: this.actionTask.revision,
        action: this.action,
        reason: this.actionReason,
        due_on: this.newDue,
      });

      this.actionTask = null;
      await this.load();
    });
  }
  protected recordObjects(r: HealthRecord) {
    return Object.entries(r)
      .filter(([, value]) => value !== null && typeof value === 'object')
      .map(([key, value]) => ({ key, value: JSON.stringify(value, null, 2) }));
  }
  protected recordLines(r: HealthRecord) {
    return Object.entries(r)
      .filter(([k, v]) => v !== null && typeof v !== 'object' && k !== 'date_precision')
      .map(([k, v]) => {
        if (k === 'occurred_on') {
          const date = precisionParts(v as string, r.date_precision ?? null);
          return 'Date: ' + date.figure + (date.qualifier ? ' ' + date.qualifier : '');
        }
        return `${healthWords(k)}: ${v}`;
      });
  }
  protected async reviewConflict() {
    if (!this.editing) return;
    const entity = this.editEntity,
      id = this.editing.id;
    try {
      const latest = await this.api.healthGet<HealthRecord>('health/' + entity + '/' + id);
      if (this.editEntity === entity && this.editing?.id === id) this.conflictRecord.set(latest);
    } catch (error) {
      if (this.editEntity === entity && this.editing?.id === id) this.error.set(String(error));
    }
  }
  protected async acceptRevision(r: HealthRecord) {
    if (this.locked()) return;
    if (this.hasUnsavedChanges() && !(await this.canLeave())) return;
    await this.edit(r);
    this.conflictRecord.set(null);
    this.writeState.reset();
    this.notice.set('Latest saved revision loaded.');
  }
  protected async history(r: HealthRecord) {
    try {
      this.revisions.set(
        await this.api.healthGet<HealthRevision[]>('health/' + r.entity + '/' + r.id + '/revisions'),
      );
    } catch (e) {
      this.error.set(String(e));
    }
  }
  protected readonly revisionLines = revisionLines;
  protected async upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.locked()) return;
    this.pendingAttachment = file;
    await this.uploadSelected();
  }
  protected async uploadSelected() {
    const file = this.pendingAttachment;
    if (!file) return;
    await this.run(async () => {
      this.uploadStatus = 'Uploading ' + file.name + '…';
      const p = this.provenance();
      const base64 = await attachmentBase64(file, (this.form.attachment_ids ?? []).length);
      const a = await this.write<{ id: string }>('health/attachments', { ...p, filename: file.name, base64 });
      this.form.attachment_ids = [...(this.form.attachment_ids ?? []), a.id];
      this.pendingAttachment = null;
      this.uploadStatus = 'Attachment stored. Save the record to link it.';
    });
  }
  protected async saveRound() {
    await this.run(async () => {
      const rows = vaccinationRows(this.roundRows);

      await this.write('health/rounds', {
        ...this.provenance(),
        confirmed: this.roundConfirmed,
        shared: { ...this.round, date_precision: 'day', kind: 'vaccine' },
        rows,
      });

      this.roundOpen = false;
      this.round = {};
      this.roundRows = {};
      this.roundConfirmed = false;
      this.notice.set('Vaccination round saved.');
      await this.load();
    });
  }
}
