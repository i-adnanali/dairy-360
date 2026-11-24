// The service and pregnancy-check entry form, driven through the real
// HttpClient against HttpTestingController -- the way forms.spec.ts drives the
// event form and its override.

import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BreedingForm } from './breeding-form';
import { Session } from '../session';
import { WriteLog } from '../after-write';

const URL = '/api/registry/breeding/events';

function mount() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
  });
  const http = TestBed.inject(HttpTestingController);
  TestBed.inject(Session).set('recall', 'adnan');
  const fixture = TestBed.createComponent(BreedingForm);
  fixture.componentRef.setInput('animalId', 'BD-0001');
  fixture.detectChanges();
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
}

const click = (el: HTMLElement, sel: string) =>
  (el.querySelector(sel) as HTMLButtonElement).click();

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
  fixture.detectChanges();
}

function choose(fixture: { detectChanges(): void }, el: HTMLElement, ...chips: string[]) {
  for (const c of chips) {
    click(el, `[data-chip="${c}"]`);
    fixture.detectChanges();
  }
}

function type(fixture: { detectChanges(): void }, el: HTMLElement, sel: string, text: string) {
  const input = el.querySelector(sel) as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

const enterDate = (fixture: { detectChanges(): void }, el: HTMLElement, text: string) =>
  type(fixture, el, 'app-precision-date [data-role="date-text"]', text);

const animal = { animal: { id: 'BD-0001', name: null }, status: null, events: [] };

describe('BreedingForm', () => {
  it('sends an AI service with the date it reads', () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'insemination', 'ai');
    enterDate(fixture, el, '13 Nov 2026');
    click(el, '[data-role="submit"]');

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Idempotency-Key')).toBeTruthy();
    const b = req.request.body;
    expect(b.animal_id).toBe('BD-0001');
    expect(b.type).toBe('insemination');
    expect(b.payload).toEqual({ service_type: 'ai', exposure_days: null });
    expect(b.occurred_on).toBe('2026-11-13');
    expect(b.date_precision).toBe('day');
    expect(b.allow_ambiguous_service).toBe(false);
    expect(b.allow_early_check).toBe(false);
    expect(b.allow_check_without_service).toBe(false);
    expect(http.match(URL)).toHaveLength(0);
  });

  it('a bull exposure asks for days and sends no time', () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'insemination', 'bull_exposure');
    expect(el.querySelector('app-precision-date legend')?.textContent?.trim()).toBe('Bull went in');
    expect(el.querySelector('[data-role="exposure_days"]')).not.toBeNull();
    enterDate(fixture, el, '1 Nov 2026');
    // The date control offers no time for a bull exposure.
    expect(el.querySelector('app-precision-date [data-role="time"]')).toBeNull();
    type(fixture, el, '[data-role="exposure_days"]', '21');
    click(el, '[data-role="submit"]');

    const b = http.expectOne(URL).request.body;
    expect(b.occurred_time).toBeNull();
    expect(b.payload).toEqual({ service_type: 'bull_exposure', exposure_days: 21 });
  });

  it('sends a check with its method and result', () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'pregnancy_check', 'palpation', 'positive');
    enterDate(fixture, el, '13 Nov 2026');
    expect(el.querySelector('[data-role="submit"]')?.textContent?.trim()).toBe('Save check');
    click(el, '[data-role="submit"]');

    const b = http.expectOne(URL).request.body;
    expect(b.type).toBe('pregnancy_check');
    expect(b.payload).toEqual({ method: 'palpation', result: 'positive' });
  });

  it('shows a precision refusal under the date', async () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'pregnancy_check', 'palpation', 'positive');
    enterDate(fixture, el, 'Nov 2026');
    click(el, '[data-role="submit"]');
    const message =
      'a pregnancy check is dated to the day: its result depends on the days since the service';
    http.expectOne(URL).flush(
      { error: 'breeding_precision', field: 'date_precision', message },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);

    expect(el.querySelector('app-precision-date [data-role="error"]')?.textContent?.trim()).toBe(message);
    expect(el.querySelector('[data-role="save-over"]')).toBeNull();
  });

  async function tripEarlyCheck() {
    const ctx = mount();
    const { http, fixture, el } = ctx;
    choose(fixture, el, 'pregnancy_check', 'palpation', 'positive');
    enterDate(fixture, el, '13 Nov 2026');
    click(el, '[data-role="submit"]');
    http.expectOne(URL).flush(
      {
        error: 'early_check',
        field: 'occurred_on',
        message: 'A check by hand is not relied on before day 46. This one is on day 35.',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    return ctx;
  }

  it('the save-over button sends only its own flag', async () => {
    const { http, fixture, el } = await tripEarlyCheck();
    expect(el.textContent).toContain('A check by hand is not relied on before day 46. This one is on day 35.');
    expect(el.querySelector('[data-role="save-over"]')?.textContent?.trim()).toBe('Save over this check');
    expect(el.textContent).toContain(
      'Saving over it writes the event and the fact that the check was written over. Her record shows both.',
    );
    type(fixture, el, '[data-role="override_reason"]', 'the vet was here that day');
    click(el, '[data-role="save-over"]');

    const second = http.expectOne(URL);
    expect(second.request.body.allow_early_check).toBe(true);
    expect(second.request.body.allow_ambiguous_service).toBe(false);
    expect(second.request.body.allow_check_without_service).toBe(false);
    expect(second.request.body.override_reason).toBe('the vet was here that day');
    second.flush(
      {
        error: 'early_check',
        field: 'occurred_on',
        message: 'A check by hand is not relied on before day 46. This one is on day 35.',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);

    click(el, '[data-role="submit"]');
    const third = http.expectOne(URL);
    expect(third.request.body.allow_early_check).toBe(false);
    expect(third.request.body.allow_ambiguous_service).toBe(false);
    expect(third.request.body.allow_check_without_service).toBe(false);
  });

  it('a save-over that sends nothing leaves no flag for the next plain save', async () => {
    const { http, fixture, el } = await tripEarlyCheck();
    enterDate(fixture, el, '');
    click(el, '[data-role="save-over"]');
    expect(http.match(URL)).toHaveLength(0);
    enterDate(fixture, el, '13 Nov 2026');
    click(el, '[data-role="submit"]');
    const b = http.expectOne(URL).request.body;
    expect(b.allow_early_check).toBe(false);
    expect(b.allow_ambiguous_service).toBe(false);
    expect(b.allow_check_without_service).toBe(false);
  });

  it('a blank reason is sent as null', async () => {
    const { http, el } = await tripEarlyCheck();
    click(el, '[data-role="save-over"]');
    const req = http.expectOne(URL);
    expect(req.request.body.allow_early_check).toBe(true);
    expect(req.request.body.override_reason).toBeNull();
  });

  it('sends a heat with its sign and time', () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'heat_observed', 'standing');
    enterDate(fixture, el, '13 Nov 2026');
    type(fixture, el, 'app-precision-date [data-role="time"]', '05:30');
    expect(el.querySelector('[data-role="submit"]')?.textContent?.trim()).toBe('Save heat');
    click(el, '[data-role="submit"]');

    const b = http.expectOne(URL).request.body;
    expect(b.type).toBe('heat_observed');
    expect(b.payload).toEqual({ sign: 'standing' });
    expect(b.occurred_on).toBe('2026-11-13');
    expect(b.date_precision).toBe('day');
    expect(b.occurred_time).toBe('05:30');
  });

  it('sends nothing seen with what was watched for', () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'null_observation');
    // Scoped: the kind chips carry a `pregnancy_check` value too.
    click(el, '[data-role="watched-for-group"] [data-chip="pregnancy_check"]');
    fixture.detectChanges();
    enterDate(fixture, el, '13 Nov 2026');
    // Dated to the day: no time is offered.
    expect(el.querySelector('app-precision-date [data-role="time"]')).toBeNull();
    click(el, '[data-role="submit"]');

    const b = http.expectOne(URL).request.body;
    expect(b.type).toBe('null_observation');
    expect(b.payload).toEqual({ watched_for: 'pregnancy_check' });
    expect(b.occurred_on).toBe('2026-11-13');
    expect(b.occurred_time).toBeNull();
  });

  it('sends a loss with its date and nothing else', () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'abortion');
    const chip = el.querySelector('[data-chip="abortion"]')!;
    const key = chip.querySelector('[data-role="chip-key"]')?.textContent ?? '';
    expect(chip.textContent?.trim().slice(key.length).trim()).toBe('Record a loss');
    enterDate(fixture, el, 'Nov 2026');
    // Dated to the day or the month: no time is offered.
    expect(el.querySelector('app-precision-date [data-role="time"]')).toBeNull();
    expect(el.querySelector('[data-role="submit"]')?.textContent?.trim()).toBe('Save loss');
    click(el, '[data-role="submit"]');

    const b = http.expectOne(URL).request.body;
    expect(b.type).toBe('abortion');
    expect(b.payload).toEqual({});
    expect(b.occurred_on).toBe('2026-11-01');
    expect(b.date_precision).toBe('month');
    expect(b.occurred_time).toBeNull();
  });

  it('opens on the kind it is given', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(Session).set('recall', 'adnan');
    const fixture = TestBed.createComponent(BreedingForm);
    fixture.componentRef.setInput('animalId', 'BD-0001');
    fixture.componentRef.setInput('initialKind', 'heat_observed');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-chip="heat_observed"]')?.getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('What did you see?');
  });

  const AMBIGUOUS =
    'BD-0001 has 1 earlier service in this case, the first on 2026-10-20, and nothing recorded since rules it out: no heat, no negative check, no calving or loss. Saved, this service joins that case and her calving window widens to cover it.';
  const NO_HEAT =
    'No heat sign is recorded for BD-0001 in the 36 hours before this service, or on its day or the day before when a time is missing. Saved, the service counts as it is; record the heat too if one was seen.';
  const FLAGS = [
    'allow_ambiguous_service',
    'allow_early_check',
    'allow_check_without_service',
    'allow_no_heat_sign',
    'allow_heat_after_positive',
  ];
  const flagsOf = (b: Record<string, unknown>) => Object.fromEntries(FLAGS.map((f) => [f, b[f]]));

  it('two warnings show both sentences and one button sends both flags', async () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'insemination', 'ai');
    enterDate(fixture, el, '13 Nov 2026');
    click(el, '[data-role="submit"]');
    const twoWarnings = {
      error: 'breeding_warnings',
      field: 'occurred_on',
      message: `${AMBIGUOUS} ${NO_HEAT}`,
      warnings: [
        { check: 'ambiguous_service', message: AMBIGUOUS },
        { check: 'no_heat_sign', message: NO_HEAT },
      ],
    };
    http.expectOne(URL).flush(twoWarnings, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);

    const shown = [...el.querySelectorAll('[data-role="override-message"]')].map((p) =>
      p.textContent?.trim(),
    );
    expect(shown).toEqual([AMBIGUOUS, NO_HEAT]);
    // Each sentence once: in the notice, not again as the date's red error.
    expect(el.querySelector('app-precision-date [data-role="error"]')).toBeNull();
    expect(el.textContent?.split(AMBIGUOUS)).toHaveLength(2);
    expect(el.textContent?.split(NO_HEAT)).toHaveLength(2);
    expect(el.querySelectorAll('[data-role="save-over"]')).toHaveLength(1);
    expect(el.querySelector('[data-role="save-over"]')?.textContent?.trim()).toBe(
      'Save over these checks',
    );
    click(el, '[data-role="save-over"]');

    const second = http.expectOne(URL);
    expect(flagsOf(second.request.body)).toEqual({
      allow_ambiguous_service: true,
      allow_early_check: false,
      allow_check_without_service: false,
      allow_no_heat_sign: true,
      allow_heat_after_positive: false,
    });
    second.flush(twoWarnings, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);

    click(el, '[data-role="submit"]');
    const third = http.expectOne(URL);
    expect(Object.values(flagsOf(third.request.body))).toEqual([false, false, false, false, false]);
  });

  it('one warning still reads Save over this check', async () => {
    const { el } = await tripEarlyCheck();
    const sentence = 'A check by hand is not relied on before day 46. This one is on day 35.';
    expect(el.querySelector('[data-role="save-over"]')?.textContent?.trim()).toBe(
      'Save over this check',
    );
    expect(el.querySelectorAll('[data-role="override-message"]')).toHaveLength(1);
    // Shown once, in the notice; the date carries no red copy of it.
    expect(el.querySelector('app-precision-date [data-role="error"]')).toBeNull();
    expect(el.textContent?.split(sentence)).toHaveLength(2);
  });

  it('moves focus to the notice when a warning comes back', async () => {
    const { el } = await tripEarlyCheck();
    await new Promise((r) => setTimeout(r, 0));
    const messages = el.querySelector('[data-role="override-messages"]') as HTMLElement;
    expect(messages.getAttribute('role')).toBe('alert');
    expect(messages.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(messages);
    // The alert holds the sentences only, not the reason input or the help text.
    expect(messages.querySelector('input')).toBeNull();
    expect(messages.textContent).not.toContain('Saving over it writes');
  });

  it('a warning the client does not know shows its message and no save-over', async () => {
    const { http, fixture, el } = mount();
    choose(fixture, el, 'insemination', 'ai');
    enterDate(fixture, el, '13 Nov 2026');
    click(el, '[data-role="submit"]');
    const unknown = 'A sentence for a check this page has no flag for.';
    http.expectOne(URL).flush(
      {
        error: 'breeding_warnings',
        field: 'occurred_on',
        message: `${AMBIGUOUS} ${unknown}`,
        warnings: [
          { check: 'ambiguous_service', message: AMBIGUOUS },
          { check: 'some_future_check', message: unknown },
        ],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);

    const shown = [...el.querySelectorAll('[data-role="override-message"]')].map((p) =>
      p.textContent?.trim(),
    );
    expect(shown).toEqual([AMBIGUOUS, unknown]);
    expect(el.querySelector('[data-role="save-over"]')).toBeNull();
    expect(el.querySelector('[data-role="override_reason"]')).toBeNull();
  });

  function mountOn(kind: string) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(Session).set('recall', 'adnan');
    const fixture = TestBed.createComponent(BreedingForm);
    fixture.componentRef.setInput('animalId', 'BD-0001');
    fixture.componentRef.setInput('initialKind', kind);
    fixture.detectChanges();
    return { http, fixture, el: fixture.nativeElement as HTMLElement };
  }
  const dirty = (fixture: { componentInstance: unknown }) =>
    (fixture.componentInstance as unknown as { writer: { dirty(): boolean } }).writer.dirty();

  it('is not dirty when it opens on a kind', () => {
    const { fixture } = mountOn('heat_observed');
    expect(dirty(fixture)).toBe(false);
  });

  it('goes back to the kind it opened on after a save', async () => {
    const { http, fixture, el } = mountOn('heat_observed');
    choose(fixture, el, 'mucus');
    enterDate(fixture, el, '13 Nov 2026');
    click(el, '[data-role="submit"]');
    http.expectOne(URL).flush({ event_id: 'ev-1', animal }, { status: 201, statusText: 'Created' });
    await settle(fixture);

    expect(el.querySelector('[data-chip="heat_observed"]')?.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('[data-chip="mucus"]')?.getAttribute('aria-checked')).toBe('false');
    expect(dirty(fixture)).toBe(false);
  });

  it('on success resets, hands back the animal and announces the write', async () => {
    const { http, fixture, el } = mount();
    let got: unknown = null;
    fixture.componentRef.setInput('saved', (d: unknown) => (got = d));
    fixture.detectChanges();
    choose(fixture, el, 'insemination', 'ai');
    enterDate(fixture, el, '13 Nov 2026');
    click(el, '[data-role="submit"]');
    http.expectOne(URL).flush({ event_id: 'ev-1', animal }, { status: 201, statusText: 'Created' });
    await settle(fixture);

    expect(got).toEqual(animal);
    expect(TestBed.inject(WriteLog).last()).toBe('Recorded a service on BD-0001.');
    expect(el.querySelector('[data-chip="insemination"]')?.getAttribute('aria-checked')).toBe('false');
  });

  describe('correcting an event', () => {
    const original = {
      id: 'aevt_service',
      type: 'insemination',
      occurred_on: '2026-11-13',
      occurred_time: '06:30',
      date_precision: 'day',
      payload: { service_type: 'ai', exposure_days: null },
      source_form: 'recall',
      source_ref: null,
      observed_by: 'Bashir',
      recorded_by: 'adnan',
      recorded_at: '2026-11-13T06:40:00.000Z',
      supersedes_id: null,
      override_checks: [],
      override_reason: null,
      superseded_by_id: null,
      effective: true,
    };

    async function mountCorrecting(event: Record<string, unknown>) {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
      });
      const http = TestBed.inject(HttpTestingController);
      TestBed.inject(Session).set('recall', 'adnan');
      const fixture = TestBed.createComponent(BreedingForm);
      fixture.componentRef.setInput('animalId', 'BD-0001');
      fixture.componentRef.setInput('initialKind', event['type']);
      fixture.componentRef.setInput('correcting', event);
      fixture.detectChanges();
      await settle(fixture);
      return { http, fixture, el: fixture.nativeElement as HTMLElement };
    }

    it('opens prefilled from the event, on its kind only, and not dirty', async () => {
      const { fixture, el } = await mountCorrecting(original);
      expect(el.querySelector('[data-role="correcting"]')?.textContent?.trim()).toBe(
        'Correcting the service of 13 Nov 2026. The original stays on her record.',
      );
      // Locked: the event's kind is the only kind chip, and it is chosen.
      const kinds = [...el.querySelectorAll('[data-role="breeding-kind-group"] [data-chip]')];
      expect(kinds.map((c) => c.getAttribute('data-chip'))).toEqual(['insemination']);
      expect(kinds[0].getAttribute('aria-checked')).toBe('true');
      expect(el.querySelector('[data-chip="ai"]')?.getAttribute('aria-checked')).toBe('true');
      expect(
        (el.querySelector('app-precision-date [data-role="date-text"]') as HTMLInputElement).value,
      ).toBe('13 Nov 2026');
      expect((el.querySelector('app-precision-date [data-role="time"]') as HTMLInputElement).value).toBe(
        '06:30',
      );
      expect((el.querySelector('[data-role="observed_by"]') as HTMLInputElement).value).toBe('Bashir');
      expect(el.querySelector('[data-role="submit"]')?.textContent?.trim()).toBe('Save correction');
      expect(dirty(fixture)).toBe(false);
    });

    it('Save correction sends supersedes_id with the event\'s values', async () => {
      const { http, el } = await mountCorrecting(original);
      click(el, '[data-role="submit"]');
      const b = http.expectOne(URL).request.body;
      expect(b.supersedes_id).toBe('aevt_service');
      expect(b.type).toBe('insemination');
      expect(b.occurred_on).toBe('2026-11-13');
      expect(b.occurred_time).toBe('06:30');
      expect(b.date_precision).toBe('day');
      expect(b.payload).toEqual({ service_type: 'ai', exposure_days: null });
      expect(b.observed_by).toBe('Bashir');
    });

    it('a new event sends no supersedes_id', () => {
      const { http, fixture, el } = mount();
      choose(fixture, el, 'insemination', 'ai');
      enterDate(fixture, el, '13 Nov 2026');
      click(el, '[data-role="submit"]');
      expect('supersedes_id' in http.expectOne(URL).request.body).toBe(false);
    });

    it('a no_heat_sign answer shows the save-over, and the second POST still corrects', async () => {
      const { http, fixture, el } = await mountCorrecting(original);
      click(el, '[data-role="submit"]');
      http.expectOne(URL).flush(
        { error: 'no_heat_sign', field: 'occurred_on', message: NO_HEAT },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle(fixture);
      expect(el.querySelector('[data-role="override-message"]')?.textContent?.trim()).toBe(NO_HEAT);
      click(el, '[data-role="save-over"]');
      const second = http.expectOne(URL).request.body;
      expect(second.supersedes_id).toBe('aevt_service');
      expect(second.allow_no_heat_sign).toBe(true);
    });

    it('prefills a month-wide check with its method and result', async () => {
      const { http, el } = await mountCorrecting({
        ...original,
        id: 'aevt_check',
        type: 'pregnancy_check',
        occurred_on: '2026-10-01',
        occurred_time: null,
        date_precision: 'month',
        payload: { method: 'ultrasound', result: 'negative' },
        observed_by: null,
      });
      expect(el.querySelector('[data-role="correcting"]')?.textContent?.trim()).toBe(
        'Correcting the pregnancy check of Oct 2026. The original stays on her record.',
      );
      expect(el.querySelector('[data-chip="ultrasound"]')?.getAttribute('aria-checked')).toBe('true');
      expect(el.querySelector('[data-chip="negative"]')?.getAttribute('aria-checked')).toBe('true');
      click(el, '[data-role="submit"]');
      const b = http.expectOne(URL).request.body;
      expect(b.supersedes_id).toBe('aevt_check');
      expect(b.occurred_on).toBe('2026-10-01');
      expect(b.date_precision).toBe('month');
      expect(b.payload).toEqual({ method: 'ultrasound', result: 'negative' });
      expect(b.observed_by).toBeNull();
    });

    it('prefills a bull\'s stay with its days, a heat with its sign, nothing seen with what was watched for', async () => {
      const bull = await mountCorrecting({
        ...original,
        occurred_time: null,
        payload: { service_type: 'bull_exposure', exposure_days: 21 },
      });
      expect((bull.el.querySelector('[data-role="exposure_days"]') as HTMLInputElement).value).toBe('21');
      click(bull.el, '[data-role="submit"]');
      expect(bull.http.expectOne(URL).request.body.payload).toEqual({
        service_type: 'bull_exposure',
        exposure_days: 21,
      });
      TestBed.resetTestingModule();
      const heat = await mountCorrecting({ ...original, type: 'heat_observed', payload: { sign: 'mucus' } });
      expect(heat.el.querySelector('[data-chip="mucus"]')?.getAttribute('aria-checked')).toBe('true');
      TestBed.resetTestingModule();
      const none = await mountCorrecting({
        ...original,
        type: 'null_observation',
        occurred_time: null,
        payload: { watched_for: 'heat' },
      });
      expect(none.el.querySelector('[data-chip="heat"]')?.getAttribute('aria-checked')).toBe('true');
      expect(none.el.querySelector('[data-role="correcting"]')?.textContent).toContain(
        'Correcting the nothing seen of 13 Nov 2026.',
      );
    });
  });
});
