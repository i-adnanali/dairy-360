// The Breeding page: To do (tasks past their limit, then due now) and Cases,
// with the entry form in a side panel. The board is computed on read by the
// server; the page only filters, sorts and words it.

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BreedingPage } from './breeding-page';
import { RegistryApi } from '../api';
import { Session } from '../session';
import type { BreedingBoard, BreedingCaseRow, BreedingTask, ReproductionView } from '../types';

const view = (over: Partial<ReproductionView>): ReproductionView => ({
  state: 'unconfirmed',
  basis: 'inferred',
  as_of: '2026-11-13',
  service: { event_id: 'e1', service_type: 'ai', occurred_on: '2026-09-02', date_precision: 'day', exposure_days: null },
  services_in_case: 1,
  ambiguous_attribution: false,
  conception_earliest: '2026-09-02',
  conception_latest: '2026-09-02',
  day_min: 72,
  day_max: 72,
  window: { opens_on: '2027-06-14', closes_on: '2027-07-24' },
  latest_check: null,
  ...over,
});
const task = (over: Partial<BreedingTask>): BreedingTask => ({
  kind: 'pregnancy_check', animal_id: 'BD-0009', standing: 'overdue',
  day_min: 72, day_max: 72, red_from: 61, red_on: '2026-11-02', ...over,
});

const moti = task({});
const chandni = task({ animal_id: 'BD-0019', day_min: 91, day_max: 165, red_from: 61, red_on: '2026-08-01' });
const rani = task({ kind: 'heat_watch', animal_id: 'BD-0007', standing: 'due', day_min: 20, day_max: 20, red_from: 24, red_on: '2026-11-17' });

const cases: BreedingCaseRow[] = [
  { animal_id: 'BD-0009', animal_name: 'Moti', view: view({}), notes: [], tasks: [moti], entry_open: true },
  {
    animal_id: 'BD-0019', animal_name: 'Chandni', notes: [], tasks: [chandni], entry_open: false,
    view: view({
      service: { event_id: 'e2', service_type: 'bull_exposure', occurred_on: '2026-06-01', date_precision: 'month', exposure_days: 45 },
      day_min: 91, day_max: 165,
    }),
  },
  { animal_id: 'BD-0007', animal_name: 'Rani', view: view({ state: 'bred', day_min: 20, day_max: 20 }), notes: [], tasks: [rani], entry_open: true },
  { animal_id: 'BD-0004', animal_name: 'Sohni', view: view({ state: 'calved', basis: 'observed', day_min: 290, day_max: 290 }), notes: [], tasks: [], entry_open: false },
];
const board: BreedingBoard = {
  on: '2026-11-13',
  tasks: [
    { ...moti, animal_name: 'Moti' },
    { ...chandni, animal_name: 'Chandni' },
    { ...rani, animal_name: 'Rani' },
  ],
  overdue: 2,
  due: 1,
  cases,
};

async function mount(url = '/animals/breeding') {
  const breedingBoard = vi.fn(() => Promise.resolve(structuredClone(board)));
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{ path: 'animals/breeding', component: BreedingPage }]),
      { provide: RegistryApi, useValue: { breedingBoard, identifierValues: () => Promise.resolve({}) } },
    ],
  });
  TestBed.inject(Session).set('direct_entry', 'adnan');
  const h = await RouterTestingHarness.create(url);
  await settle(h);
  return { h, el: h.fixture.nativeElement as HTMLElement, breedingBoard };
}
async function settle(h: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await h.fixture.whenStable();
    h.detectChanges();
  }
}
const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
async function pick(h: RouterTestingHarness, el: HTMLElement, sel: string, value: string) {
  const s = el.querySelector<HTMLSelectElement>(sel)!;
  s.value = value;
  s.dispatchEvent(new Event('change'));
  await settle(h);
}

afterEach(() => TestBed.resetTestingModule());

describe('the Breeding page', () => {
  it('lists an overdue task under "Past their limit" with its action', async () => {
    const { el } = await mount();
    expect(text(el.querySelector('h2'))).toBe('Breeding');
    expect(text(el.querySelector('[data-role="breeding-summary"]'))).toBe('2 past their limit · 1 due now');
    const tab = el.querySelector('[data-tab="todo"] .tab-n')!;
    expect(text(tab)).toBe('3');
    const overdue = el.querySelector('[data-role="overdue-block"]')!;
    expect(text(overdue.querySelector('h3'))).toContain('Past their limit');
    const row = overdue.querySelector('[data-animal="BD-0009"]')!;
    expect(text(row)).toContain('BD-0009 Moti');
    expect(text(row)).toContain('Pregnancy check due');
    expect(text(row.querySelector('.task-meta'))).toBe('Day 72 · Red since day 61 (2 Nov 2026)');
    expect(text(row.querySelector('.task-status'))).toBe('Overdue');
    expect(text(row.querySelector('[data-role="task-action"]'))).toBe('Record check');
    const due = el.querySelector('[data-role="due-block"]')!;
    expect(text(due.querySelector('h3'))).toContain('Due now');
    const heat = due.querySelector('[data-animal="BD-0007"]')!;
    expect(text(heat.querySelector('.task-meta'))).toBe('Day 20 · Turns red on day 24 (17 Nov 2026)');
    expect(Array.from(heat.querySelectorAll('[data-role="task-action"]')).map(text)).toEqual(['Heat seen', 'Nothing seen']);
    expect(text(el)).toContain('A task opens from a rule and closes when the matching event is recorded. Nobody ticks one off by hand.');
  });

  it('keeps a wide range visible on a task row, marked approximate', async () => {
    const { el } = await mount();
    const row = el.querySelector('[data-role="overdue-block"] [data-animal="BD-0019"]')!;
    const day = row.querySelector('[data-role="day"]')!;
    expect(text(day)).toBe('Day 91 to 165');
    expect(day.getAttribute('data-certainty')).toBe('approximate');
    // The qualifier's space is a margin (appQualifier), not a text node.
    expect(text(row.querySelector('[data-role="range-qualifier"]'))).toBe('month');
    expect(text(row.querySelector('.task-meta'))).toBe('Day 91 to 165month · Red since day 61 (1 Aug 2026)');
  });

  it('the Task type filter hides other kinds', async () => {
    const { h, el } = await mount();
    await pick(h, el, 'select[name="type"]', 'heat_watch');
    const rows = Array.from(el.querySelectorAll('[data-role="breeding-task"]'));
    expect(rows.map((r) => r.getAttribute('data-animal'))).toEqual(['BD-0007']);
    expect(el.querySelector('[data-role="overdue-block"]')).toBeNull();
  });

  it('says so when nothing is due', async () => {
    const { h, el } = await mount();
    await pick(h, el, 'select[name="type"]', 'calving_watch');
    expect(el.querySelectorAll('[data-role="breeding-task"]').length).toBe(0);
    expect(text(el.querySelector('[data-role="nothing-due"]'))).toBe('Nothing is due.');
  });

  it('opens filtered to the animal named in the address', async () => {
    const { el } = await mount('/animals/breeding?animal=BD-0007');
    const rows = Array.from(el.querySelectorAll('[data-role="breeding-task"]'));
    expect(rows.map((r) => r.getAttribute('data-animal'))).toEqual(['BD-0007']);
  });

  it('the Cases tab shows Closed rows only when Closed is chosen', async () => {
    const { h, el } = await mount();
    el.querySelector<HTMLButtonElement>('[data-tab="cases"]')!.click();
    await settle(h);
    const ids = () => Array.from(el.querySelectorAll('[data-role="case-row"]')).map((r) => r.getAttribute('data-animal'));
    // Most urgent first: overdue (by day_max, descending), then due.
    expect(ids()).toEqual(['BD-0019', 'BD-0009', 'BD-0007']);
    el.querySelector<HTMLButtonElement>('[data-show="closed"]')!.click();
    await settle(h);
    expect(ids()).toEqual(['BD-0004']);
    el.querySelector<HTMLButtonElement>('[data-show="all"]')!.click();
    await settle(h);
    expect(ids()).toEqual(['BD-0019', 'BD-0009', 'BD-0007', 'BD-0004']);
  });

  it('a month-precision case shows Day 91 to 165 marked approximate', async () => {
    const { h, el } = await mount('/animals/breeding?tab=cases');
    await settle(h);
    const row = el.querySelector('[data-role="case-row"][data-animal="BD-0019"]')!;
    const day = row.querySelector('[data-role="day"]')!;
    expect(text(day)).toBe('Day 91 to 165');
    expect(day.getAttribute('data-certainty')).toBe('approximate');
    expect(text(row.querySelector('[data-role="day-cell"] [data-role="range-qualifier"]'))).toBe('month');
    expect(text(row.querySelector('[data-role="service"]'))).toBe('Bull running with her · Jun 2026month');
    expect(text(row.querySelector('[data-role="next"]'))).toBe('Pregnancy check due');
    const closed = el.querySelector('[data-role="case-row"][data-animal="BD-0009"]')!;
    expect(text(closed.querySelector('[data-role="latest-check"]'))).toBe('—');
  });

  it('Record heat opens the panel with the form on heat_observed', async () => {
    const { h, el } = await mount();
    const button = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-role="breeding-actions"] button')).find((b) => text(b) === 'Record heat')!;
    button.click();
    await settle(h);
    const panel = el.querySelector('[data-role="breeding-panel"]')!;
    expect(text(panel.querySelector('#breeding-panel-title'))).toBe('Record heat');
    // Only the animals the page may enter for.
    const options = Array.from(panel.querySelectorAll<HTMLOptionElement>('select[name="entryAnimal"] option')).map((o) => o.value);
    expect(options).toEqual(['', 'BD-0009', 'BD-0007']);
    await pick(h, el, 'select[name="entryAnimal"]', 'BD-0007');
    expect(panel.querySelector('app-breeding-form [data-chip="heat_observed"]')?.getAttribute('aria-checked')).toBe('true');
    panel.querySelector<HTMLButtonElement>('.panel-close')!.click();
    await settle(h);
    expect(el.querySelector('[data-role="breeding-panel"]')).toBeNull();
  });

  it('a row action opens the form for that animal on its kind', async () => {
    const { h, el } = await mount();
    const row = el.querySelector('[data-animal="BD-0007"]')!;
    const nothing = Array.from(row.querySelectorAll<HTMLButtonElement>('[data-role="task-action"]')).find((b) => text(b) === 'Nothing seen')!;
    nothing.click();
    await settle(h);
    const panel = el.querySelector('[data-role="breeding-panel"]')!;
    expect(panel.querySelector<HTMLSelectElement>('select[name="entryAnimal"]')!.value).toBe('BD-0007');
    expect(panel.querySelector('app-breeding-form [data-chip="null_observation"]')?.getAttribute('aria-checked')).toBe('true');
  });
});
