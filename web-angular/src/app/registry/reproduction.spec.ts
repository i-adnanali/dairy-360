import { REPRODUCTIVE_STATES, basisWord, reproductionLabel, reproductionTone } from './reproduction';

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
});
