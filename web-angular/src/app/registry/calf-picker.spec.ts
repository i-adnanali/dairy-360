import { TestBed } from '@angular/core/testing';
import { CalfPicker } from './calf-picker';
import type { LinkCandidate } from './types';

function cand(over: Partial<LinkCandidate>): LinkCandidate {
  return {
    id: 'BD-0001',
    name: null,
    sex: 'female',
    origin: 'acquired',
    birth_on: '2023-01-01',
    birth_precision: 'year',
    eligible: true,
    ineligible_reason: null,
    days_apart: 0,
    within_match_window: true,
    ...over,
  };
}

function make(candidates: LinkCandidate[], ready = true) {
  const fixture = TestBed.createComponent(CalfPicker);
  const emitted: { choice: string | null; name: string | null }[] = [];
  fixture.componentInstance.changed.subscribe((v) => emitted.push(v));
  fixture.componentRef.setInput('candidates', candidates);
  fixture.componentRef.setInput('ready', ready);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, emitted };
}

describe('CalfPicker', () => {
  it('says what it is waiting for before the dam and date are known', () => {
    const { el } = make([], false);
    expect(el.querySelector('[data-role="picker-blocked"]')).not.toBeNull();
    expect(el.querySelector('[data-role="candidates"]')).toBeNull();
    // Not even the create-new option: choosing it before the list can be shown
    // would be the old binary with extra steps.
    expect(el.querySelector('[data-role="mode-new"]')).toBeNull();
  });

  it('emits nothing until a choice is made — no default in either direction', () => {
    const { emitted } = make([cand({})]);
    expect(emitted.length).toBe(0);
  });

  it('puts "create a new animal" LAST, after every candidate', () => {
    // The safe path is the one the eye reaches first. Creating an animal is the
    // deliberate act, and it used to be the first of two buttons.
    const { el } = make([cand({ id: 'BD-0007' })]);
    const order = [...el.querySelectorAll('[data-candidate], [data-role="mode-new"]')];
    expect(order.length).toBe(2);
    expect(order[0].getAttribute('data-candidate')).toBe('BD-0007');
    expect(order[1].getAttribute('data-role')).toBe('mode-new');
  });

  it('emits the animal id when an existing animal is picked', () => {
    const { fixture, el, emitted } = make([cand({ id: 'BD-0007' })]);
    (el.querySelector('[data-candidate="BD-0007"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted[emitted.length - 1]).toEqual({ choice: 'BD-0007', name: null });
  });

  it('emits null for create-new, and only then offers a name field', () => {
    const { fixture, el, emitted } = make([cand({ id: 'BD-0007' })]);
    expect(el.querySelector('[data-role="calf_name"]')).toBeNull();

    (el.querySelector('[data-role="mode-new"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted[emitted.length - 1]).toEqual({ choice: null, name: null });

    const name = el.querySelector('[data-role="calf_name"]') as HTMLInputElement;
    expect(name).not.toBeNull();
    name.value = 'Chandni';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(emitted[emitted.length - 1]).toEqual({ choice: null, name: 'Chandni' });
  });

  it('drops a typed name when the choice switches to an existing animal', () => {
    // recordCalving ignores calf_name in link mode, so carrying it would
    // silently discard something the operator typed.
    const { fixture, el, emitted } = make([cand({ id: 'BD-0007' })]);
    (el.querySelector('[data-role="mode-new"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const name = el.querySelector('[data-role="calf_name"]') as HTMLInputElement;
    name.value = 'Chandni';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (el.querySelector('[data-candidate="BD-0007"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted[emitted.length - 1]).toEqual({ choice: 'BD-0007', name: null });
  });

  it('shows ineligible animals, greyed, with the server reason and unclickable', () => {
    const { el } = make([
      cand({ id: 'BD-0007' }),
      cand({
        id: 'BD-0001',
        eligible: false,
        ineligible_reason: 'already has a birth event, so it already has a dam',
      }),
    ]);
    const row = el.querySelector('[data-candidate="BD-0001"]') as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(row.disabled).toBe(true);
    expect(row.querySelector('[data-role="reason"]')!.textContent).toContain('already has a dam');
  });

  it('does not re-sort — the ranking is a server rule', () => {
    // Re-deriving the order here would be a second implementation of a server
    // decision, and the two would drift. Same argument as ineligible_reason.
    const { el } = make([
      cand({ id: 'BD-0009', days_apart: 400 }),
      cand({ id: 'BD-0002', days_apart: 1 }),
    ]);
    const ids = [...el.querySelectorAll('[data-candidate]')].map((n) =>
      n.getAttribute('data-candidate'),
    );
    expect(ids).toEqual(['BD-0009', 'BD-0002']);
  });

  it('states "no birth date" rather than leaving the distance blank', () => {
    // It is the reason the animal ranks first; a blank cell would read as a
    // missing value instead of as the signal it is.
    const { el } = make([cand({ id: 'BD-0006', birth_on: null, birth_precision: null, days_apart: null })]);
    const row = el.querySelector('[data-candidate="BD-0006"]')!;
    expect(row.querySelector('[data-role="distance"]')!.textContent!.trim()).toBe('no birth date');
  });

  it('reads the sign of days_apart as earlier or later', () => {
    const { el } = make([
      cand({ id: 'BD-0001', days_apart: 3 }),
      cand({ id: 'BD-0002', days_apart: -3 }),
      cand({ id: 'BD-0003', days_apart: 0 }),
      cand({ id: 'BD-0004', days_apart: 400 }),
    ]);
    const text = (id: string) =>
      el
        .querySelector(`[data-candidate="${id}"] [data-role="distance"]`)!
        .textContent!.trim();
    expect(text('BD-0001')).toBe('3d earlier');
    expect(text('BD-0002')).toBe('3d later');
    expect(text('BD-0003')).toBe('same date');
    expect(text('BD-0004')).toBe('13mo earlier');
  });

  it('collapses out-of-window animals behind a VISIBLE COUNT, never hides them', () => {
    // Nothing is unreachable. A birth date two years off is not a plausible
    // match and would bury the ones that are, but an animal silently absent
    // reads as data loss -- so the count is always on screen.
    const { fixture, el } = make([
      cand({ id: 'BD-0007', within_match_window: true }),
      cand({ id: 'BD-0008', within_match_window: false, days_apart: 900 }),
      cand({ id: 'BD-0009', within_match_window: false, days_apart: 1200 }),
    ]);
    expect(el.querySelector('[data-candidate="BD-0008"]')).toBeNull();
    const toggle = el.querySelector('[data-role="show-far"]')!;
    expect(toggle.textContent).toContain('2 more');

    (toggle as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-candidate="BD-0008"]')).not.toBeNull();
    expect(el.querySelector('[data-candidate="BD-0009"]')).not.toBeNull();
  });

  it('has no toggle when every candidate is in the window', () => {
    const { el } = make([cand({ id: 'BD-0007' })]);
    expect(el.querySelector('[data-role="show-far"]')).toBeNull();
  });

  it('says so plainly when nothing is near, without claiming nothing exists', () => {
    const { el } = make([]);
    expect(el.querySelector('[data-role="candidates-empty"]')!.textContent).toContain(
      'near this calving',
    );
  });

  it('carries NO warning about unrepairable duplicates', () => {
    // Deliberately gone rather than softened. The list is the mitigation, and a
    // warning that no longer names a live risk teaches operators to skim
    // warnings -- the same reason /check has no badge that turns green.
    const { el } = make([cand({})]);
    expect(el.textContent).not.toContain('duplicate');
    expect(el.textContent).not.toContain('cannot be repaired');
  });

  it('shows a server refusal bound to the calf field, verbatim', () => {
    const { fixture, el } = make([cand({})]);
    const prose = "animal 'BD-0007' already has a birth event";
    fixture.componentRef.setInput('error', prose);
    fixture.detectChanges();
    expect(el.querySelector('[data-role="error-calf"]')!.textContent!.trim()).toBe(prose);
  });

  it('reset() clears the selection so a parent can invalidate it', () => {
    const { fixture, el } = make([cand({ id: 'BD-0007' })]);
    (el.querySelector('[data-candidate="BD-0007"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.answered()).toBe(true);

    fixture.componentInstance.reset();
    fixture.detectChanges();
    expect(fixture.componentInstance.answered()).toBe(false);
    expect(fixture.componentInstance.chosen()).toBeNull();
  });
});
