import { Metric, CoverageNotice, ChartPanel, ChartDataTable, RecordDrilldown } from '../ui/reporting';
import { TextInput } from '../ui/input';
import { Cell } from '../ui/cell';
import { Certainty } from '../ui/certainty';
import { ScrollRegion } from '../ui/scroll-region';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration } from 'chart.js';
import type { AnalyticsReport, Coverage, MilkMetrics, AnalyticsBucket } from '@dairy/shared';
import { Theme } from '../core/theme';
import { RegistryApi } from './api';
import { WriteLog } from './after-write';
import { urlParams } from './url-state';
import { farmToday } from './today';
import { ShellActions } from './navigation';
import { Pagination } from '../ui/pagination';
import { Button } from '../ui/button';
import { PageHeading } from '../ui/heading';

@Component({
  selector: 'app-analytics-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Metric, CoverageNotice, ChartPanel, ChartDataTable, RecordDrilldown,
    TextInput,
    Cell,
    Certainty,
    ScrollRegion,
    DecimalPipe,
    RouterLink,
    BaseChartDirective,
    Pagination,
    Button,
    PageHeading,
  ],
  template: `
    <div data-page-layout="review">
      <div class="mx-auto  space-y-6">
        <header class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-sm text-content-muted">Farm review</p>
            <h1 appPageHeading>Milk analytics</h1>
            <p class="mt-1 text-sm text-content-secondary">
              Production, recording coverage and where the milk went.
            </p>
          </div>
          <button appButton variant="secondary" (click)="refresh()" [disabled]="loading()">
            Refresh
          </button>
        </header>
        <section
          class="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-raised p-4"
          aria-label="Review filters"
        >
          <label
            >Review
            <select
              appInput
              [value]="q().view"
              (change)="change({ view: $any($event.target).value })"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select></label
          >
          <button appButton variant="secondary" aria-label="Previous period" (click)="step(-1)">
            ←</button
          ><label
            >Date
            <input
              appInput
              type="date"
              [value]="q().on"
              (change)="change({ on: $any($event.target).value })" /></label
          ><button appButton variant="secondary" aria-label="Next period" (click)="step(1)">
            →
          </button>
          <label
            >Session
            <select
              appInput
              [value]="q().session"
              (change)="change({ session: $any($event.target).value })"
            >
              <option value="all">All sessions</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
            </select></label
          >
        </section>
        @if (error()) {
          <p role="alert" class="rounded-xl border border-line p-4 text-content-primary">
            {{ error() }}
            <button appButton variant="secondary" (click)="refresh()" [disabled]="loading()">
              Retry
            </button>
            @if (report()) {
              Previous results remain below and are stale; retry to update them.
            }
          </p>
        }
        @if (loading()) {
          <p role="status" class="text-content-muted">
            Loading review… {{ report() ? 'Previous results are stale while refreshing.' : '' }}
          </p>
        }
        @if (report(); as r) {
          <div class="flex flex-wrap justify-between gap-2 text-sm text-content-muted">
            <p>
              {{ r.scope.from }} – {{ r.scope.to }} · {{ r.timezone }}
              @if (r.scope.inProgress) {
                · In progress
              }
            </p>
            <p>Updated {{ updated(r.generatedAt) }}</p>
          </div>
          <section class="analytics-summary" aria-label="Period totals">
            <article appMetric class="rounded-xl border border-line bg-surface-raised p-5">
              <h2 class="text-sm text-content-secondary">Measured production</h2>
              <p class="mt-2 text-3xl font-semibold tabular-nums">
                <span
                  [certaintyLabel]="production(r.metrics.produced, r.metrics.coverage)"
                  [appCertainty]="r.metrics.produced === null ? 'no-record' : 'known'"
                  >{{ production(r.metrics.produced, r.metrics.coverage) }}</span
                >
              </p>
              <p class="mt-2 text-sm text-content-muted">
                {{ productionNote(r.metrics.coverage, r.metrics.produced) }}
              </p>
            </article>
            <article appMetric class="rounded-xl border border-line bg-surface-raised p-5">
              <h2 class="text-sm text-content-secondary">Recorded dispatch</h2>
              <p class="mt-2 text-3xl font-semibold tabular-nums">
                <span
                  [certaintyLabel]="dispatch(r.metrics)"
                  [appCertainty]="r.metrics.dispatched === null ? 'no-record' : 'known'"
                  >{{ dispatch(r.metrics) }}</span
                >
              </p>
              <p class="mt-2 text-sm text-content-muted">
                Sold {{ r.metrics.sold | number: '1.0-2' }} L · Non-sale
                {{ r.metrics.nonSale | number: '1.0-2' }} L
              </p>
            </article>
            <article appMetric class="rounded-xl border border-line bg-surface-raised p-5">
              <h2 class="text-sm text-content-secondary">Difference</h2>
              <p class="mt-2 text-3xl font-semibold tabular-nums">
                <span [appCertainty]="r.metrics.difference === null ? 'absent' : 'known'">{{
                  litres(r.metrics.difference)
                }}</span>
              </p>
              <p class="mt-2 text-sm text-content-muted">
                @if (r.metrics.differencePct !== null) {
                  {{ r.metrics.differencePct | number: '1.0-2' }}% ·
                }
                Measured minus dispatched; not a wastage measure. {{ differenceNote(r.metrics) }}
              </p>
            </article>
            <article appMetric class="rounded-xl border border-line bg-surface-raised p-5">
              <h2 class="text-sm text-content-secondary">Coverage</h2>
              <p class="mt-2 text-3xl font-semibold tabular-nums">
                {{ r.metrics.coverage.measured }} / {{ r.metrics.coverage.expected }}
              </p>
              <p class="mt-2 text-sm text-content-muted">
                Expected animal sessions · {{ coverageText(r.metrics.coverage) }}
              </p>
            </article>
          </section>
          <section appChartPanel>
            <h2 class="font-semibold">Production and dispatch</h2>
            <p appCoverageNotice class="mb-4">
              Litres by {{ q().view === 'day' ? 'session' : 'day' }}. Gaps mean no measurements;
              larger points mark incomplete production. Select a point to inspect its date; the
              table provides the same information.
            </p>
            <div class="h-64 min-w-0 overflow-hidden">
              <canvas
                baseChart
                type="line"
                [data]="chartData()"
                [options]="chartOptions()"
                (chartClick)="selectPoint($event)"
                aria-label="Measured production and recorded dispatch in litres"
                role="img"
              ></canvas>
            </div>
            <div class="my-3 flex flex-wrap items-end gap-2">
            <label class="block text-sm">Inspect date / session
              <select appInput class="ml-2" (change)="inspectBucket($any($event.target).value)">
                <option value="|" [selected]="bucketIndex() < 0">Choose a date…</option>
                @for (b of r.buckets; track b.key) {
                  <option [value]="b.on + '|' + b.session" [selected]="b.on === q().detailOn && b.session === q().detailSession">{{ b.on }} · {{ b.session }}</option>
                }
              </select>
            </label>
            <button appButton variant="secondary" [disabled]="bucketIndex() <= 0" (click)="moveBucket(-1)">Previous date / session</button>
            <button appButton variant="secondary" [disabled]="bucketIndex() >= r.buckets.length - 1" (click)="moveBucket(1)">Next date / session</button>
            </div>
            <button
              appButton
              variant="secondary"
              [attr.aria-expanded]="showData()"
              aria-controls="analytics-chart-data"
              (click)="showData.set(!showData())"
            >
              {{ showData() ? 'Hide data' : 'Show data' }} · Production and dispatch
            </button>
            <div
              id="analytics-chart-data"
              [hidden]="!showData()"
              appScrollRegion="Production and dispatch chart data"
            >
              <table appChartDataTable class="w-full text-sm">
                <caption class="sr-only">
                  Production and dispatch by date and session
                </caption>
                <thead>
                  <tr>
                    <th appCell scope="col">Date / session</th>
                    <th appCell numeric scope="col">Measured production</th>
                    <th appCell numeric scope="col">Recorded dispatch</th>
                    <th appCell numeric scope="col">Difference</th>
                    <th appCell scope="col">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  @for (b of r.buckets; track b.key) {
                    <tr>
                      <td appCell>
                        <button
                          appButton
                          variant="link"
                          [attr.aria-label]="bucketLabel(b)"
                          (click)="change({ detailOn: b.on, detailSession: b.session }, false)"
                        >
                          {{ b.on }} · {{ b.session }}
                        </button>
                      </td>
                      <td appCell numeric>{{ production(b.produced, b.coverage) }}</td>
                      <td appCell numeric>{{ dispatch(b) }}</td>
                      <td appCell numeric>{{ litres(b.difference) }}</td>
                      <td appCell>{{ differenceNote(b) }} {{ coverageText(b.coverage) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
          @if (r.comparison.percent === null) { <p class="text-sm text-content-muted">Comparison unavailable: {{ r.comparison.reason }}</p> }
          <details class="rounded-xl border border-line bg-surface-raised p-4 space-y-2" [open]="r.comparison.percent !== null">
            <summary class="font-semibold">Production comparison{{ r.comparison.percent === null ? " · unavailable" : "" }}</summary>
            @if (r.comparison.percent !== null) {
              <p>
                {{ r.comparison.percent | number: '1.0-2' }}% ·
                {{ litres(r.comparison.current) }} vs
                {{ litres(r.comparison.previous) }}
              </p>
            } @else {
              <p class="text-content-muted">{{ r.comparison.reason }}</p>
            }
            @if (r.comparison.from) {
              <p class="text-sm text-content-muted">
                {{ r.comparison.from }}–{{ r.comparison.to }} compared with
                {{ r.comparison.previousFrom }}–{{ r.comparison.previousTo }}.
                {{ r.comparison.currentDays }} vs {{ r.comparison.previousDays }} days; daily
                averages {{ litres(r.comparison.currentDailyAverage) }} vs
                {{ litres(r.comparison.previousDailyAverage) }}.
              </p>
            }
            @if (q().session === 'all') {
              <p class="text-sm">
                Mean daily yield: {{ litres(r.metrics.meanDailyYield) }} per fully measured
                animal-day · {{ r.metrics.eligibleAnimalDays }} eligible,
                {{ r.metrics.excludedAnimalDays }} excluded.
                @if (r.metrics.meanDailyYield === null) {
                  No eligible fully measured animal-days.
                }
              </p>
            }
          </details>
          <section
            class="rounded-xl border border-line p-4 space-y-2"
            appRecordDrilldown aria-label="Recording review"
          >
            <h2 class="font-semibold">Records to review</h2>
            @if (r.metrics.coverage.recordingPct !== null) {
              <p class="text-sm">
                {{ r.metrics.coverage.recordingPct | number: '1.0-1' }}% of expected animal sessions
                have a recorded answer.
              </p>
            }
            <p class="text-sm">
              {{ coverageText(r.metrics.coverage) }} · {{ r.metrics.dispatchMissing }} standing
              dispatch answers missing · {{ r.metrics.dispatchPending }} not yet recorded.
            </p>
            <p class="text-sm text-content-muted">
              Historical gaps mean no records in the selected period; recording obligations before
              adoption are unknown. Occasional dispatches and retained milk may not be fully
              recorded.
            </p>
            @if (r.metrics.unavailableReasons.length) {
              <p class="text-sm text-content-muted">
                Difference percentage unavailable: {{ reasons(r.metrics.unavailableReasons) }}.
              </p>
            }
          </section>
          <section class="rounded-xl border border-line bg-surface-raised p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex gap-2">
                <button
                  appButton
                  [variant]="q().table === 'production' ? 'primary' : 'secondary'"
                  (click)="table('production')"
                >
                  By animal</button
                ><button
                  appButton
                  [variant]="q().table === 'reconciliation' ? 'primary' : 'secondary'"
                  (click)="table('reconciliation')"
                >
                  Reconciliation
                </button>
              </div>
              @if (q().table === 'production') {
                <label
                  >Find animal
                  <input
                    appInput
                    type="search"
                    maxlength="100"
                    [value]="q().search"
                    (change)="change({ search: $any($event.target).value }, false)"
                /></label>
              }
              @if (q().search) { <button appButton variant="link" (click)="change({ search: '' }, false)">Clear animal filter</button> }
              <label
                >Sort
                <select
                  appInput
                  [value]="q().sort"
                  (change)="change({ sort: $any($event.target).value }, false)"
                >
                  @if (q().table === 'production') {
                    <option value="identifier">Animal</option>
                    <option value="litres">Measured litres</option>
                  } @else {
                    <option value="date">Date</option>
                    <option value="difference">Difference</option>
                  }
                </select></label
              ><label
                >Order
                <select
                  appInput
                  [value]="q().direction"
                  (change)="change({ direction: $any($event.target).value }, false)"
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select></label
              >
            </div>
            @if (q().detailOn) {
              <p class="my-3">
                Detail date: {{ q().detailOn }} {{ q().detailSession }}
                <button
                  appButton
                  variant="secondary"
                  (click)="change({ detailOn: '', detailSession: '' }, false)"
                >
                  Clear
                </button>
              </p>
            }
            <div
              class="mt-4"
              [appScrollRegion]="
                q().table === 'production'
                  ? 'Animal production details'
                  : 'Session reconciliation details'
              "
            >
              <table class="w-full text-left text-sm">
                <caption class="sr-only">
                  {{
                    q().table === 'production' ? 'Animal production' : 'Session reconciliation'
                  }}
                  details
                </caption>
                @if (q().table === 'production') {
                  <thead>
                    <tr>
                      <th appCell scope="col">Animal</th>
                      <th appCell numeric scope="col">Measured milk</th>
                      <th appCell scope="col">Coverage</th>
                      <th appCell numeric scope="col">Complete animal-days</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (a of r.production.items; track a.id) {
                      <tr class="border-t border-line">
                        <td appCell class="py-3">
                          <a
                            class="underline whitespace-nowrap"
                            [routerLink]="['/animals', a.id]"
                            >{{ a.identifier }}</a
                          >
                          {{ a.name }}
                          @if (a.tag) {
                            <span class="text-content-muted"> · {{ a.tag }}</span>
                          }
                        </td>
                        <td appCell numeric>
                          <span
                            [certaintyLabel]="production(a.litres, a.coverage)"
                            [appCertainty]="a.litres === null ? 'no-record' : 'known'"
                            >{{ production(a.litres, a.coverage) }}</span
                          >
                        </td>
                        <td appCell>
                          {{ a.coverage.measured }}/{{ a.coverage.expected }} measured<br /><span
                            class="text-xs text-content-muted"
                            >{{ coverageText(a.coverage) }}</span
                          >
                        </td>
                        <td appCell numeric>
                          {{ q().session === 'all' ? a.eligibleAnimalDays : '—' }}
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td appCell colspan="4" class="py-8 text-content-muted">
                          No matching animal records for this period.
                        </td>
                      </tr>
                    }
                  </tbody>
                } @else {
                  <thead>
                    <tr>
                      <th appCell scope="col">Date / session</th>
                      <th appCell numeric scope="col">Measured</th>
                      <th appCell numeric scope="col">Sold</th>
                      <th appCell numeric scope="col">Non-sale</th>
                      <th appCell numeric scope="col">Difference</th>
                      <th appCell scope="col">Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (b of r.reconciliation.items; track b.key) {
                      <tr class="border-t border-line">
                        <td appCell class="py-3">{{ b.on }}<br />{{ b.session }}</td>
                        <td appCell numeric>{{ production(b.produced, b.coverage) }}</td>
                        <td appCell numeric>{{ litres(b.sold) }}</td>
                        <td appCell numeric>{{ litres(b.nonSale) }}</td>
                        <td appCell numeric>
                          {{ litres(b.difference) }}<br /><span
                            class="text-xs text-content-muted"
                            >{{ differenceNote(b) + ' · ' + coverageText(b.coverage) }}</span
                          >
                        </td>
                        <td appCell>
                          <a
                            class="underline"
                            routerLink="/milk/milking"
                            [queryParams]="{ on: b.on, session: b.session }"
                            >Milking</a
                          >
                          ·
                          <a
                            class="underline"
                            routerLink="/milk/dispatch"
                            [queryParams]="{ on: b.on, session: b.session }"
                            >Dispatch</a
                          >
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td appCell colspan="6" class="py-8 text-content-muted">
                          No elapsed sessions in this period.
                        </td>
                      </tr>
                    }
                  </tbody>
                }
              </table>
            </div>
            <app-pagination
              label="Analytics details"
              [page]="visiblePage().page"
              [pageSize]="visiblePage().pageSize"
              [total]="visiblePage().totalItems"
              [disabled]="loading()"
              (pageChange)="url.set({ page: '' + $event })"
              (sizeChange)="change({ pageSize: '' + $event }, false)"
            />
            <p class="text-xs text-content-muted">
              Cards and charts cover the full period. Pagination and animal search affect only this
              detail table.
            </p>
          </section>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .analytics-summary {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
      }
      @media (min-width: 768px) {
        .analytics-summary {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
      canvas {
        max-width: 100%;
      }
      td {
        vertical-align: top;
      }
    `,
  ],
})
export class AnalyticsPage {
  protected bucketIndex() {
    return this.report()?.buckets.findIndex(b => b.on === this.q().detailOn && b.session === this.q().detailSession) ?? -1;
  }
  protected moveBucket(delta: number) {
    const buckets = this.report()?.buckets ?? [];
    const next = buckets[this.bucketIndex() + delta];
    if (next) this.inspectBucket(next.on + '|' + next.session);
  }
  protected inspectBucket(value: string) {
    const [detailOn, detailSession] = value.split('|');
    this.change({ detailOn, detailSession: (detailSession || 'all') as any }, false);
  }

  private readonly api = inject(RegistryApi);
  private readonly writes = inject(WriteLog);
  private readonly theme = inject(Theme);
  private readonly shell = inject(ShellActions);
  readonly url = urlParams({
    view: 'day',
    on: farmToday(),
    session: 'all',
    table: 'production',
    page: '1',
    pageSize: '25',
    sort: '',
    direction: '',
    search: '',
    detailOn: '',
    detailSession: '',
  });
  readonly q = computed(() => {
    const q = this.url.value();
    return {
      ...q,
      sort: q.sort || (q.table === 'reconciliation' ? 'date' : 'identifier'),
      direction: q.direction || (q.table === 'reconciliation' ? 'desc' : 'asc'),
    };
  });
  readonly showData = signal(false);
  readonly report = signal<AnalyticsReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private readonly revision = signal(0);
  private request = 0;
  private queryKey = '';
  readonly visiblePage = computed(() =>
    this.q().table === 'production' ? this.report()!.production : this.report()!.reconciliation,
  );
  constructor() {
    effect(() => {
      this.revision();
      this.shell.recheck();
      this.writes.seq();
      void this.load(this.q());
    });
  }
  refresh() {
    this.revision.update((n) => n + 1);
  }
  async load(q: Record<string, string>) {
    const request = ++this.request;
    const key = JSON.stringify(q);
    if (key !== this.queryKey) {
      this.report.set(null);
      this.queryKey = key;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const r = await this.api.analytics(q);
      if (request !== this.request) return;
      this.report.set(r);
      const p = q['table'] === 'reconciliation' ? r.reconciliation : r.production;
      if (p.page !== Number(q['page'])) this.url.set({ page: '' + p.page });
    } catch (e) {
      if (request === this.request)
        this.error.set(e instanceof Error ? e.message : 'Could not load analytics.');
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
  change(patch: Partial<ReturnType<typeof this.q>>, clearDetail = true) {
    this.url.set({
      ...patch,
      page: '1',
      ...(clearDetail ? { detailOn: '', detailSession: '' } : {}),
    });
  }
  table(table: string) {
    this.change(
      {
        table,
        sort: table === 'production' ? 'identifier' : 'date',
        direction: table === 'production' ? 'asc' : 'desc',
        search: '',
      },
      false,
    );
  }
  step(n: number) {
    const d = new Date(this.q().on);
    if (!Number.isFinite(d.getTime())) return;
    if (this.q().view === 'month') {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + n);
    } else d.setUTCDate(d.getUTCDate() + n * (this.q().view === 'week' ? 7 : 1));
    this.change({ on: d.toISOString().slice(0, 10) });
  }
  updated(value: string) {
    return new Intl.DateTimeFormat('en-PK', {
      timeZone: 'Asia/Karachi',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }
  litres(n: number | null) {
    return n === null
      ? 'Not available'
      : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n) + ' L';
  }
  production(n: number | null, c: Coverage) {
    if (n !== null) return this.litres(n);
    return c.measured + c.unmeasured + c.notMilked + c.unexpected > 0
      ? 'No measurements'
      : 'No records';
  }
  dispatch(m: MilkMetrics) {
    return m.dispatched !== null
      ? this.litres(m.dispatched)
      : m.dispatchRows === 0
        ? 'No records'
        : 'Not available';
  }
  differenceNote(m: MilkMetrics) {
    const c = m.coverage;
    const partial =
      c.missing +
      c.unmeasured +
      c.pending +
      c.unexpected +
      c.uncertain +
      m.dispatchMissing +
      m.dispatchPending;
    const reason = this.reasons(m.unavailableReasons);
    if (m.difference === null)
      return (
        'Difference unavailable' +
        (reason ? ': ' + reason : '; insufficient comparable records') +
        '.'
      );
    return (
      (partial
        ? 'Partial coverage; not evidence of loss or surplus.'
        : 'Recorded coverage only; retained milk and occasional dispatch may be unrecorded.') +
      (reason ? ' ' + reason + '.' : '')
    );
  }
  bucketLabel(b: AnalyticsBucket) {
    return `${b.on}, ${b.session}: measured ${this.production(b.produced, b.coverage)}, dispatch ${this.dispatch(b)}, difference ${this.litres(b.difference)}. ${this.differenceNote(b)} ${this.coverageText(b.coverage)}`;
  }
  coverageText(c: Coverage) {
    return [
      `${c.unmeasured} unmeasured`,
      `${c.notMilked} not milked`,
      `${c.missing} missing`,
      `${c.pending} pending`,
      ...(c.unexpected ? [`${c.unexpected} outside expected roster`] : []),
      ...(c.uncertain ? [`${c.uncertain} approximate roster slots`] : []),
    ].join(' · ');
  }
  productionNote(c: Coverage, n: number | null) {
    return n === null
      ? 'No measurements recorded'
      : c.missing + c.unmeasured + c.pending + c.unexpected + c.uncertain
        ? 'Partial or qualified measured total'
        : 'Recorded production accounted for';
  }
  reasons(rs: string[]) {
    const labels: Record<string, string> = {
      incomplete_production: 'incomplete production',
      pending_production: 'production not yet recorded',
      unexpected_production: 'rows outside expected roster',
      approximate_roster_dates: 'approximate roster dates',
      incomplete_dispatch: 'standing dispatch records missing',
      pending_dispatch: 'standing dispatch not yet recorded',
      no_dispatch_records: 'no dispatch records',
      no_measurements: 'no measurements',
      zero_production: 'zero production',
      no_records: 'no elapsed records',
    };
    return rs.map((r) => labels[r] ?? r).join('; ');
  }
  readonly colors = computed(() => {
    this.theme.resolved();
    const css = getComputedStyle(document.documentElement);
    return {
      milk: `rgb(${css.getPropertyValue('--fill-brand').trim()})`,
      dispatch: `rgb(${css.getPropertyValue('--text-secondary').trim()})`,
      text: `rgb(${css.getPropertyValue('--text-muted').trim()})`,
    };
  });
  readonly chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const bs = this.report()?.buckets ?? [],
      c = this.colors();
    return {
      labels: bs.map((b) => (b.session === 'all' ? b.on : b.session)),
      datasets: [
        {
          label: 'Measured milk (L)',
          data: bs.map((b) => b.produced),
          borderColor: c.milk,
          backgroundColor: c.milk,
          spanGaps: false,
          pointRadius: bs.map((b) =>
            b.coverage.missing + b.coverage.unmeasured + b.coverage.pending ? 6 : 3,
          ),
        },
        {
          label: 'Recorded dispatch (L)',
          data: bs.map((b) => b.dispatched),
          borderColor: c.dispatch,
          backgroundColor: c.dispatch,
          borderDash: [5, 4],
          spanGaps: false,
        },
      ],
    };
  });
  readonly chartOptions = computed<ChartConfiguration<'line'>['options']>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: this.colors().text } } },
    scales: {
      x: { ticks: { color: this.colors().text } },
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Litres', color: this.colors().text },
        ticks: { color: this.colors().text },
      },
    },
  }));
  selectPoint(event: { active?: object[] }) {
    const index = (event.active?.[0] as { index?: number } | undefined)?.index;
    if (index !== undefined) {
      const b = this.report()?.buckets[index];
      if (b) this.change({ detailOn: b.on, detailSession: b.session }, false);
    }
  }
}
