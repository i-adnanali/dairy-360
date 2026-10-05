import { ChangeDetectorRef, viewChild } from '@angular/core';
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
import { Card, ErrorPanel } from "../../ui/surface";
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
  readonly state = new FormState<unknown>();
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
  catalogue = false;
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
    return this.mode === 'overview'
      ? 'Feed overview'
      : this.mode === 'daily'
        ? 'Feeding history'
        : this.mode === 'crops'
          ? 'Fodder crops'
          : 'Feed purchases';
  }
  words(v: string) {
    return v.replaceAll('_', ' ');
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
  cropDate(d: FeedRecord, k: string) {
    const o = d as unknown as Record<string, unknown>,
      on = String(o[k + '_on'] ?? ''),
      p = o[k + '_precision'];
    return on
      ? (p === 'month' ? on.slice(0, 7) : p === 'year' || p === 'estimated' ? on.slice(0, 4) : on) +
          ' (' +
          p +
          ')'
      : 'Unknown';
  }
  expenseTotal(d: FeedRecord) {
    return (d.expenses ?? []).reduce((n, e) => n + (e.amount_minor ?? 0), 0);
  }
  filtered() {
    return this.records().filter(
      (r) =>
        this.mode === 'crops' ?
        ((!this.cropSearch || (r.label + ' ' + (r.plot ?? '')).toLowerCase().includes(this.cropSearch.toLowerCase())) && (!this.cropStatus || (this.cropStatus === 'archived' ? r.archived : r.status === this.cropStatus && !r.archived))) :
        ((!this.itemFilter || r.item_id === this.itemFilter) &&
          (!this.from || r.on >= this.from) &&
          (!this.to || r.on <= this.to)),
    );
  }
  async load() {
    ++this.rangeGeneration;
    this.rangeLoading.set(false);
    ++this.historyGeneration;
    this.revisions.set([]);
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
          this.api.feedGet<FeedRecord[]>(mode),
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
