import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import type { AnalyticsReport } from '@dairy/shared';
import { AnalyticsPage } from './analytics-page';
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
    await TestBed.inject(Router).navigate([], {queryParams:{view:'month'}});
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
    expect(f.componentInstance.litres(null)).toBe('No records');
    fail = true;
    f.componentInstance.refresh();
    f.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    expect(f.componentInstance.report()?.metrics.produced).toBe(0);
    expect(f.nativeElement.textContent).toContain('Previous results');
  });
});
