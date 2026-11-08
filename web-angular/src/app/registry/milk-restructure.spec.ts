// The Milk section restructure: one session bar, a saved session that reads as
// saved, withdrawals sized by what they change, and buyers that show what
// they owe.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, type Type } from '@angular/core';
import { provideRouter } from '@angular/router';

import { MilkingRosterScreen } from './milking-roster/milking-roster';
import { DispatchSheetScreen } from './dispatch-sheet/dispatch-sheet';
import { DestinationsList } from './destinations-list/destinations-list';
import { sessionName, stepSession } from './milk-session-nav/milk-session-nav';
import { RegistryApi } from './api';
import { Session } from './session';
import type { DispatchSheet, MilkingRoster, RosterRow } from './types';

const IDS = { observed_by: [], acquired_from: [], sire_ref: [] };

function rosterRow(over: Partial<RosterRow>): RosterRow {
  return {
    animal_id: 'BD-0001', name: 'Noori', days_in_milk: 100, lactation_started_on: '2026-08-01',
    existing: null, previous: null, recent_mean: 6, recent_n: 4, ...over,
  } as RosterRow;
}
function saved(animal: string, litres: number | null) {
  return {
    id: 'mlk_' + animal, animal_id: animal, occurred_on: '2026-09-04', session: 'morning' as const,
    status: litres === null ? ('milked_not_measured' as const) : ('measured' as const),
    yield_litres: litres, reason: null, occurred_time: null, observed_by: null,
    recorded_by: 'zsf', recorded_at: 't', source_form: 'direct_entry' as const, note: null,
  };
}
const ROSTER: MilkingRoster = {
  occurred_on: '2026-09-04', session: 'morning',
  previous_session: { occurred_on: '2026-09-03', session: 'morning' },
  saved: 0,
  rows: [rosterRow({}), rosterRow({ animal_id: 'BD-0002', name: 'Sohni' })],
} as MilkingRoster;

async function mount<T>(component: Type<T>, api: object) {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: RegistryApi, useValue: api }],
  });
  TestBed.inject(Session).set('direct_entry', 'zsf');
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  }
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('session stepping', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('walks sessions, not days: before a morning is the evening before', () => {
    expect(stepSession({ on: '2026-11-08', session: 'morning' }, -1)).toEqual({ on: '2026-11-07', session: 'evening' });
    expect(stepSession({ on: '2026-11-08', session: 'evening' }, -1)).toEqual({ on: '2026-11-08', session: 'morning' });
    expect(stepSession({ on: '2026-11-30', session: 'evening' }, 1)).toEqual({ on: '2026-12-01', session: 'morning' });
  });
  it('names a session in words, never as a bare ISO date', () => {
    expect(sessionName({ on: '2026-11-08', session: 'evening' }, '2026-11-08')).toBe('Evening, Sun 8 Nov');
  });
});

describe('Milking restructure', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens a FULLY saved session as what was saved, with Correct and the way to Dispatch', async () => {
    const roster = {
      ...ROSTER, saved: 2,
      rows: [rosterRow({ existing: saved('BD-0001', 7) }), rosterRow({ animal_id: 'BD-0002', name: 'Sohni', existing: saved('BD-0002', null) })],
    };
    const api = { milkingRoster: async () => structuredClone(roster), identifierValues: async () => IDS };
    const { fixture, el } = await mount(MilkingRosterScreen, api);
    expect(el.querySelector('[data-role="saved-summary"]')).not.toBeNull();
    expect(el.querySelector('[data-role="saved-line"]')!.textContent).toContain('7 L from 1 measured');
    expect(el.querySelector('[data-role="submit"]')).toBeNull();
    expect(el.querySelector('[data-role="litres-BD-0001"]')).toBeNull();
    expect(el.querySelector('[data-role="to-dispatch"]')!.getAttribute('href')).toContain('session=morning');

    (el.querySelector('[data-role="correct"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el.querySelector('[data-role="litres-BD-0001"]') as HTMLInputElement).value).toBe('7');
    expect(el.querySelector('[data-role="submit"]')!.textContent).toContain('Save correction');
  });

  it('gives a milk withdrawal the full notice and a meat one only a tag', async () => {
    const roster = {
      ...ROSTER,
      rows: [
        rosterRow({ health_withdrawals: [{ animal_id: 'BD-0001', target: 'meat', status: 'active' }] }),
        rosterRow({ animal_id: 'BD-0002', name: 'Sohni', health_withdrawals: [{ animal_id: 'BD-0002', target: 'milk', status: 'active', until: '2026-11-10T13:00:00Z' }] }),
      ],
    };
    const api = { milkingRoster: async () => structuredClone(roster), identifierValues: async () => IDS };
    const { el } = await mount(MilkingRosterScreen, api);
    expect(el.querySelector('[data-row="BD-0001"] app-withdrawal-notices')).toBeNull();
    expect(el.querySelector('[data-role="other-withdrawal-BD-0001"]')!.textContent).toContain('Meat withdrawal');
    expect(el.querySelector('[data-row="BD-0002"] [data-medium="milk"]')).not.toBeNull();
  });

  it('puts the total, the progress and the save in one footer', async () => {
    const api = { milkingRoster: async () => structuredClone(ROSTER), identifierValues: async () => IDS };
    const { el } = await mount(MilkingRosterScreen, api);
    const foot = el.querySelector('.milk-foot')!;
    for (const role of ['resolved', 'total', 'blocked', 'submit', 'first-unanswered'])
      expect(foot.querySelector(`[data-role="${role}"]`)).not.toBeNull();
  });
});

describe('Dispatch restructure', () => {
  afterEach(() => TestBed.resetTestingModule());
  const sheet = {
    occurred_on: '2026-09-04', session: 'morning',
    previous_session: { occurred_on: '2026-09-03', session: 'morning' },
    standing: [], occasional: [
      { destination_id: 'dst_ali', name: 'Ali', kind: 'household', billable: true, standing: false, price: null, existing: null, previous: null },
    ],
    litres: 0, amount_minor: 0,
    produced: { measured_litres: 22, measured: 3, not_measured: 0, not_milked: 0, expected: 3, recorded: 3 },
  } as unknown as DispatchSheet;

  it('names the milk that may not be sold, read from the same session', async () => {
    const roster = {
      ...ROSTER,
      rows: [rosterRow({ animal_id: 'BD-0002', name: 'Sohni', health_withdrawals: [{ animal_id: 'BD-0002', target: 'milk', status: 'active' }] })],
    };
    const api = {
      dispatchSheet: async () => structuredClone(sheet),
      milkingRoster: async () => structuredClone(roster),
      identifierValues: async () => IDS,
    };
    const { el } = await mount(DispatchSheetScreen, api);
    const hold = el.querySelector('[data-role="not-for-sale"]')!;
    expect(hold.textContent).toContain('BD-0002 Sohni');
    // An unknown end is still a withdrawal, never "clear".
    expect(hold.textContent).toContain('end not known');
    expect(el.querySelector('[data-role="produced"]')!.textContent).toContain('22 L');
    expect(el.querySelector('[data-role="to-milking"]')!.getAttribute('href')).toContain('/milk/milking');
  });

  it('still works when the roster cannot be read', async () => {
    const api = {
      dispatchSheet: async () => structuredClone(sheet),
      milkingRoster: async () => { throw new Error('offline'); },
      identifierValues: async () => IDS,
    };
    const { el } = await mount(DispatchSheetScreen, api);
    expect(el.querySelector('[data-role="not-for-sale"]')).toBeNull();
    expect(el.querySelector('[data-role="balance-strip"]')).not.toBeNull();
  });
});

describe('Buyers restructure', () => {
  afterEach(() => TestBed.resetTestingModule());
  const rows = [
    { id: 'dst_dodhi', name: 'Bashir', kind: 'dodhi', billable: true, standing: true, contact: null, started_on: '2026-01-01', ended_on: null, note: null, recorded_by: 'a', recorded_at: 't', active: true, price: null, balance_minor: 382_500 },
    { id: 'dst_home', name: 'Home', kind: 'home', billable: false, standing: true, contact: null, started_on: '2026-01-01', ended_on: null, note: null, recorded_by: 'a', recorded_at: 't', active: true, price: null, balance_minor: null },
  ];
  const api = {
    list: async () => ({ items: structuredClone(rows), page: 1, pageSize: 25, totalItems: 2, totalPages: 1, sort: 'identifier', direction: 'asc' }),
  };

  it('shows what each buyer owes, and nothing for home rather than a zero', async () => {
    const { el } = await mount(DestinationsList, api);
    expect(el.querySelector('[data-role="owes-dst_dodhi"]')!.textContent).toContain('Rs 3,825.00');
    expect(el.querySelector('[data-role="owes-dst_home"]')!.textContent!.trim()).toBe('–');
    // Home opens too: its deliveries are worth seeing even though it is never billed.
    expect(el.querySelector('[data-role="open-dst_home"]')).not.toBeNull();
  });

  it('keeps the add form closed until it is asked for', async () => {
    const { fixture, el } = await mount(DestinationsList, api);
    expect(el.querySelector('[data-role="add-form"]')).toBeNull();
    (el.querySelector('[data-role="add-open"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-role="add-form"]')).not.toBeNull();
  });
});
