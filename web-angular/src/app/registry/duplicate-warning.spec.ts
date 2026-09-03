import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DEBOUNCE_MS, DuplicateWarning } from './duplicate-warning';
import type { DuplicateCandidate } from './types';

const BASE = '/api/registry';

function match(over: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    id: 'BD-0001',
    name: 'Kali',
    sex: 'female',
    post_no: null,
    tag_no: null,
    matched_on: 'name_exact',
    match_reason: "same name 'Kali', same sex",
    recorded_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    ...over,
  };
}

function mount() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), provideRouter([])],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(DuplicateWarning);
  fixture.componentRef.setInput('sex', 'female');
  fixture.detectChanges();
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
}

/** Past the debounce, so a pending query has actually been issued. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 20));
  await fixture.whenStable();
  fixture.detectChanges();
}

/**
 * After a flush, let the promise chain resolve before reading the DOM.
 *
 * `flush()` settles the HTTP request but the component updates in a `.then()`,
 * so a bare detectChanges() renders the state from before the response --
 * the same trap as `settle()` in forms.spec.ts, one layer in.
 */
async function rendered(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('DuplicateWarning', () => {
  it('asks nothing until something is typed', async () => {
    const { http, fixture, el } = mount();
    await settle(fixture);
    http.expectNone((r) => r.url.startsWith(`${BASE}/duplicate-candidates`));
    expect(el.querySelector('[data-role="duplicate-warning"]')).toBeNull();
  });

  it('queries on the typed identity fields once typing settles', async () => {
    const { http, fixture } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.componentRef.setInput('postNo', '12');
    fixture.detectChanges();
    await settle(fixture);

    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`));
    expect(req.request.url).toContain('name=Kali');
    expect(req.request.url).toContain('post_no=12');
    expect(req.request.url).toContain('sex=female');
    req.flush({ candidates: [] });
  });

  it('DEBOUNCES, so typing a name is one request and not one per letter', async () => {
    const { http, fixture } = mount();
    for (const v of ['K', 'Ka', 'Kal', 'Kali']) {
      fixture.componentRef.setInput('name', v);
      fixture.detectChanges();
    }
    await settle(fixture);

    const reqs = http.match((r) => r.url.startsWith(`${BASE}/duplicate-candidates`));
    expect(reqs.length).toBe(1);
    expect(reqs[0].request.url).toContain('name=Kali');
    reqs[0].flush({ candidates: [] });
  });

  it('shows the match with the server reason and how long ago it was typed', async () => {
    const { http, fixture, el } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`))
      .flush({ candidates: [match()] });
    await rendered(fixture);

    const box = el.querySelector('[data-role="duplicate-warning"]')!;
    expect(box.textContent).toContain('Is this a new one?');
    expect(box.textContent).toContain('BD-0001');
    expect(box.textContent).toContain("same name 'Kali', same sex");
    expect(box.querySelector('[data-role="added"]')!.textContent).toContain('4 minutes ago');
  });

  it('NEVER BLOCKS: no disable, no acknowledgement to click', async () => {
    // Soft is load-bearing. Two animals with no name, same sex and same arrival
    // year are genuinely two animals -- that is the roster pass. A block would
    // force the operator to invent a distinguishing detail.
    const { http, fixture, el } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`))
      .flush({ candidates: [match()] });
    await rendered(fixture);

    expect(el.querySelector('input[type="checkbox"]')).toBeNull();
    expect(el.textContent).toContain('nothing is blocked');
    // The only button is the one that opens the match to look at it.
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute('data-open')).toBe('BD-0001');
  });

  it('offers a one-click way to open the match', async () => {
    const { http, fixture, el } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`))
      .flush({ candidates: [match({ id: 'BD-0007' })] });
    await rendered(fixture);
    expect(el.querySelector('[data-open="BD-0007"]')).not.toBeNull();
  });

  it('clears itself when what was typed stops matching', async () => {
    const { http, fixture, el } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`))
      .flush({ candidates: [match()] });
    await rendered(fixture);
    expect(el.querySelector('[data-role="duplicate-warning"]')).not.toBeNull();

    fixture.componentRef.setInput('name', '');
    fixture.detectChanges();
    await settle(fixture);
    // Cleared locally without another round trip: an empty query has one answer.
    http.expectNone((r) => r.url.startsWith(`${BASE}/duplicate-candidates`));
    expect(el.querySelector('[data-role="duplicate-warning"]')).toBeNull();
  });

  it('IGNORES A STALE RESPONSE that arrives after a newer one', async () => {
    // Keystrokes produce overlapping requests and they do not come back in
    // order. Without the sequence guard, pausing after "Kal" and typing "i"
    // can leave the "Kal" matches on screen -- a warning about a name the
    // operator is no longer typing, which is worse than none.
    const { http, fixture, el } = mount();

    fixture.componentRef.setInput('name', 'Kal');
    fixture.detectChanges();
    await settle(fixture);
    const first = http.expectOne((r) => r.url.includes('name=Kal&') || r.url.endsWith('name=Kal'));

    fixture.componentRef.setInput('name', 'Zubaida');
    fixture.detectChanges();
    await settle(fixture);
    const second = http.expectOne((r) => r.url.includes('name=Zubaida'));

    // The newer answer lands first, then the older one.
    second.flush({ candidates: [] });
    await rendered(fixture);
    first.flush({ candidates: [match({ name: 'Kali' })] });
    await rendered(fixture);

    expect(el.querySelector('[data-role="duplicate-warning"]')).toBeNull();
  });

  it('passes excludeId so a row being edited cannot match itself', async () => {
    // The roster pass edits rows that already exist; without this every
    // keystroke would flag the row as a duplicate of itself.
    const { http, fixture } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.componentRef.setInput('excludeId', 'BD-0009');
    fixture.detectChanges();
    await settle(fixture);
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`));
    expect(req.request.url).toContain('exclude_id=BD-0009');
    req.flush({ candidates: [] });
  });

  it('re-queries when the refresh token changes, with the fields unchanged', async () => {
    // After a write the fields usually have not changed, so nothing else would
    // re-trigger -- and the animal just created is the one worth matching.
    const { http, fixture } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`))
      .flush({ candidates: [] });

    fixture.componentRef.setInput('refreshToken', 1);
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`))
      .flush({ candidates: [] });
  });

  it('stays silent when the server is unreachable', async () => {
    // Suggestions. An error next to a field nobody asked about is noise; the
    // write itself reports the server being down, where it matters.
    const { http, fixture, el } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`))
      .error(new ProgressEvent('error'));
    await settle(fixture);
    expect(el.querySelector('[data-role="duplicate-warning"]')).toBeNull();
  });

  it('reads a recent stamp in minutes and an old one in days', async () => {
    const { http, fixture, el } = mount();
    fixture.componentRef.setInput('name', 'Kali');
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne((r) => r.url.startsWith(`${BASE}/duplicate-candidates`)).flush({
      candidates: [
        match({ id: 'BD-0001', recorded_at: new Date(Date.now() - 30_000).toISOString() }),
        match({ id: 'BD-0002', recorded_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
        match({ id: 'BD-0003', recorded_at: null }),
      ],
    });
    await rendered(fixture);

    const age = (id: string) =>
      el.querySelector(`[data-role="duplicate-warning"] li:has([data-open="${id}"]) [data-role="added"]`)
        ?.textContent?.trim() ??
      [...el.querySelectorAll('li')]
        .find((li) => li.querySelector(`[data-open="${id}"]`))!
        .querySelector('[data-role="added"]')!.textContent!.trim();

    expect(age('BD-0001')).toBe('added seconds ago');
    expect(age('BD-0002')).toBe('added 3 days ago');
    expect(age('BD-0003')).toBe('added at an unknown time');
  });
});
