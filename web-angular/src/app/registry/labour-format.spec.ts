// Labour's dates and names in words: they were ISO ("2026-10-01 → 2026-10-31")
// and every person was shown twice ("abdul / Abdul").
import { dayText, monthText, periodText, personLabel, stintText } from './labour-format';

describe('labour in words', () => {
  it('writes days, months and pay periods as people say them', () => {
    expect(dayText('2026-10-31')).toBe('31 Oct 2026');
    expect(monthText('2026-10')).toBe('Oct 2026');
    expect(periodText('2026-10-01', '2026-10-31')).toBe('Oct 2026');
    expect(periodText('2026-02-01', '2026-02-28')).toBe('Feb 2026');
    expect(periodText('2026-11-01', '2026-11-15')).toBe('1–15 Nov 2026');
    expect(periodText('2026-09-28', '2026-10-03')).toBe('28 Sep – 3 Oct 2026');
    expect(periodText('2025-12-30', '2026-01-02')).toBe('30 Dec 2025 – 2 Jan 2026');
    expect(periodText('2026-11-08', '2026-11-08')).toBe('8 Nov 2026');
  });

  it('says a stint is open rather than drawing an arrow to "open"', () => {
    expect(stintText('2026-07-11', null)).toBe('Since 11 Jul 2026');
    expect(stintText('2026-07-11', '2026-10-03')).toBe('11 Jul 2026 to 3 Oct 2026');
  });

  it('names a person once, adding the identifier only when it differs', () => {
    expect(personLabel({ identifier: 'abdul', name: 'Abdul' })).toEqual({ name: 'Abdul', id: null });
    expect(personLabel({ identifier: 'abdul_r', name: 'Abdul' })).toEqual({ name: 'Abdul', id: 'abdul_r' });
    expect(personLabel({ identifier: 'rafiq', name: null })).toEqual({ name: 'rafiq', id: null });
  });
});
