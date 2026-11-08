import { attentionItems, milkWeek } from './today-board';
import { windowFor } from '../farm-monitor/farm-monitor';
import type { DayBoard } from '../types';
import type { HealthBoard } from '../health-workflows';
import type { FarmEventRow } from '../api';
import type { AnalyticsReport } from '@dairy/shared';

const board = (): DayBoard => ({
  on: '2026-11-06',
  milking: [
    { session: 'morning', expected: 6, recorded: 6, complete: true },
    { session: 'evening', expected: 6, recorded: 0, complete: false },
  ],
  dispatch: [
    { session: 'morning', expected: 2, recorded: 2, complete: true },
    { session: 'evening', expected: 2, recorded: 0, complete: false },
  ],
  payroll: { from_on: '2026-11-01', to_on: '2026-11-30', outstanding: 2, permanent: 2 },
  payroll_previous: null,
});

const health = (over: Partial<HealthBoard> = {}): HealthBoard => ({
  on: '2026-11-06', tasks: [], overdue: 0, due: 0, upcoming: 0, open_cases: [], withdrawals: [], ...over,
});
const task = (standing: string, kind = 'administration') =>
  ({ id: 't-' + standing, entity: 'tasks', kind, status: 'pending', standing, due_on: '2026-11-05',
     animal_id: 'BD-0001', animal_name: 'Noori', instructions: 'Vaccine' }) as unknown as HealthBoard['tasks'][number];
const event = (id: string, sev: 'urgent' | 'notable'): FarmEventRow => ({
  id, camera_id: 'cam_feed_store', zone: 'feed_store', event_type: 'detection', identity: null, confidence: 0.9,
  occurred_at: '2026-11-05T20:10:00.000Z', is_synthetic: true, flagged: true, flag_severity: sev, flag_reason: 'Restricted zone',
});

describe('attentionItems', () => {
  it('puts overdue work in "needs you now" and due-today work in "also open"', () => {
    const { now, open } = attentionItems(board(), health({ tasks: [task('overdue'), task('due', 'recheck'), task('upcoming')] }), 0, 'evening');
    expect(now.map((i) => i.badge)).toEqual(['Overdue']);
    expect(now[0].subject).toBe('BD-0001 Noori');
    expect(now[0].what).toBe('Dose · Vaccine');
    expect(open.map((i) => i.badge)).toEqual(['Due today']);
  });

  it('treats a milk withdrawal with no known end as NOT for sale, never as clear', () => {
    const { now } = attentionItems(
      board(),
      health({ withdrawals: [
        { animal_id: 'BD-0003', administration_id: 'a1', target: 'milk', status: 'needs_clarification' },
        { animal_id: 'BD-0002', administration_id: 'a2', target: 'milk', status: 'active', until: '2026-11-08T18:00:00+05:00' },
        { animal_id: 'BD-0002', administration_id: 'a2', target: 'meat', status: 'needs_clarification' },
      ] }),
      0, 'morning', new Map([['BD-0002', 'Sohni']]),
    );
    expect(now.map((i) => i.badge)).toEqual(['Not for sale', 'Not for sale']);
    expect(now[0].when).toBe('End unknown · clarify');
    expect(now[1].subject).toBe('BD-0002 Sohni');
    expect(now[1].when).toBe('Until 8 Nov, 18:00');
  });

  it('surfaces waiting approvals and flagged events, urgent first', () => {
    const { now, open } = attentionItems(board(), null, 2, 'morning', new Map(), [event('e1', 'notable'), event('e2', 'urgent')]);
    expect(now.map((i) => i.badge)).toEqual(['Urgent', 'Awaiting approval']);
    expect(now.find((i) => i.badge === 'Awaiting approval')!.opensAssistant).toBe(true);
    expect(open.map((i) => i.badge)).toEqual(['Notable']);
  });

  it('links each item to the thing itself, not the top of a section', () => {
    const { now, open } = attentionItems(
      board(),
      health({ tasks: [task('overdue'), task('due')], withdrawals: [{ animal_id: 'BD-0003', administration_id: 'a1', target: 'milk', status: 'needs_clarification' }] }),
      0, 'evening', new Map(), [event('e2', 'urgent')],
    );
    const by = (badge: string) => [...now, ...open].find((i) => i.badge === badge)!;
    expect(by('Overdue')).toMatchObject({ link: ['/animals/health'], query: { animal: 'BD-0001', task: 't-overdue' }, action: 'Open task' });
    expect(by('Due today').query).toEqual({ animal: 'BD-0001', task: 't-due' });
    expect(by('Not for sale')).toMatchObject({ query: { animal: 'BD-0003' }, action: 'Open withdrawal' });
    expect(by('Urgent')).toMatchObject({ link: ['/monitor'], query: { window: 'night', event: 'e2' }, action: 'Open event' });
  });

  it('lists a session still open from the morning as late, in the evening only', () => {
    const b = board();
    b.milking[0] = { session: 'morning', expected: 6, recorded: 2, complete: false };
    expect(attentionItems(b, null, 0, 'evening').now.map((i) => i.badge)).toEqual(['Late']);
    expect(attentionItems(b, null, 0, 'morning').now).toEqual([]);
  });
});

describe('milkWeek', () => {
  const report = (on: string, buckets: [string, number | null, number][], inProgress = false) =>
    ({
      scope: { on, inProgress },
      buckets: buckets.map(([d, produced, pending]) => ({
        on: d, produced, coverage: { pending, missing: 0 },
      })),
    }) as unknown as AnalyticsReport;

  it('returns seven days ending today, keeping no-record distinct from zero', () => {
    const days = milkWeek('2026-11-06', [
      report('2026-10-31', [['2026-10-31', 50, 0], ['2026-11-01', null, 0]]),
      report('2026-11-06', [['2026-11-04', 0, 0], ['2026-11-06', 28.9, 6]], true),
    ]);
    expect(days.map((d) => d.on)).toEqual([
      '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
    ]);
    expect(days[1].litres).toBeNull();
    expect(days[4].litres).toBe(0);
    expect(days[6]).toMatchObject({ litres: 28.9, partial: true, label: '6 Nov' });
  });
});

describe('windowFor', () => {
  it('reads "last night" as 18:00 to 06:00 farm time, before or after dawn', () => {
    const afternoon = windowFor('night', new Date('2026-11-06T11:00:00Z')); // 16:00 PKT
    expect(afternoon).toEqual({ from: '2026-11-05T13:00:00.000Z', to: '2026-11-06T01:00:00.000Z' });
    const beforeDawn = windowFor('night', new Date('2026-11-06T00:30:00Z')); // 05:30 PKT
    expect(beforeDawn).toEqual({ from: '2026-11-04T13:00:00.000Z', to: '2026-11-05T01:00:00.000Z' });
  });
});
