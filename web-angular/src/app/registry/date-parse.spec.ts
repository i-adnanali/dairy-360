import { AMBIGUOUS_MESSAGE, canEstimate, parseDateEntry } from './date-parse';
import type { DateEntry } from './date-parse';

const parse = (t: string, o?: { estimated?: boolean; time?: string | null }) =>
  parseDateEntry(t, o);

/** The stored triple, for the cases where that is all that matters. */
function value(e: DateEntry) {
  if (e.status !== 'complete') throw new Error(`expected complete, got ${e.status}`);
  return e.value;
}

describe('parseDateEntry — precision is inferred from the keystrokes', () => {
  it('a bare year is year precision, stored as January 1', () => {
    expect(value(parse('2019'))).toEqual({
      occurred_on: '2019-01-01',
      date_precision: 'year',
      occurred_time: null,
    });
  });

  it('a month name and a year is month precision, stored as the 1st', () => {
    // The input is folded into the comparison so a failure names which form
    // broke -- vitest's toEqual takes no message argument.
    for (const t of ['Mar 2019', 'mar 2019', 'March 2019', 'MARCH 2019', '2019 Mar', 'Mar. 2019']) {
      expect({ t, ...value(parse(t)) }).toEqual({
        t,
        occurred_on: '2019-03-01',
        date_precision: 'month',
        occurred_time: null,
      });
    }
  });

  it('a day, a month name and a year is day precision', () => {
    for (const t of ['6 Jul 2023', 'Jul 6 2023', 'Jul 6, 2023', '6 July 2023']) {
      expect({ t, ...value(parse(t)) }).toEqual({
        t,
        occurred_on: '2023-07-06',
        date_precision: 'day',
        occurred_time: null,
      });
    }
  });

  it('accepts ISO at both grains', () => {
    expect(value(parse('2023-07-06')).date_precision).toBe('day');
    expect(value(parse('2023-07-06')).occurred_on).toBe('2023-07-06');
    expect(value(parse('2019-03')).date_precision).toBe('month');
    expect(value(parse('2019-03')).occurred_on).toBe('2019-03-01');
  });

  it('is not confused by extra whitespace', () => {
    expect(value(parse('   6   Jul   2023  ')).occurred_on).toBe('2023-07-06');
  });

  it('pads single-digit months and days', () => {
    expect(value(parse('2023-7-6')).occurred_on).toBe('2023-07-06');
  });
});

describe('parseDateEntry — ambiguity is refused, never guessed', () => {
  it('refuses every all-numeric slash form, including the unambiguous ones', () => {
    // 25/12/2023 could only be December, but accepting it teaches a habit that
    // breaks silently the first time the day is under 13.
    for (const t of ['06/07/2023', '6/7/2023', '25/12/2023', '06-07-2023', '06.07.2023']) {
      const e = parse(t);
      expect(e.status).toBe('incomplete');
      expect((e as { message: string }).message).toBe(AMBIGUOUS_MESSAGE);
    }
  });

  it('the refusal teaches the two ways out', () => {
    expect(AMBIGUOUS_MESSAGE).toContain('6 Jul 2023');
    expect(AMBIGUOUS_MESSAGE).toContain('2023-07-06');
  });

  it('ISO is matched BEFORE the slash rule, so a leading year is never ambiguous', () => {
    // Otherwise the escape the message offers would itself be refused.
    expect(parse('2023-07-06').status).toBe('complete');
  });
});

describe('parseDateEntry — the three states', () => {
  it('empty text is EMPTY, which is not the same as incomplete', () => {
    // The distinction the old contract could not express, and the whole reason
    // a half-typed optional date used to vanish.
    expect(parse('').status).toBe('empty');
    expect(parse('   ').status).toBe('empty');
  });

  it('text that does not parse is INCOMPLETE, and says so', () => {
    const e = parse('sometime in the spring');
    expect(e.status).toBe('incomplete');
    expect((e as { message: string }).message).toContain('Try 2019');
  });

  it('an impossible day is incomplete and names the real length', () => {
    const e = parse('31 Feb 2023');
    expect(e.status).toBe('incomplete');
    expect((e as { message: string }).message).toContain('February 2023 has 28 days');
  });

  it('respects a leap year', () => {
    expect(parse('29 Feb 2024').status).toBe('complete');
    expect(parse('29 Feb 2023').status).toBe('incomplete');
  });

  it('an implausible year is incomplete', () => {
    expect(parse('1823').status).toBe('incomplete');
    expect(parse('9999').status).toBe('incomplete');
  });

  it('an unrecognised month word is incomplete, not a silent month 1', () => {
    expect(parse('Smarch 2019').status).toBe('incomplete');
  });

  it('an ambiguous month abbreviation is refused rather than picked', () => {
    // `ju` matches June and July; `j` matches three. Neither may be guessed.
    expect(parse('ju 2019').status).toBe('incomplete');
    expect(parse('jun 2019').status).toBe('complete');
    expect(parse('jul 2019').status).toBe('complete');
  });
});

describe('parseDateEntry — the estimated modifier', () => {
  it('turns a bare year into estimated, storing January 1 either way', () => {
    const plain = value(parse('2019'));
    const guess = value(parse('2019', { estimated: true }));
    expect(plain.date_precision).toBe('year');
    expect(guess.date_precision).toBe('estimated');
    expect(guess.occurred_on).toBe(plain.occurred_on);
  });

  it('is IGNORED on a month or a day, which is why the checkbox is disabled there', () => {
    // `estimated` stores January 1, so a specific day at estimated precision is
    // a fabricated day wearing a humility label -- rejected by name at the
    // write boundary. Silently downgrading the date instead would be worse.
    expect(value(parse('Mar 2019', { estimated: true })).date_precision).toBe('month');
    expect(value(parse('6 Jul 2023', { estimated: true })).date_precision).toBe('day');
  });

  it('canEstimate is true only for a bare year', () => {
    expect(canEstimate('2019')).toBe(true);
    expect(canEstimate('Mar 2019')).toBe(false);
    expect(canEstimate('6 Jul 2023')).toBe(false);
    expect(canEstimate('06/07/2023')).toBe(false);
    expect(canEstimate('')).toBe(false);
  });
});

describe('parseDateEntry — time rides only on a day', () => {
  it('keeps a time at day precision', () => {
    expect(value(parse('6 Jul 2023', { time: '05:30' })).occurred_time).toBe('05:30');
  });

  it('drops a time above day precision, so it cannot reach the server', () => {
    // There is no such thing as knowing the hour but not the day, and the
    // server refuses the combination three ways over.
    expect(value(parse('Mar 2019', { time: '05:30' })).occurred_time).toBeNull();
    expect(value(parse('2019', { time: '05:30' })).occurred_time).toBeNull();
  });
});

describe('parseDateEntry — the reading is shown back', () => {
  it('describes what it understood, at every precision', () => {
    // An inference the operator cannot see is a default by another name.
    const reading = (t: string, o?: { estimated?: boolean }) => {
      const e = parse(t, o);
      if (e.status !== 'complete') throw new Error('expected complete');
      return e.reading;
    };
    expect(reading('6 Jul 2023')).toContain('exact day');
    expect(reading('Mar 2019')).toContain('month only');
    expect(reading('Mar 2019')).toContain('stored as the 1st');
    expect(reading('2019')).toContain('year only');
    expect(reading('2019')).toContain('January 1');
    expect(reading('2019', { estimated: true })).toContain('estimated year');
  });
});
