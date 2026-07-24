// Regression suite -- model fallback path (Cycle 3; see docs/REGRESSION.md).
//
// Reused Cycle 1 Phase 5 case. DEFAULT_MODEL is read once at stream.ts module
// load, so this runs in its own process with ANTHROPIC_MODEL set to a
// nonexistent model at launch (npm run test:regression:fallback). The first
// call 404s before emitting anything, and streamWithFallback retries on the
// latest Sonnet -- so the turn still completes rather than erroring.
import 'dotenv/config';
import assert from 'node:assert';
import { before, beforeEach, describe, test } from 'node:test';

import { seed } from '../../seed';
import { liveSkipReason, outcome, runTurn, userText } from './harness';

describe('regression suite: model fallback (bad ANTHROPIC_MODEL)', { skip: liveSkipReason() }, () => {
  before(() => seed());
  beforeEach(() => seed());

  test('a rejected primary model falls back and the turn completes', { timeout: 60_000 }, async () => {
    assert.match(
      process.env.ANTHROPIC_MODEL ?? '',
      /not-a-real-model/,
      'run via npm run test:regression:fallback',
    );

    const { events } = await runTurn({
      messages: [userText('In one short sentence, what can you help me with?')],
    });

    // The primary 404s with nothing emitted yet -> fallback model handles it.
    assert.equal(outcome(events), 'completed');
  });
});
