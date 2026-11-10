import { Segmented, TabBar } from "../../ui/selection";
import { attachmentBase64, vaccinationRows, type HealthTask, type HealthBoard, type HealthRevision, type VaccinationRound, type VaccinationRow } from '../health-workflows';
import type { HerdRow } from '../types';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithdrawalNotices } from "../withdrawal-notices/withdrawal-notices";
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
  ElementRef,
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
import { Card, ErrorPanel, StatusBadge } from "../../ui/surface";
import { IdentifierLink } from "../../ui/navigation";
import { NgTemplateOutlet } from '@angular/common';
import { feedDay } from "../feed-format";
import { PageHeading } from "../../ui/heading";
import { FieldLabel, HelpText } from "../../ui/text";
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { HostListener } from '@angular/core';
import { healthDate, healthView, recordedText, revisionView, type HealthView, type RevisionView } from "../health-view";
import { SOURCE_FORMS, feedLabel } from "../feed-format";

@Component({
  selector: 'app-health-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented, TabBar, 
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
    NgTemplateOutlet,
    IdentifierLink,
    StatusBadge,
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

  /**
   * THREE VIEWS instead of one 3,000px page: what to do now, the history of
   * what was done, and the reference lists (medicines and plans). Carried in
   * the URL so a link from an animal lands on the right one.
   */
  protected readonly tabs = [
    { id: 'todo', label: 'To do' },
    { id: 'records', label: 'Records' },
    { id: 'reference', label: 'Medicines & plans' },
  ] as const;
  protected tab: 'todo' | 'records' | 'reference' = 'todo';
  private static readonly REFERENCE = ['products', 'plans'];
  protected tabEntities(): string[] {
    return this.tab === 'reference'
      ? this.entities.filter((e) => HealthPage.REFERENCE.includes(e))
      : this.entities.filter((e) => !HealthPage.REFERENCE.includes(e) && e !== 'tasks');
  }
  protected setTab(tab: 'todo' | 'records' | 'reference') {
    if (tab === this.tab) return;
    this.tab = tab;
    const list = this.tabEntities();
    if (tab !== 'todo' && !list.includes(this.entity)) {
      this.entity = list[0];
      this.loadRecords();
    }
    this.writeUrl();
    this.changeDetector.markForCheck();
  }

  /** The row whose view or form is open in the panel, marked in the list. */
  protected activeRow: string | null = null;
  private linkedTask: string | null = null;
  private linkedNew: 'visits' | 'administrations' | 'round' | null = null;
  private showLinkedTask() {
    const id = this.linkedTask;
    if (!id) return;
    this.linkedTask = null;
    this.activeRow = id;
    this.changeDetector.markForCheck();
    // Matched by attribute value, inside this page only: no selector string to
    // escape (CSS.escape is missing in jsdom, and this timer used to throw there
    // after the test ended), and nothing found once the page is gone.
    setTimeout(() => {
      const row = Array.from(this.host.querySelectorAll<HTMLElement>('[data-task]')).find((r) => r.dataset['task'] === id);
      row?.scrollIntoView?.({ block: 'center' });
      row?.querySelector<HTMLElement>('[data-role="complete-task"]')?.focus({ preventScroll: true });
    });
  }
  /** The task whose "More" menu is open. */
  protected menuFor: string | null = null;
  protected toggleMenu(id: string) {
    this.menuFor = this.menuFor === id ? null : id;
  }
  @HostListener('document:click', ['$event'])
  protected closeMenu(event: Event) {
    if (this.menuFor && !(event.target as HTMLElement | null)?.closest?.('.task-more')) {
      this.menuFor = null;
      this.changeDetector.markForCheck();
    }
  }
  /** Phone: the five filters fold behind one button. */
  protected filtersOpen = false;
  protected activeFilters() {
    return [this.animalFilter, this.taskFilter, this.standingFilter, this.assigneeFilter, this.on !== farmToday() ? this.on : ''].filter(Boolean).length;
  }
  protected readonly today = farmToday();
  protected asOfText() {
    return this.on === this.today ? 'Today' : healthDate(this.on);
  }
  /** Whose correction history is open; it shows in the panel. */
  protected historyFor: string | null = null;
  private historyRecord: HealthRecord | null = null;
  protected closeHistory() {
    this.historyFor = null;
    this.historyRecord = null;
    this.revisions.set([]);
    this.activeRow = null;
    this.returnFocus();
  }
  protected revisionViews(): RevisionView[] {
    const list = [...this.revisions()].sort((a, b) => a.revision - b.revision);
    const entity = this.historyRecord?.entity ?? this.editEntity;
    return list.map((v, i) => revisionView(v, i ? list[i - 1] : null, entity, this.lookup)).reverse();
  }

  // ---- The panel --------------------------------------------------------
  protected panelMode(): 'editor' | 'action' | 'history' | null {
    if (this.editorOpen) return 'editor';
    if (this.actionTask) return 'action';
    if (this.historyFor) return 'history';
    return null;
  }
  protected panelTitle(): string {
    const mode = this.panelMode();
    if (mode === 'history') return 'Correction history';
    if (mode === 'action') return 'Change task status';
    const what = this.editEntity === 'administrations' ? 'dose' : this.entityLabel(this.editEntity, true);
    if (this.savedView) return feedLabel(this.editEntity === 'administrations' ? 'recorded dose' : what);
    if (this.editing) return 'Correct ' + what;
    return this.form.task_id ? 'Record completion' : 'Record ' + what;
  }
  /** "BD-0001 Noori · Observation requiring follow-up": what the panel is about. */
  protected panelSubject(): string {
    const r: Partial<HealthRecord> | null =
      this.panelMode() === 'history' ? this.historyRecord : this.panelMode() === 'action' ? this.actionTask : this.savedView || this.editing ? this.editing : this.form;
    if (!r) return '';
    const animal = r.animal_id ? this.animalLine(r.animal_id) : '';
    const title = r.title ?? r.name ?? r.product_name ?? r.reason ?? r.instructions;
    return [animal, this.panelMode() === 'editor' && !this.editing ? '' : title].filter(Boolean).join(' · ');
  }
  protected closePanel() {
    if (this.panelMode() === 'history') return this.closeHistory();
    return this.closeDrafts();
  }
  protected readonly actions = [
    { id: 'defer', label: 'Defer to a new date' },
    { id: 'miss', label: 'Missed' },
    { id: 'cancel', label: 'Cancelled' },
  ];
  /** The task a completion form is for, shown at the top of the form. */
  protected completingTask(): HealthTask | null {
    if (!this.form.task_id || this.editing) return null;
    return (this.board()?.tasks ?? []).find((t) => t.id === this.form.task_id) ?? null;
  }
  protected setToday() {
    this.form.occurred_on = this.today;
    this.form.date_precision = 'day';
    this.form.occurred_time = null;
    this.setDate();
    this.changeDetector.markForCheck();
  }

  // ---- Reading records in words ----------------------------------------
  protected readonly lookup = (ref: string, id: string): string | null => {
    if (ref === 'animals') return this.animalLine(id);
    const r = (this.catalog()[ref] ?? []).find((x) => x.id === id) ?? (ref === 'tasks' ? (this.board()?.tasks ?? []).find((t) => t.id === id) : null);
    return r ? this.label(r) : null;
  };
  protected view(r: HealthRecord): HealthView {
    return healthView(r, this.lookup);
  }
  protected recorded(r: HealthRecord) {
    return recordedText(r);
  }
  protected sourceName() {
    const f = this.session.sourceForm();
    return f ? (SOURCE_FORMS[f] ?? feedLabel(f)) : '';
  }
  protected date(on: unknown, precision: unknown) {
    return healthDate(on, precision);
  }
  protected statusWord(s: unknown) {
    return s ? feedLabel(String(s)) : 'Open';
  }
  protected animalName(id: string | undefined | null) {
    return this.animals().find((a) => a.id === id)?.name ?? '';
  }
  protected animalLine(id: string) {
    const n = this.animalName(id);
    return n ? id + ' ' + n : id;
  }
  protected recordMeta(r: HealthRecord) {
    return [r.status || r.kind ? feedLabel(String(r.status || r.kind)) : '', r.recorded_by ? 'Recorded by ' + r.recorded_by : '', 'revision ' + r.revision]
      .filter(Boolean)
      .join(' · ');
  }

  // ---- The To do summary -----------------------------------------------
  protected dueCount(b: HealthBoard) {
    return this.forAnimalTasks(b).filter((t) => t.status === 'pending' && (t.standing === 'overdue' || t.standing === 'due')).length;
  }
  private forAnimalTasks(b: HealthBoard) {
    return b.tasks.filter((t) => !this.animalFilter || t.animal_id === this.animalFilter);
  }
  protected openCases(b: HealthBoard) {
    return b.open_cases.filter((c) => !this.animalFilter || c.animal_id === this.animalFilter);
  }
  protected summaryParts(b: HealthBoard): { text: string; tone: string }[] {
    const tasks = this.forAnimalTasks(b).filter((t) => t.status === 'pending');
    const n = (s: string) => tasks.filter((t) => t.standing === s).length;
    const parts: { text: string; tone: string }[] = [];
    if (n('overdue')) parts.push({ text: `${n('overdue')} overdue`, tone: 'danger' });
    if (n('due')) parts.push({ text: `${n('due')} due today`, tone: 'warning' });
    if (n('upcoming')) parts.push({ text: `${n('upcoming')} upcoming`, tone: 'neutral' });
    if (!tasks.length) parts.push({ text: 'No tasks outstanding', tone: 'neutral' });
    const w = this.milkWithdrawals(b).length + this.otherWithdrawals(b).length;
    const milk = this.milkWithdrawals(b).length;
    if (w) parts.push({ text: `${w} ${w === 1 ? 'withdrawal' : 'withdrawals'} needing attention${milk ? ` (${milk} milk)` : ''}`, tone: milk ? 'danger' : 'warning' });
    const c = this.openCases(b).length;
    if (c) parts.push({ text: `${c} open ${c === 1 ? 'case' : 'cases'}`, tone: 'neutral' });
    return parts;
  }

  // ---- The URL carries the view, so a reload or a link keeps it ---------
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  protected writeUrl() {
    try {
      if (typeof window === 'undefined' || !window.location.pathname.endsWith('/animals/health')) return;
      const q: Record<string, string> = {};
      if (this.tab !== 'todo') q['tab'] = this.tab;
      if (this.animalFilter) q['animal'] = this.animalFilter;
      if (this.taskFilter) q['type'] = this.taskFilter;
      if (this.standingFilter) q['due'] = this.standingFilter;
      if (this.assigneeFilter) q['assignee'] = this.assigneeFilter;
      if (this.on !== this.today) q['on'] = this.on;
      if (this.tab !== 'todo') q['show'] = this.entity;
      this.location.replaceState(this.router.createUrlTree(['/animals/health'], { queryParams: q }).toString());
    } catch {
      /* a test route without a router tree */
    }
  }
  protected clearAnimal() {
    this.animalFilter = '';
    this.writeUrl();
    this.changeDetector.markForCheck();
  }
  protected chooseEntity(e: string) {
    this.entity = e;
    this.loadRecords();
    this.writeUrl();
  }
  protected countFor(e: string) {
    return (this.catalog()[e] ?? []).filter((r) => !this.animalFilter || !r.animal_id || r.animal_id === this.animalFilter).length;
  }

  /** Follows the Animal filter too, so ?animal=BD-0001 shows only her withdrawals. */
  private forAnimal(b: HealthBoard) {
    return b.withdrawals.filter((w) => !this.animalFilter || w.animal_id === this.animalFilter);
  }
  protected milkWithdrawals(b: HealthBoard) {
    return this.forAnimal(b).filter((w) => w.target === 'milk');
  }
  protected otherWithdrawals(b: HealthBoard) {
    return this.forAnimal(b).filter((w) => w.target !== 'milk');
  }
  /** "7 Nov" for a due date. */
  protected day(on: string | null | undefined) {
    return feedDay(on ?? '');
  }
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
  protected actionTask: HealthTask | null = null;
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
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
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      // ?animal=BD-0001 from an animal's page: the board opens filtered to her.
      const animal = q.get('animal');
      if (animal) this.animalFilter = animal;
      const tab = q.get('tab');
      if (tab === 'records' || tab === 'reference' || tab === 'todo') this.tab = tab;
      this.taskFilter = q.get('type') ?? this.taskFilter;
      this.standingFilter = q.get('due') ?? this.standingFilter;
      this.assigneeFilter = q.get('assignee') ?? this.assigneeFilter;
      const on = q.get('on');
      if (on && /^\d{4}-\d{2}-\d{2}$/.test(on)) this.on = on;
      // ?new= from Search: open that form, once.
      const fresh = q.get('new');
      if (fresh === 'visits' || fresh === 'administrations' || fresh === 'round') this.linkedNew = fresh;
      // ?task= from Today: that task is marked and brought into view.
      this.linkedTask = q.get('task');
      if (this.linkedTask) this.tab = 'todo';
      const show = q.get('show');
      if (show && this.tabEntities().includes(show)) this.entity = show;
      void this.load();
    });
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
      this.showLinkedTask();
      const fresh = this.linkedNew;
      this.linkedNew = null;
      if (fresh === 'round') void this.openRound();
      else if (fresh) void this.create(fresh);
      // Once used, ?new= and ?task= leave the address: a reload should not
      // open the form again. writeUrl keeps only the view's own filters.
      if (fresh || this.route.snapshot.queryParamMap.has('task')) this.writeUrl();
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
  protected taskKind(kind: string | null | undefined) {
    if (!kind) return 'Task';
    return ({ administration: 'Dose', recheck: 'Recheck', test: 'Test' } as Record<string, string>)[kind] ?? feedLabel(kind);
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
    this.dropHistory();
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
    this.dropHistory();
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
  /** The panel's title takes focus, so a screen reader hears what opened. */
  private focusEditor() {
    this.sizePanel();
    const title = document.getElementById('health-panel-title');
    if (title) return title.focus();
    document.getElementById('health-editor')?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }
  private dropHistory() {
    this.historyFor = null;
    this.historyRecord = null;
    this.revisions.set([]);
  }
  /**
   * The panel sticks beside the list on a wide screen, so it is never taller
   * than the scrolling area it sits in.
   */
  @HostListener('window:resize')
  protected sizePanel() {
    const main = document.querySelector('main');
    const host = document.querySelector<HTMLElement>('app-health-page');
    if (main && host) host.style.setProperty('--panel-max', Math.max(320, main.clientHeight - 24) + 'px');
  }
  protected async closeDrafts() {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.showDoseExceptions = false;
    this.activeRow = null;
    this.returnFocus();
  }
  /** Back to the row that opened the panel, once the panel has gone. */
  private returnFocus() {
    const origin = this.editorOrigin;
    this.changeDetector.markForCheck();
    setTimeout(() => {
      if (origin?.isConnected) origin.focus();
    });
  }
  protected closeEditor() {
    return this.closeDrafts();
  }
  protected async openRound() {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.dropHistory();
    this.showDoseExceptions = false;
    this.editorOrigin = document.activeElement as HTMLElement;
    this.roundOpen = true;
    this.changeDetector.markForCheck();
    setTimeout(() => document.querySelector<HTMLElement>('#health-round select')?.focus());
  }
  protected async openAction(t: HealthTask) {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.dropHistory();
    this.showDoseExceptions = false;
    this.editorOrigin = document.activeElement as HTMLElement;
    this.actionTask = t;
    this.changeDetector.markForCheck();
    setTimeout(() => this.focusEditor());
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
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    if (!this.editorOpen) this.editorOrigin = document.activeElement as HTMLElement;
    this.resetDrafts();
    this.historyFor = r.id;
    this.historyRecord = r;
    this.revisions.set([]);
    this.changeDetector.markForCheck();
    setTimeout(() => this.focusEditor());
    try {
      this.revisions.set(
        await this.api.healthGet<HealthRevision[]>('health/' + r.entity + '/' + r.id + '/revisions'),
      );
      this.changeDetector.markForCheck();
    } catch (e) {
      this.error.set(String(e));
    }
  }
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
