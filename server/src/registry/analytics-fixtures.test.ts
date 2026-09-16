import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsHerd } from './analytics-fixtures';
import { analytics } from './analytics';
import { parseArgs } from './harness';

test('analytics harness covers comparisons, pagination, missing, pending, zero and signed differences', () => {
  const { db, scenarios } = analyticsHerd('2026-09-16');
  try {
    const now = new Date('2026-09-16T06:00:00Z');
    const report = (on: string, view = 'day', page = '1') => analytics(db, { on, view, page }, now);
    const monthly = report('2026-08-15', 'month');
    assert.equal(monthly.metrics.coverage.measurementPct, 100);
    assert.notEqual(monthly.comparison.percent, null);
    assert.equal(monthly.production.totalItems, 30);
    assert.equal(monthly.production.items.length, 25);
    assert.equal(report('2026-08-15', 'month', '2').production.items.length, 5);
    assert.deepEqual(report('2026-08-15', 'month', '2').metrics, monthly.metrics);
    assert.equal(report(scenarios.missing).metrics.coverage.missing, 30);
    assert.equal(report(scenarios.zero).metrics.produced, 0);
    assert.equal(report(scenarios.zero).metrics.dispatched, 0);
    assert.equal(report(scenarios.zero).metrics.differencePct, null);
    assert.equal(report(scenarios.excess).metrics.difference, -14);
    assert.equal(report(scenarios.retained).metrics.difference, 10);
    const today = report(scenarios.today).metrics;
    assert.equal(today.coverage.pending, 30);
    assert.equal(today.coverage.unmeasured, 1);
    assert.equal(today.coverage.notMilked, 1);
    assert.equal(today.differencePct, null);
    assert.equal(report('2026-08-19', 'week').metrics.coverage.measurementPct, 100);
  } finally { db.close(); }
});

test('analytics harness flag is explicit and incompatible with empty mode', () => {
  assert.equal(parseArgs(['--analytics']).analytics, true);
  assert.equal(parseArgs([]).analytics, false);
  assert.throws(() => parseArgs(['--analytics', '--empty']), /mutually exclusive/);
});
