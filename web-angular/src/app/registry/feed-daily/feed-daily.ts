import { DraftRegistry } from "../draft-registry";
import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  DestroyRef,
  inject,
  signal,
  effect,
  ElementRef,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegistryApi } from "../api";
import { Session } from "../session";
import { SessionRequired } from "../session-required/session-required";
import { FormState } from "../form-state";
import { WriteLog } from "../after-write";
import { TextInput } from "../../ui/input";
import { Button } from "../../ui/button";
import { Card, ErrorPanel } from "../../ui/surface";
import { FieldLabel, HelpText } from "../../ui/text";
import { PageHeading } from "../../ui/heading";
import { FeedEditor } from "../feed-editor/feed-editor";
import { blankFeed, type FeedRecord, type FeedLine } from "../feed-model";
import { farmToday } from "../today";

@Component({
  selector: 'app-feed-daily',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WriteLock,
    JsonPipe,
    FormsModule,
    RouterLink,
    SessionRequired,
    TextInput,
    Button,
    Card,
    ErrorPanel,
    FieldLabel,
    HelpText,
    PageHeading,
    FeedEditor,
  ],
  templateUrl: './feed-daily.html',
  styleUrl: './feed-daily.css',
})
export class FeedDailyScreen {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly api = inject(RegistryApi);
  readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly log = inject(WriteLog);
  readonly items = signal<FeedRecord[]>([]);
  readonly crops = signal<FeedRecord[]>([]);
  readonly purchases = signal<FeedRecord[]>([]);
  readonly loaded = signal(false);
  readonly loadError = signal('');
  readonly latest = signal<FeedRecord | null>(null);
  readonly purchaseSaved = signal('');
  readonly suggestions = signal<{
    herd: { id: string; name: string | null }[];
    milking: { id: string; name: string | null }[];
  }>({ herd: [], milking: [] });
  readonly state = new FormState<FeedRecord>();
  draft = blankFeed();
  review = false;
  nested = '';
  nestedItem = false;
  removing = false;
  localError = '';
  originalId = '';
  readonly assessments = ['enough', 'short', 'surplus', 'unknown', 'not_applicable'];
  private readonly draftRegistry = inject(DraftRegistry);
  originalRecord: FeedRecord | null = null;
  savedView = false;
  readonly writer = writerDraft({
    name: 'Daily feeding',
    description: () => 'Daily feeding · ' + this.draft.on,
    states: [this.state],
    snapshot: () => this.draft,
    restore: (value) => {
      this.draft = structuredClone(value);
    },
  });
  private loadGeneration = 0;
  private latestGeneration = 0;
  private revisionsGeneration = 0;
  ngDoCheck() {
    this.writer.check();
  }
  beginEdit() {
    this.savedView = false;
    this.review = false;
    setTimeout(() => this.host.nativeElement.querySelector('input')?.focus());
  }
  async changeDate(on: string) {
    await this.router.navigate(['/feed/daily', on]);
    const input = this.host.nativeElement.querySelector(
      'input[name="on"]',
    ) as HTMLInputElement | null;
    if (input) input.value = this.draft.on;
  }
  constructor() {
    inject(DestroyRef).onDestroy(() => { ++this.loadGeneration; ++this.latestGeneration; ++this.revisionsGeneration; });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => void this.load());
  }
  async load() {
    const generation = ++this.loadGeneration;
    ++this.latestGeneration; ++this.revisionsGeneration;
    this.latest.set(null); this.revisions.set([]);
    this.localError = '';
    this.loaded.set(false);
    try {
      const on = this.route.snapshot.paramMap.get('on') ?? farmToday();
      const [r] = await Promise.all([
        this.api.feedGet<FeedRecord | null>('daily/on/' + on),
        this.catalogues(),
      ]);
      if (generation !== this.loadGeneration) return;
      this.originalRecord = r ? structuredClone(r) : null;
      this.savedView = !!r;
      this.draft = { ...blankFeed(), ...structuredClone(r ?? {}), on: r?.on ?? on };
      this.originalId = r?.id ?? '';
      this.review = !!r;
      this.writer.accept();
      await this.refreshSuggestions();
      if (generation !== this.loadGeneration) return;
      this.loadError.set('');
      this.loaded.set(true);
    } catch (e) {
      if (generation !== this.loadGeneration) return;
      this.loadError.set(String(e));
    }
  }
  async catalogues() {
    const generation = this.loadGeneration;
    const [i, c, p] = await Promise.all([
      this.api.feedGet<FeedRecord[]>('items'),
      this.api.feedGet<FeedRecord[]>('crops'),
      this.api.feedGet<FeedRecord[]>('purchases'),
    ]);
    if (generation !== this.loadGeneration) return;
    this.items.set(i);
    this.crops.set(c);
    this.purchases.set(p);
  }
  async refreshSuggestions() {
    const on = this.draft.on;
    const generation = this.loadGeneration;
    try {
      const suggestions = await this.api.feedGet<any>('recipients?on=' + on);
      if (generation !== this.loadGeneration || on !== this.draft.on) return;
      this.suggestions.set(suggestions);
    } catch (e) {
      if (generation === this.loadGeneration && on === this.draft.on) this.localError = String(e);
    } finally {
      this.changeDetector.markForCheck();
    }
  }
  suggestedCrops() {
    return this.crops().filter(
      (c) =>
        this.draft.on < farmToday() ||
        (!c.archived && c.status !== 'finished') ||
        this.draft.lines.some((l) => l.sources.some((s) => s.ref_id === c.id)),
    );
  }
  words(v: string) {
    return v.replaceAll('_', ' ');
  }
  category(id: string) {
    return this.items().find((x) => x.id === id)?.category;
  }
  itemName(id: string) {
    return this.items().find((x) => x.id === id)?.label ?? id;
  }
  freshChanged() {
    if (this.draft.fresh_status === 'none') this.draft.assessment = 'not_applicable';
    else if (this.draft.fresh_status === 'unknown') this.draft.assessment = 'unknown';
    else this.draft.assessment = '';
  }
  addLine() {
    this.draft.lines.push({
      item_id: '',
      quantity: null,
      unit: null,
      preparation: 'unknown',
      recipients: 'unspecified',
      animal_ids: [],
      recipients_confirmed: false,
      sources: [],
      purpose: null,
      notes: null,
    });
  }
  hasSource(l: FeedLine, k: string, id: string | null) {
    return l.sources.some((s) => s.kind === k && s.ref_id === id);
  }
  toggleSource(l: FeedLine, k: string, id: string | null) {
    if (this.hasSource(l, k, id))
      l.sources = l.sources.filter((s) => !(s.kind === k && s.ref_id === id));
    else l.sources.push({ kind: k, ref_id: id });
  }
  refreshLine(l: FeedLine) {
    l.animal_ids =
      l.recipients === 'herd'
        ? this.suggestions().herd.map((a) => a.id)
        : l.recipients === 'milking'
          ? this.suggestions().milking.map((a) => a.id)
          : [];
    l.recipients_confirmed = false;
  }
  toggleAnimal(l: FeedLine, id: string) {
    l.animal_ids = l.animal_ids.includes(id)
      ? l.animal_ids.filter((x) => x !== id)
      : [...l.animal_ids, id];
    l.recipients_confirmed = false;
  }
  recipientNames(l: FeedLine) {
    return l.animal_ids
      .map((id) => {
        const a = this.suggestions().herd.find((a) => a.id === id);
        return a?.name ? id + ' ' + a.name : id;
      })
      .join(', ');
  }
  sourceNames(l: FeedLine) {
    return l.sources
      .map((s) =>
        s.kind === 'crop'
          ? 'Own crop: ' + (this.crops().find((c) => c.id === s.ref_id)?.label ?? s.ref_id)
          : s.kind === 'purchase'
            ? 'Purchase: ' + (this.purchases().find((p) => p.id === s.ref_id)?.on ?? s.ref_id)
            : s.kind + ' source',
      )
      .join('; ');
  }
  reviewDraft() {
    this.localError = '';
    if (!this.writer.meaningful()) {
      this.localError = 'No changes to save.';
      return;
    }
    if (!this.draft.fresh_status || !this.draft.additional_status || !this.draft.assessment) {
      this.localError =
        'Answer fresh fodder, supply assessment and additional feed before review. Unknown is a valid partial account.';
      return;
    }
    if (this.draft.lines.some((l) => l.recipients !== 'unspecified' && !l.recipients_confirmed)) {
      this.localError = 'Confirm the displayed recipients on each resolved line.';
      return;
    }
    this.review = true;
    setTimeout(() => {
      const heading = this.host.nativeElement.querySelector('form h3') as HTMLElement | null;
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    });
  }
  async save() {
    if (
      !this.session.ready() ||
      this.state.submitting() ||
      this.nested ||
      !this.review ||
      this.savedView ||
      (!this.writer.meaningful() && !this.state.uncertain())
    )
      return;
    const r = await this.state.runRequest(
      () =>
        [
          'daily' + (this.originalId ? '/' + this.originalId : ''),
          { ...this.draft, ...this.session.provenance() },
        ] as const,
      (request, key) => this.api.feedWrite<FeedRecord>(request[0], request[1], key),
    );
    if (r) {
      this.log.announce(
        `Feed ${r.completeness === 'partial' ? 'partially ' : ''}recorded for ${r.on}.`,
      );
      this.writer.accept();
      await this.router.navigate(['/'], { queryParams: { on: r.on } });
    }
  }
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly nestedEditor = viewChild<FeedEditor>('nestedEditor');
  readonly nestedItemEditor = viewChild<FeedEditor>('nestedItemEditor');
  async openNestedItem() {
    const editor = this.nestedItemEditor();
    if (editor && !(await editor.writer.transition(() => {}))) return;
    this.nestedItem = true;
    this.changeDetector.markForCheck();
  }
  async openNested(entity: string) {
    const editor = this.nestedEditor();
    if (editor && !(await editor.writer.transition(() => {}))) return;
    this.nested = entity;
    this.changeDetector.markForCheck();
    requestAnimationFrame(() => {
      const input = this.host.nativeElement.querySelector(
        'app-feed-editor input',
      ) as HTMLElement | null;
      input?.focus();
      input?.scrollIntoView({ block: 'center' });
    });
  }
  async nestedSaved(r: FeedRecord) {
    if (this.nested === 'purchases') this.purchaseSaved.set(r.id);
    this.nested = '';
    await this.catalogues();
  }
  async itemSaved(r: FeedRecord) {
    this.nestedItem = false;
    await this.catalogues();
  }
  async loadLatest() {
    const generation = ++this.latestGeneration;
    this.latest.set(null); this.localError = '';
    const on = this.draft.on;
    try {
      const latest = await this.api.feedGet<FeedRecord | null>('daily/on/' + on);
      if (generation !== this.latestGeneration || on !== this.draft.on) return;
      this.latest.set(latest);
      if (!latest)
        this.localError = 'This date no longer has a saved account. Your draft is preserved.';
    } catch (e) {
      if (generation === this.latestGeneration && on === this.draft.on) this.localError = String(e);
    } finally {
      this.changeDetector.markForCheck();
    }
  }
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
  async showRevisions() {
    const generation = ++this.revisionsGeneration;
    const id = this.originalId;
    this.revisions.set([]); this.localError = '';
    try {
      const revisions = await this.api.feedGet<ReturnType<typeof this.revisions>>('daily/' + id + '/revisions');
      if (generation === this.revisionsGeneration && id === this.originalId) this.revisions.set(revisions);
    } catch (e) {
      if (generation === this.revisionsGeneration && id === this.originalId) this.localError = String(e);
    } finally {
      this.changeDetector.markForCheck();
    }
  }
  async adoptLatest() {
    const r = this.latest();
    const generation = this.latestGeneration;
    if (r)
      await this.writer.transition(() => {
        if (generation !== this.latestGeneration || this.latest() !== r) return;
        this.originalRecord = structuredClone(r);
        this.savedView = true;
        this.draft = { ...blankFeed(), ...structuredClone(r) };
        this.originalId = r.id;
        this.review = true;
        this.state.reset();
        this.latest.set(null);
      });
  }
  async confirmRemoval() {
    if (this.state.locked()) return;
    if (this.draftRegistry.hasChanges() && !(await this.draftRegistry.request())) return;
    if (
      !(await this.draftRegistry.confirm(
        'Remove feeding summary?',
        this.draft.on + '. The audit trail remains. This date returns to not recorded.',
        'Remove summary',
      ))
    )
      return;
    this.removing = true;
    await this.remove();
  }
  async remove() {
    if (!this.session.ready() || this.state.submitting()) return;
    const r = await this.state.runRequest(
      () =>
        [
          'daily/' + this.originalId + '/delete',
          { revision: this.draft.revision, ...this.session.provenance() },
        ] as const,
      (request, key) => this.api.feedWrite<FeedRecord>(request[0], request[1], key),
    );
    if (r) {
      this.log.announce('Removed feeding summary; audit trail retained.');
      this.writer.accept();
      await this.router.navigate(['/'], { queryParams: { on: this.draft.on } });
    }
  }
}
