import { normalizeFeed, type FeedWireRecord } from "../feed-model";
import { ChangeDetectorRef, DestroyRef } from '@angular/core';
import { Field } from "../../ui/field/field";
import { JsonPipe } from '@angular/common';
import { ElementRef, untracked } from '@angular/core';
import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
import { PrecisionDateControl, DateEntry, PrecisionDate } from "../precision-date/precision-date";
import { Component, ChangeDetectionStrategy, inject, input, output, effect } from '@angular/core';
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
import { blankFeed, categories, type FeedRecord } from "../feed-model";
import { parseDateEntry } from "../date-parse";
import { formatMinor, rupeesToMinor } from "../money";

@Component({
  selector: 'app-feed-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Field,
    JsonPipe,
    WriteLock,
    PrecisionDateControl,
    FormsModule,
    SessionRequired,
    TextInput,
    Button,
    Card,
    ErrorPanel,
    FieldLabel,
    HelpText,
  ],
  templateUrl: './feed-editor.html',
  styleUrl: './feed-editor.css',
})
export class FeedEditor {
  readonly entity = input.required<string>();
  readonly record = input<FeedWireRecord | null>(null);
  readonly items = input<FeedRecord[]>([]);
  readonly cropId = input('');
  readonly saved = output<FeedRecord>();
  readonly cancelled = output<void>();
  readonly addItem = output<void>();
  readonly session = inject(Session);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly origin = document.activeElement as HTMLElement | null;
  private readonly api = inject(RegistryApi);
  private readonly log = inject(WriteLog);
  readonly state = new FormState<FeedRecord>();
  readonly categories = categories;
  readonly expenseCategories = [
    'seed',
    'fertilizer',
    'irrigation',
    'machinery_cutting',
    'separate_labour',
    'other',
  ];
  readonly dateKeys = ['sowing', 'cutting_start', 'cutting_end'];
  draft = blankFeed();
  dates: Record<string, string> = {};
  guesses: Record<string, boolean> = {};
  rate: number | null = null;
  goods: number | null = null;
  amount: number | null = null;
  transport = 0;
  other = 0;
  localError = '';
  latest: FeedWireRecord | null = null;
  originalRecord: FeedWireRecord | null = null;
  private readonly conflictCdr = inject(ChangeDetectorRef);
  private compareGeneration = 0;
  async compareLatest() {
    const generation = ++this.compareGeneration;
    this.latest = null;
    this.localError = '';
    if (!this.record()) return;
    const entity = this.entity(),
      id = this.record()!.id;
    try {
      const latest = await this.api.feedGet<FeedWireRecord>(entity + '/' + id);
      if (generation === this.compareGeneration && this.entity() === entity && this.record()?.id === id) this.latest = latest;
    } catch (error) {
      if (generation === this.compareGeneration && this.entity() === entity && this.record()?.id === id) this.localError = String(error);
    } finally {
      this.conflictCdr.markForCheck();
    }
  }
  async adoptLatest() {
    const latest = this.latest;
    if (!latest) return;
    const generation = this.compareGeneration;
    await this.writer.transition(() => {
      if (generation !== this.compareGeneration || this.latest !== latest) return;
      this.originalRecord = structuredClone(latest);
      this.draft = normalizeFeed(latest);
      this.rate = this.draft.basis_price_minor === null ? null : this.draft.basis_price_minor / 100;
      this.goods = this.draft.goods_minor === null ? null : this.draft.goods_minor / 100;
      this.amount = this.draft.amount_minor === null ? null : this.draft.amount_minor / 100;
      this.transport = this.draft.transport_minor / 100;
      this.other = this.draft.other_minor / 100;
      this.dateEntries = {};
      this.dateGeneration++;
      this.latest = null;
      this.state.reset();
    });
  }

  readonly writer = writerDraft({
    name: 'Feed editor',
    states: [this.state],
    snapshot: () => ({
      draft: this.draft,
      incompleteDates: Object.fromEntries(
        Object.entries(this.dateEntries ?? {}).filter(([, e]) => e.status === 'incomplete'),
      ),
      rate: this.rate,
      goods: this.goods,
      amount: this.amount,
      transport: this.transport,
      other: this.other,
    }),
    restore: (value) => {
      Object.assign(this, value);
      this.dateEntries = {};
      this.dateGeneration++;
    },
  });
  dateGeneration = 0;
  dateEntries: Record<string, DateEntry> = {};
  ngDoCheck() {
    this.writer.check();
  }
  async cancel() {
    if (await this.writer.transition(() => this.cancelled.emit()))
      setTimeout(() => this.origin?.focus());
  }
  dateValue(k: string): PrecisionDate | null {
    const draft = this.draft as any;
    return draft[k + '_on']
      ? {
          occurred_on: draft[k + '_on'],
          date_precision: draft[k + '_precision'],
          occurred_time: null,
        }
      : null;
  }
  dateChanged(k: string, entry: DateEntry) {
    this.dateEntries[k] = entry;
    this.dates[k] =
      entry.status === 'complete'
        ? entry.value.occurred_on
        : entry.status === 'incomplete'
          ? '?'
          : '';
    this.guesses[k] = entry.status === 'complete' && entry.value.date_precision === 'estimated';
    if (entry.status !== 'incomplete')
      Object.assign(this.draft, {
        [k + '_on']: entry.status === 'complete' ? entry.value.occurred_on : null,
        [k + '_precision']: entry.status === 'complete' ? entry.value.date_precision : null,
      });
  }
  constructor() {
    inject(DestroyRef).onDestroy(() => ++this.compareGeneration);
    effect(() => {
      this.entity();
      ++this.compareGeneration;
      this.latest = null;
      this.localError = '';
      this.dateEntries = {};
      this.originalRecord = this.record() ? structuredClone(this.record()!) : null;
      this.draft = {
        ...blankFeed(),
        ...structuredClone(this.record() ?? {}),
        crop_id: this.cropId() || (this.record() ? normalizeFeed(this.record()!).crop_id : '') || '',
      };
      this.rate = this.draft.basis_price_minor === null ? null : this.draft.basis_price_minor / 100;
      this.goods = this.draft.goods_minor === null ? null : this.draft.goods_minor / 100;
      this.amount = this.draft.amount_minor === null ? null : this.draft.amount_minor / 100;
      this.transport = this.draft.transport_minor / 100;
      this.other = this.draft.other_minor / 100;
      this.dateGeneration++;
      for (const k of this.dateKeys) {
        const d = this.draft as unknown as Record<string, unknown>;
        const on = String(d[k + '_on'] ?? ''),
          p = d[k + '_precision'];
        this.dates[k] =
          p === 'month' ? on.slice(0, 7) : p === 'year' || p === 'estimated' ? on.slice(0, 4) : on;
        this.guesses[k] = p === 'estimated';
      }
      untracked(() => this.writer.accept());
      setTimeout(() =>
        this.host.nativeElement.querySelector<HTMLInputElement>('input, select')?.focus(),
      );
    });
  }
  words(v: string) {
    return v.replaceAll('_', ' ');
  }
  noun() {
    return (
      (
        { items: 'feed item', crops: 'crop', expenses: 'expense', purchases: 'purchase' } as Record<
          string,
          string
        >
      )[this.entity()] ?? 'record'
    );
  }
  reading(k: string) {
    const e = parseDateEntry(this.dates[k] ?? '', { estimated: this.guesses[k] ?? false });
    return e.status === 'complete'
      ? e.reading
      : e.status === 'incomplete'
        ? e.message
        : 'Date unknown';
  }
  async save() {
    if (
      !this.session.ready() ||
      this.state.submitting() ||
      (this.record() && !this.writer.meaningful() && !this.state.uncertain())
    )
      return;
    this.localError = '';
    for (const value of [this.rate, this.goods, this.amount, this.transport, this.other]) {
      if (value !== null && rupeesToMinor(String(value)) === null) {
        this.localError = 'Enter non-negative rupee amounts with at most two decimal places.';
        return;
      }
    }
    const body = {
      ...this.draft,
      ...this.session.provenance(),
      basis_price_minor: this.rate === null ? null : Math.round(this.rate * 100),
      goods_minor: this.goods === null ? null : Math.round(this.goods * 100),
      amount_minor: this.amount === null ? null : Math.round(this.amount * 100),
      transport_minor: Math.round(this.transport * 100),
      other_minor: Math.round(this.other * 100),
    };
    if (this.entity() === 'crops')
      for (const k of this.dateKeys) {
        const e = this.dateEntries[k];
        // An untouched control retains the stored date and its exact precision.
        if (!e) continue;
        if (e.status === 'incomplete') {
          this.localError = `Finish or clear the ${this.words(k)} date.`;
          return;
        }
        Object.assign(body, {
          [k + '_on']: e.status === 'complete' ? e.value.occurred_on : null,
          [k + '_precision']: e.status === 'complete' ? e.value.date_precision : null,
        });
      }
    const r = await this.state.runRequest(
      () => [this.entity() + (this.draft.id ? '/' + this.draft.id : ''), body] as const,
      (request, key) => this.api.feedWrite<FeedRecord>(request[0], request[1], key),
    );
    if (r) {
      this.log.announce(`Saved ${this.noun()}${r.label ? ' ' + r.label : ''}.`);
      this.writer.accept();
      this.saved.emit(r);
    }
  }
}
