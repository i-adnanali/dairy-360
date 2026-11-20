// The calving form's override notice over the calving-window warnings, driven
// through the real HttpClient against HttpTestingController -- the way
// breeding-form.spec.ts drives the breeding warnings. The rest of the form's
// wiring is covered in forms.spec.ts.

import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CalvingForm } from './calving-form';
import { CorrectionForm } from '../correction-form/correction-form';
import { Session } from '../session';
import type { TimelineEvent } from '../types';

const BASE = '/api/registry';
const FLAGS = ['allow_near_duplicate', 'allow_calving_before_window', 'allow_calving_past_extreme'];
const flagsOf = (b: Record<string, unknown>) => Object.fromEntries(FLAGS.map((f) => [f, b[f]]));

const BEFORE =
  'This calving is 250 days after her earliest possible conception, before the calving window opens at 285 days.';
const DUPLICATE =
  "dam 'BD-0001' already has a calving on 2024-05-20, within 60 days of 2024-06-02. This is far more likely a double entry than a real second calving. Pass allow_near_duplicate: true if it is genuinely a separate event.";
const PAST =
  'This calving is 360 days after her latest possible conception, past the 346 days a pregnancy runs at the most.';

const DAMS = [{
  id: 'BD-0001', name: 'Noor', sex: 'female', origin: 'acquired',
  birth_on: '2018-01-01', birth_precision: 'year', eligible: true,
  ineligible_reason: null, days_apart: null, within_match_window: true,
}];

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
  });
  TestBed.inject(Session).set('recall', 'adnan');
  return TestBed.inject(HttpTestingController);
}

const click = (el: HTMLElement, sel: string) =>
  (el.querySelector(sel) as HTMLButtonElement).click();

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
  fixture.detectChanges();
}

function enterDate(fixture: { detectChanges(): void }, el: HTMLElement, text: string) {
  const input = el.querySelector('app-precision-date [data-role="date-text"]') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

const refuse = (body: object) => [body, { status: 400, statusText: 'Bad Request' }] as const;

/** A calving filled in to the point of submit: dam, date, calf sex, a new calf. */
async function readyCalving() {
  const http = setup();
  const fixture = TestBed.createComponent(CalvingForm);
  fixture.detectChanges();
  http.expectOne(`${BASE}/dam-candidates`).flush({ candidates: DAMS });
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const sel = el.querySelector('[data-role="dam"]') as HTMLSelectElement;
  sel.value = 'BD-0001';
  sel.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  enterDate(fixture, el, '2 Jun 2024');
  click(el, '[data-role="calf-sex-group"] [data-chip="female"]');
  fixture.detectChanges();
  await settle(fixture);
  http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: [] });
  await settle(fixture);
  click(el, '[data-role="mode-new"]');
  fixture.detectChanges();
  return { http, fixture, el };
}

/** Each sentence once in the whole form: the notice, not the date, not WriteLock. */
function expectShownOnce(el: HTMLElement, ...sentences: string[]) {
  const shown = [...el.querySelectorAll('[data-role="override-message"]')].map((p) =>
    p.textContent?.trim(),
  );
  expect(shown).toEqual(sentences);
  expect(el.querySelector('app-precision-date [data-role="error"]')).toBeNull();
  for (const s of sentences) expect(el.textContent?.split(s)).toHaveLength(2);
}

describe('CalvingForm over a calving-window warning', () => {
  it('a calving before the window shows its sentence once and saves over it alone', async () => {
    const { http, fixture, el } = await readyCalving();
    click(el, '[data-role="submit"]');
    http.expectOne(`${BASE}/calvings`).flush(...refuse({
      error: 'calving_before_window', field: 'occurred_on', message: BEFORE,
      warnings: [{ check: 'calving_before_window', message: BEFORE }],
    }));
    await settle(fixture);

    expectShownOnce(el, BEFORE);
    const messages = el.querySelector('[data-role="override-messages"]') as HTMLElement;
    expect(messages.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(messages);
    expect(el.querySelector('[data-role="save-over"]')?.textContent?.trim()).toBe(
      'Save over this check',
    );
    click(el, '[data-role="save-over"]');

    const second = http.expectOne(`${BASE}/calvings`);
    expect(flagsOf(second.request.body)).toEqual({
      allow_near_duplicate: false,
      allow_calving_before_window: true,
      allow_calving_past_extreme: false,
    });
  });

  it('two warnings show both sentences and one button sends both flags; a plain save sends none', async () => {
    const { http, fixture, el } = await readyCalving();
    click(el, '[data-role="submit"]');
    const two = {
      error: 'breeding_warnings', field: 'occurred_on', message: `${DUPLICATE} ${PAST}`,
      warnings: [
        { check: 'near_duplicate_calving', message: DUPLICATE },
        { check: 'calving_past_extreme', message: PAST },
      ],
    };
    http.expectOne(`${BASE}/calvings`).flush(...refuse(two));
    await settle(fixture);

    expectShownOnce(el, DUPLICATE, PAST);
    expect(el.querySelectorAll('[data-role="save-over"]')).toHaveLength(1);
    expect(el.querySelector('[data-role="save-over"]')?.textContent?.trim()).toBe(
      'Save over these checks',
    );
    click(el, '[data-role="save-over"]');

    const second = http.expectOne(`${BASE}/calvings`);
    expect(flagsOf(second.request.body)).toEqual({
      allow_near_duplicate: true,
      allow_calving_before_window: false,
      allow_calving_past_extreme: true,
    });
    second.flush(...refuse(two));
    await settle(fixture);

    click(el, '[data-role="submit"]');
    const third = http.expectOne(`${BASE}/calvings`);
    expect(flagsOf(third.request.body)).toEqual({
      allow_near_duplicate: false,
      allow_calving_before_window: false,
      allow_calving_past_extreme: false,
    });
  });

  it('with breeding off, a near duplicate (no list) shows its message once and saves over it', async () => {
    const { http, fixture, el } = await readyCalving();
    click(el, '[data-role="submit"]');
    http.expectOne(`${BASE}/calvings`).flush(...refuse({
      error: 'near_duplicate_calving', field: 'occurred_on', message: DUPLICATE,
    }));
    await settle(fixture);

    expectShownOnce(el, DUPLICATE);
    expect(el.querySelector('[data-role="save-over"]')?.textContent?.trim()).toBe(
      'Save over this check',
    );
    click(el, '[data-role="save-over"]');
    expect(flagsOf(http.expectOne(`${BASE}/calvings`).request.body)).toEqual({
      allow_near_duplicate: true,
      allow_calving_before_window: false,
      allow_calving_past_extreme: false,
    });
  });

  it('a departed dam is a refusal with no way past it', async () => {
    const { http, fixture, el } = await readyCalving();
    click(el, '[data-role="submit"]');
    http.expectOne(`${BASE}/calvings`).flush(...refuse({
      error: 'animal_departed', field: 'occurred_on', message: 'dam departed on 2024-05-01.',
    }));
    await settle(fixture);
    expect(el.querySelector('[data-role="override"]')).toBeNull();
    expect(el.querySelector('[data-role="save-over"]')).toBeNull();
  });
});

describe('CorrectionForm over a calving-window warning', () => {
  const calving: TimelineEvent = {
    id: 'aevt_target', type: 'calving', occurred_on: '2023-04-01', occurred_time: null,
    date_precision: 'month', payload: {}, source_form: 'recall', source_ref: null,
    observed_by: null, recorded_by: 'adnan', recorded_at: 't', supersedes_id: null,
    superseded_by_id: null, override_checks: [], override_reason: null, effective: true,
  };
  const URL = `${BASE}/calvings/aevt_target/correction`;

  it('two warnings show once each, save over both, and a plain save sends none', async () => {
    const http = setup();
    const fixture = TestBed.createComponent(CorrectionForm);
    fixture.componentRef.setInput('events', [calving]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    click(el, '[data-calving="aevt_target"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'May 2023');
    click(el, '[data-role="submit"]');
    const two = {
      error: 'breeding_warnings', field: 'occurred_on', message: `${BEFORE} ${PAST}`,
      warnings: [
        { check: 'calving_before_window', message: BEFORE },
        { check: 'calving_past_extreme', message: PAST },
      ],
    };
    http.expectOne(URL).flush(...refuse(two));
    await settle(fixture);

    expectShownOnce(el, BEFORE, PAST);
    expect(el.querySelector('[data-role="save-over"]')?.textContent?.trim()).toBe(
      'Save over these checks',
    );
    click(el, '[data-role="save-over"]');
    const second = http.expectOne(URL);
    expect(flagsOf(second.request.body)).toEqual({
      allow_near_duplicate: false,
      allow_calving_before_window: true,
      allow_calving_past_extreme: true,
    });
    second.flush(...refuse(two));
    await settle(fixture);

    click(el, '[data-role="submit"]');
    expect(Object.values(flagsOf(http.expectOne(URL).request.body))).toEqual([false, false, false]);
  });
});
