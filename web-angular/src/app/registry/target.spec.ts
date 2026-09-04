// Which database the app is pointed at, and what it takes to open a session
// against a real one.
//
// The property under test is not cosmetic. Before this, "these writes are real"
// was communicated by an amber banner NOT being there, and these specs pin the
// three things that fixes: the target is stated in every case, a real target is
// not entered without saying so, and the harness is deliberately exempt so the
// confirmation does not become something clicked through by habit.

import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SessionBar } from './session-bar';
import { SessionGate } from './session-gate';
import { Session } from './session';
import { Target } from './target';

const STORAGE = '/api/registry/storage';
const REAL = '/Users/x/dairy-360/server/dairy.db';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
  });
  return {
    http: TestBed.inject(HttpTestingController),
    session: TestBed.inject(Session),
    target: TestBed.inject(Target),
  };
}

/** Answer the probe. `null` storage stands for a server that would not say. */
function answer(
  http: HttpTestingController,
  body: { storage: string; memory: boolean } | null,
  opts: { reachable?: boolean } = {},
) {
  const req = http.expectOne(STORAGE);
  if (body) req.flush(body);
  else if (opts.reachable === false) req.error(new ProgressEvent('error'));
  else req.flush('Cannot GET', { status: 404, statusText: 'Not Found' });
}

const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
const start = (e: HTMLElement) => e.querySelector('[data-role="start"]') as HTMLButtonElement;

/**
 * Answer the probe a component started in its constructor, and let the DOM
 * catch up.
 *
 * `whenStable()` alone is NOT enough: the probe resolves through a promise
 * chain (storage -> ask -> probe) and the assertions would read the pre-answer
 * DOM. Joining the in-flight probe -- which `Target` shares rather than
 * duplicating -- is what makes the wait exact rather than a guessed number of
 * microtasks.
 */
async function settle(
  fixture: { detectChanges: () => void; whenStable: () => Promise<unknown> },
  http: HttpTestingController,
  body: { storage: string; memory: boolean } | null,
  opts: { reachable?: boolean } = {},
) {
  const joined = TestBed.inject(Target).probe();
  answer(http, body, opts);
  await joined;
  await fixture.whenStable();
  fixture.detectChanges();
}

async function fillProvenance(fixture: { detectChanges: () => void; nativeElement: unknown }) {
  const e = el(fixture);
  (e.querySelector('[data-chip="recall"]') as HTMLButtonElement).click();
  const who = e.querySelector('[data-role="recorded-by"]') as HTMLInputElement;
  who.value = 'adnan';
  who.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('Target', () => {
  it('reads `memory`, not the path — an in-memory database cannot be the real registry', async () => {
    const { http, target } = setup();
    const kind = target.probe();
    answer(http, { storage: ':memory:', memory: true });
    expect(await kind).toBe('harness');
  });

  it('reads a file-backed database as real, and names it', async () => {
    const { http, target } = setup();
    const kind = target.probe();
    answer(http, { storage: REAL, memory: false });
    expect(await kind).toBe('real');
    expect(target.storage()).toBe(REAL);
    expect(target.basename()).toBe('dairy.db');
  });

  it('reports a server that will not say as unknown, not as either answer', async () => {
    const { http, target } = setup();
    const kind = target.probe();
    answer(http, null);
    expect(await kind).toBe('unknown');
    expect(target.reachable()).toBe(true);
    expect(target.storage()).toBeNull();
  });

  it('separates no server from a server that would not answer', async () => {
    const { http, target } = setup();
    const kind = target.probe();
    answer(http, null, { reachable: false });
    expect(await kind).toBe('unknown');
    expect(target.reachable()).toBe(false);
  });

  it('asks once when several callers ask at the same time', async () => {
    const { http, target } = setup();
    const a = target.probe();
    const b = target.probe();
    answer(http, { storage: ':memory:', memory: true }); // expectOne: a second request would fail here
    expect(await a).toBe('harness');
    expect(await b).toBe('harness');
  });

  it('clears the session when the database changes under it', async () => {
    const { http, target, session } = setup();
    const first = target.probe();
    answer(http, { storage: ':memory:', memory: true });
    await first;
    target.enter();
    session.set('recall', 'adnan');
    expect(session.ready()).toBe(true);

    // The harness was killed and the real server started on the same port.
    const done = target.reprobe();
    answer(http, { storage: REAL, memory: false });
    await done;

    expect(session.ready()).toBe(false); // back to the gate, which will ask again
    expect(target.kind()).toBe('real');
  });

  it('does not clear the session when the server merely goes away', async () => {
    const { http, target, session } = setup();
    const first = target.probe();
    answer(http, { storage: REAL, memory: false });
    await first;
    target.enter();
    session.set('recall', 'adnan');

    const down = target.reprobe();
    answer(http, null, { reachable: false });
    await down;
    expect(session.ready()).toBe(true);

    // ...and the anchor survived the outage, so drift is still caught after it.
    const back = target.reprobe();
    answer(http, { storage: ':memory:', memory: true });
    await back;
    expect(session.ready()).toBe(false);
  });
});

describe('SessionGate target', () => {
  it('will not open a session against a real database until that is acknowledged', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(SessionGate);
    fixture.detectChanges();
    await settle(fixture, http, { storage: REAL, memory: false });
    await fillProvenance(fixture);

    const e = el(fixture);
    expect(e.querySelector('[data-role="target-real"]')!.textContent).toContain('dairy.db');
    // Provenance is complete, so this is the target and nothing else.
    expect(start(e).disabled).toBe(true);

    const ack = e.querySelector('[data-role="acknowledge-target"]') as HTMLInputElement;
    ack.checked = true;
    ack.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(start(e).disabled).toBe(false);

    start(e).click();
    expect(TestBed.inject(Session).ready()).toBe(true);
  });

  it('does not ask on the harness — a confirmation clicked through daily protects nothing', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(SessionGate);
    fixture.detectChanges();
    await settle(fixture, http, { storage: ':memory:', memory: true });
    await fillProvenance(fixture);

    const e = el(fixture);
    expect(e.querySelector('[data-role="target-harness"]')!.textContent).toContain('discarded');
    expect(e.querySelector('[data-role="acknowledge-target"]')).toBeNull();
    expect(start(e).disabled).toBe(false);
  });

  it('asks when the target could not be determined, rather than resolving it permissively', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(SessionGate);
    fixture.detectChanges();
    await settle(fixture, http, null); // a server, but no answer about its database
    await fillProvenance(fixture);

    const e = el(fixture);
    expect(e.querySelector('[data-role="target-unknown"]')!.textContent).toContain('cannot be ruled out');
    expect(start(e).disabled).toBe(true);
    expect(e.querySelector('[data-role="acknowledge-target"]')).not.toBeNull();
  });

  it('does not block a session on a server that is not running yet', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(SessionGate);
    fixture.detectChanges();
    await settle(fixture, http, null, { reachable: false });
    await fillProvenance(fixture);

    const e = el(fixture);
    expect(e.querySelector('[data-role="target-unknown"]')!.textContent).toContain('No server answered');
    expect(start(e).disabled).toBe(false);
  });
});

describe('SessionBar target', () => {
  it('states the real target rather than leaving it to the absence of a banner', async () => {
    const { http, session } = setup();
    session.set('recall', 'adnan');
    const fixture = TestBed.createComponent(SessionBar);
    fixture.detectChanges();
    await settle(fixture, http, { storage: REAL, memory: false });

    const e = el(fixture);
    expect(e.querySelector('[data-role="harness-banner"]')).toBeNull();
    expect(e.querySelector('[data-role="target-summary"]')!.textContent!.trim()).toBe('dairy.db');
  });

  it('keeps the harness banner, and keeps it out of the real case', async () => {
    const { http, session } = setup();
    session.set('recall', 'adnan');
    const fixture = TestBed.createComponent(SessionBar);
    fixture.detectChanges();
    await settle(fixture, http, { storage: ':memory:', memory: true });

    const e = el(fixture);
    expect(e.querySelector('[data-role="harness-banner"]')!.textContent).toContain('not the real registry');
    expect(e.querySelector('[data-role="target-summary"]')).toBeNull();
  });
});
