import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import type { AnalyticsReport } from '@dairy/shared';
import { AnalyticsPage } from "./analytics-page/analytics-page";
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
  it('moves the date inspector without losing the period and search context', async () => {
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
    const inspector = Array.from(f.nativeElement.querySelectorAll('select') as NodeListOf<HTMLSelectElement>)
      .find(select => select.closest('label')?.textContent?.includes('Inspect date'))!;
    expect(inspector.value).toBe('2026-09-14|evening');
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
    f.componentInstance.change({ search: 'Noor' }, false);
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    expect(api.mock.calls.at(-1)?.[0]['page']).toBe('1');
    expect(api.mock.calls.at(-1)?.[0]['search']).toBe('Noor');
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
          f.nativeElement.querySelectorAll('section[aria-label="Period totals"] h2'),
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
    expect(a.litres(-1.235)).toBe('-1.24 L');
    expect(a.litres(null)).toBe('Not available');
    expect(a.differenceNote(report().metrics)).toContain('Partial coverage');
    expect(a.differenceNote({ ...report().metrics, difference: null })).toContain(
      'Difference unavailable',
    );
    expect(a.differenceNote({...report().metrics, coverage: {...c, measured:4, expected:4, missing:0, pending:0, uncertain:0}, dispatchMissing:0, dispatchPending:0, unavailableReasons:[]})).toContain('Recorded coverage only');
    expect(a.dispatch({...report().metrics,dispatched:null,dispatchRows:0})).toBe('No records');
    expect(a.dispatch({...report().metrics,dispatched:null,dispatchRows:1})).toBe('Not available');
    expect(a.bucketLabel(report().buckets[0])).toContain('2026-09-14');
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
