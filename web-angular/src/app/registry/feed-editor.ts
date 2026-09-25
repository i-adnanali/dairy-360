import { JsonPipe } from '@angular/common';
import { ElementRef, untracked } from '@angular/core';
import { writerDraft } from './writer-draft';
import { WriteLock } from './write-lock';
import { PrecisionDateControl, DateEntry, PrecisionDate } from './precision-date';
import { Component, ChangeDetectionStrategy, inject, input, output, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { FormState } from './form-state';
import { WriteLog } from './after-write';
import { TextInput } from '../ui/input';
import { Button } from '../ui/button';
import { Card, ErrorPanel } from '../ui/surface';
import { FieldLabel, HelpText } from '../ui/text';
import { blankFeed, categories, type FeedRecord } from './feed-model';
import { parseDateEntry } from './date-parse';
import { formatMinor, rupeesToMinor } from './money';

@Component({
  selector: 'app-feed-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
  template: `
    <form data-page-layout="entry"
      [appWriteLock]="state"
      appCard
      class="space-y-4"
      (ngSubmit)="save()"
      data-role="feed-editor"
    >
      @if (record()) {
        <p appHelp>
          Saved record · revision {{ originalRecord?.revision }} · recorded by
          {{ originalRecord?.recorded_by }} · {{ originalRecord?.source_form }} ·
          {{ originalRecord?.source_ref || 'no source reference' }}
        </p>
      }
      @if (state.error()?.code === 'feed_conflict') {
        <button appButton variant="secondary" type="button" (click)="compareLatest()">
          Compare latest saved record
        </button>
      }
      @if (latest) {
        <section appCard>
          <h3>Latest saved revision {{ latest.revision }}</h3>
          <pre class="whitespace-pre-wrap break-all">{{ latest | json }}</pre>
          <button appButton variant="secondary" type="button" (click)="latest = null">
            Keep my draft
          </button>
          <button appButton intent="danger" type="button" (click)="adoptLatest()">
            Discard draft and load latest
          </button>
        </section>
      }
      <h3 class="font-medium">{{ record()?.id ? 'Correct' : 'Add' }} {{ noun() }}</h3>
      @if (entity() === 'items' || entity() === 'crops') {
        <label class="block"
          ><span appFieldLabel>Name</span
          ><input appInput name="label" [(ngModel)]="draft.label" required class="w-full"
        /></label>
      }
      @if (entity() === 'items') {
        <label class="block"
          ><span appFieldLabel>Category</span
          ><select appInput name="category" [(ngModel)]="draft.category">
            <option value="">Choose category</option>
            @for (c of categories; track c) {
              <option [value]="c">{{ words(c) }}</option>
            }
          </select></label
        >
      }
      @if (entity() === 'crops') {
        <div class="grid gap-4 sm:grid-cols-2">
          <label
            ><span appFieldLabel>Plot (optional)</span
            ><input appInput name="plot" [(ngModel)]="draft.plot" class="w-full"
          /></label>
          <label
            ><span appFieldLabel>Acres (optional)</span
            ><input
              appInput
              type="number"
              step="any"
              name="acreage"
              [(ngModel)]="draft.acreage"
              class="w-full"
          /></label>
        </div>
        <label class="block"
          ><span appFieldLabel>Status</span
          ><select appInput name="status" [(ngModel)]="draft.status">
            <option value="growing">Growing</option>
            <option value="cutting">Cutting</option>
            <option value="finished">Finished</option>
          </select></label
        >
        @for (k of dateKeys; track k) {
          <app-precision-date
            [label]="words(k) + ' date (optional)'"
            [allowTime]="false"
            [initialValue]="dateValue(k)"
            [resetKey]="dateGeneration"
            (changed)="dateChanged(k, $event)"
          />
        }
        <p appHelp>
          Unknown dates and acreage are valid. Finishing does not invent a last cutting date.
        </p>
      }
      @if (entity() === 'purchases' || entity() === 'expenses') {
        <label class="block"
          ><span appFieldLabel>{{ entity() === 'purchases' ? 'Delivery' : 'Expense' }} date</span
          ><input appInput type="date" name="on" [(ngModel)]="draft.on" required
        /></label>
        <p appHelp>
          Use an exact date. Defer uncertain historical invoices rather than assign today.
        </p>
      }
      @if (entity() === 'purchases') {
        <label class="block"
          ><span appFieldLabel>Feed item</span
          ><select appInput name="item_id" [(ngModel)]="draft.item_id">
            <option value="">Choose item</option>
            @for (i of items(); track i.id) {
              <option [value]="i.id">{{ i.label }}{{ i.archived ? ' (archived)' : '' }}</option>
            }
          </select></label
        >
        <button appButton variant="secondary" type="button" (click)="addItem.emit()">
          Create feed item
        </button>
        <label class="block"
          ><span appFieldLabel>Supplier (optional)</span
          ><input appInput name="supplier" [(ngModel)]="draft.supplier" class="w-full"
        /></label>
        <div class="grid gap-4 sm:grid-cols-2">
          <label
            ><span appFieldLabel>Quantity (optional)</span
            ><input
              appInput
              type="number"
              step="any"
              name="quantity"
              [(ngModel)]="draft.quantity"
              class="w-full"
          /></label>
          <label
            ><span appFieldLabel>Original unit</span
            ><input
              appInput
              name="unit"
              [(ngModel)]="draft.unit"
              placeholder="kg, trolley, bundle, bag…"
              class="w-full"
          /></label>
        </div>
        <p appHelp>Blank quantity means unmeasured. A bag or container has no inferred weight.</p>
        <label class="block"
          ><span appFieldLabel>Pricing</span
          ><select appInput name="pricing" [(ngModel)]="draft.pricing">
            <option value="unknown">Total cost unknown</option>
            <option value="total">Known goods total</option>
            <option value="rate">Quantity × agreed rate</option>
          </select></label
        >
        @if (draft.pricing === 'rate') {
          <div class="grid gap-4 sm:grid-cols-3">
            <label
              ><span appFieldLabel>Price (Rs)</span
              ><input
                appInput
                type="number"
                step="0.01"
                name="rate"
                [(ngModel)]="rate"
                class="w-full"
            /></label>
            <label
              ><span appFieldLabel>Per quantity</span
              ><input
                appInput
                type="number"
                step="any"
                name="basis_quantity"
                [(ngModel)]="draft.basis_quantity"
                class="w-full"
            /></label>
            <label
              ><span appFieldLabel>Rate unit</span
              ><input
                appInput
                name="basis_unit"
                [(ngModel)]="draft.basis_unit"
                placeholder="kg"
                class="w-full"
            /></label>
          </div>
        }
        @if (draft.pricing === 'total') {
          <label class="block"
            ><span appFieldLabel>Goods total (Rs)</span
            ><input appInput type="number" step="0.01" name="goods" [(ngModel)]="goods"
          /></label>
        }
        <div class="grid gap-4 sm:grid-cols-2">
          <label
            ><span appFieldLabel>Transport (Rs)</span
            ><input
              appInput
              type="number"
              step="0.01"
              name="transport"
              [(ngModel)]="transport"
              class="w-full"
          /></label>
          <label
            ><span appFieldLabel>Other charges (Rs)</span
            ><input
              appInput
              type="number"
              step="0.01"
              name="other"
              [(ngModel)]="other"
              class="w-full"
          /></label>
        </div>
        <p appHelp>
          Recorded acquisition cost; this does not record a payment or assert that the feed was
          given.
        </p>
      }
      @if (entity() === 'expenses') {
        <label class="block"
          ><span appFieldLabel>Category</span
          ><select appInput name="category" [(ngModel)]="draft.category">
            <option value="">Choose category</option>
            @for (c of expenseCategories; track c) {
              <option [value]="c">{{ words(c) }}</option>
            }
          </select></label
        >
        <label class="block"
          ><span appFieldLabel>Amount incurred (Rs)</span
          ><input appInput type="number" step="0.01" name="amount" [(ngModel)]="amount"
        /></label>
        <p appHelp>
          Do not enter salaries already recorded in payroll again. Only separately incurred labour
          belongs here; allocation is deferred.
        </p>
      }
      @if (entity() === 'items' || entity() === 'crops') {
        <label class="flex gap-2 text-sm"
          ><input type="checkbox" name="archived" [(ngModel)]="draft.archived" />Archived — keep
          historical references</label
        >
      }
      <label class="block"
        ><span appFieldLabel>Notes (optional)</span
        ><textarea appInput name="notes" [(ngModel)]="draft.notes" class="w-full"></textarea>
      </label>
      <label class="block"
        ><span appFieldLabel>Source reference (optional)</span
        ><input appInput name="source_ref" [(ngModel)]="draft.source_ref" class="w-full"
      /></label>
      @if (state.error(); as e) {
        <p appErrorPanel role="alert">{{ e.message }}</p>
      }
      @if (localError) {
        <p appErrorPanel role="alert">{{ localError }}</p>
      }
      @if (session.ready()) {
        <p appHelp>
          {{ record() ? 'This correction will be recorded by' : 'This entry will be recorded by' }}
          {{ session.recordedBy() }} · {{ session.sourceForm() }}
        </p>
        <button
          appButton
          type="submit"
          [appButtonDisabled]="state.submitting() || (!!record() && !writer.meaningful())"
          [busy]="state.submitting()"
        >
          {{ state.submitting() ? 'Saving…' : 'Save ' + noun() }}
        </button>
      } @else {
        <app-session-required [what]="noun()" />
      }
      <button appButton variant="secondary" type="button" (click)="cancel()">Cancel</button>
    </form>
  `,
})
export class FeedEditor {
  readonly entity = input.required<string>();
  readonly record = input<FeedRecord | null>(null);
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
  latest: FeedRecord | null = null;
  originalRecord: FeedRecord | null = null;
  async compareLatest() {
    if (!this.record()) return;
    const entity = this.entity(),
      id = this.record()!.id;
    try {
      const latest = await this.api.feedGet<FeedRecord>(entity + '/' + id);
      if (this.entity() === entity && this.record()?.id === id) this.latest = latest;
    } catch (error) {
      this.localError = String(error);
    }
  }
  async adoptLatest() {
    const latest = this.latest;
    if (!latest) return;
    await this.writer.transition(() => {
      this.originalRecord = structuredClone(latest);
      this.draft = { ...blankFeed(), ...structuredClone(latest) };
      this.rate = latest.basis_price_minor === null ? null : latest.basis_price_minor / 100;
      this.goods = latest.goods_minor === null ? null : latest.goods_minor / 100;
      this.amount = latest.amount_minor === null ? null : latest.amount_minor / 100;
      this.transport = latest.transport_minor / 100;
      this.other = latest.other_minor / 100;
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
    effect(() => {
      this.originalRecord = this.record() ? structuredClone(this.record()!) : null;
      this.draft = {
        ...blankFeed(),
        ...structuredClone(this.record() ?? {}),
        crop_id: this.cropId() || this.record()?.crop_id || '',
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
        const e = this.dateEntries[k] ?? ({ status: 'empty' } as DateEntry);
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
