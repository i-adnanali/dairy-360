// The milking roster: what it guarantees, and what it deliberately allows.
//
// The behaviour worth pinning is not "a number reaches the server" -- it is that
// an animal cannot be dropped by accident and CAN be dropped on purpose. Those
// two pull in opposite directions and the whole screen is the compromise.

import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MilkingRosterScreen } from './milking-roster';
import { Session } from './session';
import { WriteLog } from './after-write';
import type { MilkingRoster } from './types';

const BASE = '/api/registry';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
  });
  const http = TestBed.inject(HttpTestingController);
  TestBed.inject(Session).set('direct_entry', 'zsf');
  return { http };
}

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
  fixture.detectChanges();
}

const ROSTER: MilkingRoster = {
  occurred_on: '2026-09-04',
  session: 'morning',
  previous_session: { occurred_on: '2026-09-03', session: 'evening' },
  saved: 0,
  rows: [
    {
      animal_id: 'BD-0001', name: 'Noori', days_in_milk: 120,
      lactation_started_on: '2026-05-07', existing: null,
      previous: { session: 'evening', occurred_on: '2026-09-03', status: 'measured', yield_litres: 6 },
      recent_mean: 6, recent_n: 4,
    },
    {
      animal_id: 'BD-0002', name: 'Sohni', days_in_milk: 40,
      lactation_started_on: '2026-07-26', existing: null, previous: null,
      recent_mean: null, recent_n: 0,
    },
  ],
};

async function mount(roster: MilkingRoster = ROSTER) {
  const { http } = setup();
  const fixture = TestBed.createComponent(MilkingRosterScreen);
  fixture.detectChanges();
  http.match((r) => r.url.startsWith(`${BASE}/identifier-values`)).forEach((r) =>
    r.flush({ observed_by: [], acquired_from: [], sire_ref: [] }),
  );
  http.match((r) => r.url.startsWith(`${BASE}/milking/roster`)).forEach((r) => r.flush(roster));
  await settle(fixture);
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
}

const cell = (el: HTMLElement, id: string) =>
  el.querySelector(`[data-role="litres-${id}"]`) as HTMLInputElement;

function type(fixture: { detectChanges(): void }, el: HTMLElement, id: string, v: string) {
  const input = cell(el, id);
  input.value = v;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function press(fixture: { detectChanges(): void }, el: HTMLElement, id: string, key: string) {
  cell(el, id).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  fixture.detectChanges();
}

describe('MilkingRoster', () => {
  it('asks the server for TODAY and the session the clock suggests', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(MilkingRosterScreen);
    fixture.detectChanges();
    http.match((r) => r.url.startsWith(`${BASE}/identifier-values`)).forEach((r) =>
      r.flush({ observed_by: [], acquired_from: [], sire_ref: [] }),
    );

    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/milking/roster`));
    // Today is a legitimate default HERE and nowhere else -- today is a fact,
    // not a guess -- and the session is a shown, changeable inference.
    expect(req.request.url).toMatch(/on=\d{4}-\d{2}-\d{2}/);
    expect(req.request.url).toMatch(/session=(morning|evening)/);
    req.flush(ROSTER);
  });

  it('renders the roster it was given — there is no picker', async () => {
    const { el } = await mount();
    expect(el.querySelectorAll('[data-row]').length).toBe(2);
    expect(el.querySelector('select')).toBeNull();
    // The context that does the error-catching, all free from existing data.
    expect(el.querySelector('[data-row="BD-0001"] [data-role="dim"]')!.textContent).toContain('120');
    expect(el.querySelector('[data-row="BD-0001"] [data-role="previous"]')!.textContent).toContain('6');
  });

  it('BLOCKS the save while any animal is untouched, and NAMES her', async () => {
    // "3 animals left" makes the operator hunt, and the hunt is where one gets
    // skipped.
    const { el, fixture } = await mount();
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('Noori');

    type(fixture, el, 'BD-0001', '6.5');
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('Sohni');
    expect(el.querySelector('[data-role="blocked"]')!.textContent).not.toContain('Noori');
  });

  it('A PARTIAL SESSION SAVES, because the alternative is a fabricated number', async () => {
    // The point of the whole vocabulary. If a number were the only way to save,
    // an operator on a session they did not measure would type a plausible one.
    const { el, fixture, http } = await mount();
    type(fixture, el, 'BD-0001', '6.5');
    press(fixture, el, 'BD-0002', 'm');

    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBeNull();
    (el.querySelector('[data-role="submit"]') as HTMLButtonElement).click();

    const req = http.expectOne(`${BASE}/milking/session`);
    expect(req.request.body.entries).toEqual([
      { animal_id: 'BD-0001', status: 'measured', yield_litres: 6.5 },
      { animal_id: 'BD-0002', status: 'milked_not_measured' },
    ]);
    expect(req.request.body.occurred_on).toBe('2026-09-04');
    expect(req.request.body.session).toBe('morning');
    expect(req.request.body.source_form).toBe('direct_entry');
    expect(req.request.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('sends NO yield_litres on a row that was not measured', async () => {
    // A number filed under a not-measured status is a contradiction, and the
    // server refuses it -- but it must never get that far.
    const { el, fixture, http } = await mount();
    type(fixture, el, 'BD-0001', '9');
    press(fixture, el, 'BD-0001', 'n');
    press(fixture, el, 'BD-0002', 'm');
    (el.querySelector('[data-role="submit"]') as HTMLButtonElement).click();

    const req = http.expectOne(`${BASE}/milking/session`);
    expect(req.request.body.entries[0]).toEqual({ animal_id: 'BD-0001', status: 'not_milked' });
    expect('yield_litres' in req.request.body.entries[0]).toBe(false);
  });

  it('m and n answer a row without leaving the keyboard', async () => {
    const { el, fixture } = await mount();
    press(fixture, el, 'BD-0001', 'm');
    expect(cell(el, 'BD-0001').disabled).toBe(true);
    press(fixture, el, 'BD-0002', 'n');
    expect(el.querySelector('[data-role="reason-BD-0002"]')).not.toBeNull();
  });

  it('clearing the number returns the row to untouched, not to zero', async () => {
    // An empty box means nothing was said. A zero is a claim that she gave
    // nothing, which is what not_milked is for.
    const { el, fixture } = await mount();
    type(fixture, el, 'BD-0001', '6');
    type(fixture, el, 'BD-0002', '5');
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBeNull();

    type(fixture, el, 'BD-0001', '');
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('Noori');
  });

  it('the herd total sums only MEASURED rows', async () => {
    // The total is what catches a ten-fold typo; counting a not-measured row as
    // zero would make it lie in the other direction.
    const { el, fixture } = await mount();
    type(fixture, el, 'BD-0001', '6.5');
    press(fixture, el, 'BD-0002', 'm');
    const total = el.querySelector('[data-role="total"]')!.textContent!;
    expect(total).toContain('6.5');
    expect(total).toContain('1 measured');
    expect(el.querySelector('[data-role="resolved"]')!.textContent).toContain('2');
  });

  it('warns when a figure is unlike her recent mean, without refusing it', async () => {
    // A real collapse in yield is precisely the row worth having.
    const { el, fixture } = await mount();
    type(fixture, el, 'BD-0001', '60'); // mean is 6 -- a misplaced decimal
    expect(el.querySelector('[data-role="band-BD-0001"]')).not.toBeNull();
    press(fixture, el, 'BD-0002', 'm');
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBeNull();

    type(fixture, el, 'BD-0001', '6.5');
    expect(el.querySelector('[data-role="band-BD-0001"]')).toBeNull();
  });

  it('re-opening a saved session shows what was saved, ready to correct', async () => {
    // A cleared roster would look exactly like one never filled in, and saving
    // it would overwrite the session with blanks.
    const saved: MilkingRoster = {
      ...ROSTER,
      saved: 1,
      rows: [
        {
          ...ROSTER.rows[0],
          existing: {
            id: 'mlk_1', animal_id: 'BD-0001', occurred_on: '2026-09-04', session: 'morning',
            status: 'measured', yield_litres: 7, reason: null, occurred_time: null,
            observed_by: 'abdul', recorded_by: 'zsf', recorded_at: 't', source_form: 'direct_entry',
            note: null,
          },
        },
        ROSTER.rows[1],
      ],
    };
    const { el } = await mount(saved);
    expect(cell(el, 'BD-0001').value).toBe('7');
    expect(el.querySelector('[data-role="saved-BD-0001"]')).not.toBeNull();
    // The unsaved animal still blocks, so a re-open cannot silently half-save.
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('Sohni');
  });

  it('announces the write and reloads rather than clearing', async () => {
    const { el, fixture, http } = await mount();
    type(fixture, el, 'BD-0001', '6');
    press(fixture, el, 'BD-0002', 'm');
    (el.querySelector('[data-role="submit"]') as HTMLButtonElement).click();

    http.expectOne(`${BASE}/milking/session`).flush({
      occurred_on: '2026-09-04', session: 'morning',
      written: 2, measured: 1, milked_not_measured: 1, not_milked: 0, updated: 0,
    });
    await settle(fixture);
    http.match((r) => r.url.startsWith(`${BASE}/identifier-values`)).forEach((r) =>
      r.flush({ observed_by: [], acquired_from: [], sire_ref: [] }),
    );
    // Reloaded, not cleared.
    http.match((r) => r.url.startsWith(`${BASE}/milking/roster`)).forEach((r) => r.flush(ROSTER));
    await settle(fixture);

    expect(TestBed.inject(WriteLog).last()).toContain('2 animal(s)');
    expect(TestBed.inject(WriteLog).last()).toContain('1 measured');
  });

  it('says plainly when nobody was in milk, and points at the cause', async () => {
    const { el } = await mount({ ...ROSTER, rows: [] });
    expect(el.querySelector('[data-role="nobody"]')).not.toBeNull();
    expect(el.querySelector('[data-role="nobody"]')!.textContent).toContain('dried off');
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
  });
});
