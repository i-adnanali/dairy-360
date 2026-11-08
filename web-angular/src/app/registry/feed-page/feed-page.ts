import { ChangeDetectorRef, Injector, afterNextRender, viewChild } from '@angular/core';
import { DraftRegistry } from "../draft-registry";
import { writerDraft } from "../writer-draft";
import { LocalPagination } from "../../ui/local-pagination/local-pagination";
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RegistryApi } from "../api";
import { Session } from "../session";
import { SessionRequired } from "../session-required/session-required";
import { FormState } from "../form-state";
import { WriteLog } from "../after-write";
import { FeedEditor } from "../feed-editor/feed-editor";
import { type FeedRecord, type FeedOverview, type FeedDay } from "../feed-model";
import { farmToday } from "../today";
import { formatMinor } from "../money";
import { TextInput } from "../../ui/input";
import { Button } from "../../ui/button";
import { Card, ErrorPanel, StatusBadge, type BadgeTone } from "../../ui/surface";
import { TextLink } from "../../ui/text";
import { Cell } from "../../ui/cell";
import { ScrollRegion } from "../../ui/scroll-region";
import { NgTemplateOutlet } from '@angular/common';
import { SectionHeading } from "../../ui/heading";
import { dayStanding, feedDay, feedLabel, feedProvenance, feedRelativeDay, feedWeekday } from "../feed-format";
import { FieldLabel, HelpText } from "../../ui/text";
import { PageHeading } from "../../ui/heading";

@Component({
  selector: 'app-feed-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LocalPagination,
    RouterLink,
    FormsModule,
    SessionRequired,
    FeedEditor,
    TextInput,
    Button,
    Card,
    ErrorPanel,
    FieldLabel,
    HelpText,
    PageHeading,
    SectionHeading,
    StatusBadge,
    TextLink,
    Cell,
    ScrollRegion,
    NgTemplateOutlet,
  ],
  templateUrl: './feed-page.html',
  styleUrl: './feed-page.css',
})
export class FeedPage {
  readonly session = inject(Session);
  private readonly api = inject(RegistryApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly log = inject(WriteLog);
  readonly items = signal<FeedRecord[]>([]);
  readonly records = signal<FeedRecord[]>([]);
  readonly detail = signal<FeedRecord | null>(null);
  readonly overview = signal<FeedOverview | null>(null);
  readonly error = signal('');
  readonly loading = signal(true);
  readonly rangeLoading = signal(false);
  readonly revisions = signal<
    {
      id: string;
      operation: string;
      revision: number;
      recorded_at: string;
      before_json: string;
      after_json: string;
      provenance: string;
    }[]
  >([]);
  /** Whose correction history is open: it renders beside that record, not at the foot of the page. */
  readonly historyFor = signal<string | null>(null);
  readonly state = new FormState<unknown>();
  protected readonly day = feedDay;
  protected readonly relDay = feedRelativeDay;
  protected readonly weekday = feedWeekday;
  protected readonly label = feedLabel;
  protected readonly provenance = feedProvenance;
  protected readonly standing = dayStanding;
  private readonly injector = inject(Injector);
  readonly today = farmToday();
  readonly assessmentKeys = ['enough', 'short', 'surplus', 'unknown', 'not_applicable'];
  readonly dateKeys = ['sowing', 'cutting_start', 'cutting_end'];
  mode = 'overview';
  id = '';
  from = '';
  to = farmToday();
  itemFilter = '';
  cropSearch = '';
  cropStatus = '';
  itemOpen = false;
  itemEdit: FeedRecord | null = null;
  editor = false;
  editRecord: FeedRecord | null = null;
  expenseOpen = false;
  expenseEdit: FeedRecord | null = null;
  removeTarget: FeedRecord | null = null;
  private readonly primaryEditor = viewChild<FeedEditor>('primaryEditor');
  private readonly itemEditor = viewChild<FeedEditor>('itemEditor');
  private readonly expenseEditor = viewChild<FeedEditor>('expenseEditor');
  private readonly drafts = inject(DraftRegistry);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private loadGeneration = 0;
  private historyGeneration = 0;
  private rangeGeneration = 0;
  private readonly removalDraft = writerDraft({
    name: 'Feed removal',
    fields: {},
    states: [this.state],
  });
  async openEditor(slot: 'primary' | 'item' | 'expense', record: FeedRecord | null) {
    const editor =
      slot === 'item'
        ? this.itemEditor()
        : slot === 'expense'
          ? this.expenseEditor()
          : this.primaryEditor();
    const open = () => {
      if (slot === 'item') {
        this.itemEdit = record;
        this.itemOpen = true;
      } else if (slot === 'expense') {
        this.expenseEdit = record;
        this.expenseOpen = true;
      } else {
        this.editRecord = record;
        this.editor = true;
      }
    };
    if (editor) await editor.writer.transition(open);
    else open();
    this.changeDetector.markForCheck();
    this.focusEditor(slot);
  }
  /** Every form opens beside the control that asked for it; take the eye and the caret there. */
  private focusEditor(slot: string): void {
    afterNextRender(() => {
      const host = document.querySelector<HTMLElement>(`[data-editor-slot="${slot}"]`);
      host?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      host?.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea')?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      ++this.loadGeneration;
      ++this.historyGeneration;
      ++this.rangeGeneration;
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => {
      this.editor = false;
      this.itemOpen = false;
      this.expenseOpen = false;
      this.editRecord = null;
      this.expenseEdit = null;
      this.itemEdit = null;
      this.detail.set(null);
      this.mode = this.route.snapshot.data['feedMode'] ?? 'overview';
      this.id = this.route.snapshot.paramMap.get('id') ?? '';
      this.from = this.route.snapshot.queryParamMap.get('from') ?? '';
      this.to = this.route.snapshot.queryParamMap.get('to') ?? this.today;
      void this.load();
    });
  }
  title() {
    const d = this.detail();
    if (this.id === 'new') return this.mode === 'crops' ? 'Add crop' : 'Record purchase';
    if (this.id && d) return this.mode === 'crops' ? d.label : `${this.itemName(d.item_id)}, ${feedDay(d.on)}`;
    return (
      { overview: 'Feed', daily: 'Feeding days', crops: 'Fodder crops', purchases: 'Feed purchases', items: 'Feed catalogue' } as Record<string, string>
    )[this.mode] ?? 'Feed';
  }
  /** One sentence per view saying what the list is -- not the same paragraph on all six. */
  intro() {
    return (
      {
        overview: 'Feeding accounts, fodder supply and recorded costs for the range below.',
        daily: 'One feeding account per day. A missing day means not recorded, never not fed.',
        crops: 'Your own fodder: plots, lifecycle and what each crop has cost so far.',
        purchases: 'Feed bought in, as recorded. A recorded cost is not a payment.',
        items: 'The feed items you choose from when recording feeding and purchases.',
      } as Record<string, string>
    )[this.mode] ?? '';
  }
  /** Newest first: the day you are most likely to open is today or yesterday. */
  days(o: FeedOverview): FeedDay[] {
    return [...o.days].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
  }
  cropTone(r: FeedRecord): BadgeTone {
    if (r.archived || r.status === 'finished') return 'ended';
    return r.status === 'cutting' ? 'success' : 'neutral';
  }
  cropStatusLabel(r: FeedRecord): string {
    return r.archived ? 'Archived' : feedLabel(r.status);
  }
  closeHistory() {
    ++this.historyGeneration;
    this.historyFor.set(null);
    this.revisions.set([]);
  }
  words(v: string) {
    return feedLabel(v);
  }
  money(v: number | null) {
    return v === null ? 'Cost unknown' : formatMinor(v);
  }
  itemName(id: string) {
    return this.items().find((i) => i.id === id)?.label ?? id;
  }
  agreement(r: FeedRecord) {
    return r.pricing === 'rate'
      ? `${this.money(r.basis_price_minor)} per ${r.basis_quantity} ${r.basis_unit}`
      : r.pricing === 'total'
        ? 'Known goods total; no weight inferred'
        : 'Total unknown; excluded from recorded cost totals';
  }
  /** "6 Jul 2025", "Jul 2025", "2025", "About 2025" or "Unknown" -- the precision is shown, never a fabricated day. */
  cropDate(d: FeedRecord, k: string) {
    const o = d as unknown as Record<string, unknown>,
      on = String(o[k + '_on'] ?? ''),
      p = o[k + '_precision'];
    if (!on) return 'Unknown';
    if (p === 'year') return on.slice(0, 4);
    if (p === 'estimated') return 'About ' + on.slice(0, 4);
    if (p === 'month') return feedDay(on.slice(0, 7) + '-01', '0000').replace(/^1 /, '');
    return feedDay(on, '0000');
  }
  expenseTotal(d: FeedRecord) {
    return (d.expenses ?? []).reduce((n, e) => n + (e.amount_minor ?? 0), 0);
  }
  filtered() {
    // The catalogue has no filters: items carry no date, and the date filter
    // below would drop every one of them.
    const rows = this.mode === 'items' ? [...this.records()] : this.records().filter(
      (r) =>
        this.mode === 'crops' ?
        ((!this.cropSearch || (r.label + ' ' + (r.plot ?? '')).toLowerCase().includes(this.cropSearch.toLowerCase())) && (!this.cropStatus || (this.cropStatus === 'archived' ? r.archived : r.status === this.cropStatus && !r.archived))) :
        ((!this.itemFilter || r.item_id === this.itemFilter) &&
          (!this.from || r.on >= this.from) &&
          (!this.to || r.on <= this.to)),
    );
    if (this.mode === 'purchases') return rows.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
    if (this.mode === 'items') return rows.sort((a, b) => Number(a.archived) - Number(b.archived) || a.label.localeCompare(b.label));
    // Crops: the ones still feeding the herd first.
    const rank = (r: FeedRecord) => (r.archived ? 3 : r.status === 'cutting' ? 0 : r.status === 'growing' ? 1 : 2);
    return rows.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  }
  async load() {
    ++this.rangeGeneration;
    this.rangeLoading.set(false);
    ++this.historyGeneration;
    this.revisions.set([]);
    this.historyFor.set(null);
    const generation = ++this.loadGeneration,
      mode = this.mode,
      id = this.id;
    this.loading.set(true);
    this.error.set('');
    try {
      const items = await this.api.feedGet<FeedRecord[]>('items');
      if (generation !== this.loadGeneration) return;
      this.items.set(items);
      if (mode === 'overview' || mode === 'daily') await this.loadRange();
      else {
        const [records, detail] = await Promise.all([
          mode === 'items' ? Promise.resolve(items) : this.api.feedGet<FeedRecord[]>(mode),
          id && id !== 'new'
            ? this.api.feedGet<FeedRecord>(mode + '/' + id)
            : Promise.resolve(null),
        ]);
        if (generation !== this.loadGeneration) return;
        this.records.set(records);
        this.detail.set(detail);
      }
    } catch (error) {
      if (generation === this.loadGeneration) this.error.set(String(error));
    } finally {
      if (generation === this.loadGeneration) this.loading.set(false);
    }
  }
  async loadRange() {
    const generation = ++this.rangeGeneration;
    this.rangeLoading.set(true);
    this.overview.set(null);
    this.error.set('');
    try {
      const q = new URLSearchParams({ to: this.to });
      if (this.from) q.set('from', this.from);
      const o = await this.api.feedGet<FeedOverview>('overview?' + q);
      if (generation !== this.rangeGeneration) return;
      this.overview.set(o);
      this.from = o.from;
      this.to = o.to;
      this.error.set('');
    } catch (e) {
      if (generation === this.rangeGeneration) this.error.set(String(e));
    } finally {
      if (generation === this.rangeGeneration) this.rangeLoading.set(false);
    }
  }
  cancelEditor() {
    this.editor = false;
    if (this.id === 'new') void this.router.navigate(['/feed', this.mode]);
  }
  async saved(r: FeedRecord, slot: 'primary' | 'item' | 'expense' = 'primary') {
    if (slot === 'item') this.itemOpen = false;
    else if (slot === 'expense') this.expenseOpen = false;
    else this.editor = false;
    if (slot === 'primary' && this.id === 'new')
      await this.router.navigate(['/feed', this.mode, r.id]);
    else await this.load();
  }
  async showRevisions(d: FeedRecord, entity = this.mode) {
    const generation = ++this.historyGeneration;
    this.revisions.set([]);
    this.historyFor.set(d.id);
    this.error.set('');
    try {
      const revisions = await this.api.feedGet<ReturnType<typeof this.revisions>>(entity + '/' + d.id + '/revisions');
      if (generation === this.historyGeneration) this.revisions.set(revisions);
    } catch (e) {
      if (generation === this.historyGeneration) this.error.set(String(e));
    }
  }
  async startRemoval(record: FeedRecord) {
    if (this.state.locked()) return;
    if (this.drafts.hasChanges() && !(await this.drafts.request())) return;
    if (
      !(await this.drafts.confirm(
        'Remove feed record?',
        (record.crop_id ? 'Expense' : 'Purchase') +
          ' · ' +
          record.on +
          '. The audit trail remains. A linked purchase cannot be removed.',
        'Remove record',
      ))
    )
      return;
    this.removeTarget = record;
    await this.remove();
  }
  async remove() {
    const r = this.removeTarget;
    if (!r || !this.session.ready() || this.state.submitting()) return;
    const v = await this.state.runRequest(
      () =>
        [
          (r.crop_id ? 'expenses' : 'purchases') + '/' + r.id + '/delete',
          { revision: r.revision, ...this.session.provenance() },
        ] as const,
      (request, key) => this.api.feedWrite(request[0], request[1], key),
    );
    if (v) {
      this.log.announce('Removed feed record; audit trail retained.');
      this.removeTarget = null;
      if (!r.crop_id) await this.router.navigate(['/feed/purchases']);
      else await this.load();
    }
  }
}
