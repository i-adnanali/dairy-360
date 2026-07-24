// Regression & eval suite -- core scenarios (Cycle 3; see docs/REGRESSION.md).
//
// Runs against the REAL Anthropic API (no mock), matching the verification
// standard used for observability: exercise the actual loop, not a simulation.
// The model is not perfectly deterministic, so a scenario can occasionally take
// a valid-but-different path; v1 does not auto-retry -- a flake is reviewed by
// hand (see docs/REGRESSION.md Open items).
//
// Load server/.env for a local ANTHROPIC_API_KEY; in CI the key comes from the
// job env. dotenv never overrides an already-set var, so this is safe.
import 'dotenv/config';
import assert from 'node:assert';
import { before, beforeEach, describe, test } from 'node:test';

import { sumDeliveredLitres, sumMilkYield } from '../../db';
import { daysAgo, seed } from '../../seed';
import {
  datasets,
  finalHistory,
  liveSkipReason,
  outcome,
  pendingCards,
  resultFor,
  runTurn,
  selection,
  toolCalls,
  userText,
} from './harness';
import { DISPATCH_SCENARIOS, MATCHED_WINDOW, MISMATCHED_WINDOW } from './scenarios';

const round1 = (n: number) => Math.round(n * 10) / 10;
const TURN_TIMEOUT = 60_000;

describe('regression suite (live model)', { skip: liveSkipReason() }, () => {
  // A fresh, identical, seeded DB per test: seed() re-seeds its RNG each call,
  // so writes from one scenario (approved log_milking) never leak into another.
  before(() => seed());
  beforeEach(() => seed());

  // --- Reused Cycle 1 Phase 4/5 (fit the direct-runAgentStream harness) ------

  test('chart read: milk yield for a group renders a dataset', { timeout: TURN_TIMEOUT }, async () => {
    const { events } = await runTurn({
      messages: [userText('Show me the milk yield for the Kundi group over the last 30 days.')],
    });

    assert.equal(selection(events), 'dairy', 'a pure milk-yield question routes to the dairy agent');

    const call = toolCalls(events).find((c) => c.name === 'get_milk_yield');
    assert.ok(call, 'the model called get_milk_yield');
    assert.equal(call?.input.group, 'Kundi', 'scoped to the Kundi group');

    const ds = datasets(events);
    assert.ok(ds.length >= 1, 'a chart dataset was emitted');
    assert.ok(ds[0].points.length > 0, 'the dataset carries the full time series');

    assert.equal(outcome(events), 'completed');
  });

  test('guard rejection: unknown animal never executes', { timeout: TURN_TIMEOUT }, async () => {
    const { events } = await runTurn({
      messages: [userText('Give me the full detail for animal animal_999, including its recent yield.')],
    });

    const call = toolCalls(events).find((c) => c.name === 'get_animal');
    assert.ok(call, 'the model called get_animal');
    assert.equal(call?.input.animal_id, 'animal_999');

    const res = resultFor(events, 'get_animal');
    assert.ok(res, 'get_animal produced a result');
    assert.equal(res?.isError, true, 'the id guard rejected it');
    const digest = res?.content as { error?: string; animal_id?: string };
    assert.equal(digest.error, 'unknown_animal');
    assert.equal(digest.animal_id, 'animal_999');

    // A rejected read is "wrong cheaply": the model reads the error and still
    // finishes the turn rather than the run aborting.
    assert.equal(outcome(events), 'completed');
  });

  test('write gate: log_milking pauses for approval', { timeout: TURN_TIMEOUT }, async () => {
    const { events } = await runTurn({
      messages: [userText(`Log a morning milking for animal_001 of 7 litres on ${daysAgo(0)}.`)],
    });

    assert.equal(selection(events), 'dairy');
    assert.equal(outcome(events), 'awaiting_approval', 'the write paused instead of executing');

    const cards = pendingCards(events);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].toolName, 'log_milking');
    assert.ok(
      toolCalls(events).some((c) => c.name === 'log_milking'),
      'the assistant tool_use was log_milking',
    );
  });

  test('approved write + resume: log_milking executes on approval', { timeout: TURN_TIMEOUT }, async () => {
    // Turn 1: the write pauses and the server hands back the opaque history.
    const first = await runTurn({
      messages: [userText(`Log a morning milking for animal_001 of 7 litres on ${daysAgo(0)}.`)],
    });
    assert.equal(outcome(first.events), 'awaiting_approval');
    const call = toolCalls(first.events).find((c) => c.name === 'log_milking');
    assert.ok(call, 'log_milking was proposed');

    // Turn 2: resend that history plus an approval, exactly like the client.
    const second = await runTurn({
      messages: finalHistory(first.events),
      approvals: [{ toolUseId: call!.id, approved: true }],
    });

    assert.equal(outcome(second.events), 'completed', 'the resume ran to completion');
    const res = resultFor(second.events, 'log_milking');
    assert.ok(res, 'the approved write produced a result');
    assert.equal(res?.isError, false);
    const digest = res?.content as { inserted?: number };
    assert.ok((digest.inserted ?? 0) >= 1, 'a milking row was inserted');
  });

  // --- New (Cycle 2 risk): dispatcher correctness ----------------------------

  for (const sc of DISPATCH_SCENARIOS) {
    test(`dispatcher: ${sc.id} -> ${sc.expect}`, { timeout: TURN_TIMEOUT }, async () => {
      const { events } = await runTurn({ messages: [userText(sc.prompt)] });
      assert.equal(selection(events), sc.expect, sc.prompt);
    });
  }

  // --- New (Cycle 2 risk): reconciliation accuracy ---------------------------

  test('reconciliation: matched window is not flagged and is accurate', { timeout: TURN_TIMEOUT }, async () => {
    const { events } = await runTurn({
      messages: [
        userText(
          `Reconcile the milk we produced against what we delivered from ${MATCHED_WINDOW.from} to ${MATCHED_WINDOW.to}.`,
        ),
      ],
    });

    assert.equal(selection(events), 'both', 'reconciliation routes to both agents');
    const res = resultFor(events, 'get_yield_vs_deliveries');
    assert.ok(res, 'the model used the reconciliation tool (not two separate reads)');

    const d = res!.content as {
      from: string;
      to: string;
      producedLitres: number;
      deliveredLitres: number;
      discrepancyLitres: number;
      flagged: boolean;
    };

    // Accuracy: recompute ground truth from the SAME seeded DB for the exact
    // window the model used, so the check is independent of which dates it
    // picked -- it verifies the tool's arithmetic, the load-bearing risk.
    assert.equal(d.producedLitres, round1(sumMilkYield(d.from, d.to)));
    assert.equal(d.deliveredLitres, round1(sumDeliveredLitres(d.from, d.to)));
    assert.equal(d.discrepancyLitres, round1(sumMilkYield(d.from, d.to) - sumDeliveredLitres(d.from, d.to)));

    assert.equal(d.flagged, false, 'a within-tolerance window is not flagged');
  });

  test('reconciliation: deliberately-mismatched window is flagged and accurate', { timeout: TURN_TIMEOUT }, async () => {
    const { events } = await runTurn({
      messages: [
        userText(
          `Reconcile the milk we produced against what we delivered from ${MISMATCHED_WINDOW.from} to ${MISMATCHED_WINDOW.to}. Is there a discrepancy?`,
        ),
      ],
    });

    assert.equal(selection(events), 'both');
    const res = resultFor(events, 'get_yield_vs_deliveries');
    assert.ok(res, 'the model used the reconciliation tool');

    const d = res!.content as {
      from: string;
      to: string;
      producedLitres: number;
      deliveredLitres: number;
      discrepancyLitres: number;
      flagged: boolean;
    };

    assert.equal(d.producedLitres, round1(sumMilkYield(d.from, d.to)));
    assert.equal(d.deliveredLitres, round1(sumDeliveredLitres(d.from, d.to)));
    assert.equal(d.discrepancyLitres, round1(sumMilkYield(d.from, d.to) - sumDeliveredLitres(d.from, d.to)));

    assert.equal(d.flagged, true, 'the seeded mismatch window exceeds tolerance');
    assert.ok(d.discrepancyLitres > 0, 'more was produced than delivered');
  });

  // --- New (Cycle 2 risk): vendor write gate ---------------------------------

  test('vendor write gate: record_delivery pauses for approval', { timeout: TURN_TIMEOUT }, async () => {
    const { events } = await runTurn({
      messages: [userText(`Record a delivery of 120 litres to vendor_001 dated ${daysAgo(0)}.`)],
    });

    assert.equal(selection(events), 'vendor');
    assert.equal(outcome(events), 'awaiting_approval', 'the vendor write pauses exactly like log_milking');

    const cards = pendingCards(events);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].toolName, 'record_delivery');
  });
});
