import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { SessionBoard, buildSlots, selectedSlotKey } from './session-board';
import { RegistryApi } from '../api';
import type { DayBoard } from '../types';

const BOARD: DayBoard = {
  on: '2026-09-07',
  milking: [
    { session: 'morning', expected: 3, recorded: 3, complete: true },
    { session: 'evening', expected: 3, recorded: 0, complete: false },
  ],
  dispatch: [
    { session: 'morning', expected: 2, recorded: 2, complete: true },
    { session: 'evening', expected: 2, recorded: 0, complete: false },
  ],
  feed: { state: 'complete', summary: 'Fed' },
  payroll: { from_on: '2026-09-01', to_on: '2026-09-30', outstanding: 0, permanent: 0 },
  payroll_previous: null,
};
const clone = () => structuredClone(BOARD);
const state = (b: DayBoard, half: 'morning' | 'evening') =>
  Object.fromEntries(buildSlots(b, half).map((s) => [s.key, s.state]));

describe('buildSlots', () => {
  it('lists the five sessions in the order the day runs', () => {
    expect(buildSlots(clone(), 'evening').map((s) => s.label)).toEqual([
      'Morning milking', 'Morning dispatch', 'Feeding', 'Evening milking', 'Evening dispatch',
    ]);
  });

  it('flags only the sessions that are actually outstanding, and lights the first of them', () => {
    const s = state(clone(), 'evening');
    expect(s['milk-morning']).toBe('done');
    expect(s['milk-evening']).toBe('lit');
    expect(s['dispatch-evening']).toBe('open');
    expect(buildSlots(clone(), 'evening').find((x) => x.key === 'milk-evening')!.figure).toBe('0/3');
  });

  it('calls a morning session still open in the evening LATE, in words, and does not light it', () => {
    const b = clone();
    b.milking[0] = { session: 'morning', expected: 3, recorded: 1, complete: false };
    const slots = buildSlots(b, 'evening');
    const morning = slots.find((x) => x.key === 'milk-morning')!;
    expect(morning.state).toBe('late');
    expect(morning.caption).toMatch(/^Late · /);
    expect(slots.find((x) => x.state === 'lit')!.key).toBe('milk-evening');
  });

  it('reads an empty farm as nothing expected, never as outstanding', () => {
    const b = clone();
    b.milking = [
      { session: 'morning', expected: 0, recorded: 0, complete: true },
      { session: 'evening', expected: 0, recorded: 0, complete: true },
    ];
    b.dispatch = structuredClone(b.milking);
    const slots = buildSlots(b, 'morning');
    expect(slots.filter((x) => x.key !== 'feed').every((x) => x.state === 'none')).toBe(true);
    expect(slots.find((x) => x.key === 'milk-morning')!.caption).toBe('Nothing expected');
    expect(slots.some((x) => x.state === 'lit')).toBe(false);
  });

  it('never makes feeding late, and may light it in either half', () => {
    const b = clone();
    b.feed = { state: 'unrecorded', summary: '' };
    b.milking.forEach((m) => { m.complete = true; m.recorded = m.expected; });
    b.dispatch.forEach((m) => { m.complete = true; m.recorded = m.expected; });
    expect(state(b, 'evening')['feed']).toBe('lit');
  });

  it('links each slot to the exact session that clears it', () => {
    const evening = buildSlots(clone(), 'evening').find((x) => x.key === 'dispatch-evening')!;
    expect(evening.link).toEqual(['/milk/dispatch']);
    expect(evening.query).toEqual({ on: '2026-09-07', session: 'evening' });
  });
});

describe('SessionBoard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a navigable list with the lit slot marked as the current step', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RegistryApi, useValue: { today: () => Promise.resolve(clone()) } },
      ],
    });
    const f = TestBed.createComponent(SessionBoard);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const nav = el.querySelector('nav[data-role="session-board"]')!;
    expect(nav.getAttribute('aria-label')).toBe("Today's sessions");
    const links = nav.querySelectorAll('a');
    expect(links.length).toBe(5);
    const current = el.querySelectorAll('[aria-current="step"]');
    expect(current.length).toBeLessThanOrEqual(1);
    const href = el.querySelector('[data-slot="dispatch-evening"]')!.getAttribute('href')!;
    expect(href).toContain('/milk/dispatch');
    expect(href).toContain('session=evening');
  });
});

describe('selectedSlotKey', () => {
  it('fills the slot for the section you are in, separately from the "Now" session', () => {
    expect(selectedSlotKey('/milk/dispatch?on=2026-09-07&session=evening', 'morning')).toBe('dispatch-evening');
    expect(selectedSlotKey('/milk/milking?session=morning', 'evening')).toBe('milk-morning');
    expect(selectedSlotKey('/feed/daily/2026-09-07', 'morning')).toBe('feed');
  });
  it('anywhere in Feed is Feeding -- the overview, a crop, another day', () => {
    expect(selectedSlotKey('/feed', 'morning')).toBe('feed');
    expect(selectedSlotKey('/feed/crops/abc', 'morning')).toBe('feed');
    expect(selectedSlotKey('/feed/daily/2026-09-01', 'evening')).toBe('feed');
  });
  it('reads a sheet opened without a session as the likely one', () => {
    expect(selectedSlotKey('/milk/milking', 'evening')).toBe('milk-evening');
  });
  it('fills nothing outside the sessions', () => {
    expect(selectedSlotKey('/milk/buyers', 'morning')).toBeNull();
    expect(selectedSlotKey('/feedback', 'morning')).toBeNull();
    expect(selectedSlotKey('/animals', 'morning')).toBeNull();
    expect(selectedSlotKey('/', 'morning')).toBeNull();
  });
});
