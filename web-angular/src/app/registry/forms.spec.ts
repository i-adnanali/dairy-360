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
import { WriteLog } from './after-write';
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
 * Type a date into one of the form's date fields.
 *
 * MUCH SIMPLER THAN IT WAS, and that is the item-5 change: the control used to
 * be a segmented precision picker plus year/month/day inputs, so this helper
 * clicked a precision and then filled three fields. Now precision is read from
 * the text, so there is one input and one string.
 *
 * The strings are deliberately in the forms a real operator types -- `2019`,
 * `Mar 2019`, `6 Jul 2023` -- rather than pre-normalised ISO, so the specs
 * exercise the parse the operator actually goes through.
 *
 * `which` indexes the app-precision-date elements, since AnimalForm renders two
 * (arrival, then birth).
 */
function enterDate(
  fixture: { detectChanges(): void },
  el: HTMLElement,
  text: string,
  which = 0,
): void {
  const scope = el.querySelectorAll('app-precision-date')[which] as HTMLElement;
  const input = scope.querySelector('[data-role="date-text"]') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('item 6a — the keyboard retrofit', () => {
  /** Flush the identifier-values request /add fires on mount. */
  function mountAdd(http: HttpTestingController) {
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    http.match((r) => r.url.startsWith(`${BASE}/identifier-values`)).forEach((r) =>
      r.flush({ observed_by: [], acquired_from: [], sire_ref: [] }),
    );
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('ENTER IN A TEXT FIELD SUBMITS, which nothing in the registry used to do', async () => {
    // There was no <form> element anywhere and every button was type="button",
    // so Enter did nothing on any screen.
    const { http } = setup();
    const { fixture, el } = mountAdd(http);
    enterDate(fixture, el, '2019');

    const form = el.querySelector('form')!;
    expect(form).not.toBeNull();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle(fixture);

    const req = http.expectOne(`${BASE}/animals`);
    expect(req.request.body.acquired_on).toBe('2019-01-01');
  });

  it('does not let the browser navigate away on submit', async () => {
    // The native event needs preventDefault. `(ngSubmit)` would not have bound
    // at all without FormsModule -- the form would have done a real submission
    // and reloaded the page.
    const { http } = setup();
    const { fixture, el } = mountAdd(http);
    enterDate(fixture, el, '2019');
    const e = new Event('submit', { bubbles: true, cancelable: true });
    el.querySelector('form')!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    http.expectOne(`${BASE}/animals`);
  });

  it('the submit button is type=submit, so Enter and the mouse take one path', async () => {
    const { http } = setup();
    const { el } = mountAdd(http);
    expect(el.querySelector('[data-role="submit"]')!.getAttribute('type')).toBe('submit');
  });

  // --- the post-submit contract ------------------------------------------

  async function writeOne() {
    const ctx = setup();
    const { fixture, el } = mountAdd(ctx.http);
    const name = el.querySelector('[data-role="name"]') as HTMLInputElement;
    name.value = 'Kali';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    enterDate(fixture, el, '2019');
    click(el, '[data-role="submit"]');
    ctx.http.expectOne(`${BASE}/animals`).flush({
      animal_id: 'BD-0004',
      animal: { animal: { id: 'BD-0004', name: 'Kali' }, status: null, events: [] },
    });
    await settle(fixture);
    ctx.http.match((r) => r.url.startsWith(`${BASE}/identifier-values`)).forEach((r) =>
      r.flush({ observed_by: [], acquired_from: [], sire_ref: [] }),
    );
    await settle(fixture);
    return { ...ctx, fixture, el, name };
  }

  it('CLEARS the per-animal fields after a write', async () => {
    // Twenty animals is twenty round trips, not twenty times eight fields.
    // Leaving the last animal's values in place is what made the next submit a
    // near-duplicate, and a form that invites the mistake is not fixed by a
    // warning about it.
    const { el, name } = await writeOne();
    expect(name.value).toBe('');
    const date = el.querySelector('[data-role="date-text"]') as HTMLInputElement;
    expect(date.value).toBe('');
  });

  it('KEEPS sex, which has a strong prior', async () => {
    // Consecutive animals in a backfill are usually the same sex. Re-answering
    // it twenty times is the tax the defaults rule exists to avoid.
    const { el } = await writeOne();
    expect(el.querySelector('[data-chip="female"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('ANNOUNCES the write, naming the serial, in a live region', async () => {
    // A cleared form is ambiguous: it looks exactly like one never filled in.
    // So something has to say which serial was written, without being looked
    // for -- and aria-live="polite" so it does not interrupt typing.
    const { fixture } = await writeOne();
    const shell = TestBed.inject(WriteLog);
    expect(shell.last()).toContain('BD-0004');
    expect(shell.last()).toContain('Kali');
    expect(shell.last()).toContain('Ready for the next');
    fixture.detectChanges();
  });

  it('BLOCKS the next submit until the required date is re-entered', async () => {
    // The reset is honest about what it cleared: an empty required date blocks,
    // so the cleared form cannot be submitted as a duplicate by a stray Enter.
    const { el } = await writeOne();
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain(
      'Enter the arrival date',
    );
  });
});

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

  /**
   * Answer the calf sex. NOT OPTIONAL in these flows any more, and that is the
   * point: it starts unanswered, and the picker will not load a list without it
   * because the server filters candidates on it.
   *
   * Scoped to the group rather than matching `[data-chip="female"]` loose, since
   * the outcome row is a second chip group on the same form.
   */
  const chooseCalfSex = (
    fixture: { detectChanges(): void },
    el: HTMLElement,
    sex: 'female' | 'male',
  ) => {
    click(el, `[data-role="calf-sex-group"] [data-chip="${sex}"]`);
    fixture.detectChanges();
  };

  it('fetches candidates once the dam, the date AND the calf sex are known', async () => {
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, '2 Jun 2024');
    chooseCalfSex(fixture, el, 'female');
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

  it('STARTS WITH NO CALF SEX, and fetches nothing until it is answered', async () => {
    // The default was `female`, and it did more than record a wrong column:
    // linkCandidates marks an animal ineligible when its sex disagrees, so a
    // guessed default greys out the right calf and leaves "create a new animal"
    // as the only reachable path -- minting the duplicate the picker exists to
    // prevent, from a question nobody was asked.
    const { http, fixture, el } = await mount();
    const group = el.querySelector('[data-role="calf-sex-group"]')!;
    for (const chip of Array.from(group.querySelectorAll('[data-chip]'))) {
      expect(chip.getAttribute('aria-checked')).toBe('false');
    }

    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, '2 Jun 2024');
    await settle(fixture);

    // No list, and the submit blocker names the field that is holding it up.
    http.expectNone((r) => r.url.startsWith(`${BASE}/link-candidates`));
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('female or male');

    chooseCalfSex(fixture, el, 'female');
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: CANDIDATES });
    await settle(fixture);
    expect(el.querySelector('[data-candidate="BD-0006"]')).not.toBeNull();
  });

  it('cannot submit until the calf question is answered one way or the other', async () => {
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, '2 Jun 2024');
    chooseCalfSex(fixture, el, 'female');
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
    enterDate(fixture, el, '2 Jun 2024');
    chooseCalfSex(fixture, el, 'female');
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: CANDIDATES });
    await settle(fixture);

    (el.querySelector('[data-candidate="BD-0006"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/calvings`);
    expect(req.request.body.calf_id).toBe('BD-0006');
    expect(req.request.body.calf_name).toBeNull();
    expect(req.request.body.calf_sex).toBe('female');
    expect(req.request.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('sends calf_id null for create-new, carrying the typed name', async () => {
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, '2 Jun 2024');
    chooseCalfSex(fixture, el, 'female');
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

  it('CLEARS the calf sex after a write, while the dam survives', async () => {
    // The dam survives because a cycle card is one animal's whole history, so
    // the next calving is almost always hers. The calf's sex must NOT: carrying
    // it forward would rebuild the default this change removed, from record two
    // onward -- and because the value filters the picker, a stale answer hides
    // the right calf on the very next calving rather than merely recording a
    // wrong column.
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, '2 Jun 2024');
    chooseCalfSex(fixture, el, 'male');
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: [] });
    await settle(fixture);

    click(el, '[data-role="mode-new"]');
    fixture.detectChanges();
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/calvings`);
    // The answered value reaches the wire, not the removed default.
    expect(req.request.body.calf_sex).toBe('male');
    req.flush({
      calf_id: 'BD-0007',
      linked: false,
      superseded_origin_event_id: null,
      dam: { animal: { id: 'BD-0001' }, status: { status: 'lactating', parity: 1 }, events: [] },
      calf: { animal: { id: 'BD-0007' }, status: null, events: [] },
    });
    await settle(fixture);
    // The two refreshes the success path fires.
    http.match((r) => r.url.startsWith(`${BASE}/dam-candidates`))
      .forEach((r) => r.flush({ candidates: DAMS }));
    http.match((r) => r.url.startsWith(`${BASE}/identifier-values`))
      .forEach((r) => r.flush({ observed_by: [], acquired_from: [], sire_ref: [] }));
    await settle(fixture);

    // Sex is back to unanswered.
    const chips = [...el.querySelectorAll('[data-role="calf-sex-group"] [data-chip]')];
    expect(chips.map((c) => c.getAttribute('aria-checked'))).toEqual(['false', 'false']);

    // The dam is still selected.
    expect((el.querySelector('[data-role="dam"]') as HTMLSelectElement).value).toBe('BD-0001');

    // `outcome` survives, and that asymmetry is deliberate: live -> died is
    // repairable with a departure event and the reverse is not, so its default
    // fails safe in a way the sex default did not.
    expect(
      el.querySelector('[data-role="outcome-group"] [data-chip="live"]')!.getAttribute('aria-checked'),
    ).toBe('true');

    // And the picker is unreachable again rather than showing a stale list.
    expect(el.querySelector('[data-role="picker-blocked"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-candidate]').length).toBe(0);
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(true);
    // The date cleared too, and it is named FIRST -- blockedReason reports the
    // earliest unanswered field, not every one of them.
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('Enter the calving date');

    // Typing the next record's date hands the block to the sex, which proves
    // the cleared sex is really gating and not just visually deselected.
    enterDate(fixture, el, '9 Sep 2025');
    await settle(fixture);
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('female or male');
    http.expectNone((r) => r.url.startsWith(`${BASE}/link-candidates`));
  });

  it('a changed date invalidates the choice — eligibility depends on it', async () => {
    // A picked animal can become ineligible when the date moves, so letting a
    // stale selection ride to submit would mean a refusal with a real animal in
    // front of you.
    const { http, fixture, el } = await mount();
    chooseDam(fixture, el, 'BD-0001');
    enterDate(fixture, el, '2 Jun 2024');
    chooseCalfSex(fixture, el, 'female');
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/link-candidates`)).flush({ candidates: CANDIDATES });
    await settle(fixture);

    (el.querySelector('[data-candidate="BD-0006"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(false);

    enterDate(fixture, el, '9 Jun 2024');
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

    enterDate(fixture, el, '2019');
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
    click(el, '[data-chip="dry_off"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'Aug 2024');

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
    click(el, '[data-chip="dry_off"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'Aug 2024');
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
    enterDate(fixture, el, '2019');
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
    enterDate(fixture, el, '2019');

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
    enterDate(fixture, el, '2019');

    click(el, '[data-role="submit"]');
    const first = http.expectOne(`${BASE}/animals`);
    const key = first.request.headers.get('Idempotency-Key');
    first.flush({ animal_id: 'BD-0001', animal: { animal: { id: 'BD-0001', name: null }, status: null, events: [] } });
    await settle(fixture);
    http.match((r) => r.url.startsWith(`${BASE}/identifier-values`)).forEach((r) =>
      r.flush({ observed_by: [], acquired_from: [], sire_ref: [] }),
    );
    await settle(fixture);

    // The date has to be RE-ENTERED, because a successful write now clears the
    // per-animal fields and returns focus to the first one -- see after-write.ts.
    // That is the post-submit reset working, and it is why this spec can no
    // longer just click submit twice.
    enterDate(fixture, el, '2019');
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
    click(el, '[data-chip="dry_off"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'May 2024');

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

    click(el, '[data-chip="recall"]');
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
  it('cannot submit until the required date is entered', () => {
    // Was "until a precision is chosen". There is no precision to choose any
    // more -- it is read from the text -- so the blocker names the field.
    setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain(
      'Enter the arrival date',
    );
  });

  it('A HALF-TYPED OPTIONAL BIRTH DATE BLOCKS SUBMIT, and nothing is sent', () => {
    // The disappearance this item closes. Before, an unparseable birth date
    // left the form submitting with birth_on: null -- a birth year the operator
    // typed, gone with no trace, indistinguishable from never typing one.
    setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    enterDate(fixture, el, '2019');           // arrival: fine
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(false);

    enterDate(fixture, el, '06/07/2023', 1);  // birth: ambiguous, so incomplete
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('birth date');
  });

  it('an EMPTY optional birth date does not block, and sends null honestly', () => {
    // The other half of the rule: `required` decides only whether empty blocks.
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    enterDate(fixture, el, '2019');
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).disabled).toBe(false);
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/animals`);
    expect(req.request.body.birth_on).toBeNull();
    expect(req.request.body.birth_precision).toBeNull();
  });

  it('a completed optional birth date is sent with its inferred precision', () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    enterDate(fixture, el, '2019');
    enterDate(fixture, el, 'Mar 2017', 1);
    click(el, '[data-role="submit"]');

    const req = http.expectOne(`${BASE}/animals`);
    expect(req.request.body.acquired_on).toBe('2019-01-01');
    expect(req.request.body.date_precision).toBe('year');
    expect(req.request.body.birth_on).toBe('2017-03-01');
    expect(req.request.body.birth_precision).toBe('month');
  });

  it('sends the session provenance and a normalized date, and no observed_by', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(AnimalForm);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // Precision first, on the arrival-date control (the first one rendered).
    enterDate(fixture, el, '2019');
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
    enterDate(fixture, el, '2019');
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
    enterDate(fixture, el, '14 Jun 2019');
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
    enterDate(fixture, el, '14 Jun 2019');
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
    click(el, '[data-chip="departure"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'May 2024');
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
    click(el, '[data-chip="departure"]');
    fixture.detectChanges();
    expect(el.textContent).toContain('terminal');
  });

  it('offers an explicit override when the server refuses on a terminal departure', async () => {
    const { http, fixture, el } = mount();
    click(el, '[data-chip="dry_off"]');
    fixture.detectChanges();
    enterDate(fixture, el, 'May 2024');
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
    enterDate(fixture, el, 'May 2023');
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
