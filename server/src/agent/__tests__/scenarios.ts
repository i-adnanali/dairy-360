// Golden dataset (Cycle 3; see docs/REGRESSION.md).
//
// Scoped narrowly to what got riskier by going multi-agent (Cycle 2): the
// dispatcher can route a turn to the wrong agent, and a coordination bug can
// produce a wrong reconciliation number. Plus the reused Cycle 1 Phase 4/5
// cases that fit the direct-runAgentStream harness (chart read, guard
// rejection, write-gate pause + approved resume). Iteration-cap and
// model-fallback live in their own env-variant files (regression.cap.test.ts,
// regression.fallback.test.ts) because they pivot on module-load env.
//
// Prompts assert on tool-call sequences + key args + outcome, never exact text.

import { daysAgo } from '../../seed';
import type { AgentKind } from '@dairy/shared';

/** Dispatcher routing scenarios: does the turn reach the right tool list? The
 * dispatcher (selectAgent) is a deterministic keyword matcher, so these are the
 * low-flake end of the suite. */
export interface DispatchScenario {
  id: string;
  prompt: string;
  expect: AgentKind;
}

export const DISPATCH_SCENARIOS: DispatchScenario[] = [
  {
    id: 'dispatch-dairy-only',
    prompt: 'How much milk did the Kundi group produce over the last week?',
    expect: 'dairy',
  },
  {
    id: 'dispatch-vendor-only',
    prompt: 'What is the outstanding balance owed by Al-Karam Sweets?',
    expect: 'vendor',
  },
  {
    id: 'dispatch-both-recon',
    prompt: 'Is there any discrepancy between the milk we produced and what we delivered this month?',
    expect: 'both',
  },
];

// --- Reconciliation windows -------------------------------------------------
// Derived from the same daysAgo() the seed uses, so they line up exactly with
// the data seed.ts populates. The seed delivers 95-99% of production on normal
// days (within the 5% tolerance) EXCEPT a deliberately-mismatched window 21-30
// days ago where only ~60-70% was delivered.

/** A window entirely in the normal region -> produced vs delivered within
 * tolerance -> flagged:false. */
export const MATCHED_WINDOW = { from: daysAgo(14), to: daysAgo(1) };

/** The deliberately-mismatched window -> gap well beyond tolerance ->
 * flagged:true with a large discrepancyLitres. */
export const MISMATCHED_WINDOW = { from: daysAgo(30), to: daysAgo(21) };
