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
    <form appCard class="space-y-4" (ngSubmit)="save()" data-role="feed-editor">
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
          <label class="block"
            ><span appFieldLabel>{{ words(k) }} date (optional)</span
            ><input
              appInput
              [name]="k"
              [(ngModel)]="dates[k]"
              placeholder="2026, Aug 2026, or 10 Sep 2026"
              class="w-full"
          /></label>
          <label class="flex gap-2 text-sm"
            ><input type="checkbox" [name]="k + 'guess'" [(ngModel)]="guesses[k]" />Even the year is
            a guess</label
          >
          <p appHelp>{{ reading(k) }}</p>
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
        <p appHelp>Recording as {{ session.sourceForm() }} · {{ session.recordedBy() }}</p>
        <button appButton type="submit" [appButtonDisabled]="state.submitting()">
          {{ state.submitting() ? 'Saving…' : 'Save ' + noun() }}
        </button>
      } @else {
        <app-session-required [what]="noun()" />
      }
      <button appButton variant="secondary" type="button" (click)="cancelled.emit()">Cancel</button>
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
  constructor() {
    effect(() => {
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
      for (const k of this.dateKeys) {
        const d = this.draft as unknown as Record<string, unknown>;
        const on = String(d[k + '_on'] ?? ''),
          p = d[k + '_precision'];
        this.dates[k] =
          p === 'month' ? on.slice(0, 7) : p === 'year' || p === 'estimated' ? on.slice(0, 4) : on;
        this.guesses[k] = p === 'estimated';
      }
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
    if (!this.session.ready() || this.state.submitting()) return;
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
        const e = parseDateEntry(this.dates[k] ?? '', { estimated: this.guesses[k] ?? false });
        if (e.status === 'incomplete') {
          this.localError = `Finish or clear the ${this.words(k)} date.`;
          return;
        }
        Object.assign(body, {
          [k + '_on']: e.status === 'complete' ? e.value.occurred_on : null,
          [k + '_precision']: e.status === 'complete' ? e.value.date_precision : null,
        });
      }
    const r = await this.state.run((key) =>
      this.api.feedWrite<FeedRecord>(
        this.entity() + (this.draft.id ? '/' + this.draft.id : ''),
        body,
        key,
      ),
    );
    if (r) {
      this.log.announce(`Saved ${this.noun()}${r.label ? ' ' + r.label : ''}.`);
      this.saved.emit(r);
    }
  }
}
