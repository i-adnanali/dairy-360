import type { MilkingSessionCompleteness, DispatchSessionCompleteness } from './types';
it('models the two endpoint completeness shapes independently', () => {
  const milking: MilkingSessionCompleteness = { occurred_on: '2026-10-02', session: 'morning',
    expected: 2, recorded: 1, measured: 1, milked_not_measured: 0, not_milked: 0 };
  const dispatch: DispatchSessionCompleteness = { occurred_on: '2026-10-02', session: 'morning',
    expected_standing: 2, recorded_standing: 1 };
  expect(milking.recorded).toBe(1);
  expect(dispatch.recorded_standing).toBe(1);
});
