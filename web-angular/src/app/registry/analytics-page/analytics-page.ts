import { Metric, CoverageNotice, ChartPanel, ChartDataTable, RecordDrilldown } from "../../ui/reporting";
import { TextInput } from "../../ui/input";
import { Cell } from "../../ui/cell";
import { Certainty } from "../../ui/certainty";
import { ScrollRegion } from "../../ui/scroll-region";
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
import { Theme } from "../../core/theme";
import { RegistryApi } from "../api";
import { WriteLog } from "../after-write";
import { urlParams } from "../url-state";
import { farmToday } from "../today";
import { ShellActions } from "../navigation";
import { Pagination } from "../../ui/pagination/pagination";
import { Button } from "../../ui/button";
import { PageHeading } from "../../ui/heading";

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
  templateUrl: './analytics-page.html',
  styleUrl: './analytics-page.css',

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
        ".."
      );
    return (
      (partial
        ? 'Partial coverage; not evidence of loss or surplus.'
        : 'Recorded coverage only; retained milk and occasional dispatch may be unrecorded.') +
      (reason ? ' ' + reason + ".." : '')
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
