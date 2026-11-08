import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { FeedPage } from './feed-page';
import { RegistryApi } from '../api';
import { blankFeed, type FeedOverview } from '../feed-model';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = (id: string) => ({ ...blankFeed(), id });
const revisions = (id: string) => [{ id, revision: 1, operation: 'create', recorded_at: '2026-10-05', before_json: '{}', after_json: '{}', provenance: '{}' }];
const overview = (from: string): FeedOverview => ({ from, to: '2026-10-05', days: [], recorded: 0, partial: 0,
  unrecorded: 0, assessments: {}, own_days: 0, purchased_days: 0, mixed_days: 0, purchase_cost_minor: 0,
  unknown_costs: 0, expense_cost_minor: 0, crops: [], quantities: [] });

describe('feed page revision history ownership', () => {
  let read: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    read = vi.fn().mockResolvedValue([]);
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: RegistryApi, useValue: { feedGet: read } },
      { provide: ActivatedRoute, useValue: {
        paramMap: of(convertToParamMap({})),
        snapshot: { data: { feedMode: 'crops' }, paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) },
      } },
    ] });
  });

  it.each(['success', 'failure'])('ignores an older history %s after a newer selection', async outcome => {
    const f = TestBed.createComponent(FeedPage); await f.whenStable();
    const c = f.componentInstance;
    const old = deferred<ReturnType<typeof revisions>>();
    read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(revisions('expense'));
    c.revisions.set(revisions('previous'));
    c.error.set('previous failure');
    const pending = c.showRevisions(row('crop'), 'crops');
    expect(c.revisions()).toEqual([]); expect(c.error()).toBe('');
    await c.showRevisions(row('expense'), 'expenses');
    if (outcome === 'success') old.resolve(revisions('crop'));
    else old.reject(new Error('obsolete history failure'));
    await pending; await f.whenStable();
    expect(c.revisions()).toEqual(revisions('expense'));
    expect(c.error()).toBe('');
  });

  it.each(['reload', 'destroy'])('invalidates pending history on %s', async action => {
    const f = TestBed.createComponent(FeedPage); await f.whenStable();
    const c = f.componentInstance, old = deferred<ReturnType<typeof revisions>>();
    read.mockReturnValueOnce(old.promise);
    const pending = c.showRevisions(row('crop'), 'crops');
    if (action === 'reload') await c.load(); else f.destroy();
    old.resolve(revisions('obsolete')); await pending;
    expect(c.revisions()).toEqual([]);
  });

  it.each(['success', 'failure'])('keeps the latest selected range after an older %s', async outcome => {
    const f = TestBed.createComponent(FeedPage); await f.whenStable();
    const c = f.componentInstance, old = deferred<FeedOverview>();
    c.overview.set(overview('2026-10-01'));
    c.error.set('previous error');
    read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(overview('2026-10-04'));
    c.from = '2026-10-03';
    const pending = c.loadRange();
    expect(c.rangeLoading()).toBe(true); expect(c.overview()).toBeNull(); expect(c.error()).toBe('');
    c.from = '2026-10-04'; await c.loadRange();
    if (outcome === 'success') old.resolve(overview('2026-10-03'));
    else old.reject(new Error('obsolete range failure'));
    await pending;
    expect(c.from).toBe('2026-10-04'); expect(c.overview()?.from).toBe('2026-10-04');
    expect(c.error()).toBe(''); expect(c.rangeLoading()).toBe(false);
  });

  it('does not publish a range after the page reloads', async () => {
    const f = TestBed.createComponent(FeedPage); await f.whenStable();
    const c = f.componentInstance, old = deferred<FeedOverview>();
    read.mockReturnValueOnce(old.promise);
    const pending = c.loadRange(); await c.load();
    old.resolve(overview('2026-10-03')); await pending;
    expect(c.overview()).toBeNull(); expect(c.rangeLoading()).toBe(false);
  });
});

describe('feed lists', () => {
  const setup = (mode: string, rows: unknown[]) => {
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: RegistryApi, useValue: { feedGet: vi.fn().mockResolvedValue(rows) } },
      { provide: ActivatedRoute, useValue: {
        paramMap: of(convertToParamMap({})),
        snapshot: { data: { feedMode: mode }, paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) },
      } },
    ] });
    return TestBed.createComponent(FeedPage);
  };

  it('the catalogue lists every item -- items carry no date to filter on', async () => {
    const f = setup('items', [{ ...row('b'), label: 'Silage' }, { ...row('a'), label: 'Khall', archived: true }, { ...row('c'), label: 'Bhoosa' }]);
    await f.whenStable(); f.detectChanges();
    expect(f.componentInstance.filtered().map((r) => r.label)).toEqual(['Bhoosa', 'Silage', 'Khall']);
    expect(f.nativeElement.querySelectorAll('[data-role="feed-table-items"] tbody tr').length).toBe(3);
  });

  it('purchases are newest first; crops still cutting come first', async () => {
    const f = setup('purchases', [{ ...row('1'), on: '2026-11-01' }, { ...row('2'), on: '2026-11-06' }]);
    await f.whenStable();
    expect(f.componentInstance.filtered().map((r) => r.id)).toEqual(['2', '1']);
    TestBed.resetTestingModule();
    const g = setup('crops', [
      { ...row('x'), label: 'Old', status: 'finished' },
      { ...row('y'), label: 'Maize', status: 'cutting' },
      { ...row('z'), label: 'Berseem', status: 'growing' },
    ]);
    await g.whenStable();
    expect(g.componentInstance.filtered().map((r) => r.id)).toEqual(['y', 'z', 'x']);
  });
});
