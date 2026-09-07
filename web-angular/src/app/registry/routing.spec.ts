import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../app.routes';
import { TodayBoard } from './today-board';
import { MilkingRosterScreen } from './milking-roster';
import { RegistryApi } from './api';
import { Session } from './session';
import type { DayBoard, MilkingRoster } from './types';

// ---------------------------------------------------------------------------
// The route table
// ---------------------------------------------------------------------------

describe('routes', () => {
  it('puts every literal BEFORE its parameterised sibling', () => {
    // `animals/new` after `animals/:id` makes the add form unreachable, and the
    // failure is silent: the router happily renders the detail screen for an
    // animal called "new". This is a table, so it is checkable rather than
    // something to remember.
    const children = routes[0].children!;
    const paths = children.map((r) => r.path);
    expect(paths.indexOf('animals/new')).toBeLessThan(paths.indexOf('animals/:id'));
    expect(paths.indexOf('animals/calvings/new')).toBeLessThan(paths.indexOf('animals/:id'));
    expect(paths.indexOf('milk/buyers')).toBeLessThan(paths.indexOf('milk/buyers/:id'));
    expect(paths.indexOf('labour/people')).toBeLessThan(paths.indexOf('labour/people/:id'));
  });

  it('groups by SUBJECT, not by the nav’s record/review split', () => {
    // A URL names a thing; the nav says what you are doing. /record/milking
    // would put one subject in two places and mean nothing to whoever received
    // the link.
    const paths = routes[0].children!.map((r) => r.path);
    expect(paths).not.toContain('record');
    expect(paths).not.toContain('review');
    for (const p of ['milk/milking', 'milk/dispatch', 'milk/buyers']) expect(paths).toContain(p);
    for (const p of ['labour/payroll', 'labour/people']) expect(paths).toContain(p);
    for (const p of ['animals', 'animals/new', 'animals/:id']) expect(paths).toContain(p);
    // /check verifies all three axes, so it belongs to none of them.
    expect(paths).toContain('check');
  });

  it('lands on the day board, not on a subsystem', () => {
    const root = routes[0].children!.find((r) => r.path === '');
    expect(root!.redirectTo).toBeUndefined();
    expect(root!.loadComponent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Screen state in the URL
// ---------------------------------------------------------------------------

const ROSTER: MilkingRoster = {
  occurred_on: '2026-08-14',
  session: 'evening',
  previous_session: { occurred_on: '2026-08-13', session: 'evening' },
  rows: [],
  saved: 0,
};

class RosterApi {
  asked: { on: string; session: string }[] = [];
  identifierValues() {
    return Promise.resolve({ observed_by: [], acquired_from: [], sire_ref: [] });
  }
  /**
   * Needed because RouterTestingHarness mounts the WHOLE shell, and SessionBar
   * probes the target on construction. The component-level specs never see
   * this: they create one component with no shell around it.
   */
  storage() {
    return Promise.resolve({
      info: { storage: ':memory:', memory: true },
      reachable: true,
    });
  }
  milkingRoster(on: string, session: string): Promise<MilkingRoster> {
    this.asked.push({ on, session });
    return Promise.resolve({ ...ROSTER, occurred_on: on, session: session as 'morning' });
  }
}

async function harnessWith(api: unknown, url: string) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes, withComponentInputBinding()),
      { provide: RegistryApi, useValue: api },
    ],
  });
  TestBed.inject(Session).set('direct_entry', 'adnan');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  harness.detectChanges();
  return harness;
}

describe('URL-backed screen state', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens the roster the URL asks for, not today', async () => {
    // This is the whole point: before this, /milking always opened on today and
    // the guessed session, so yesterday evening was unlinkable.
    const api = new RosterApi();
    await harnessWith(api, '/milk/milking?on=2026-08-14&session=evening');
    expect(api.asked.at(-1)).toEqual({ on: '2026-08-14', session: 'evening' });
  });

  it('IGNORES a session the URL made up, rather than asking the server for it', async () => {
    // `?session=lunch` is a URL somebody can type. Passing it through would
    // produce a server refusal on a screen with no field to attach it to.
    const api = new RosterApi();
    await harnessWith(api, '/milk/milking?session=lunch');
    expect(['morning', 'evening']).toContain(api.asked.at(-1)!.session);
  });

  it('writes the date back to the URL when the control changes', async () => {
    const api = new RosterApi();
    const harness = await harnessWith(api, '/milk/milking');
    const el = harness.fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('[data-role="on"]')!;
    input.value = '2026-08-14';
    input.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toContain('on=2026-08-14');
    expect(api.asked.at(-1)!.on).toBe('2026-08-14');
  });

  it('leaves a bare URL bare, so a bookmark keeps meaning “now”', async () => {
    // Stamping today's date in on load would freeze every bookmark on the day
    // it was made.
    const api = new RosterApi();
    await harnessWith(api, '/milk/milking');
    expect(TestBed.inject(Router).url).toBe('/milk/milking');
  });
});

// ---------------------------------------------------------------------------
// The day board
// ---------------------------------------------------------------------------

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
  payroll: { from_on: '2026-09-01', to_on: '2026-09-30', outstanding: 2, permanent: 2 },
  payroll_previous: { from_on: '2026-08-01', to_on: '2026-08-31', outstanding: 2, permanent: 2 },
};

class BoardApi {
  board: DayBoard = structuredClone(BOARD);
  today(): Promise<DayBoard> {
    return Promise.resolve(structuredClone(this.board));
  }
}

describe('TodayBoard', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(api: BoardApi) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RegistryApi, useValue: api },
      ],
    });
    const fixture = TestBed.createComponent(TodayBoard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('flags only the sessions that are actually outstanding', async () => {
    const el = await render(new BoardApi());
    const milking = el.querySelectorAll('[data-role="milking"] [data-session]');
    expect(milking[0].getAttribute('data-complete')).toBe('true');
    expect(milking[1].getAttribute('data-complete')).toBe('false');
    expect(milking[1].textContent).toContain('0 of 3 recorded');
  });

  it('links each line to the exact session that clears it', async () => {
    const el = await render(new BoardApi());
    const evening = el.querySelector('[data-role="dispatch"] [data-session="evening"]')!;
    const href = evening.getAttribute('href')!;
    expect(href).toContain('/milk/dispatch');
    expect(href).toContain('on=2026-09-07');
    expect(href).toContain('session=evening');
  });

  it('prompts about LAST month and states this one without flagging it', async () => {
    // The current month is outstanding for the whole of it, so an amber line
    // every day from the 1st to the 30th is one nobody reads by the 3rd.
    const el = await render(new BoardApi());
    expect(el.querySelector('[data-role="payroll-previous"]')!.textContent).toContain(
      '2 of 2 unanswered',
    );
    const current = el.querySelector('[data-role="payroll-current"]')!;
    expect(current.textContent).toContain('September 2026');
    expect(current.className).not.toContain('amber');
  });

  it('drops the last-month prompt entirely once it is settled', async () => {
    const api = new BoardApi();
    api.board.payroll_previous = null;
    const el = await render(api);
    expect(el.querySelector('[data-role="payroll-previous"]')).toBeNull();
  });

  it('says so plainly when there is nothing to do', async () => {
    const api = new BoardApi();
    api.board.milking.forEach((s) => { s.complete = true; s.recorded = s.expected; });
    api.board.dispatch.forEach((s) => { s.complete = true; s.recorded = s.expected; });
    api.board.payroll_previous = null;
    const el = await render(api);
    expect(el.querySelector('[data-role="all-clear"]')!.textContent).toContain(
      'Nothing outstanding',
    );
  });

  it('does NOT say all-clear while last month is unpaid', async () => {
    // The one wrong thing this screen could say, because it is the line
    // somebody would trust without checking.
    const api = new BoardApi();
    api.board.milking.forEach((s) => { s.complete = true; s.recorded = s.expected; });
    api.board.dispatch.forEach((s) => { s.complete = true; s.recorded = s.expected; });
    const el = await render(api);
    expect(el.querySelector('[data-role="all-clear"]')).toBeNull();
  });

  it('reads an empty farm as done rather than as outstanding work', async () => {
    const api = new BoardApi();
    api.board.milking = [
      { session: 'morning', expected: 0, recorded: 0, complete: true },
      { session: 'evening', expected: 0, recorded: 0, complete: true },
    ];
    api.board.dispatch = structuredClone(api.board.milking);
    api.board.payroll = { from_on: '2026-09-01', to_on: '2026-09-30', outstanding: 0, permanent: 0 };
    api.board.payroll_previous = null;
    const el = await render(api);
    expect(el.querySelector('[data-role="all-clear"]')).toBeTruthy();
    expect(el.querySelector('[data-role="milking"] [data-session="morning"]')!.textContent)
      .toContain('nothing expected');
  });
});

describe('TodayBoard ?on=', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens the day the URL asks for, with no date control on the page', async () => {
    // Same call /check makes for as_of: the parameter exists so a day can be
    // reproduced from a link, but a picker would turn the landing page into a
    // history browser and make "nothing outstanding" ambiguous about when.
    const asked: string[] = [];
    const api = {
      storage: () => Promise.resolve({ info: { storage: ':memory:', memory: true }, reachable: true }),
      today: (on: string) => {
        asked.push(on);
        return Promise.resolve({ ...structuredClone(BOARD), on });
      },
    };
    const harness = await harnessWith(api, '/?on=2026-08-14');
    expect(asked.at(-1)).toBe('2026-08-14');
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[type="date"]')).toBeNull();
    expect(el.querySelector('[data-role="date"]')!.textContent).toContain('14 August 2026');
  });
});

// ---------------------------------------------------------------------------
// Browsing without a recording session
// ---------------------------------------------------------------------------

describe('reads without a session', () => {
  afterEach(() => TestBed.resetTestingModule());

  /** Like harnessWith, but WITHOUT setting the session. */
  async function browse(api: unknown, url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes, withComponentInputBinding()),
        { provide: RegistryApi, useValue: api },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.fixture.nativeElement as HTMLElement;
  }

  const boardApi = {
    storage: () => Promise.resolve({ info: { storage: ':memory:', memory: true }, reachable: true }),
    today: () => Promise.resolve(structuredClone(BOARD)),
  };

  it('renders the day board with no session set, and says nothing is being recorded', async () => {
    // This is the whole complaint: the shell used to refuse to render ANY route
    // until provenance was declared, so looking at a balance meant declaring a
    // transcription session you were not about to have.
    const el = await browse(boardApi, '/');
    expect(el.querySelector('[data-role="milking"]')).toBeTruthy();
    expect(el.querySelector('[data-role="gate"]')).toBeNull();
    expect(el.querySelector('[data-role="browsing"]')!.textContent).toContain(
      'nothing is being recorded',
    );
  });

  it('keeps the nav reachable while browsing', async () => {
    // It used to be hidden with the outlet, so somebody who only wanted to look
    // something up could not see where to look.
    const el = await browse(boardApi, '/');
    expect(el.querySelector('[data-role="nav"]')).toBeTruthy();
    expect(el.querySelector('[data-role="nav-today"]')).toBeTruthy();
  });

  it('GATES a route that is nothing but a form', async () => {
    // /animals/new has nothing to browse, so arriving without a session asks
    // immediately rather than rendering a form whose submit is a prompt.
    const el = await browse(
      { storage: boardApi.storage, identifierValues: () => Promise.resolve({ observed_by: [], acquired_from: [], sire_ref: [] }) },
      '/animals/new',
    );
    expect(el.querySelector('[data-role="gate"]')).toBeTruthy();
  });

  it('replaces a submit control with the prompt on a mixed screen', async () => {
    const api = {
      storage: boardApi.storage,
      people: () => Promise.resolve([
        {
          person_id: 'per_1', identifier: 'imran', name: 'Imran', engaged: true,
          balance_minor: 0, last_period_on: null, last_payment_on: null,
        },
      ]),
    };
    const el = await browse(api, '/labour/people');
    // The list -- a pure read -- is there.
    expect(el.querySelector('[data-role="people-table"]')).toBeTruthy();
    // The submit is not, and the prompt stands where it was.
    expect(el.querySelector('[data-role="add-person"] button[type="submit"]')).toBeNull();
    const prompt = el.querySelector('[data-role="session-required"]')!;
    expect(prompt.textContent).toContain('cannot be saved yet');
    expect(prompt.querySelector('[data-role="start-recording"]')).toBeTruthy();
  });
});
