import { REPRODUCTIVE_STATES, basisWord, dayRange, reproductionLabel, reproductionTone, serviceWord } from './reproduction';
import type { ReproductionView } from './types';

describe('reproduction presentation', () => {
  it('names and tones every state', () => {
    expect(REPRODUCTIVE_STATES.map((s) => [s, reproductionLabel(s), reproductionTone(s)])).toEqual([
      ['calved', 'Calved', 'success'], ['lost', 'Lost', 'danger'], ['overdue', 'Overdue', 'danger'],
      ['window', 'Calving window', 'warning'], ['close', 'Close to calving', 'warning'],
      ['dryoff', 'Due to dry off', 'warning'], ['confirmed', 'Confirmed pregnant', 'success'],
      ['recheck', 'Pregnant, re-check due', 'warning'], ['unconfirmed', 'Pregnancy unconfirmed', 'neutral'],
      ['bred', 'Bred', 'brand'], ['open', 'Open', 'ended'],
    ]);
  });
  it('says whether a state was recorded or worked out', () => {
    expect([basisWord('observed'), basisWord('inferred')]).toEqual(['recorded', 'worked out']);
  });
  it('names how she was served', () => {
    expect(serviceWord('bull_exposure')).toBe('Bull running with her');
  });
  it('gives one day, or a range when the days differ', () => {
    expect(dayRange({ day_min: 35, day_max: 35 } as ReproductionView)).toBe('Day 35');
    expect(dayRange({ day_min: 91, day_max: 165 } as ReproductionView)).toBe('Day 91 to 165');
  });
});
