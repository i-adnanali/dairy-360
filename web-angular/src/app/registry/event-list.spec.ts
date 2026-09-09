import { TestBed } from '@angular/core/testing';
import { EventList } from './event-list';
import type { TimelineEvent } from './types';

function ev(over: Partial<TimelineEvent> & Pick<TimelineEvent, 'id' | 'type'>): TimelineEvent {
  return {
    occurred_on: '2024-01-01',
    occurred_time: null,
    date_precision: 'day',
    payload: {},
    source_form: 'recall',
    source_ref: null,
    observed_by: null,
    recorded_by: 'adnan',
    recorded_at: '2026-01-01T00:00:00.000Z',
    supersedes_id: null,
    superseded_by_id: null,
    override_check: null,
    override_reason: null,
    effective: true,
    ...over,
  };
}

function render(events: TimelineEvent[]) {
  const fixture = TestBed.createComponent(EventList);
  fixture.componentRef.setInput('events', events);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('EventList — the correction window', () => {
  it('does not invent an override when the wire omits optional override fields', () => {
    const event = ev({ id: 'aevt_plain', type: 'note' });
    delete (event as Partial<TimelineEvent>).override_check;
    const el = render([event]);
    expect(el.querySelector('[data-role="override"]')).toBeNull();
  });

  it('SHOWS superseded events rather than filtering them out', () => {
    // The whole reason this view is load-bearing: a filtered-out event is
    // indistinguishable from one never written, so a successful correction
    // would look identical to a silent no-op.
    const el = render([
      ev({
        id: 'aevt_old',
        type: 'calving',
        occurred_on: '2023-04-01',
        date_precision: 'month',
        effective: false,
        superseded_by_id: 'aevt_new',
      }),
      ev({
        id: 'aevt_new',
        type: 'calving',
        occurred_on: '2023-05-01',
        date_precision: 'month',
        supersedes_id: 'aevt_old',
      }),
    ]);
    expect(el.querySelectorAll('[data-event]').length).toBe(2);
    expect(el.querySelector('[data-event="aevt_old"]')).not.toBeNull();
  });

  it('renders event ids, because a correction targets one', () => {
    const el = render([ev({ id: 'aevt_abc', type: 'calving' })]);
    expect(el.querySelector('[data-event="aevt_abc"] [data-role="id"]')!.textContent).toContain(
      'aevt_abc',
    );
  });

  it('marks the superseded row and NAMES what replaced it', () => {
    const el = render([
      ev({ id: 'aevt_old', type: 'calving', effective: false, superseded_by_id: 'aevt_new' }),
      ev({ id: 'aevt_new', type: 'calving', supersedes_id: 'aevt_old' }),
    ]);
    const old = el.querySelector('[data-event="aevt_old"]')!;
    expect(old.getAttribute('data-effective')).toBe('false');
    expect(old.querySelector('[data-role="superseded-badge"]')).not.toBeNull();
    expect(old.querySelector('[data-role="replaced-by"]')!.textContent).toContain('aevt_new');
    // Struck through, so the eye can tell at a glance which is live.
    expect(old.querySelector('[data-role="when"]')!.className).toContain('line-through');

    const fresh = el.querySelector('[data-event="aevt_new"]')!;
    expect(fresh.getAttribute('data-effective')).toBe('true');
    expect(fresh.querySelector('[data-role="replaces"]')!.textContent).toContain('aevt_old');
    expect(fresh.querySelector('[data-role="when"]')!.className).not.toContain('line-through');
  });

  it('shows precision on every date, never a bare date, and never a fabricated day', () => {
    const el = render([
      ev({ id: 'a', type: 'acquired', occurred_on: '2019-01-01', date_precision: 'year' }),
      ev({ id: 'b', type: 'note', occurred_on: '2024-03-14', date_precision: 'day' }),
    ]);
    const a = el.querySelector('[data-event="a"] [data-role="when"]')!;
    const b = el.querySelector('[data-event="b"] [data-role="when"]')!;

    // THE QUALIFIER LOST ITS BRACKETS, per UI_SYSTEM.md §6.1: lowercase, no
    // parentheses, one space after the figure. This assertion used to read
    // `(year)` / `(day)`.
    expect(a.textContent).toContain('2019 year');

    // AND THE FIGURE LOST THE DAY IT NEVER KNEW, which is the substance of the
    // change rather than the punctuation. A year-precision event is stored as
    // January 1, and this cell printed `2019-01-01 (year)` -- asserting an exact
    // day in the same breath as denying one. The test's own name says "never a
    // bare date"; a date with a fabricated day is worse than a bare one,
    // because it is specific.
    expect(a.textContent).not.toContain('2019-01-01');

    // An exact day keeps every digit and takes no qualifier: there is no
    // imprecision to name, and `(day)` was a word spent saying nothing.
    expect(b.textContent).toContain('2024-03-14');
    expect(b.textContent).not.toContain('day');
  });

  it('says when no witness was recorded rather than leaving it blank', () => {
    const el = render([ev({ id: 'a', type: 'note' })]);
    expect(el.querySelector('[data-role="provenance"]')!.textContent).toContain(
      'no witness recorded',
    );
  });

  it('names the witness when there is one', () => {
    const el = render([ev({ id: 'a', type: 'note', observed_by: 'keeper_1' })]);
    expect(el.querySelector('[data-role="provenance"]')!.textContent).toContain('keeper_1');
  });

  it('summarises each payload type without a table', () => {
    const el = render([
      ev({
        id: 'c',
        type: 'calving',
        payload: { calf_id: 'BD-0007', calf_sex: 'female', outcome: 'live' },
      }),
      ev({ id: 'b', type: 'birth', payload: { dam_id: 'BD-0001', calving_event_id: 'aevt_x' } }),
      ev({ id: 'd', type: 'departure', payload: { reason: 'sold', to: 'Chak 42' } }),
      ev({ id: 'n', type: 'note', payload: { text: 'limping' } }),
      ev({ id: 'q', type: 'acquired', payload: {} }),
    ]);
    expect(el.querySelector('[data-event="c"] [data-role="summary"]')!.textContent).toContain(
      'BD-0007',
    );
    expect(el.querySelector('[data-event="b"] [data-role="summary"]')!.textContent).toContain(
      'BD-0001',
    );
    expect(el.querySelector('[data-event="d"] [data-role="summary"]')!.textContent).toContain(
      'Chak 42',
    );
    expect(el.querySelector('[data-event="n"] [data-role="summary"]')!.textContent).toContain(
      'limping',
    );
    expect(el.querySelector('[data-event="q"] [data-role="summary"]')!.textContent).toContain(
      'no birth date given',
    );
  });

  it('has a built empty state', () => {
    const el = render([]);
    expect(el.querySelector('[data-role="empty"]')).not.toBeNull();
    expect(el.textContent).toContain('origin event');
  });

  it('surfaces a recorded override, so the log explaining itself is visible', () => {
    // The fact is already on the row; without this nobody ever reads it.
    // Columns since migration 4 -- it was payload.override before.
    const el = render([
      ev({
        id: 'aevt_over',
        type: 'dry_off',
        payload: { reason: null, notes: null },
        override_check: 'animal_departed',
        override_reason: 'stayed on the farm until August',
      }),
    ]);
    const o = el.querySelector('[data-role="override"]')!;
    expect(o.textContent).toContain('animal_departed');
    expect(o.textContent).toContain('stayed on the farm until August');
  });

  it('says a reason was not recorded rather than showing a blank', () => {
    const el = render([
      ev({
        id: 'aevt_over',
        type: 'dry_off',
        payload: { reason: null, notes: null },
        override_check: 'animal_departed',
      }),
    ]);
    expect(el.querySelector('[data-role="override"]')!.textContent).toContain('no reason recorded');
  });

  it('shows no override block on an ordinary event', () => {
    const el = render([
      ev({ id: 'aevt_plain', type: 'dry_off', payload: { reason: null, notes: null } }),
    ]);
    expect(el.querySelector('[data-role="override"]')).toBeNull();
  });
});
