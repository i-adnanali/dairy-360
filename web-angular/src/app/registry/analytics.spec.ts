import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import type { AnalyticsReport } from '@dairy/shared';
import { AnalyticsPage, defaultAnalyticsDay } from "./analytics-page/analytics-page";
import { RegistryApi } from './api';

function report(): AnalyticsReport {
  const coverage = {
    expected: 4,
    measured: 3,
    unmeasured: 0,
    notMilked: 0,
    missing: 1,
    pending: 0,
    unexpected: 0,
    uncertain: 0,
    recordingPct: 75,
    measurementPct: 75,
  };
  const metrics = {
    coverage,
    produced: 30,
    sold: 20,
    nonSale: 0,
    dispatched: 20,
    difference: 10,
    differencePct: null,
    unavailableReasons: ['incomplete_production'],
    dispatchExpected: 2,
    dispatchRecorded: 2,
    dispatchMissing: 0,
    dispatchPending: 0,
    dispatchRows: 2,
    nonSaleByKind: {},
    milkedAnimals: 2,
    meanDailyYield: 20,
    eligibleAnimalDays: 1,
    excludedAnimalDays: 1,
  };
  return {
    metricVersion: 1,
    generatedAt: '2026-09-15T00:00:00Z',
    timezone: 'Asia/Karachi',
    scope: {
      view: 'day',
      on: '2026-09-14',
      from: '2026-09-14',
      to: '2026-09-14',
      session: 'all',
      inProgress: false,
    },
    metrics,
    buckets: [
      { ...metrics, key: '2026-09-14/morning', on: '2026-09-14', session: 'morning' },
      {
        ...metrics,
        key: '2026-09-14/evening',
        on: '2026-09-14',
        session: 'evening',
        produced: null,
      },
    ],
    production: {
      items: [],
      page: 1,
      pageSize: 25,
      totalItems: 63,
      totalPages: 3,
      sort: 'identifier',
      direction: 'asc',
    },
    reconciliation: {
      items: [],
      page: 1,
      pageSize: 25,
      totalItems: 2,
      totalPages: 1,
      sort: 'date',
      direction: 'desc',
    },
    comparison: {
      from: null,
      to: null,
      previousFrom: null,
      previousTo: null,
      current: null,
      previous: null,
      currentDays: 0,
      previousDays: 0,
      currentDailyAverage: null,
      previousDailyAverage: null,
      percent: null,
      reason: 'Incomplete comparison',
    },
  };
}
async function mount(analytics: (q: Record<string, string>) => Promise<AnalyticsReport>) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideCharts(withDefaultRegisterables()),
      { provide: RegistryApi, useValue: { analytics } },
    ],
  });
  const f = TestBed.createComponent(AnalyticsPage);
  f.detectChanges();
  await new Promise((r) => setTimeout(r, 0));
  f.detectChanges();
  return f;
}
afterEach(() => TestBed.resetTestingModule());
describe('Owner analytics', () => {
  it('renders partial totals and preserves chart gaps instead of inventing zero', async () => {
    const f = await mount(async () => report());
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('30 L');
    expect(el.textContent).toContain('1 missing');
    expect(el.textContent).toContain('incomplete production');
    expect(f.componentInstance.chartData().datasets[0].data[1]).toBeNull();
    expect(el.querySelector('app-pagination')?.textContent).toContain('1–25 of 63');
  });
  it('moves the page-wide selection without losing the period and search context', async () => {
    const f = await mount(async () => report());
    const router = TestBed.inject(Router);
    await router.navigate([], { queryParams: { view: 'month', on: '2026-09-14', search: 'Noor', detailOn: '2026-09-14', detailSession: 'morning' } });
    await f.whenStable();
    (f.componentInstance as any).moveBucket(1);
    await f.whenStable();
    expect(router.url).toContain('detailSession=evening');
    expect(router.url).toContain('view=month');
    expect(router.url).toContain('search=Noor');
    f.detectChanges();
    // The pick applies to the whole page: the bar names it and the figures follow it.
    expect(f.nativeElement.querySelector('[data-role="selection-bar"]')?.textContent).toContain('Evening');
    expect(f.componentInstance.shown()?.produced).toBeNull();
    expect(f.nativeElement.querySelector('[aria-pressed="true"][aria-label^="Mon 14 Sep · Evening"]')).not.toBeNull();
    (f.componentInstance as any).moveBucket(1);
    await f.whenStable();
    expect(router.url).toContain('detailSession=evening');
  });
  it('pages through the API and resets page when a filter changes', async () => {
    const api = vi.fn(async (q: Record<string, string>) => {
      const r = report();
      r.production.page = Number(q['page']);
      return r;
    });
    const f = await mount(api);
    await TestBed.inject(Router).navigate([], { queryParams: { page: '2' } });
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    expect(api.mock.calls.at(-1)?.[0]['page']).toBe('2');
    expect(f.componentInstance.report()?.metrics.produced).toBe(30);
    f.componentInstance.change({ session: 'morning' }, false);
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    expect(api.mock.calls.at(-1)?.[0]['page']).toBe('1');
    expect(api.mock.calls.at(-1)?.[0]['session']).toBe('morning');
  });
  it('does not label old results with new filters if a request fails', async () => {
    const f = await mount(async (q) => {
      if (q['view'] === 'month') throw new Error('offline');
      return report();
    });
    await TestBed.inject(Router).navigate([], { queryParams: { view: 'month' } });
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.report()).toBeNull();
    expect(f.nativeElement.textContent).toContain('offline');
  });
  it('retains a failed refresh as explicitly stale, while zero remains a value', async () => {
    let fail = false;
    const f = await mount(async () => {
      if (fail) throw new Error('offline');
      const r = report();
      r.metrics.produced = 0;
      return r;
    });
    expect(f.componentInstance.litres(0)).toBe('0 L');
    expect(f.componentInstance.litres(null)).toBe('Not available');
    fail = true;
    f.componentInstance.refresh();
    f.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    expect(f.componentInstance.report()?.metrics.produced).toBe(0);
    expect(f.nativeElement.textContent).toContain('Previous results');
  });
});

describe('B4 analytics semantics and filter matrix', () => {
  for (const view of ['day', 'week', 'month'])
    for (const session of ['all', 'morning', 'evening']) {
      it(`${view}/${session} retains query filters and unchanged supplied numbers`, async () => {
        const api = vi.fn(async () => report());
        const f = await mount(api);
        await TestBed.inject(Router).navigate([], {
          queryParams: { view, session, on: '2026-09-14' },
        });
        await f.whenStable();
        f.detectChanges();
        const q = api.mock.calls.at(-1);
        expect(q).toBeDefined();
        expect(f.componentInstance.q().view).toBe(view);
        expect(f.componentInstance.q().session).toBe(session);
        expect(f.componentInstance.report()!.metrics).toEqual(report().metrics);
        const headings = Array.from(
          f.nativeElement.querySelectorAll('section[aria-label="Period totals"] dt'),
        ).map((h: any) => h.textContent.trim());
        expect(headings).toEqual([
          'Measured production',
          'Recorded dispatch',
          'Difference',
          'Coverage',
        ]);
        f.componentInstance.showData.set(true);
        f.detectChanges();
        expect(f.nativeElement.querySelector('#analytics-chart-data table')).not.toBeNull();
      });
    }
  it('distinguishes measured zero, no records, unmeasured records, unexpected records and unavailable differences', async () => {
    const f = await mount(async () => report());
    const c = {
      ...report().metrics.coverage,
      measured: 0,
      unmeasured: 0,
      notMilked: 0,
      unexpected: 0,
    };
    const a = f.componentInstance;
    expect(a.production(0, c)).toBe('0 L');
    expect(a.production(null, c)).toBe('No records');
    expect(a.production(null, { ...c, unmeasured: 1 })).toBe('No measurements');
    expect(a.production(null, { ...c, unexpected: 1 })).toBe('No measurements');
    expect(a.litres(-1.235)).toBe('\u22121.24 L');
    expect(a.litres(null)).toBe('Not available');
    expect(a.differenceNote(report().metrics)).toContain('Partial coverage');
    expect(a.differenceNote({ ...report().metrics, difference: null })).toContain(
      'Difference unavailable',
    );
    expect(a.differenceNote({...report().metrics, coverage: {...c, measured:4, expected:4, missing:0, pending:0, uncertain:0}, dispatchMissing:0, dispatchPending:0, unavailableReasons:[]})).toContain('Recorded coverage only');
    expect(a.dispatch({...report().metrics,dispatched:null,dispatchRows:0})).toBe('No records');
    expect(a.dispatch({...report().metrics,dispatched:null,dispatchRows:1})).toBe('Not available');
    expect(a.bucketLabel(report().buckets[0])).toContain('Mon 14 Sep · Morning');
    expect(a.bucketLabel(report().buckets[0])).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it('retry retains selected filters and distinguishes an in-flight refresh from fresh data', async () => {
    let fail = true;
    const api = vi.fn(async () => {
      if (fail) throw Error('offline');
      return report();
    });
    const f = await mount(api);
    await TestBed.inject(Router).navigate([], {
      queryParams: { view: 'week', session: 'evening', on: '2026-09-14' },
    });
    await f.whenStable();
    f.detectChanges();
    fail = false;
    const retry = Array.from(f.nativeElement.querySelectorAll('button')).find(
      (b: any) => b.textContent.trim() === 'Retry',
    ) as HTMLButtonElement;
    retry.click();
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.q().session).toBe('evening');
    expect(f.componentInstance.q().view).toBe('week');
    expect(f.componentInstance.error()).toBe('');
  });
});

it('exposes No measurements rather than the generic no-record label to assistive technology', async () => {
  const r = report();
  r.production.items = [
    {
      id: 'A',
      identifier: 'A',
      name: null,
      tag: null,
      litres: null,
      coverage: { ...r.metrics.coverage, measured: 0, unmeasured: 1 },
      eligibleAnimalDays: 0,
    },
  ];
  const f = await mount(async () => r);
  expect(
    f.nativeElement.querySelector('td span[aria-label="No measurements"]')?.textContent,
  ).toContain('No measurements');
});

describe('analytics arrangement', () => {
  it('opens on a week, names the period in words and drops zero-count noise', async () => {
    const f = await mount(async () => report());
    const a = f.componentInstance as any;
    expect(a.q().view).toBe('week');
    expect(a.coverageText({ ...report().metrics.coverage, missing: 0 })).toBe('Nothing missing');
    expect(a.coverageText(report().metrics.coverage)).toBe('1 missing');
    expect(a.differenceNote({ ...report().metrics, difference: null })).not.toContain('..');
    expect(a.bucketName({ on: '2026-09-14', session: 'morning' })).toBe('Mon 14 Sep · Morning');
  });
  it('lists what is still to record with a link to each sheet', async () => {
    const f = await mount(async () => report());
    const links = Array.from(f.nativeElement.querySelectorAll('[data-role="to-review"] a') as NodeListOf<HTMLAnchorElement>)
      .map((a) => a.getAttribute('href'));
    expect(links.some((h) => h?.startsWith('/milk/milking') && h.includes('on=2026-09-14'))).toBe(true);
  });
  it('selecting the same bucket again returns to the whole period', async () => {
    const f = await mount(async () => report());
    const a = f.componentInstance as any;
    const b = report().buckets[0];
    a.selectBucket(b); await f.whenStable();
    expect(a.q().detailOn).toBe('2026-09-14');
    expect(a.shown().produced).toBe(30);
    a.selectBucket(b); await f.whenStable();
    expect(a.q().detailOn).toBe('');
  });
});

describe('analytics restructure', () => {
  it('shows sold and not sold as missing, never 0 L, when no dispatch was recorded', async () => {
    const r = report();
    r.metrics = { ...r.metrics, sold: null, nonSale: null, dispatched: null, dispatchRows: 0, difference: null };
    r.buckets = r.buckets.map((b) => ({ ...b, sold: null, nonSale: null, dispatched: null, dispatchRows: 0, difference: null }));
    const f = await mount(async () => r);
    f.componentInstance.showData.set(true);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('section[aria-label="Period totals"]')?.textContent).toContain('No dispatch recorded');
    const cells = Array.from(el.querySelectorAll('#analytics-chart-data tbody td')).map((td) => td.textContent!.trim());
    expect(cells).not.toContain('0 L');
    expect(el.querySelectorAll('#analytics-chart-data span[aria-label="No dispatch recorded"]').length).toBe(4);
  });
  it('marks a total built from incomplete milkings as partial, not known', async () => {
    const f = await mount(async () => report());
    const a = f.componentInstance as any;
    const m = report().metrics;
    expect(a.producedAmount(30, m.coverage)).toEqual(jasmineLike({ state: 'approximate', qualifier: 'partial' }));
    expect(a.producedAmount(30, { ...m.coverage, missing: 0 })).toEqual(jasmineLike({ state: 'known', qualifier: '' }));
    expect(a.producedAmount(null, { ...m.coverage, measured: 0 }).state).toBe('no-record');
  });
  it('keeps the last results on screen while the next query loads', async () => {
    let release!: () => void;
    let hold = false;
    const f = await mount(async () => {
      if (hold) await new Promise<void>((r) => (release = r));
      return report();
    });
    hold = true;
    f.componentInstance.change({ sort: 'litres', direction: 'desc' }, false);
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    expect(f.componentInstance.loading()).toBe(true);
    expect(f.componentInstance.report()).not.toBeNull();
    expect(f.nativeElement.querySelector('.analytics-body')?.getAttribute('aria-busy')).toBe('true');
    release();
  });
  it('narrows Still to record to a picked day', async () => {
    const r = report();
    r.buckets[1] = { ...r.buckets[1], on: '2026-09-13', key: '2026-09-13/evening' };
    const f = await mount(async () => r);
    const a = f.componentInstance as any;
    expect(a.toReview().length).toBe(2);
    await TestBed.inject(Router).navigate([], { queryParams: { detailOn: '2026-09-13', detailSession: 'evening' } });
    await f.whenStable();
    expect(a.toReview().map((x: any) => x.b.on)).toEqual(['2026-09-13']);
  });
  it('opens on the week just ended on a Monday, and on this week otherwise', () => {
    expect(defaultAnalyticsDay('2026-11-09')).toBe('2026-11-08');
    expect(defaultAnalyticsDay('2026-11-10')).toBe('2026-11-10');
  });
  it('writes no empty params and steps the period with [ and ]', async () => {
    const f = await mount(async () => report());
    const router = TestBed.inject(Router);
    await router.navigate([], { queryParams: { view: 'week', on: '2026-09-14' } });
    await f.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
    await f.whenStable();
    expect(f.componentInstance.q().on).toBe('2026-09-07');
    expect(router.url).not.toMatch(/=(&|$)/);
  });
});

function jasmineLike(o: Record<string, unknown>) {
  return expect.objectContaining(o);
}
