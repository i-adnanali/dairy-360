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
import type { AnalyticsReport, Coverage } from '@dairy/shared';
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
  imports: [DecimalPipe, RouterLink, BaseChartDirective, Pagination, Button, PageHeading],
  template: `<div class="mx-auto max-w-6xl space-y-6">
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
        <select [value]="q().view" (change)="change({ view: $any($event.target).value })">
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
          type="date"
          [value]="q().on"
          (change)="change({ on: $any($event.target).value })" /></label
      ><button appButton variant="secondary" aria-label="Next period" (click)="step(1)">→</button>
      <label
        >Session
        <select [value]="q().session" (change)="change({ session: $any($event.target).value })">
          <option value="all">All sessions</option>
          <option value="morning">Morning</option>
          <option value="evening">Evening</option>
        </select></label
      >
    </section>
    @if (error()) {
      <p role="alert" class="rounded-xl border border-line p-4 text-content-primary">
        {{ error() }}
        @if (report()) {
          Previous results remain below; refresh to update them.
        }
      </p>
    }
    @if (loading()) {
      <p role="status" class="text-content-muted">Loading review…</p>
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
      <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Period totals">
        <article class="rounded-xl border border-line bg-surface-raised p-5">
          <h2 class="text-sm text-content-secondary">Measured milk</h2>
          <p class="mt-2 text-3xl font-semibold tabular-nums">{{ litres(r.metrics.produced) }}</p>
          <p class="mt-2 text-sm text-content-muted">
            {{ productionNote(r.metrics.coverage, r.metrics.produced) }}
          </p>
        </article>
        <article class="rounded-xl border border-line bg-surface-raised p-5">
          <h2 class="text-sm text-content-secondary">Measurement coverage</h2>
          <p class="mt-2 text-3xl font-semibold tabular-nums">
            {{ r.metrics.coverage.measured }} / {{ r.metrics.coverage.expected }}
          </p>
          <p class="mt-2 text-sm text-content-muted">
            Expected animal sessions · {{ coverageText(r.metrics.coverage) }}
          </p>
        </article>
        <article class="rounded-xl border border-line bg-surface-raised p-5">
          <h2 class="text-sm text-content-secondary">Recorded dispatch</h2>
          <p class="mt-2 text-3xl font-semibold tabular-nums">{{ litres(r.metrics.dispatched) }}</p>
          <p class="mt-2 text-sm text-content-muted">
            Sold {{ r.metrics.sold | number: '1.0-2' }} L · Non-sale
            {{ r.metrics.nonSale | number: '1.0-2' }} L
          </p>
        </article>
        <article class="rounded-xl border border-line bg-surface-raised p-5">
          <h2 class="text-sm text-content-secondary">Unreconciled difference</h2>
          <p class="mt-2 text-3xl font-semibold tabular-nums">{{ litres(r.metrics.difference) }}</p>
          <p class="mt-2 text-sm text-content-muted">
            @if (r.metrics.differencePct !== null) {
              {{ r.metrics.differencePct | number: '1.0-2' }}% ·
            }
            Measured minus dispatched; not a wastage measure.
          </p>
        </article>
      </section>
      <section class="rounded-xl border border-line bg-surface-raised p-5 space-y-2">
        <h2 class="font-semibold">Production comparison</h2>
        @if (r.comparison.percent !== null) {
          <p>
            {{ r.comparison.percent | number: '1.0-2' }}% · {{ litres(r.comparison.current) }} vs
            {{ litres(r.comparison.previous) }}
          </p>
        } @else {
          <p class="text-content-muted">{{ r.comparison.reason }}</p>
        }
        @if (r.comparison.from) {
          <p class="text-sm text-content-muted">
            {{ r.comparison.from }}–{{ r.comparison.to }} compared with
            {{ r.comparison.previousFrom }}–{{ r.comparison.previousTo }}.
            {{ r.comparison.currentDays }} vs {{ r.comparison.previousDays }} days; daily averages
            {{ litres(r.comparison.currentDailyAverage) }} vs
            {{ litres(r.comparison.previousDailyAverage) }}.
          </p>
        }
        @if (q().session === 'all') {
          <p class="text-sm">
            Mean daily yield: {{ litres(r.metrics.meanDailyYield) }} per fully measured animal-day ·
            {{ r.metrics.eligibleAnimalDays }} eligible,
            {{ r.metrics.excludedAnimalDays }} excluded.
          </p>
        }
      </section>
      <section class="rounded-xl border border-line bg-surface-raised p-5">
        <h2 class="font-semibold">Production and dispatch</h2>
        <p class="mb-4 text-sm text-content-muted">
          Litres by {{ q().view === 'day' ? 'session' : 'day' }}. Gaps mean no measurements; larger points mark incomplete production. Select
          a point to inspect its date; the table provides the same information.
        </p>
        <div class="h-64">
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
        <div class="mt-3 flex flex-wrap gap-2" aria-label="Inspect chart dates">
          @for (b of r.buckets; track b.key) {
            <button
              appButton
              variant="link"
              (click)="change({ detailOn: b.on, detailSession: b.session }, false)"
            >
              {{ b.session === 'all' ? b.on : b.session }}
            </button>
          }
        </div>
      </section>
      <section class="rounded-xl border border-line p-4 space-y-2" aria-label="Recording review">
        <h2 class="font-semibold">Records to review</h2>
        @if (r.metrics.coverage.recordingPct !== null) {
          <p class="text-sm">
            {{ r.metrics.coverage.recordingPct | number: '1.0-1' }}% of expected animal sessions
            have a recorded answer.
          </p>
        }
        <p class="text-sm">
          {{ coverageText(r.metrics.coverage) }} · {{ r.metrics.dispatchMissing }} standing dispatch
          answers missing · {{ r.metrics.dispatchPending }} not yet recorded.
        </p>
        <p class="text-sm text-content-muted">
          Historical gaps mean no records in the selected period; recording obligations before
          adoption are unknown. Occasional dispatches and retained milk may not be fully recorded.
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
                type="search"
                maxlength="100"
                [value]="q().search"
                (change)="change({ search: $any($event.target).value }, false)"
            /></label>
          }
          <label
            >Sort
            <select
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
        <div class="mt-4 overflow-x-auto">
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
                  <th>Animal</th>
                  <th>Measured milk</th>
                  <th>Coverage</th>
                  <th>Complete animal-days</th>
                </tr>
              </thead>
              <tbody>
                @for (a of r.production.items; track a.id) {
                  <tr class="border-t border-line">
                    <td class="py-3">
                      <a class="underline" [routerLink]="['/animals', a.id]">{{ a.identifier }}</a>
                      {{ a.name }}
                      @if (a.tag) {
                        <span class="text-content-muted"> · {{ a.tag }}</span>
                      }
                    </td>
                    <td>{{ litres(a.litres) }}</td>
                    <td>
                      {{ a.coverage.measured }}/{{ a.coverage.expected }} measured<br /><span
                        class="text-xs text-content-muted"
                        >{{ coverageText(a.coverage) }}</span
                      >
                    </td>
                    <td>{{ q().session === 'all' ? a.eligibleAnimalDays : '—' }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="4" class="py-8 text-content-muted">
                      No matching animal records for this period.
                    </td>
                  </tr>
                }
              </tbody>
            } @else {
              <thead>
                <tr>
                  <th>Date / session</th>
                  <th>Measured</th>
                  <th>Sold</th>
                  <th>Non-sale</th>
                  <th>Difference</th>
                  <th>Records</th>
                </tr>
              </thead>
              <tbody>
                @for (b of r.reconciliation.items; track b.key) {
                  <tr class="border-t border-line">
                    <td class="py-3">{{ b.on }}<br />{{ b.session }}</td>
                    <td>{{ litres(b.produced) }}</td>
                    <td>{{ litres(b.sold) }}</td>
                    <td>{{ litres(b.nonSale) }}</td>
                    <td>
                      {{ litres(b.difference) }}<br /><span class="text-xs text-content-muted">{{
                        coverageText(b.coverage)
                      }}</span>
                    </td>
                    <td>
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
                    <td colspan="6" class="py-8 text-content-muted">
                      No elapsed sessions in this period.
                    </td>
                  </tr>
                }
              </tbody>
            }
          </table>
        </div>
        <app-pagination
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
  </div>`,
  styles: [
    `
      select,
      input {
        border: 1px solid rgb(var(--border-default));
        border-radius: 0.4rem;
        padding: 0.4rem;
        background: transparent;
        margin-left: 0.3rem;
      }
      th {
        padding: 0.6rem 0.5rem 0.6rem 0;
      }
      td {
        padding-right: 0.5rem;
      }
    `,
  ],
})
export class AnalyticsPage {
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
  readonly q = computed(() => { const q=this.url.value(); return {...q, sort:q.sort || (q.table==='reconciliation'?'date':'identifier'), direction:q.direction || (q.table==='reconciliation'?'desc':'asc')}; });
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
      ? 'No records'
      : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n) + ' L';
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
