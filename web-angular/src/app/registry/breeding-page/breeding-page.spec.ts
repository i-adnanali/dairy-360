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
import type { BreedingBoard, BreedingCaseRow, BreedingFigures, BreedingTask, ReproductionView } from '../types';

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

// The mockup's sample herd, worded through the server's shape. Held to first
// service has 7 decided cases, under minCases, so no rate; losses has 12, so one.
const figures: BreedingFigures = {
  on: '2026-11-13',
  period: '12m',
  from: '2025-11-14',
  animals: 11,
  overdue_now: { n: 1, animals: [{ animal_id: 'BD-0002', animal_name: 'Sohni', day_max: 350 }] },
  services_per_conception: { services: 8, conceptions: 6, value: null },
  held_to_first_service: { n: 4, of: 7, rate: null, pending: 4 },
  confirmed_by_day_60: { n: 3, of: 6, rate: null, later_days: [63, 68, 74] },
  days_open: { value: 97, n: 5, min: 67, max: 148, approximate: 1 },
  calving_interval: { value: 416, n: 4, min: 408, max: 430, approximate: 0 },
  losses: { n: 1, of: 12, rate: 8 },
  heats_caught: { recorded: 7, expected: 12, estimated: true },
  by_animal: [
    { animal_id: 'BD-0002', animal_name: 'Sohni', services: 2, first_service: 'held', confirmed_day: 63, days_open: 97, calving_interval: 416 },
    { animal_id: 'BD-0007', animal_name: 'Rani', services: 1, first_service: 'pending', confirmed_day: null, days_open: null, calving_interval: null },
    { animal_id: 'BD-0009', animal_name: null, services: 3, first_service: 'replaced', confirmed_day: null, days_open: null, calving_interval: null },
  ],
  rough: ['4 services have no outcome yet', '1 animal has no earlier calving', 'expected heats are estimated'],
};

async function mount(url = '/animals/breeding', data: BreedingBoard = board, figs: BreedingFigures = figures) {
  const breedingBoard = vi.fn(() => Promise.resolve(structuredClone(data)));
  const breedingFigures = vi.fn((period: '12m' | 'all') => Promise.resolve({ ...structuredClone(figs), period, from: period === 'all' ? null : figs.from }));
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{ path: 'animals/breeding', component: BreedingPage }]),
      { provide: RegistryApi, useValue: { breedingBoard, breedingFigures, identifierValues: () => Promise.resolve({}) } },
    ],
  });
  TestBed.inject(Session).set('direct_entry', 'adnan');
  const h = await RouterTestingHarness.create(url);
  await settle(h);
  return { h, el: h.fixture.nativeElement as HTMLElement, breedingBoard, breedingFigures };
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
    const exact = el.querySelector('[data-role="case-row"][data-animal="BD-0009"]')!;
    expect(text(exact.querySelector('[data-role="latest-check"]'))).toBe('—');
  });

  it('dots the calving window only when it rests on a month-only service', async () => {
    const { el } = await mount('/animals/breeding?tab=cases');
    const win = (id: string) => el.querySelector(`[data-role="case-row"][data-animal="${id}"] [data-role="window"] span`)!;
    expect(win('BD-0009').getAttribute('data-certainty')).toBe('known');
    expect(win('BD-0009').className).not.toContain('border-dotted');
    expect(win('BD-0019').getAttribute('data-certainty')).toBe('approximate');
    expect(win('BD-0019').className).toContain('border-dotted');
  });

  it('links Record calving to the calving form on her, and Record dry-off to her Add an event tab', async () => {
    const b = structuredClone(board);
    b.tasks = [
      { ...task({ kind: 'calving_watch', animal_id: 'BD-0009', standing: 'due' }), animal_name: 'Moti' },
      { ...task({ kind: 'dry_off', animal_id: 'BD-0007', standing: 'due' }), animal_name: 'Rani' },
    ];
    const { el } = await mount('/animals/breeding', b);
    const href = (id: string) => el.querySelector(`[data-animal="${id}"] [data-role="task-action"]`)!.getAttribute('href');
    expect(href('BD-0009')).toBe('/animals/calvings/new?dam=BD-0009');
    expect(href('BD-0007')).toBe('/animals/BD-0007?tab=add-event');
  });

  it('the To do count is neutral at nought', async () => {
    const b = { ...structuredClone(board), tasks: [], overdue: 0, due: 0 };
    const { el } = await mount('/animals/breeding', b);
    const n = el.querySelector('[data-tab="todo"] .tab-n')!;
    expect(text(n)).toBe('0');
    expect(n.className).not.toMatch(/danger|warning/);
  });

  it('Find filters as you type', async () => {
    const { h, el } = await mount('/animals/breeding?tab=cases');
    const find = el.querySelector<HTMLInputElement>('input[name="find"]')!;
    find.value = 'rani';
    find.dispatchEvent(new Event('input'));
    await settle(h);
    expect(Array.from(el.querySelectorAll('[data-role="case-row"]')).map((r) => r.getAttribute('data-animal'))).toEqual(['BD-0007']);
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

  // ---- Herd figures ---------------------------------------------------------
  it('the Herd figures tab asks for the last 12 months, and All on record asks for all', async () => {
    const { h, el, breedingFigures } = await mount();
    expect(breedingFigures).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>('[data-tab="figures"]')!.click();
    await settle(h);
    expect(text(el.querySelector('[data-tab="figures"]'))).toBe('Herd figures');
    expect(breedingFigures).toHaveBeenLastCalledWith('12m');
    expect(text(el.querySelector('[data-role="figures-lead"]'))).toBe(
      'Counted from the cases on record. With a herd this size, read the counts before the percentages.',
    );
    expect(text(el.querySelector('[data-role="figures-range"]'))).toBe('14 Nov 2025 to 13 Nov 2026 · 11 animals with a service in this period');
    el.querySelector<HTMLButtonElement>('[data-period="all"]')!.click();
    await settle(h);
    expect(breedingFigures).toHaveBeenLastCalledWith('all');
    expect(el.querySelector('[data-period="all"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(text(el.querySelector('[data-role="figures-range"]'))).toBe('All on record · 11 animals with a service');
  });

  it('opens on the figures from the address, with the eight cards in order', async () => {
    const { el, breedingFigures } = await mount('/animals/breeding?tab=figures&period=all');
    expect(breedingFigures).toHaveBeenLastCalledWith('all');
    const titles = Array.from(el.querySelectorAll('[data-role="figure"] dt')).map(text);
    expect(titles).toEqual([
      'Overdue now', 'Services per conception', 'Held to first service', 'Confirmed by day 60',
      'Days open', 'Calving interval', 'Losses', 'Heats caught',
    ]);
  });

  it('a count under its minimum shows "4 of 7" and no percentage; one with a rate shows it', async () => {
    const { el } = await mount('/animals/breeding?tab=figures');
    const card = (k: string) => el.querySelector(`[data-role="figure"][data-figure="${k}"]`)!;
    const held = card('held_to_first_service');
    expect(text(held.querySelector('.figure-value'))).toBe('4 of 7');
    expect(text(held)).not.toContain('%');
    expect(text(held.querySelector('.figure-note'))).toBe('First services with a known outcome. 4 more have no outcome yet.');
    const losses = card('losses');
    expect(text(losses.querySelector('.figure-value'))).toBe('1 of 12 · 8%');
    expect(text(card('overdue_now').querySelector('.figure-note'))).toBe('BD-0002 Sohni, day 350. Follows straight from the calving window.');
    expect(text(card('services_per_conception').querySelector('.figure-value'))).toBe('–');
    expect(text(card('services_per_conception').querySelector('.figure-note'))).toBe(
      '8 services for 6 confirmed pregnancies. Counts only services that were written down.',
    );
    expect(text(card('confirmed_by_day_60').querySelector('.figure-note'))).toBe(
      'The other 3 were confirmed later, on days 63, 68 and 74. Day 60 is your own yardstick.',
    );
    const open = card('days_open');
    expect(text(open.querySelector('.figure-value'))).toBe('97 days, middle of 5');
    expect(open.querySelector('[data-role="spread-value"]')!.className).toContain('border-dotted');
    expect(text(open.querySelector('.figure-note'))).toBe('From calving to the service that held. Shortest 67, longest 148.');
    const interval = card('calving_interval');
    expect(text(interval.querySelector('.figure-value'))).toBe('416 days, average of 4');
    expect(interval.querySelector('[data-role="spread-value"]')!.className).not.toContain('border-dotted');
  });

  it('a held-to-first-service count at its minimum shows the rate', async () => {
    const f = { ...structuredClone(figures), held_to_first_service: { n: 6, of: 10, rate: 60, pending: 0 } };
    const { el } = await mount('/animals/breeding?tab=figures', board, f);
    const held = el.querySelector('[data-figure="held_to_first_service"]')!;
    expect(text(held.querySelector('.figure-value'))).toBe('6 of 10');
    expect(text(held.querySelector('.figure-note'))).toBe('60% of first services with a known outcome.');
  });

  it('nothing to count shows a dash and no numbers in the sentence', async () => {
    const f = {
      ...structuredClone(figures),
      overdue_now: { n: 0, animals: [] },
      services_per_conception: { services: 0, conceptions: 0, value: null },
      confirmed_by_day_60: { n: 0, of: 0, rate: null, later_days: [] },
      days_open: { value: null, n: 0, min: null, max: null, approximate: 0 },
    };
    const { el } = await mount('/animals/breeding?tab=figures', board, f);
    const card = (k: string) => el.querySelector(`[data-figure="${k}"]`)!;
    expect(text(card('overdue_now').querySelector('.figure-value'))).toBe('0');
    expect(text(card('overdue_now').querySelector('.figure-note'))).toBe('Follows straight from the calving window.');
    expect(text(card('services_per_conception').querySelector('.figure-note'))).toBe('Counts only services that were written down.');
    expect(text(card('confirmed_by_day_60').querySelector('.figure-value'))).toBe('–');
    expect(text(card('confirmed_by_day_60').querySelector('.figure-note'))).toBe('Day 60 is your own yardstick.');
    expect(text(card('days_open').querySelector('.figure-value'))).toBe('–');
    expect(text(card('days_open').querySelector('.figure-note'))).toBe('From calving to the service that held.');
  });

  it('Heats caught carries est, and the rough lines and footers are shown', async () => {
    const { el } = await mount('/animals/breeding?tab=figures');
    const heats = el.querySelector('[data-figure="heats_caught"]')!;
    expect(text(heats.querySelector('.figure-value'))).toBe('7 of 12est');
    expect(text(heats.querySelector('[appQualifier]'))).toBe('est');
    expect(text(heats.querySelector('.figure-note'))).toBe('Heats recorded against heats expected. "Expected" is itself an estimate.');
    expect(Array.from(el.querySelectorAll('[data-role="rough"] li')).map(text)).toEqual(figures.rough);
    expect(text(el)).toContain('No target lines are drawn. What counts as a good days-open or calving interval differs by breed and by source, so the page shows your own numbers and their range.');
    expect(text(el)).toContain('A figure with fewer than its minimum number of cases shows the count and no rate.');
  });

  it('the By animal table lists one row per animal, with outcomes in words', async () => {
    const { el } = await mount('/animals/breeding?tab=figures');
    const table = el.querySelector('[data-role="by-animal"]')!;
    expect(Array.from(table.querySelectorAll('th')).map(text)).toEqual([
      'Animal', 'Services', 'First service', 'Confirmed', 'Days open', 'Calving interval',
    ]);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows.map((r) => r.getAttribute('data-animal'))).toEqual(['BD-0002', 'BD-0007', 'BD-0009']);
    expect(Array.from(rows[0].querySelectorAll('td')).map(text)).toEqual(['BD-0002 Sohni', '2', 'Held', 'Day 63', '97', '416']);
    expect(Array.from(rows[1].querySelectorAll('td')).map(text)).toEqual(['BD-0007 Rani', '1', 'No outcome yet', '–', '–', '–']);
    expect(rows[1].querySelector('[data-role="first-service"] span')!.className).toContain('italic');
    expect(text(rows[2].querySelector('[data-role="first-service"]'))).toBe('Followed by a new service');
    expect(text(el)).toContain('Words in italics are answers that are still open. A dash means there is nothing to count, such as a first calving with no interval before it.');
  });
});
