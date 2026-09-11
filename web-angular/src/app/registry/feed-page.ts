import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { FormState } from './form-state';
import { WriteLog } from './after-write';
import { FeedEditor } from './feed-editor';
import { type FeedRecord, type FeedOverview, type FeedDay } from './feed-model';
import { farmToday } from './today';
import { formatMinor } from './money';
import { TextInput } from '../ui/input';
import { Button } from '../ui/button';
import { Card, ErrorPanel } from '../ui/surface';
import { FieldLabel, HelpText } from '../ui/text';
import { PageHeading } from '../ui/heading';

@Component({
  selector: 'app-feed-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
  template: `
    <div class="space-y-5">
      <header>
        <h2 appPageHeading>{{ title() }}</h2>
        <p appHelp>
          Own fodder, recorded acquisitions and one daily account. Quantities may be unmeasured;
          recorded costs are not cash paid or feed consumed cost.
        </p>
      </header>
      @if (error()) {
        <p appErrorPanel role="alert">{{ error() }}</p>
        <button appButton variant="secondary" (click)="load()">Retry</button>
      }
      @if (loading()) {
        <p appHelp>Loading feed records…</p>
      }
      <div class="flex flex-wrap gap-2">
        <a appButton variant="secondary" routerLink="/feed/crops/new">Add crop</a
        ><a appButton variant="secondary" routerLink="/feed/purchases/new">Record purchase</a
        ><a appButton [routerLink]="['/feed/daily', today]">Record feeding</a
        ><button appButton variant="secondary" (click)="catalogue = !catalogue">
          Feed catalogue
        </button>
      </div>
      @if (catalogue) {
        <section appCard class="space-y-3">
          <h3 class="font-medium">Feed items</h3>
          <button appButton variant="secondary" (click)="itemEdit = null; itemOpen = true">
            Create item
          </button>
          @for (i of items(); track i.id) {
            <div class="flex flex-wrap gap-3">
              <span
                >{{ i.label }} · {{ words(i.category) }}{{ i.archived ? ' · archived' : '' }}</span
              ><button appButton variant="secondary" (click)="itemEdit = i; itemOpen = true">
                Edit / archive
              </button>
            </div>
          }
        </section>
      }
      @if (mode === 'overview' || mode === 'daily') {
        <form class="flex flex-wrap items-end gap-3" (ngSubmit)="loadRange()">
          <label
            ><span appFieldLabel>From</span
            ><input appInput type="date" name="from" [(ngModel)]="from" /></label
          ><label
            ><span appFieldLabel>Through</span
            ><input appInput type="date" name="to" [(ngModel)]="to" /></label
          ><button appButton variant="secondary" type="submit">Show range</button>
        </form>
        <p appHelp>
          Default coverage begins at the first saved summary. A missing day means not recorded,
          never not fed.
        </p>
        @if (overview(); as o) {
          @if (mode === 'overview') {
            <div class="grid gap-4 sm:grid-cols-3">
              <section appCard>
                <h3 class="font-medium">Daily coverage</h3>
                <p>
                  {{ o.recorded }} recorded · {{ o.partial }} partial ·
                  {{ o.unrecorded }} unrecorded
                </p>
              </section>
              <section appCard>
                <h3 class="font-medium">Recorded purchase costs</h3>
                <p>{{ money(o.purchase_cost_minor) }}</p>
                <p appHelp>{{ o.unknown_costs }} unknown totals excluded</p>
              </section>
              <section appCard>
                <h3 class="font-medium">Recorded crop expenses</h3>
                <p>{{ money(o.expense_cost_minor) }}</p>
              </section>
            </div>
            <section appCard class="space-y-3">
              <h3 class="font-medium">Fresh-fodder supply</h3>
              @for (a of assessmentKeys; track a) {
                <p>
                  {{ words(a) }}: {{ o.assessments[a].length }}
                  @for (on of o.assessments[a]; track on) {
                    <a class="underline ml-2" [routerLink]="['/feed/daily', on]">{{ on }}</a>
                  }
                </p>
              }
              <p appHelp>
                Own-source days {{ o.own_days }} · purchased-source days {{ o.purchased_days }} ·
                mixed-source days {{ o.mixed_days }}. Counts overlap; do not add them.
              </p>
            </section>
            <section appCard>
              <h3 class="font-medium">Purchase quantities by original unit</h3>
              @for (q of o.quantities; track q.item_id + q.unit) {
                <p>
                  {{ itemName(q.item_id) }}:
                  {{
                    q.quantity > 0
                      ? q.quantity + ' ' + q.unit + ' measured'
                      : 'No measured quantity'
                  }}
                  · {{ q.unmeasured }} unmeasured purchases excluded
                </p>
              } @empty {
                <p appHelp>No purchases in this range.</p>
              }
            </section>
            <section appCard class="space-y-3">
              <h3 class="font-medium">Crop cycles — currently recorded lifecycle</h3>
              <p appHelp>
                Status is the latest recorded state, not a reconstructed range history. Dates may be
                unknown or approximate.
              </p>
              @for (c of o.crops; track c.id) {
                <p>
                  <a class="underline" [routerLink]="['/feed/crops', c.id]">{{ c.label }}</a> ·
                  {{ c.status }}{{ c.archived ? ' · archived' : '' }} ·
                  {{ c.acreage ?? 'unknown' }} acres · {{ money(c.expense_minor ?? 0) }} expenses to
                  date · {{ c.supply_days?.length ?? 0 }} distinct recorded supply dates
                </p>
              } @empty {
                <p appHelp>
                  No crops recorded. Add a growing or already-cutting crop; unknown dates are valid.
                </p>
              }
            </section>
          }
          <section appCard>
            <h3 class="font-medium">Feeding history</h3>
            @for (d of o.days; track d.on) {
              <div class="flex flex-wrap justify-between gap-2 border-b border-line-subtle py-2">
                <a class="underline" [routerLink]="['/feed/daily', d.on]">{{ d.on }}</a
                ><span>{{
                  d.summary
                    ? d.summary.completeness === 'partial'
                      ? 'Partially recorded'
                      : 'Recorded'
                    : 'Not recorded'
                }}</span>
              </div>
            }
          </section>
        }
      }
      @if (mode === 'crops' || mode === 'purchases') {
        @if (!id || id === 'new') {
          @if (id === 'new') {
            <div class="max-w-[720px]">
              <app-feed-editor
                [entity]="mode"
                [items]="items()"
                (saved)="saved($event)"
                (cancelled)="cancelEditor()"
                (addItem)="itemEdit = null; itemOpen = true"
              />
            </div>
          }
          @if (mode === 'purchases') {
            <div class="flex flex-wrap gap-3">
              <label
                ><span appFieldLabel>Item filter</span
                ><select appInput [(ngModel)]="itemFilter">
                  <option value="">All items</option>
                  @for (i of items(); track i.id) {
                    <option [value]="i.id">{{ i.label }}</option>
                  }
                </select></label
              ><label
                ><span appFieldLabel>From</span
                ><input appInput type="date" [(ngModel)]="from" /></label
              ><label
                ><span appFieldLabel>Through</span><input appInput type="date" [(ngModel)]="to"
              /></label>
            </div>
          }
          <section appCard class="space-y-3">
            @for (r of filtered(); track r.id) {
              <div class="border-b border-line-subtle py-3">
                <a class="underline font-medium" [routerLink]="['/feed', mode, r.id]">{{
                  mode === 'crops' ? r.label : itemName(r.item_id) + ' · ' + r.on
                }}</a>
                @if (mode === 'crops') {
                  <p>
                    {{ r.status }}{{ r.archived ? ' · archived' : '' }} ·
                    {{ r.acreage ?? 'unknown' }} acres
                  </p>
                } @else {
                  <p>
                    {{ r.quantity === null ? 'Unmeasured' : r.quantity + ' ' + r.unit }} ·
                    {{ money(r.total_minor) }}
                  </p>
                  <p appHelp>{{ agreement(r) }}</p>
                }
              </div>
            } @empty {
              <p appHelp>
                No {{ mode }} in this view. Use the actions above to record the first one.
              </p>
            }
          </section>
        } @else {
          @if (detail(); as d) {
            <section appCard class="space-y-3">
              <h3 class="font-medium">{{ mode === 'crops' ? d.label : itemName(d.item_id) }}</h3>
              <p appHelp>
                Revision {{ d.revision }} · {{ d.source_form }} · {{ d.recorded_by }} ·
                {{ d.source_ref || 'no source reference' }} · {{ d.recorded_at }}
              </p>
              @if (mode === 'crops') {
                <p>
                  {{ d.status }}{{ d.archived ? ' · archived' : '' }} ·
                  {{ d.plot || 'plot unspecified' }} · {{ d.acreage ?? 'unknown' }} acres
                </p>
                @for (k of dateKeys; track k) {
                  <p>{{ words(k) }}: {{ cropDate(d, k) }}</p>
                }
              } @else {
                <p>Delivered {{ d.on }} · {{ d.supplier || 'supplier unspecified' }}</p>
                <p>
                  {{ d.quantity === null ? 'Unmeasured' : d.quantity + ' ' + d.unit }} ·
                  {{ agreement(d) }}
                </p>
                <p>
                  Goods {{ money(d.goods_minor) }} + transport {{ money(d.transport_minor) }} +
                  other {{ money(d.other_minor) }} = {{ money(d.total_minor) }}
                </p>
              }
              <p>{{ d.notes }}</p>
              <button appButton variant="secondary" (click)="editRecord = d; editor = true">
                Correct{{ mode === 'crops' ? ' / finish / archive' : '' }}
              </button>
              @if (mode === 'purchases') {
                <button appButton variant="secondary" (click)="removeTarget = d">
                  Remove purchase
                </button>
              }
              <button appButton variant="secondary" (click)="showRevisions(d)">
                Correction history
              </button>
            </section>
            @if (editor) {
              <div class="max-w-[720px]">
                <app-feed-editor
                  [entity]="mode"
                  [record]="editRecord"
                  [items]="items()"
                  (saved)="saved($event)"
                  (cancelled)="cancelEditor()"
                  (addItem)="itemEdit = null; itemOpen = true"
                />
              </div>
            }
            @if (mode === 'crops') {
              <section appCard class="space-y-3">
                <h3 class="font-medium">Expenses recorded so far — {{ money(expenseTotal(d)) }}</h3>
                <p appHelp>Do not duplicate existing payroll salaries.</p>
                <button
                  appButton
                  variant="secondary"
                  (click)="expenseEdit = null; expenseOpen = true"
                >
                  Add expense
                </button>
                @for (e of d.expenses; track e.id) {
                  <div class="flex flex-wrap gap-3">
                    <span
                      >{{ e.on }} · {{ words(e.category) }} · {{ money(e.amount_minor) }} ·
                      {{ e.notes }}</span
                    ><button
                      appButton
                      variant="secondary"
                      (click)="expenseEdit = e; expenseOpen = true"
                    >
                      Correct expense</button
                    ><button appButton variant="secondary" (click)="removeTarget = e">
                      Remove expense
                    </button>
                    <button appButton variant="secondary" (click)="showRevisions(e, 'expenses')">
                      Expense history
                    </button>
                  </div>
                }
              </section>
              @if (expenseOpen) {
                <div class="max-w-[720px]">
                  <app-feed-editor
                    entity="expenses"
                    [cropId]="d.id"
                    [record]="expenseEdit"
                    (saved)="saved($event)"
                    (cancelled)="expenseOpen = false"
                  />
                </div>
              }
              <section appCard>
                <h3 class="font-medium">Recorded supply days</h3>
                @for (on of d.supply_days; track on) {
                  <a class="underline mr-3" [routerLink]="['/feed/daily', on]">{{ on }}</a>
                } @empty {
                  <p appHelp>
                    No linked supply days recorded. This does not mean no fodder was cut.
                  </p>
                }
              </section>
            }
          }
        }
      }
      @if (itemOpen) {
        <div class="max-w-[720px]">
          <app-feed-editor
            entity="items"
            [record]="itemEdit"
            (saved)="saved($event)"
            (cancelled)="itemOpen = false"
          />
        </div>
      }
      @if (revisions().length) {
        <section appCard class="space-y-3">
          <h3 class="font-medium">Recoverable correction history</h3>
          @for (r of revisions(); track r.id) {
            <details>
              <summary>{{ r.operation }} · revision {{ r.revision }} · {{ r.recorded_at }}</summary>
              <pre class="whitespace-pre-wrap break-all text-xs">{{ r.before_json }}</pre>
              <pre class="whitespace-pre-wrap break-all text-xs">{{ r.after_json }}</pre>
              <p>{{ r.provenance }}</p>
            </details>
          }
        </section>
      }
      @if (removeTarget) {
        <section appCard>
          <p>
            Remove this {{ removeTarget.crop_id ? 'expense' : 'purchase' }}? The audit trail
            remains. A linked purchase cannot be removed.
          </p>
          @if (session.ready()) {
            <button appButton (click)="remove()" [appButtonDisabled]="state.submitting()">
              Confirm removal
            </button>
          } @else {
            <app-session-required what="this removal" />
          }
          <button appButton variant="secondary" (click)="removeTarget = null">Keep record</button>
          @if (state.error(); as e) {
            <p appErrorPanel>{{ e.message }}</p>
          }
        </section>
      }
    </div>
  `,
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
  catalogue = false;
  itemOpen = false;
  itemEdit: FeedRecord | null = null;
  editor = false;
  editRecord: FeedRecord | null = null;
  expenseOpen = false;
  expenseEdit: FeedRecord | null = null;
  removeTarget: FeedRecord | null = null;
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => {
      this.mode = this.route.snapshot.data['feedMode'] ?? 'overview';
      this.id = this.route.snapshot.paramMap.get('id') ?? '';
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
        this.mode !== 'purchases' ||
        ((!this.itemFilter || r.item_id === this.itemFilter) &&
          (!this.from || r.on >= this.from) &&
          (!this.to || r.on <= this.to)),
    );
  }
  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.items.set(await this.api.feedGet<FeedRecord[]>('items'));
      if (this.mode === 'overview' || this.mode === 'daily') await this.loadRange();
      else {
        this.records.set(await this.api.feedGet<FeedRecord[]>(this.mode));
        if (this.id && this.id !== 'new')
          this.detail.set(await this.api.feedGet<FeedRecord>(this.mode + '/' + this.id));
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }
  async loadRange() {
    try {
      const q = new URLSearchParams({ to: this.to });
      if (this.from) q.set('from', this.from);
      const o = await this.api.feedGet<FeedOverview>('overview?' + q);
      this.overview.set(o);
      this.from = o.from;
      this.to = o.to;
      this.error.set('');
    } catch (e) {
      this.error.set(String(e));
    }
  }
  cancelEditor() {
    this.editor = false;
    if (this.id === 'new') void this.router.navigate(['/feed', this.mode]);
  }
  async saved(r: FeedRecord) {
    const primary = !this.itemOpen && !this.expenseOpen;
    this.itemOpen = false;
    this.expenseOpen = false;
    if (primary) this.editor = false;
    if (primary && this.id === 'new') {
      await this.router.navigate(['/feed', this.mode, r.id]);
    } else await this.load();
  }
  async showRevisions(d: FeedRecord, entity = this.mode) {
    try {
      this.revisions.set(await this.api.feedGet(entity + '/' + d.id + '/revisions'));
    } catch (e) {
      this.error.set(String(e));
    }
  }
  async remove() {
    const r = this.removeTarget;
    if (!r || !this.session.ready() || this.state.submitting()) return;
    const v = await this.state.run((k) =>
      this.api.feedWrite(
        (r.crop_id ? 'expenses' : 'purchases') + '/' + r.id + '/delete',
        { revision: r.revision, ...this.session.provenance() },
        k,
      ),
    );
    if (v) {
      this.log.announce('Removed feed record; audit trail retained.');
      this.removeTarget = null;
      if (!r.crop_id) await this.router.navigate(['/feed/purchases']);
      else await this.load();
    }
  }
}
