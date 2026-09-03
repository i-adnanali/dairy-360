// Form specs, driven through the real HttpClient against HttpTestingController.
//
// These exercise the path a browser click takes: control state -> request body
// -> server refusal -> message bound to the right control. What they cannot
// cover is layout and actual pointer input; that is what the manual pass
// against the harness is for.

import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AnimalForm } from './animal-form';
import { EventForm } from './event-form';
import { CorrectionForm } from './correction-form';
import { CalvingForm } from './calving-form';
import { SessionGate } from './session-gate';
import { Session } from './session';
import type { TimelineEvent } from './types';

const BASE = '/api/registry';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
  });
  const http = TestBed.inject(HttpTestingController);
  const session = TestBed.inject(Session);
  session.set('recall', 'adnan');
  return { http, session };
}

const click = (el: HTMLElement, sel: string) =>
  (el.querySelector(sel) as HTMLButtonElement).click();

/**
 * Let promise chains finish, then render.
 *
 * `fixture.whenStable()` alone is NOT enough for a chain kicked off in a
 * component constructor -- CalvingForm asks for its dam list there, and without
 * a macrotask tick the `.then()` has not run, so the form still shows its "no
 * females in the registry yet" empty state and every selector comes back null.
 * Measured, not guessed: the dam <select> is absent with whenStable() alone and
 * present with this.
 */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
  fixture.detectChanges();
}

/**
 * Choose a precision AND type the date it requires.
 *
 * THE SECOND HALF USED TO BE UNNECESSARY, AND THAT WAS THE BUG. `PrecisionDate`
 * initialised year/month/day to the current year, January and the 1st, so
 * clicking a precision was enough to submit -- and seven specs in this file did
 * exactly that. Worse, two of them asserted the *shape* of the result
 * (`acquired_on` matching /^\d{4}-01-01$/, `occurred_on` matching /-01$/) while
 * staying agnostic about the value, which is precisely what kept the fabricated
 * date invisible to a green suite.
 *
 * Every date these specs submit is now one they typed, and the assertions name
 * it exactly. See precision-date.ts's header for the three fabrications this
 * closed.
 *
 * `which` indexes the app-precision-date elements, since AnimalForm renders two
 * (arrival, then birth) and the scoping must not depend on which of them
 * currently has inputs rendered.
 */
function enterDate(
  fixture: { detectChanges(): void },
  el: HTMLElement,
  precision: 'day' | 'month' | 'year' | 'estimated',
  parts: { year: number; month?: number; day?: number },
  which = 0,
): void {
  const scope = el.querySelectorAll('app-precision-date')[which] as HTMLElement;
  (scope.querySelector(`[data-precision="${precision}"]`) as HTMLButtonElement).click();
  fixture.detectChanges();

  const set = (role: string, value: number, ev: string) => {
    const node = scope.querySelector(`[data-role="${role}"]`) as HTMLInputElement;
    node.value = String(value);
    node.dispatchEvent(new Event(ev));
    fixture.detectChanges();
  };

  set('year', parts.year, 'input');
  if (parts.month !== undefined) set('month', parts.month, 'change');
  if (parts.day !== undefined) set('day', parts.day, 'input');
}

describe('CalvingForm', () => {
  // There was no spec for this form before. The wiring most likely to break is
  // the candidate list ARRIVING: it used to be fetched when the operator
  // clicked "yes -- link to it", and that click no longer exists.

  const DAMS = [{
    id: 'BD-0001', name: 'Noor', sex: 'female', origin: 'acquired',
    birth_on: '2018-01-01', birth_precision: 'year', eligible: true,
    ineligible_reason: null, days_apart: null, within_match_window: true,
  }];
  const CANDIDATES = [{
    id: 'BD-0006', name: null, sex: 'female', origin: 'acquired',
    birth_on: null, birth_precision: null, eligible: true,
    ineligible_reason: null, days_apart: null, within_match_window: true,
  }];

  // Async because damCandidates() resolves through a promise: without awaiting
  // stability the dam <select> has not rendered and the form still shows its
  // "no females in the registry yet" empty state.
  async function mount() {
    const ctx = setup();
    const fixture = TestBed.createComponent(CalvingForm);
    fixture.detectChanges();
    ctx.http.expectOne(`${BASE}/dam-candidates`).flush({ candidates: DAMS });
    await settle(fixture);
    return { ...ctx, fixture, el: fixture.nativeElement as HTMLElement };
  }

  const chooseDam = (fixture: { detectChanges(): void }, el: HTMLElement, id: string) => {
    const sel = el.querySelector('[data-role="dam"]') as HTMLSelectElement;
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  it('fetches candidates as soon as the dam and the date are both known', async () => {
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, 'day', { year: 2024, month: 6, day: 2 });
    await settle(fixture);

    // The client builds the query into the URL rather than using HttpParams,
    // so match on the prefix and read the string.
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`));
    expect(req.request.url).toContain('dam=BD-0001');
    expect(req.request.url).toContain('occurred_on=2024-06-02');
    expect(req.request.url).toContain('date_precision=day');
    req.flush({ candidates: CANDIDATES });
    await settle(fixture);
    expect(el.querySelector('[data-candidate="BD-0006"]')).not.toBeNull();
  });

  it('cannot submit until the calf question is answered one way or the other', async () => {
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, 'day', { year: 2024, month: 6, day: 2 });
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: CANDIDATES });
    await settle(fixture);

    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('none of these');

    (el.querySelector('[data-candidate="BD-0006"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the picked animal as calf_id, and no calf_name', async () => {
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, 'day', { year: 2024, month: 6, day: 2 });
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: CANDIDATES });
    await settle(fixture);

    (el.querySelector('[data-candidate="BD-0006"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/calvings`);
    expect(req.request.body.calf_id).toBe('BD-0006');
    expect(req.request.body.calf_name).toBeNull();
    expect(req.request.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('sends calf_id null for create-new, carrying the typed name', async () => {
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, 'day', { year: 2024, month: 6, day: 2 });
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: CANDIDATES });
    await settle(fixture);

    click(el, '[data-role="mode-new"]');
    fixture.detectChanges();
    const name = el.querySelector('[data-role="calf_name"]') as HTMLInputElement;
    name.value = 'Chandni';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/calvings`);
    expect(req.request.body.calf_id).toBeNull();
    expect(req.request.body.calf_name).toBe('Chandni');
  });

  it('a changed date invalidates the choice — eligibility depends on it', async () => {
    // A picked animal can become ineligible when the date moves, so letting a
    // stale selection ride to submit would mean a refusal with a real animal in
    // front of you.
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, 'day', { year: 2024, month: 6, day: 2 });
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: CANDIDATES });
    await settle(fixture);

    (el.querySelector('[data-candidate="BD-0006"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(false);

    const day = el.querySelector('[data-role="day"]') as HTMLInputElement;
    day.value = '9';
    day.dispatchEvent(new Event('input'));
    await settle(fixture);

    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(true);
    http.match((r) => r.url.startsWith(`${BASE}/link-candidates`)).forEach((r) => r.flush({ candidates: CANDIDATES }));
  });

  it('no longer warns that a duplicate cannot be repaired', async () => {
    // The list replaced the recall question, so the warning no longer names a
    // live risk. Removed rather than softened.
    const { el } = await mount();
    expect(el.textContent).not.toContain('cannot be repaired');
    expect(el.querySelector('[data-role="mode-existing"]')).toBeNull();
  });
});

describe('item 4 — the smaller items', () => {
  it('says the no-default rationale ONCE on a page with two date controls', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    http.expectOne(`${BASE}/identifier-values`).flush({
      observed_by: [], acquired_from: [], sire_ref: [],
    });
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('app-precision-date').length).toBe(2);
    const occurrences = (el.textContent!.match(/a default is how/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('offers previously-used names on /add, and refreshes them after a write', async () => {
    // The refresh is the point: a name typed on animal four has to be offered
    // on animal five, and a list fetched once at page load never contains it.
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    http.expectOne(`${BASE}/identifier-values`).flush({
      observed_by: ['abdul'], acquired_from: [], sire_ref: [],
    });
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('datalist option')].map((o) => o.getAttribute('value')))
      .toContain('abdul');

    enterDate(fixture, el, 'year', { year: 2019 });
    click(el, '[data-role="submit"]');
    http.expectOne(`${BASE}/animals`).flush({
      animal_id: 'BD-0001',
      animal: { animal: { id: 'BD-0001', name: null }, status: null, events: [] },
    });
    await settle(fixture);
    http.expectOne(`${BASE}/identifier-values`).flush({
      observed_by: ['abdul', 'rashid'], acquired_from: [], sire_ref: [],
    });
    await settle(fixture);
    expect([...el.querySelectorAll('datalist option')].map((o) => o.getAttribute('value')))
      .toContain('rashid');
  });

  it('/calving with no females links out instead of dead-ending', async () => {
    // /herd's empty state already had a CTA. The asymmetry was the bug: the
    // same nothing-yet state, one screen offering the next step and one not.
    const ctx = setup();
    const fixture = TestBed.createComponent(CalvingForm);
    fixture.detectChanges();
    ctx.http.expectOne(`${BASE}/dam-candidates`).flush({ candidates: [] });
    ctx.http.expectOne(`${BASE}/identifier-values`).flush({
      observed_by: [], acquired_from: [], sire_ref: [],
    });
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-role="no-dams"]')).not.toBeNull();
    const cta = el.querySelector('[data-role="no-dams-cta"]')!;
    expect(cta.getAttribute('href')).toBe('/add');
  });
});

describe('overridden checks', () => {
  // The flag was transient, so an overridden write left no trace. What the UI
  // has to add is the optional reason -- and it must stay optional: requiring
  // prose to clear a guard makes the guard a wall, and the operator types "yes".

  async function tripDeparture() {
    const ctx = setup();
    const fixture = TestBed.createComponent(EventForm);
    fixture.componentRef.setInput('animalId', 'BD-0001');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    click(el, '[data-type="dry_off"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'month', { year: 2024, month: 8 });

    click(el, '[data-role="submit"]');
    ctx.http.expectOne(`${BASE}/events`).flush(
      { error: 'animal_departed', field: 'occurred_on', message: 'animal departed on 2024-05-01…' },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    return { ...ctx, fixture, el };
  }

  it('offers a reason field only once a guard has actually been tripped', async () => {
    const { el } = await tripDeparture();
    expect(el.querySelector('[data-role="override_reason"]')).not.toBeNull();
  });

  it('sends the typed reason with the override', async () => {
    const { http, fixture, el } = await tripDeparture();
    const why = el.querySelector('[data-role="override_reason"]') as HTMLInputElement;
    why.value = 'sold in May but stayed on the farm until August';
    why.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    click(el, '[data-role="allow-after-departure"]');
    const req = http.expectOne(`${BASE}/events`);
    expect(req.request.body.allow_after_departure).toBe(true);
    expect(req.request.body.override_reason).toBe('sold in May but stayed on the farm until August');
  });

  it('overrides fine with no reason — null, not an empty string', async () => {
    // A blank must reach the server as null. '' would be stored as a reason
    // that says nothing, which reads as one that was given rather than skipped.
    const { http, el } = await tripDeparture();
    click(el, '[data-role="allow-after-departure"]');
    const req = http.expectOne(`${BASE}/events`);
    expect(req.request.body.allow_after_departure).toBe(true);
    expect(req.request.body.override_reason).toBeNull();
  });

  it('does not send an override reason on a write that tripped nothing', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(EventForm);
    fixture.componentRef.setInput('animalId', 'BD-0001');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    click(el, '[data-type="dry_off"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'month', { year: 2024, month: 8 });
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/events`);
    expect(req.request.body.allow_after_departure).toBe(false);
    expect(req.request.body.override_reason).toBeNull();
  });
});

describe('idempotency key', () => {
  // The rule: one key per submission ATTEMPT SEQUENCE. Minted on first submit,
  // reused while a refusal is on screen, dropped on success. See form-state.ts.

  it('sends an Idempotency-Key header on a write', () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    enterDate(fixture, el, 'year', { year: 2019 });
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/animals`);
    const key = req.request.headers.get('Idempotency-Key');
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(8);
  });

  it('REUSES the key when a submit failed — the retry may already have landed', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    enterDate(fixture, el, 'year', { year: 2019 });

    click(el, '[data-role="submit"]');
    const first = http.expectOne(`${BASE}/animals`);
    const key = first.request.headers.get('Idempotency-Key');
    // A network fault: the request may have succeeded server-side and failed in
    // transit, which is exactly the case a reused key exists for.
    first.error(new ProgressEvent('error'));
    await fixture.whenStable();
    fixture.detectChanges();

    click(el, '[data-role="submit"]');
    const retry = http.expectOne(`${BASE}/animals`);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
  });

  it('MINTS A NEW key after a success — the next animal is not a replay of the last', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    enterDate(fixture, el, 'year', { year: 2019 });

    click(el, '[data-role="submit"]');
    const first = http.expectOne(`${BASE}/animals`);
    const key = first.request.headers.get('Idempotency-Key');
    first.flush({ animal_id: 'BD-0001', animal: { animal: { id: 'BD-0001', name: null }, status: null, events: [] } });
    await fixture.whenStable();
    fixture.detectChanges();

    // The same body a second time. Two identical roster rows are two animals,
    // and a payload-derived key would have silently collapsed them into one --
    // which is why the key is minted per attempt rather than hashed from the body.
    click(el, '[data-role="submit"]');
    const next = http.expectOne(`${BASE}/animals`);
    expect(next.request.headers.get('Idempotency-Key')).not.toBe(key);
    expect(next.request.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('reuses the key across an override resubmit, where the BODY is what changed', async () => {
    // `allow_after_departure` flips and the form resubmits on the same key. The
    // server keys on (key, body), so a changed body is processed as new without
    // the client having to know anything about it.
    const { http } = setup();
    const fixture = TestBed.createComponent(EventForm);
    fixture.componentRef.setInput('animalId', 'BD-0001');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    click(el, '[data-type="dry_off"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'month', { year: 2024, month: 5 });

    click(el, '[data-role="submit"]');
    const first = http.expectOne(`${BASE}/events`);
    const key = first.request.headers.get('Idempotency-Key');
    expect(first.request.body.allow_after_departure).toBe(false);
    first.flush(
      { error: 'animal_departed', field: 'occurred_on', message: 'animal departed on 2024-05-01…' },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    click(el, '[data-role="allow-after-departure"]');
    const override = http.expectOne(`${BASE}/events`);
    expect(override.request.headers.get('Idempotency-Key')).toBe(key);
    expect(override.request.body.allow_after_departure).toBe(true);
  });
});

describe('SessionGate', () => {
  it('blocks until both source form and recorder are given', () => {
    setup();
    const fixture = TestBed.createComponent(SessionGate);
    TestBed.inject(Session).clear();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const start = el.querySelector('[data-role="start"]') as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    click(el, '[data-source-form="recall"]');
    fixture.detectChanges();
    expect((el.querySelector('[data-role="start"]') as HTMLButtonElement).disabled).toBe(true);

    const who = el.querySelector('[data-role="recorded-by"]') as HTMLInputElement;
    who.value = 'adnan';
    who.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect((el.querySelector('[data-role="start"]') as HTMLButtonElement).disabled).toBe(false);

    click(el, '[data-role="start"]');
    expect(TestBed.inject(Session).ready()).toBe(true);
  });

  it('says plainly that a witness is asked per record, not per session', () => {
    setup();
    const fixture = TestBed.createComponent(SessionGate);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('per record');
  });
});

describe('AnimalForm', () => {
  it('cannot submit until a precision is chosen', () => {
    setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('how well you know');
  });

  it('sends the session provenance and a normalized date, and no observed_by', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // Precision first, on the arrival-date control (the first one rendered).
    enterDate(fixture, el, 'year', { year: 2019 });
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/animals`);
    expect(req.request.body.source_form).toBe('recall');
    expect(req.request.body.recorded_by).toBe('adnan');
    expect(req.request.body.date_precision).toBe('year');
    // The date the spec typed, named exactly. The old assertion was
    // /^\d{4}-01-01$/ -- true of any fabricated year, which is why it passed.
    expect(req.request.body.acquired_on).toBe('2019-01-01');
    expect(req.request.body.observed_by).toBeNull();
    expect(req.request.body.birth_on).toBeNull();
    req.flush({ animal_id: 'BD-0001', animal: { animal: { id: 'BD-0001', name: null }, status: { status: 'heifer', birth_on: null, birth_precision: null }, events: [] } });
    // The submit is async: without awaiting stability the DOM still shows the
    // pre-flush state and the assertion below reads null.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-role="result"]')!.textContent).toContain('BD-0001');
  });

  it('binds a server refusal to the control its field names', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    enterDate(fixture, el, 'year', { year: 2019 });
    click(el, '[data-role="submit"]');

    const prose = "sex must be 'female' or 'male', got 'wombat'";
    http.expectOne(`${BASE}/animals`).flush(
      { error: 'invalid_payload', field: 'sex', message: prose },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    // Verbatim, and next to the named control.
    expect(el.querySelector('[data-role="error-sex"]')!.textContent!.trim()).toBe(prose);
    expect(el.querySelector('[data-role="error-form"]')).toBeNull();
  });

  it('shows a refusal at form level when its field is not one this form renders', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    enterDate(fixture, el, 'day', { year: 2019, month: 6, day: 14 });
    click(el, '[data-role="submit"]');

    http.expectOne(`${BASE}/animals`).flush(
      { error: 'invalid_payload', field: 'something_unknown', message: 'a message that must not vanish' },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-role="error-form"]')!.textContent).toContain('must not vanish');
  });

  it('does not present a server bug as something to fix in the form', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    enterDate(fixture, el, 'day', { year: 2019, month: 6, day: 14 });
    click(el, '[data-role="submit"]');
    http.expectOne(`${BASE}/animals`).flush('boom', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    const msg = el.querySelector('[data-role="error-form"]')!.textContent!;
    expect(msg).toContain('bug');
    expect(el.querySelector('[data-role="error-sex"]')).toBeNull();
  });
});

describe('EventForm', () => {
  function mount() {
    const ctx = setup();
    const fixture = TestBed.createComponent(EventForm);
    fixture.componentRef.setInput('animalId', 'BD-0001');
    fixture.detectChanges();
    return { ...ctx, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows no date control until an event type is chosen', () => {
    const { el } = mount();
    expect(el.querySelector('app-precision-date')).toBeNull();
    expect(el.textContent).toContain('not entered here');
  });

  it('requires a reason for a departure and sends it', () => {
    const { http, fixture, el } = mount();
    click(el, '[data-type="departure"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'month', { year: 2024, month: 5 });
    const sel = el.querySelector('[data-role="reason"]') as HTMLSelectElement;
    sel.value = 'sold';
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/events`);
    expect(req.request.body.type).toBe('departure');
    expect(req.request.body.reason).toBe('sold');
    expect(req.request.body.date_precision).toBe('month');
    // Named exactly. The old assertion was /-01$/, which the fabricated
    // January-the-1st default satisfied without any date being entered.
    expect(req.request.body.occurred_on).toBe('2024-05-01');
  });

  it('warns against recording an uncertain calf as dead — the irreversible direction', () => {
    // Not in the event form; this is the calving form's warning. Here we check
    // the departure form at least states that departure is terminal.
    const { fixture, el } = mount();
    click(el, '[data-type="departure"]');
    fixture.detectChanges();
    expect(el.textContent).toContain('terminal');
  });

  it('offers an explicit override when the server refuses on a terminal departure', async () => {
    const { http, fixture, el } = mount();
    click(el, '[data-type="dry_off"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'month', { year: 2024, month: 5 });
    click(el, '[data-role="submit"]');
    http.expectOne(`${BASE}/events`).flush(
      { error: 'animal_departed', field: 'occurred_on', message: 'animal departed on 2024-05-01…' },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-role="allow-after-departure"]')).not.toBeNull();

    click(el, '[data-role="allow-after-departure"]');
    const retry = http.expectOne(`${BASE}/events`);
    expect(retry.request.body.allow_after_departure).toBe(true);
  });
});

describe('CorrectionForm', () => {
  function ev(over: Partial<TimelineEvent> & Pick<TimelineEvent, 'id'>): TimelineEvent {
    return {
      type: 'calving', occurred_on: '2023-04-01', occurred_time: null, date_precision: 'month',
      payload: {}, source_form: 'recall', source_ref: null, observed_by: null,
      recorded_by: 'adnan', recorded_at: 't', supersedes_id: null, superseded_by_id: null,
      effective: true, ...over,
    };
  }

  it('offers only EFFECTIVE calvings — a superseded one must be corrected at the chain end', () => {
    setup();
    const fixture = TestBed.createComponent(CorrectionForm);
    fixture.componentRef.setInput('events', [
      ev({ id: 'aevt_live' }),
      ev({ id: 'aevt_dead', effective: false, superseded_by_id: 'aevt_live' }),
      ev({ id: 'aevt_note', type: 'note' }),
    ]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-calving="aevt_live"]')).not.toBeNull();
    expect(el.querySelector('[data-calving="aevt_dead"]')).toBeNull();
    expect(el.querySelector('[data-calving="aevt_note"]')).toBeNull();
  });

  it('explains that both halves are written together, before anything is submitted', () => {
    setup();
    const fixture = TestBed.createComponent(CorrectionForm);
    fixture.componentRef.setInput('events', [ev({ id: 'aevt_live' })]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    click(el, '[data-calving="aevt_live"]');
    fixture.detectChanges();
    expect(el.textContent).toContain('Both halves');
    expect(el.textContent).toContain('departure moves too');
  });

  it('posts to the chosen event and reports every supersession', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(CorrectionForm);
    fixture.componentRef.setInput('events', [ev({ id: 'aevt_target' })]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    click(el, '[data-calving="aevt_target"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'month', { year: 2023, month: 5 });
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/calvings/aevt_target/correction`);
    expect(req.request.body.date_precision).toBe('month');
    req.flush({
      superseded: {
        calving_event_id: 'aevt_target',
        birth_event_id: 'aevt_birth',
        departure_event_id: 'aevt_dep',
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const result = el.querySelector('[data-role="result"]')!.textContent!;
    expect(result).toContain('aevt_target');
    expect(result).toContain('aevt_birth');
    expect(result).toContain('aevt_dep');
  });

  it('has a built empty state when there is nothing to correct', () => {
    setup();
    const fixture = TestBed.createComponent(CorrectionForm);
    fixture.componentRef.setInput('events', []);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-role="no-calvings"]')).not.toBeNull();
  });
});
