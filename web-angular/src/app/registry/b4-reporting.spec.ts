import { BehaviorSubject, of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { LifeReport } from "./life-report/life-report";
import { DestinationDetail } from "./destination-detail/destination-detail";
import { RegistryApi } from './api';
import { lifeSections, lifeSummary, reportDate } from './life-report-model';
import { labourPresentation } from './check-presentation';
import type { LabourReportContext } from '@dairy/shared';

const tick = async (f: any) => {
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
};
function life(count = 101): any {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: 'milk-' + i,
    occurred_on: '2026-09-01',
    status: 'measured',
    yield_litres: i,
    session: 'morning',
    recorded_by: 'fixture',
    future_field: { untouched: [1, null, 'last'] },
  }));
  return {
    animal_id: 'BD-0001',
    generated_at: '2026-09-25',
    filters: {},
    current_snapshot: {
      animal: { name: 'Synthetic', origin: 'acquired', sex: 'female', species: 'buffalo' },
    },
    health: { vaccinations: [], records: [], withdrawals: [] },
    totals: {
      measured_litres: 5050,
      measured_sessions: count,
      unmeasured_sessions: 0,
      not_milked_sessions: 0,
    },
    sections: { production: { records: rows, note: 'Missing is not zero' }, feed: { records: [] } },
    timeline: [],
    coverage_warnings: ['No records is not absence'],
    corrections: { animal_events: [{ id: 'old', effective: false }] },
    future_domain: { raw: true },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});
describe('B4 advisory contexts', () => {
  const base = {
    personId: 'person / name',
    engagementId: 'eng-1',
    wageId: 'wage-1',
    fromOn: '2026-09-01',
    toOn: '2026-09-30',
  };
  const contexts: LabourReportContext[] = [
    { kind: 'unknown_identifier', identifier: 'unlinked', recordCount: 2 },
    { kind: 'overlapping_engagements', personId: base.personId, engagementIds: ['a', 'b'] },
    {
      kind: 'multiple_open_engagements',
      personId: base.personId,
      engagementIds: ['a', 'b'],
      asOf: '2026-09-25',
    },
    { kind: 'wage_period_outside_engagement', ...base },
    { kind: 'amount_differs_from_term', ...base, amountMinor: 4500000, agreementMinor: 0 },
  ];
  for (const context of contexts)
    it(context.kind + ' uses structured IDs and retains prose separately', () => {
      const line = { kind: context.kind, context, detail: 'Prose does not contain an ID' };
      const result = labourPresentation(line);
      expect(result.heading).not.toBe('Advisory record');
      expect(result.link).toEqual(
        context.kind === 'unknown_identifier'
          ? ['/labour/people']
          : ['/labour/people', base.personId],
      );
      if (context.kind === 'amount_differs_from_term') {
        expect(result.context).toContain('Rs 45,000.00');
        expect(result.context).toContain('Rs 0.00');
        expect(result.context).not.toContain('paid');
      }
      expect(line.detail).toBe('Prose does not contain an ID');
    });
  it('unknown kinds, missing and mismatched contexts never infer links', () => {
    for (const line of [
      { kind: 'future', detail: '/people/person' },
      { kind: 'amount_differs_from_term', detail: '4500000' },
      { kind: 'future', detail: 'unknown', context: contexts[0] },
    ])
      expect(labourPresentation(line).link).toBeNull();
  });
});
describe('B4 life report', () => {
  it('adapts domains with precision and preserves source record order', () => {
    const r = life();
    expect(lifeSections(r).find((s) => s.id === 'milk')!.records).toBe(
      r.sections.production.records,
    );
    expect(reportDate('2026-03-01', 'month')).toBe('Mar 2026 (month known)');
    expect(reportDate('2026-01-01', 'estimated')).toBe('Approximately 2026');
    expect(
      lifeSummary(
        {
          type: 'calving',
          effective: false,
          occurred_on: '2026-01-01',
          date_precision: 'year',
          payload: { calf_id: 'BD-0002', outcome: 'live', future: { deep: 'secret' } },
        },
        'event',
      ).join(' '),
    ).toContain('Superseded');
    expect(lifeSummary({ entity: 'future', nested: { unknown: 1 } }, 'health').join(' ')).toContain(
      'Technical audit',
    );
    expect(
      lifeSummary(
        { item_name: 'Hay', quantity: 0, unit: 'kg', animal_ids: ['BD-0001', 'BD-0002'] },
        'feed',
      ).join(' '),
    ).toContain('0 kg');
    expect(lifeSummary({ amount_minor: 4500000, currency: 'PKR' }, 'cost').join(' ')).toContain(
      'Rs 45,000.00',
    );
  });
  it('prints all 101 rows and disclosures and exports the untouched complete response', async () => {
    const r = life();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RegistryApi, useValue: { healthGet: async () => r } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(new Map([['id', 'BD-0001']])), snapshot: { paramMap: new Map([['id', 'BD-0001']]) } },
        },
      ],
    });
    const f = TestBed.createComponent(LifeReport);
    await tick(f);
    const el = f.nativeElement as HTMLElement;
    const milk = () => el.querySelector('#report-milk')!.closest('section')!;
    expect(milk().querySelectorAll('article').length).toBe(25);
    const nextMilkPage = Array.from(milk().querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Next',
    )!;
    nextMilkPage.click();
    await tick(f);
    const beforePrintRow = milk().querySelector('article')!.textContent;
    expect(beforePrintRow).toContain('milk-25');
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(milk().querySelectorAll('article').length).toBe(101);
      expect(el.querySelectorAll('details:not([open])').length).toBe(0);
      expect(el.querySelector('pre')!.textContent).toContain('future_domain');
      expect(el.querySelector('pre')!.textContent).toContain('milk-100');
    });
    (f.componentInstance as any).print();
    expect(print).toHaveBeenCalledOnce();
    expect(milk().querySelectorAll('article').length).toBe(25);
    expect(milk().querySelector('article')!.textContent).toBe(beforePrintRow);
    const create = vi.fn((_blob: Blob) => 'blob:test');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    (f.componentInstance as any).download();
    const blob = create.mock.calls[0][0] as Blob;
    expect(JSON.parse(await blob.text())).toEqual(r);
    anchorClick.mockRestore();
    const heading = milk().querySelector('h3')!;
    heading.scrollIntoView = vi.fn();
    vi.spyOn(heading, 'focus');
    // document lookup requires attachment, as in the browser.
    document.body.append(el);
    el.querySelector<HTMLAnchorElement>('a[href="#report-milk"]')!.click();
    expect(heading.focus).toHaveBeenCalled();
    el.remove();
  });
  it('retains empty domain coverage without empty pagination', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RegistryApi, useValue: { healthGet: async () => life(0) } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(new Map([['id', 'BD-0001']])), snapshot: { paramMap: new Map([['id', 'BD-0001']]) } },
        },
      ],
    });
    const f = TestBed.createComponent(LifeReport);
    await tick(f);
    expect(f.nativeElement.textContent).toContain('Milk · 0 records');
    expect(f.nativeElement.textContent).not.toContain('Page 0');
  });
});
describe('B4 buyer statement', () => {
  it('pages deliveries and payments independently without changing full-period totals', async () => {
    const m = {
      month: '2026-09',
      litres: 101,
      billed_minor: 4500000,
      paid_minor: 10000,
      closing_minor: 4490000,
      dispatches: Array.from({ length: 101 }, (_, i) => ({
        id: 'd' + i,
        occurred_on: '2026-09-01',
        session: 'morning',
        status: 'taken',
        litres: 1,
        amount_minor: 100,
        price_minor: 100,
        price_unit_litres: 1,
      })),
      payments: Array.from({ length: 26 }, (_, i) => ({
        id: 'p' + i,
        occurred_on: '2026-09-02',
        method: 'cash',
        amount_minor: 100,
      })),
    };
    const s = {
      id: 'buyer',
      name: 'Fixture buyer',
      billable: false,
      litres: 101,
      billed_minor: 4500000,
      paid_minor: 10000,
      balance_minor: 4490000,
      months: [m],
      prices: [],
      unpriced: 0,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RegistryApi, useValue: { statement: async () => s } },
      ],
    });
    const f = TestBed.createComponent(DestinationDetail);
    f.componentRef.setInput('id', 'buyer');
    await tick(f);
    const el = f.nativeElement as HTMLElement;
    const totals = el.querySelector('[data-role=totals]')!.textContent;
    const pagers = el.querySelectorAll('app-local-pagination');
    const next = Array.from(pagers[0].querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Next',
    )!;
    expect(next).not.toBeNull();
    next.click();
    await tick(f);
    expect(el.querySelector('[data-dispatch=d25]')).not.toBeNull();
    expect(el.querySelector('[data-payment=p0]')).not.toBeNull();
    expect(el.querySelector('[data-role=totals]')!.textContent).toBe(totals);
    expect(el.querySelectorAll('[role=region]').length).toBe(2);
    window.dispatchEvent(new Event('beforeprint'));
    // Synchronous native print snapshots cannot wait for another Angular tick.
    expect(el.querySelectorAll('[data-dispatch]').length).toBe(101);
    expect(el.querySelectorAll('[data-payment]').length).toBe(26);
    expect(el.querySelector('.statement-print-context')!.textContent).toContain('Fixture buyer');
    expect(document.querySelectorAll('.life-print-pages [data-dispatch]').length).toBe(101);
    expect(document.querySelectorAll('.life-print-pages [data-payment]').length).toBe(26);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('.life-print-pages')).toBeNull();
    expect(el.querySelectorAll('[data-dispatch]').length).toBe(25);
    expect(el.querySelector('[data-dispatch=d25]')).not.toBeNull();
    expect(el.querySelectorAll('[data-payment]').length).toBe(25);
    expect(el.querySelector('[data-role=totals]')!.textContent).toBe(totals);
    m.dispatches = [];
    (f.componentInstance as any).statement.set({ ...s });
    await tick(f);
    expect(el.textContent).toContain('No deliveries recorded');
    expect(el.querySelector('[data-payment=p0]')).not.toBeNull();
  });
});

describe('B4 Check loading and failures', () => {
  it('never displays a clean result while rechecking or after verification fails; reconciliation failure is explicit', async () => {
    const { VerificationPanel } = await import("./verification-panel/verification-panel");
    const data = {
      as_of: '2026-09-17',
      counts: { animals: 0, events: 0, lactations: 0, milkings: 0 },
      violations: [],
      labour: [],
      histogram: [],
      intervals: { intervals: [], caveat: 'fixture' },
      milking: { rows: 0, caveat: 'fixture' },
    };
    let rejectCheck: (error: Error) => void = () => {};
    let pending = false;
    const api = {
      verification: () =>
        pending
          ? new Promise((_resolve, reject) => {
              rejectCheck = reject;
            })
          : Promise.resolve(data),
      reconcile: async () => {
        throw Error('reconciliation offline');
      },
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: RegistryApi, useValue: api }],
    });
    const f = TestBed.createComponent(VerificationPanel);
    await tick(f);
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(
      'No issues found in this advisory check as of 2026-09-17',
    );
    expect(f.nativeElement.textContent).toContain('Milk reconciliation unavailable');
    pending = true;
    const checking = (f.componentInstance as any).load();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Checking records');
    expect(f.nativeElement.querySelector('[data-role=violations-none]')).toBeNull();
    rejectCheck(Error('verification offline'));
    await checking;
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('verification offline');
    expect(f.nativeElement.querySelector('[data-role=violations-none]')).toBeNull();
  });
});

describe('B4 revision and domain adapters', () => {
  it('keeps correction order, differentiates superseded revisions and preserves the untouched JSON', () => {
    const r = life(0);
    const original = {
      id: 'dose',
      entity: 'administrations',
      revision: 1,
      occurred_on: '2026-01-01',
      date_precision: 'year',
      product_name: 'Old vaccine',
      amount: 0,
      unit: 'ml',
      voided: false,
      recorded_by: 'first',
    };
    r.corrections.health = [
      {
        id: 'rev1',
        record_id: 'dose',
        revision: 1,
        operation: 'create',
        after_json: JSON.stringify(original),
      },
      {
        id: 'rev2',
        record_id: 'dose',
        revision: 2,
        operation: 'revise',
        reason: 'Correct name',
        after_json: JSON.stringify({
          ...original,
          revision: 2,
          product_name: 'Corrected vaccine',
          recorded_by: 'second',
        }),
      },
    ];
    const before = JSON.stringify(r);
    const section = lifeSections(r).find((s) => s.id === 'health-revisions')!;
    expect(section.records.map((row) => row['id'])).toEqual(['rev1', 'rev2']);
    expect(lifeSummary(section.records[0], 'health').join(' ')).toContain('Superseded revision');
    expect(lifeSummary(section.records[1], 'health').join(' ')).toContain(
      'Latest retained revision',
    );
    expect(lifeSummary(section.records[1], 'health').join(' ')).toContain('Correct name');
    expect(JSON.stringify(r)).toBe(before);
  });
  it('covers every supported health domain without recursively dumping unknown fields', () => {
    for (const entity of [
      'visits',
      'examinations',
      'cases',
      'plans',
      'tasks',
      'administrations',
      'results',
      'costs',
    ]) {
      const lines = lifeSummary(
        {
          entity,
          occurred_on: '2026-09-17',
          date_precision: 'day',
          animal_id: 'BD-0001',
          recorded_by: 'recorder',
          status: 'open',
          instructions: 'Follow up',
          amount_minor: 0,
          currency: 'PKR',
          future: { deep: 'do not flatten' },
        },
        'health',
      ).join(' ');
      expect(lines).toContain('17 Sept 2026');
      expect(lines).not.toContain('do not flatten');
    }
  });
});

it('reloads a reused life report when the animal parameter changes', async () => {
  const paramMap = new BehaviorSubject(convertToParamMap({ id: 'A' }));
  const route = { paramMap, snapshot: { paramMap: paramMap.value } };
  const healthGet = vi.fn(async (path: string) => ({ ...life(0), animal_id: path.split('/')[1] }));
  TestBed.configureTestingModule({ providers: [provideRouter([]),
    { provide: ActivatedRoute, useValue: route }, { provide: RegistryApi, useValue: { healthGet } }] });
  const f = TestBed.createComponent(LifeReport); await tick(f);
  expect((f.componentInstance as any).report().animal_id).toBe('A');
  route.snapshot.paramMap = convertToParamMap({ id: 'B' });
  paramMap.next(route.snapshot.paramMap); await tick(f);
  expect((f.componentInstance as any).report().animal_id).toBe('B');
  expect(healthGet.mock.calls[1][0]).toContain('animals/B/life-report');
});
