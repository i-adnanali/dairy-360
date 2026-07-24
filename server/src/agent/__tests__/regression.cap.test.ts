// Regression suite -- iteration-cap path (Cycle 3; see docs/REGRESSION.md).
//
// Reused Cycle 1 Phase 5 case. MAX_ITERATIONS is read once at stream.ts module
// load, so this scenario runs in its own process with AGENT_MAX_ITERATIONS=1
// set at launch (npm run test:regression:cap) -- the same per-invocation env
// approach Cycle 1 used. With the cap at 1, a turn that needs a tool call plus
// a follow-up response cannot finish and must exit via the graceful cap
// message, NOT an error.
import 'dotenv/config';
import assert from 'node:assert';
import { before, beforeEach, describe, test } from 'node:test';

import { seed } from '../../seed';
import { liveSkipReason, outcome, runTurn, userText } from './harness';

describe('regression suite: iteration cap (AGENT_MAX_ITERATIONS=1)', { skip: liveSkipReason() }, () => {
  before(() => seed());
  beforeEach(() => seed());

  test('a multi-step turn exits gracefully at the cap', { timeout: 60_000 }, async () => {
    assert.equal(process.env.AGENT_MAX_ITERATIONS, '1', 'run via npm run test:regression:cap');

    const { events } = await runTurn({
      messages: [userText('Show me the milk yield for the Kundi group over the last 30 days.')],
    });

    // Iteration 1 spends its single pass on the tool call; the loop then hits
    // the cap and emits the friendly completion instead of erroring.
    assert.equal(outcome(events), 'iteration_cap');
  });
});
