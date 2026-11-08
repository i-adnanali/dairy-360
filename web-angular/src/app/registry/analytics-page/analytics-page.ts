import { ChartPanel, ChartDataTable } from "../../ui/reporting";
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
import { PageHeading, SectionHeading } from "../../ui/heading";
import { StatusBadge } from "../../ui/surface";
import { HelpText, TextLink } from "../../ui/text";
import { farmMoment } from "../today";
import { feedDay, feedLabel, feedWeekday } from "../feed-format";

@Component({
  selector: 'app-analytics-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartPanel, ChartDataTable,
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
    SectionHeading,
    StatusBadge,
    HelpText,
    TextLink,
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

  /** The day (or, in the day view, the session) picked on the chart. Applies to the WHOLE page. */
  readonly selected = computed<AnalyticsBucket | null>(() => {
    const q = this.q();
    if (!q.detailOn) return null;
    return this.report()?.buckets.find((b) => b.on === q.detailOn && b.session === (q.detailSession || 'all')) ?? null;
  });
  /** The figures follow the selection: the period's totals, or the picked bucket's own. */
  readonly shown = computed<MilkMetrics | null>(() => this.selected() ?? this.report()?.metrics ?? null);
  protected selectBucket(b: AnalyticsBucket) {
    const same = this.selected()?.key === b.key;
    this.change(same ? { detailOn: '', detailSession: '' } : { detailOn: b.on, detailSession: b.session }, false);
  }
  protected clearSelection() {
    this.change({ detailOn: '', detailSession: '' }, false);
  }
  protected readonly views = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];
  protected readonly sessions = [
    { value: 'all', label: 'Both sessions' },
    { value: 'morning', label: 'Morning' },
    { value: 'evening', label: 'Evening' },
  ];
  /** "Sun 8 Nov", "Week of 2–8 Nov", "November 2026" -- what the period IS, in words. */
  protected periodLabel(): string {
    const r = this.report(), q = this.q();
    const from = r?.scope.from, to = r?.scope.to;
    if (q.view === 'day') return `${feedWeekday(q.on)} ${feedDay(q.on)}`;
    if (q.view === 'month') {
      const [y, m] = (from ?? q.on).split('-');
      return `${MONTHS[Number(m) - 1]} ${y}`;
    }
    if (!from || !to) return 'Week of ' + feedDay(q.on);
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    return `Week of ${sameMonth ? Number(from.slice(8)) : feedDay(from)}–${feedDay(to)}`;
  }
  protected periodNoun(): string {
    return this.q().view === 'day' ? 'day' : this.q().view;
  }
  /** "Wed 4 Nov", "Wed 4 Nov · Morning", or "Morning" in the day view. */
  protected bucketName(b: { on: string; session: string }, withDay = true): string {
    const day = `${feedWeekday(b.on)} ${feedDay(b.on)}`;
    const session = b.session === 'all' ? '' : feedLabel(b.session);
    if (!withDay) return session || day;
    return session ? `${day} · ${session}` : day;
  }
  protected sortBy(column: string) {
    const q = this.q();
    const direction = q.sort === column ? (q.direction === 'asc' ? 'desc' : 'asc') : column === 'identifier' || column === 'date' ? (column === 'date' ? 'desc' : 'asc') : 'desc';
    this.change({ sort: column, direction }, false);
  }
  protected ariaSort(column: string): 'ascending' | 'descending' | null {
    return this.q().sort === column ? (this.q().direction === 'asc' ? 'ascending' : 'descending') : null;
  }
  /**
   * Days (or sessions) with something still to record, newest first, each with
   * the sheet that answers it. Was a paragraph of counts with no way to act.
   */
  readonly toReview = computed(() =>
    [...(this.report()?.buckets ?? [])]
      .map((b) => ({
        b,
        milking: b.coverage.missing + b.coverage.pending,
        dispatch: b.dispatchMissing + b.dispatchPending,
      }))
      .filter((x) => x.milking + x.dispatch > 0)
      .sort((a, z) => (a.b.key < z.b.key ? 1 : -1)),
  );
  /**
   * The sessions a "Still to record" link should open: only those with
   * answers missing. A day used to offer both, so "Morning" opened a sheet
   * that was already saved.
   */
  protected sessionsFor(b: AnalyticsBucket, kind: 'milking' | 'dispatch'): ('morning' | 'evening')[] {
    if (b.session === 'morning' || b.session === 'evening') return [b.session];
    const missing = b.missingSessions?.[kind];
    const all: ('morning' | 'evening')[] = ['morning', 'evening'];
    return missing ? all.filter((s) => missing.includes(s)) : all;
  }

  private readonly api = inject(RegistryApi);
  private readonly writes = inject(WriteLog);
  private readonly theme = inject(Theme);
  private readonly shell = inject(ShellActions);
  // A week by default: the day view opened on a morning with nothing recorded
  // yet, which is an empty page ("No records" x3, a blank 0-1 chart).
  readonly url = urlParams({
    view: 'week',
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
    return farmMoment(value);
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
      (reason ? ' Not complete: ' + reason + '.' : '')
    );
  }
  bucketLabel(b: AnalyticsBucket) {
    return `${b.on}, ${b.session}: measured ${this.production(b.produced, b.coverage)}, dispatch ${this.dispatch(b)}, difference ${this.litres(b.difference)}. ${this.differenceNote(b)} ${this.coverageText(b.coverage)}`;
  }
  /** Only what is actually short, in plain words -- not "0 unmeasured · 0 not milked · …". */
  coverageText(c: Coverage) {
    const parts = [
      c.missing ? `${c.missing} missing` : '',
      c.pending ? `${c.pending} not yet recorded` : '',
      c.unmeasured ? `${c.unmeasured} unmeasured` : '',
      c.notMilked ? `${c.notMilked} not milked` : '',
      c.unexpected ? `${c.unexpected} outside the roster` : '',
      c.uncertain ? `${c.uncertain} with approximate roster dates` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Nothing missing';
  }
  /** Short standing for a row: what a badge can say in one word. */
  standing(m: MilkMetrics): { label: string; tone: 'success' | 'warning' | 'ended' } {
    if (m.produced === null && m.dispatched === null) return { label: 'No records', tone: 'ended' };
    const c = m.coverage;
    return c.missing + c.pending + c.unmeasured + c.unexpected + m.dispatchMissing + m.dispatchPending
      ? { label: 'Partial', tone: 'warning' }
      : { label: 'Complete', tone: 'success' };
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
    const v = (n: string) => css.getPropertyValue(n).trim();
    return {
      milk: `rgb(${v('--fill-brand')})`,
      milkSoft: `rgb(${v('--fill-brand')} / 0.25)`,
      dispatch: `rgb(${v('--text-secondary')})`,
      text: `rgb(${v('--text-muted')})`,
      grid: `rgb(${v('--border-hairline')})`,
      ink: `rgb(${v('--text-primary')})`,
    };
  });
  /** Partial buckets get an open bar, the same mark as the milk graph on Today. */
  private partial(b: AnalyticsBucket) {
    return b.coverage.missing + b.coverage.unmeasured + b.coverage.pending > 0;
  }
  readonly chartData = computed<ChartConfiguration<'bar' | 'line'>['data']>(() => {
    const bs = this.report()?.buckets ?? [],
      c = this.colors(),
      sel = this.selected()?.key;
    return {
      labels: bs.map((b) =>
        b.session === 'all'
          ? this.q().view === 'month' ? String(Number(b.on.slice(8))) : `${feedWeekday(b.on)} ${Number(b.on.slice(8))}`
          : feedLabel(b.session),
      ),
      datasets: [
        {
          type: 'bar',
          label: 'Measured milk (L)',
          data: bs.map((b) => b.produced),
          backgroundColor: bs.map((b) => (this.partial(b) ? c.milkSoft : c.milk)),
          borderColor: bs.map((b) => (b.key === sel ? c.ink : c.milk)),
          borderWidth: bs.map((b) => (b.key === sel ? 3 : this.partial(b) ? 1.5 : 0)),
          borderRadius: 3,
          maxBarThickness: 44,
          order: 2,
        },
        {
          type: 'line',
          label: 'Recorded dispatch (L)',
          data: bs.map((b) => b.dispatched),
          borderColor: c.dispatch,
          backgroundColor: c.dispatch,
          borderDash: [5, 4],
          borderWidth: 2,
          pointRadius: 3,
          spanGaps: false,
          order: 1,
        },
      ],
    } as ChartConfiguration<'bar' | 'line'>['data'];
  });
  readonly chartOptions = computed<ChartConfiguration<'bar' | 'line'>['options']>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    // The legend is drawn in HTML beside the heading; Chart.js drew the dashed
    // series as a scribbled block.
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => {
            const b = this.report()?.buckets[items[0]?.dataIndex ?? -1];
            return b ? this.bucketName(b) : '';
          },
          label: (item) => `${item.dataset.label?.replace(' (L)', '')}: ${item.raw === null ? 'no record' : this.litres(item.raw as number)}`,
        },
      },
    },
    onHover: (e, els) => {
      const t = e.native?.target as HTMLElement | undefined;
      if (t) t.style.cursor = els.length ? 'pointer' : 'default';
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: this.colors().text } },
      y: {
        beginAtZero: true,
        grid: { color: this.colors().grid },
        title: { display: true, text: 'Litres', color: this.colors().text },
        ticks: { color: this.colors().text, precision: 0 },
      },
    },
  }));
  selectPoint(event: { active?: object[] }) {
    const index = (event.active?.[0] as { index?: number } | undefined)?.index;
    if (index !== undefined) {
      const b = this.report()?.buckets[index];
      if (b) this.selectBucket(b);
    }
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
