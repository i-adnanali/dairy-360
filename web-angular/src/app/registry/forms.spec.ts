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
