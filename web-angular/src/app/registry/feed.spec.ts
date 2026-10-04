import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { FeedEditor } from "./feed-editor/feed-editor";
import { FeedDailyScreen } from "./feed-daily/feed-daily";
import { RegistryApi, ApiError } from './api';
import { Session } from './session';
import { blankFeed } from './feed-model';
const on = '2026-09-10';
async function settle(f: ComponentFixture<unknown>) {
  await new Promise((r) => setTimeout(r, 0));
  await f.whenStable();
  f.detectChanges();
}
function field(f: ComponentFixture<unknown>, name: string, value: string) {
  const el = f.nativeElement.querySelector(`[name="${name}"]`) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input'));
  f.detectChanges();
}
describe('feed editor', () => {
  let write: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    write = vi.fn().mockResolvedValue({ ...blankFeed(), id: 'saved', revision: 1 });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RegistryApi, useValue: { feedWrite: write } },
      ],
    });
  });
  it('preserves entered values through provenance setup and refuses Enter without setup', async () => {
    const f = TestBed.createComponent(FeedEditor);
    f.componentRef.setInput('entity', 'items');
    await settle(f);
    field(f, 'label', 'My fodder');
    await f.componentInstance.save();
    expect(write).not.toHaveBeenCalled();
    const s = TestBed.inject(Session);
    s.requestSetup();
    s.set('recall', 'farmer');
    await settle(f);
    expect(f.componentInstance.draft.label).toBe('My fodder');
    expect(f.nativeElement.querySelector('[name="label"]').value).toBe('My fodder');
  });
  it('records per-40 kg agreement in paisa without inferring bags', async () => {
    const f = TestBed.createComponent(FeedEditor);
    f.componentRef.setInput('entity', 'purchases');
    TestBed.inject(Session).set('direct_entry', 'farmer');
    await settle(f);
    Object.assign(f.componentInstance.draft, {
      on,
      item_id: 'silage',
      quantity: 400,
      unit: 'kg',
      pricing: 'rate',
      basis_quantity: 40,
      basis_unit: 'kg',
    });
    f.componentInstance.rate = 2000;
    f.componentInstance.transport = 100;
    await f.componentInstance.save();
    const b = write.mock.calls[0][1];
    expect(b.quantity).toBe(400);
    expect(b.unit).toBe('kg');
    expect(b.basis_quantity).toBe(40);
    expect(b.basis_price_minor).toBe(200000);
    expect(b.transport_minor).toBe(10000);
  });
  it('blocks an incomplete optional crop date instead of erasing it', async () => {
    const f = TestBed.createComponent(FeedEditor);
    f.componentRef.setInput('entity', 'crops');
    TestBed.inject(Session).set('recall', 'farmer');
    await settle(f);
    const date = f.nativeElement.querySelector('[data-role="date-text"]') as HTMLInputElement;
    date.value = 'sometime in spring';
    date.dispatchEvent(new Event('input'));
    f.detectChanges();
    await f.componentInstance.save();
    expect(write).not.toHaveBeenCalled();
    expect(f.componentInstance.localError).toContain('Finish or clear');
    date.value = '2025';
    date.dispatchEvent(new Event('input'));
    f.detectChanges();
    await f.componentInstance.save();
    expect(write.mock.calls[0][1].sowing_on).toBe('2025-01-01');
    expect(write.mock.calls[0][1].sowing_precision).toBe('year');
  });
  it('keeps form values and retry key after a server refusal', async () => {
    write.mockRejectedValue(
      new ApiError({ error: 'feed_conflict', message: 'Reload and review.' }, true),
    );
    const f = TestBed.createComponent(FeedEditor);
    f.componentRef.setInput('entity', 'items');
    TestBed.inject(Session).set('direct_entry', 'farmer');
    await settle(f);
    field(f, 'label', 'Khall');
    await f.componentInstance.save();
    await f.componentInstance.save();
    expect(write.mock.calls[0][2]).toBe(write.mock.calls[1][2]);
    expect(f.componentInstance.draft.label).toBe('Khall');
  });
});
describe('daily feeding', () => {
  let write: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    write = vi.fn();
    const read = vi.fn((p: string) =>
      Promise.resolve(
        p.startsWith('daily/on/')
          ? null
          : p.startsWith('recipients')
            ? {
                herd: [{ id: 'BD-0001', name: 'Kali' }],
                milking: [{ id: 'BD-0001', name: 'Kali' }],
              }
            : [],
      ),
    );
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of({}), snapshot: { paramMap: { get: () => on } } },
        },
        { provide: RegistryApi, useValue: { feedGet: read, feedWrite: write } },
      ],
    });
  });
  it('ignores history from a previous feeding account', async () => {
    const f = TestBed.createComponent(FeedDailyScreen);
    await settle(f);
    const c = f.componentInstance;
    c.originalId = 'old';
    let resolve!: (rows: any[]) => void;
    vi.spyOn(TestBed.inject(RegistryApi), 'feedGet').mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const request = c.showRevisions();
    c.originalId = 'new';
    resolve([{ id: 'old-revision' }]); await request;
    expect(c.revisions()).toEqual([]);
  });
  it('untouched account cannot pass review, explicit unknown account can', async () => {
    const f = TestBed.createComponent(FeedDailyScreen);
    await settle(f);
    f.componentInstance.reviewDraft();
    expect(f.componentInstance.review).toBe(false);
    Object.assign(f.componentInstance.draft, {
      fresh_status: 'unknown',
      additional_status: 'unknown',
      assessment: 'unknown',
    });
    f.componentInstance.reviewDraft();
    expect(f.componentInstance.review).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
  it('group shortcut shows a snapshot and requires confirmation', async () => {
    const f = TestBed.createComponent(FeedDailyScreen);
    await settle(f);
    const c = f.componentInstance;
    c.addLine();
    const l = c.draft.lines[0];
    l.recipients = 'milking';
    c.refreshLine(l);
    expect(l.animal_ids).toEqual(['BD-0001']);
    expect(l.recipients_confirmed).toBe(false);
    Object.assign(c.draft, {
      fresh_status: 'none',
      additional_status: 'given',
      assessment: 'not_applicable',
    });
    c.reviewDraft();
    expect(c.review).toBe(false);
    l.recipients_confirmed = true;
    c.reviewDraft();
    expect(c.review).toBe(true);
  });
  it('nested purchase save preserves daily draft and does not implicitly add feeding', async () => {
    const f = TestBed.createComponent(FeedDailyScreen);
    await settle(f);
    const c = f.componentInstance;
    Object.assign(c.draft, {
      notes: 'Keep this draft',
      assessment: 'short',
      fresh_status: 'given',
    });
    c.addLine();
    const before = structuredClone(c.draft);
    c.nested = 'purchases';
    await c.nestedSaved({ ...blankFeed(), id: 'purchase' });
    expect(c.draft).toEqual(before);
    expect(c.purchaseSaved()).toBe('purchase');
    expect(write).not.toHaveBeenCalled();
  });
  it('changing selected animals retracts confirmation without inferring quantity', async () => {
    const f = TestBed.createComponent(FeedDailyScreen);
    await settle(f);
    const c = f.componentInstance;
    c.addLine();
    const l = c.draft.lines[0];
    l.recipients = 'selected';
    l.recipients_confirmed = true;
    c.toggleAnimal(l, 'BD-0001');
    expect(l.animal_ids).toEqual(['BD-0001']);
    expect(l.recipients_confirmed).toBe(false);
    expect(l.quantity).toBeNull();
  });
});

describe('saved feeding correction semantics', () => {
  it('keeps saved provenance, prevents unchanged/reverted saves, and explicitly discards on conflict', async () => {
    const record = {
      ...blankFeed(),
      id: 'feed-fixture',
      on: '2026-09-17',
      revision: 2,
      recorded_by: 'adnan',
      source_form: 'recall',
      source_ref: 'old notebook',
      notes: 'Original note',
      fresh_status: 'unknown',
      additional_status: 'unknown',
      assessment: 'unknown',
    };
    const latest = { ...record, revision: 3, notes: 'Another recorder updated this' };
    const read = vi.fn(async (path: string) =>
      path.startsWith('daily/on/')
        ? record
        : path.startsWith('recipients')
          ? { herd: [], milking: [] }
          : [],
    );
    const write = vi
      .fn()
      .mockRejectedValue(
        new ApiError({ error: 'feed_conflict', message: 'Original revision conflict' }, true),
      );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of({}), snapshot: { paramMap: { get: () => record.on } } },
        },
        { provide: RegistryApi, useValue: { feedGet: read, feedWrite: write } },
      ],
    });
    TestBed.inject(Session).set('direct_entry', 'spec-review');
    const f = TestBed.createComponent(FeedDailyScreen);
    await settle(f);
    const c = f.componentInstance;
    expect(c.savedView).toBe(true);
    expect(f.nativeElement.textContent).toContain('recorded by adnan');
    expect(f.nativeElement.querySelector('button[type=submit]')).toBeNull();
    (Array.from(f.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => b.textContent?.trim() === 'Edit account')!
      .click();
    await settle(f);
    c.reviewDraft();
    await c.save();
    expect(write).not.toHaveBeenCalled();
    c.draft.notes = 'Changed note';
    c.draft.notes = 'Original note';
    c.reviewDraft();
    expect(c.localError).toBe('No changes to save.');
    field(f, 'notes', 'Changed note');
    f.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle(f);
    expect(f.nativeElement.textContent).toContain(
      'This correction will be recorded by spec-review',
    );
    await c.save();
    expect(write.mock.calls[0][1].revision).toBe(2);
    expect(write.mock.calls[0][1].recorded_by).toBe('spec-review');
    expect(c.originalRecord!.recorded_by).toBe('adnan');
    expect(c.draft.notes).toBe('Changed note');
    c.latest.set(latest);
    const keep = c.adoptLatest();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-role=keep-editing]')!.click();
    await keep;
    expect(c.draft.notes).toBe('Changed note');
    expect(c.draft.revision).toBe(2);
    const discard = c.adoptLatest();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-role=discard-changes]')!.click();
    await discard;
    expect(c.draft.revision).toBe(3);
    expect(c.savedView).toBe(true);
  });
});

describe('feed conflict wire records', () => {
  for (const [entity, fields] of [
    ['items', { label: 'Grass', category: 'fresh_fodder', archived: false }],
    ['crops', { item_id: 'grass', plot: 'North', status: 'growing' }],
    ['expenses', { crop_id: 'crop', on, category: 'seed', amount_minor: 2500 }],
    ['purchases', { item_id: 'grass', on, goods_minor: 10000, transport_minor: 300, other_minor: 0 }],
  ] as const) {
    it(`adopts ${entity} without creating invalid hidden money`, async () => {
      TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: RegistryApi, useValue: {} }] });
      const f = TestBed.createComponent(FeedEditor);
      f.componentRef.setInput('entity', entity);
      await f.whenStable();
      f.componentInstance.latest = { id: 'record', revision: 2, notes: null,
        source_form: 'direct_entry', recorded_by: 'tester', recorded_at: '', source_ref: null, ...fields } as any;
      await f.componentInstance.adoptLatest();
      for (const value of [f.componentInstance.rate, f.componentInstance.goods, f.componentInstance.amount,
        f.componentInstance.transport, f.componentInstance.other]) {
        expect(value === null || Number.isFinite(value)).toBe(true);
      }
      expect(f.componentInstance.draft.revision).toBe(2);
    });
  }
  it('renders a delayed conflict lookup failure without forced change detection', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise((_, no) => { reject = no; });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: RegistryApi, useValue: { feedGet: () => pending } }] });
    const f = TestBed.createComponent(FeedEditor);
    f.componentRef.setInput('entity', 'items');
    f.componentRef.setInput('record', { ...blankFeed(), id: 'item', label: 'Grass' });
    await f.whenStable();
    const lookup = f.componentInstance.compareLatest();
    await f.whenStable();
    reject(new Error('Latest revision unavailable'));
    await lookup;
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Latest revision unavailable');
  });
});

it('ignores an older feed conflict result after a newer lookup', async () => {
  let resolve!: (value: unknown) => void;
  const old = new Promise(r => { resolve = r; });
  const latest = { ...blankFeed(), id: 'item', label: 'Current', revision: 3 };
  const feedGet = vi.fn().mockReturnValueOnce(old).mockResolvedValue(latest);
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
    { provide: RegistryApi, useValue: { feedGet } }] });
  const f = TestBed.createComponent(FeedEditor);
  f.componentRef.setInput('entity', 'items');
  f.componentRef.setInput('record', { ...blankFeed(), id: 'item', label: 'Original' });
  await f.whenStable();
  const first = f.componentInstance.compareLatest();
  await f.componentInstance.compareLatest();
  resolve({ ...latest, revision: 2 }); await first;
  expect(f.componentInstance.latest?.revision).toBe(3);
  f.componentRef.setInput('record', { ...latest, id: 'other' });
  await f.whenStable();
  expect(f.componentInstance.latest).toBeNull();
});

it('preserves an adopted crop date before date controls emit', async () => {
  const feedWrite = vi.fn().mockResolvedValue({ ...blankFeed(), id: 'crop' });
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
    { provide: RegistryApi, useValue: { feedWrite } }] });
  const f = TestBed.createComponent(FeedEditor);
  f.componentRef.setInput('entity', 'crops');
  await f.whenStable();
  TestBed.inject(Session).set('direct_entry', 'tester');
  const c = f.componentInstance;
  c.latest = { ...blankFeed(), id: 'crop', sowing_on: '2026-09-01', sowing_precision: 'month' } as any;
  await c.adoptLatest();
  c.draft.notes = 'Correction';
  c.dateEntries = {};
  await c.save();
  expect(feedWrite.mock.calls[0][1].sowing_on).toBe('2026-09-01');
  expect(feedWrite.mock.calls[0][1].sowing_precision).toBe('month');
});
