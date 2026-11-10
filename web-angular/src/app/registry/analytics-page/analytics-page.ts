import { Segmented } from "../../ui/selection";
import { ChartPanel, ChartDataTable } from "../../ui/reporting";
import { Cell } from "../../ui/cell";
import { Certainty, Qualifier, type CertaintyState } from "../../ui/certainty";
import { ScrollRegion } from "../../ui/scroll-region";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration } from 'chart.js';
import type { AnalyticsReport, Coverage, MilkMetrics, AnalyticsBucket, ProductionRow } from '@dairy/shared';
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

/** One figure at one certainty, with the qualifier §6.1 puts after it. */
export interface Amount {
  text: string;
  state: CertaintyState;
  label: string | null;
  qualifier: string;
}

/**
 * The period /analytics opens on. A week, as before -- but on a Monday the
 * current week has nothing in it yet (an empty chart, "No records" four
 * times), so Monday opens on the week that just ended.
 */
export function defaultAnalyticsDay(today: string = farmToday()): string {
  if (feedWeekday(today) !== 'Mon') return today;
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

@Component({
  selector: 'app-analytics-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented, ChartPanel, ChartDataTable,
    Cell,
    Certainty,
    Qualifier,
    ScrollRegion,
    DecimalPipe,
    NgTemplateOutlet,
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
  host: { '(document:keydown)': 'onKey($event)' },
})
export class AnalyticsPage {
  protected bucketIndex() {
    return this.report()?.buckets.findIndex(b => b.on === this.q().detailOn && b.session === (this.q().detailSession || 'all')) ?? -1;
  }
  protected moveBucket(delta: number) {
    const buckets = this.report()?.buckets ?? [];
    const next = buckets[this.bucketIndex() + delta];
    if (next) this.change({ detailOn: next.on, detailSession: next.session }, false);
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
    const from = r?.scope.view === q.view ? r.scope.from : undefined;
    const to = r?.scope.view === q.view ? r.scope.to : undefined;
    if (q.view === 'day') return `${feedWeekday(q.on)} ${feedDay(q.on)}`;
    if (q.view === 'month') {
      const [y, m] = q.on.split('-');
      return `${MONTHS[Number(m) - 1]} ${y}`;
    }
    if (!from || !to || q.on < from || q.on > to) return 'Week of ' + feedDay(q.on);
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    return `Week of ${sameMonth ? Number(from.slice(8)) : feedDay(from)}–${feedDay(to)}`;
  }
  protected periodNoun(): string {
    return this.q().view === 'day' ? 'day' : this.q().view;
  }
  /** What the By animal table covers, said where the table is. */
  protected detailScope(): string {
    const sel = this.selected();
    if (sel) return `${this.bucketName(sel)} only`;
    const session = this.q().session;
    return this.periodLabel() + (session === 'all' ? '' : ` · ${feedLabel(session)} only`);
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
    const direction = q.sort === column ? (q.direction === 'asc' ? 'desc' : 'asc') : column === 'identifier' ? 'asc' : 'desc';
    this.change({ sort: column, direction }, false);
  }
  protected ariaSort(column: string): 'ascending' | 'descending' | null {
    return this.q().sort === column ? (this.q().direction === 'asc' ? 'ascending' : 'descending') : null;
  }
  /**
   * Days (or sessions) with something still to record, newest first, each with
   * the sheet that answers it. A picked day narrows it like everything else.
   */
  readonly toReview = computed(() => {
    const sel = this.selected()?.key;
    return [...(this.report()?.buckets ?? [])]
      .filter((b) => !sel || b.key === sel)
      .map((b) => ({
        b,
        milking: b.coverage.missing + b.coverage.pending,
        dispatch: b.dispatchMissing + b.dispatchPending,
      }))
      .filter((x) => x.milking + x.dispatch > 0)
      .sort((a, z) => (a.b.key < z.b.key ? 1 : -1));
  });
  readonly showAllReview = signal(false);
  readonly reviewShown = computed(() => (this.showAllReview() ? this.toReview() : this.toReview().slice(0, 6)));
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
  protected sheetLabel(s: string, kind: 'milking' | 'dispatch', b: AnalyticsBucket): string {
    return `${feedLabel(s)} ${kind}, ${feedWeekday(b.on)} ${feedDay(b.on)}`;
  }

  private readonly api = inject(RegistryApi);
  private readonly writes = inject(WriteLog);
  private readonly theme = inject(Theme);
  private readonly shell = inject(ShellActions);
  readonly url = urlParams({
    view: 'week',
    on: defaultAnalyticsDay(),
    session: 'all',
    page: '1',
    pageSize: '25',
    sort: '',
    direction: '',
    detailOn: '',
    detailSession: '',
  });
  readonly q = computed(() => {
    const q = this.url.value();
    return { ...q, sort: q.sort || 'identifier', direction: q.direction || 'asc' };
  });
  readonly showData = signal(false);
  readonly report = signal<AnalyticsReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private readonly revision = signal(0);
  private request = 0;
  /** The query the shown report answers. */
  private reportKey = '';
  readonly visiblePage = computed(() => this.report()!.production);
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
  /**
   * The last report STAYS on screen, dimmed and marked busy, while the next
   * one loads. Clearing it collapsed the page to "Loading…", so a sort or a
   * page click threw the reader back to the top and dropped focus. Only a
   * failure for a DIFFERENT query clears it: old figures must not sit under
   * new filters.
   */
  async load(q: Record<string, string>) {
    const request = ++this.request;
    const key = JSON.stringify(q);
    this.loading.set(true);
    this.error.set('');
    try {
      const r = await this.api.analytics(q);
      if (request !== this.request) return;
      this.report.set(r);
      this.reportKey = key;
      if (r.production.page !== Number(q['page'])) this.url.set({ page: r.production.page === 1 ? '' : '' + r.production.page });
    } catch (e) {
      if (request === this.request) {
        this.error.set(e instanceof Error ? e.message : 'Could not load analytics.');
        if (this.reportKey !== key) this.report.set(null);
      }
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
  change(patch: Partial<ReturnType<typeof this.q>>, clearDetail = true) {
    this.url.set({
      ...patch,
      page: '',
      ...(clearDetail ? { detailOn: '', detailSession: '' } : {}),
    });
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
  /** `[` and `]` step the period, as the buttons' titles say. Never while typing. */
  protected onKey(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== '[' && e.key !== ']')) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (t?.closest('[role="dialog"]')) return;
    e.preventDefault();
    this.step(e.key === '[' ? -1 : 1);
  }
  updated(value: string) {
    return farmMoment(value);
  }
  litres(n: number | null) {
    return n === null
      ? 'Not available'
      : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n).replace('-', '\u2212') + ' L';
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

  // ---- Certainty ---------------------------------------------------------
  // §6: an answer is words, only the absence of an answer is a dash, and a
  // total built from incomplete records is not drawn as a known figure.
  private milkShort(c: Coverage) {
    return c.missing + c.pending + c.unmeasured > 0;
  }
  private dispatchShort(m: MilkMetrics) {
    return m.dispatchMissing + m.dispatchPending > 0;
  }
  private known(n: number, partial: boolean): Amount {
    return partial
      ? { text: this.litres(n), state: 'approximate', label: null, qualifier: 'partial' }
      : { text: this.litres(n), state: 'known', label: null, qualifier: '' };
  }
  private static readonly NONE = (label: string): Amount => ({ text: '–', state: 'no-record', label, qualifier: '' });
  private static readonly ABSENT = (text: string): Amount => ({ text, state: 'absent', label: text, qualifier: '' });
  protected producedAmount(n: number | null, c: Coverage): Amount {
    if (n !== null) return this.known(n, this.milkShort(c));
    return this.production(null, c) === 'No records' ? AnalyticsPage.NONE('No records') : AnalyticsPage.ABSENT('No measurements');
  }
  protected dispatchAmount(m: MilkMetrics): Amount {
    if (m.dispatched !== null) return this.known(m.dispatched, this.dispatchShort(m));
    return m.dispatchRows === 0 ? AnalyticsPage.NONE('No records') : AnalyticsPage.ABSENT('Not available');
  }
  /** Sold or not sold: missing when no dispatch was recorded, never 0 L. */
  protected partAmount(n: number | null, m: MilkMetrics): Amount {
    return n === null ? AnalyticsPage.NONE('No dispatch recorded') : this.known(n, this.dispatchShort(m));
  }
  protected differenceAmount(m: MilkMetrics): Amount {
    if (m.difference === null) return AnalyticsPage.ABSENT('Not available');
    return this.known(m.difference, this.milkShort(m.coverage) || this.dispatchShort(m));
  }
  /** Litres per measured milking: what lets two animals be compared. */
  protected perMilking(a: ProductionRow): Amount {
    if (a.litres === null || !a.coverage.measured) return AnalyticsPage.NONE('No measured milking');
    return this.known(Math.round((a.litres / a.coverage.measured) * 10) / 10, false);
  }
  protected soldNote(m: MilkMetrics): string {
    if (m.sold === null) return 'No dispatch recorded';
    return `Sold ${this.litres(m.sold)} · not sold ${this.litres(m.nonSale)}`;
  }
  protected dispatchGap(m: MilkMetrics): string {
    const n = m.dispatchMissing + m.dispatchPending;
    return n ? ` · ${n} buyer ${n === 1 ? 'answer' : 'answers'} missing` : '';
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
  /** What a screen reader hears on a day button: words, not "2026-11-04, all". */
  bucketLabel(b: AnalyticsBucket) {
    return `${this.bucketName(b)}: measured ${this.production(b.produced, b.coverage)}, dispatched ${this.dispatch(b)}. ${this.coverageText(b.coverage)}`;
  }
  /**
   * Only what is actually short, in plain words. Approximate roster dates are
   * a fact about the herd, not about a row: they are said once, beside the
   * Coverage figure and in the caveats, not repeated on every line.
   */
  coverageText(c: Coverage) {
    const parts = [
      c.missing ? `${c.missing} missing` : '',
      c.pending ? `${c.pending} not yet recorded` : '',
      c.unmeasured ? `${c.unmeasured} unmeasured` : '',
      c.notMilked ? `${c.notMilked} not milked` : '',
      c.unexpected ? `${c.unexpected} outside the roster` : '',
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
  /** "2–8 Nov" for the comparison sentence: §6.1, dates in words. */
  protected span(from: string | null, to: string | null): string {
    if (!from || !to) return '';
    return from === to ? feedDay(from) : `${feedDay(from)}–${feedDay(to)}`;
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
      milkFaint: `rgb(${v('--fill-brand')} / 0.1)`,
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
    // With a day picked, the other bars fade back so the pick reads at a glance.
    const fill = (b: AnalyticsBucket) =>
      sel && b.key !== sel ? c.milkFaint : this.partial(b) ? c.milkSoft : c.milk;
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
          backgroundColor: bs.map(fill),
          borderColor: bs.map((b) => (b.key === sel ? c.ink : c.milk)),
          borderWidth: bs.map((b) => (b.key === sel ? 3 : sel ? 0 : this.partial(b) ? 1.5 : 0)),
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
