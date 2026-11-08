import { dayStanding, feedDay, feedLabel, feedProvenance, feedRelativeDay, feedWeekday } from './feed-format';
import { SECTIONS, activeViewPath } from './navigation';

describe('feed formatting', () => {
  it('shows calendar dates as the rest of the app does', () => {
    expect(feedDay('2026-11-06', '2026-11-08')).toBe('6 Nov');
    expect(feedDay('2025-01-31', '2026-11-08')).toBe('31 Jan 2025');
    expect(feedDay('not a date', '2026-11-08')).toBe('not a date');
    expect(feedDay(null)).toBe('');
  });
  it('names today and yesterday, and the weekday', () => {
    expect(feedRelativeDay('2026-11-08', '2026-11-08')).toBe('Today');
    expect(feedRelativeDay('2026-11-07', '2026-11-08')).toBe('Yesterday');
    expect(feedRelativeDay('2026-11-01', '2026-11-08')).toBe('1 Nov');
    expect(feedRelativeDay('2026-02-28', '2026-03-01')).toBe('Yesterday');
    expect(feedWeekday('2026-11-08')).toBe('Sun');
  });
  it('sentence-cases stored values and never prints the wire', () => {
    expect(feedLabel('water_mixed')).toBe('Water mixed');
    expect(feedProvenance({ recorded_by: 'adnan', source_form: 'direct_entry', recorded_at: '2026-11-06T13:28:31.389Z', revision: 1, source_ref: null }))
      .toBe('Recorded by adnan · Direct entry · 6 Nov, 18:28 · Revision 1 · No source reference');
  });
  it('a missing day is "Not recorded", never a zero', () => {
    expect(dayStanding(null)).toEqual({ label: 'Not recorded', tone: 'ended' });
    expect(dayStanding({ completeness: 'partial' }).label).toBe('Partial');
    expect(dayStanding({ completeness: 'complete' }).label).toBe('Recorded');
  });
});

describe('section view matching', () => {
  const feed = SECTIONS.find((s) => s.label === 'Feed')!;
  const herd = SECTIONS.find((s) => s.label === 'Herd')!;
  it('keeps your place on a record under a list', () => {
    expect(activeViewPath(feed, '/feed')).toBe('/feed');
    expect(activeViewPath(feed, '/feed/crops/abc')).toBe('/feed/crops');
    expect(activeViewPath(feed, '/feed/purchases/new')).toBe('/feed/purchases');
    expect(activeViewPath(feed, '/feed/daily/2026-11-08')).toBe('/feed/daily');
    expect(activeViewPath(feed, '/feed/items?x=1')).toBe('/feed/items');
  });
  it('the root view claims only itself, or a page with no view of its own', () => {
    expect(activeViewPath(herd, '/animals/calvings/new')).toBe('/animals/calvings');
    expect(activeViewPath(herd, '/animals/BD-0001')).toBe('/animals');
    expect(activeViewPath(herd, '/animals')).toBe('/animals');
  });
});
