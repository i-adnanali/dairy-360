// Regression suite harness (Cycle 3; see docs/REGRESSION.md).
//
// Drives the REAL agent loop -- the same runAgentStream() the live server calls
// from POST /api/agent/run -- with an `emit` that captures AG-UI events into an
// array instead of writing them to an SSE response. The extractors below then
// read back what happened (dispatcher selection, tool calls + args, tool
// results, pending write cards, datasets) so tests can assert on tool-call
// sequences and outcomes rather than the assistant's exact wording.
//
// This is deliberately NOT a parallel re-implementation of the loop: it calls
// the production function directly, so a change to the loop that breaks a
// scenario surfaces here.

import { randomUUID } from 'node:crypto';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentKind, Approval, Dataset, PendingWrite } from '@dairy/shared';
import {
  AGENT_DATASET_EVENT,
  AGENT_MESSAGES_EVENT,
  AGENT_PENDING_EVENT,
  AGENT_SELECTION_EVENT,
} from '@dairy/shared';
import { ITERATION_CAP_MESSAGE, runAgentStream } from '../stream';

/** Captured AG-UI event. The AG-UI union is wide and field access is dynamic
 * here, so we widen to a record for read-back convenience. */
export type CapturedEvent = BaseEvent & Record<string, unknown>;

export interface RunResult {
  events: CapturedEvent[];
}

/** Send one turn through the real loop, capturing every emitted event. */
export async function runTurn(opts: {
  messages: Anthropic.MessageParam[];
  approvals?: Approval[];
}): Promise<RunResult> {
  const events: CapturedEvent[] = [];
  await runAgentStream({
    threadId: `thread_${randomUUID()}`,
    runId: `run_${randomUUID()}`,
    messages: opts.messages,
    approvals: opts.approvals,
    emit: (e) => {
      events.push(e as CapturedEvent);
    },
  });
  return { events };
}

/** A plain user-typed turn. */
export function userText(text: string): Anthropic.MessageParam {
  return { role: 'user', content: text };
}

// --- extractors -------------------------------------------------------------

/** Most recent CUSTOM event value by name (selection/messages/pending/dataset
 * are all CUSTOM events). */
function latestCustom(events: CapturedEvent[], name: string): unknown {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === EventType.CUSTOM && e.name === name) return e.value;
  }
  return undefined;
}

/** Which agent the dispatcher routed this turn to (dairy | vendor | both). */
export function selection(events: CapturedEvent[]): AgentKind | undefined {
  return latestCustom(events, AGENT_SELECTION_EVENT) as AgentKind | undefined;
}

/** The final opaque message history the server emits for the client to resend.
 * Carries the assistant tool_use blocks (with full args) and tool_result
 * blocks, so we read tool calls/results from here rather than reassembling
 * streamed deltas. */
export function finalHistory(events: CapturedEvent[]): Anthropic.MessageParam[] {
  return (latestCustom(events, AGENT_MESSAGES_EVENT) as Anthropic.MessageParam[]) ?? [];
}

/** Pending write cards emitted when the run pauses for approval. */
export function pendingCards(events: CapturedEvent[]): PendingWrite[] {
  return (latestCustom(events, AGENT_PENDING_EVENT) as PendingWrite[]) ?? [];
}

/** Chart datasets emitted for read tools that produce a time series. */
export function datasets(events: CapturedEvent[]): Dataset[] {
  return events
    .filter((e) => e.type === EventType.CUSTOM && e.name === AGENT_DATASET_EVENT)
    .map((e) => e.value as Dataset);
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Every tool the model actually called this turn, in order, with its args. */
export function toolCalls(events: CapturedEvent[]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const m of finalHistory(events)) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content as Anthropic.ContentBlock[]) {
      if (b.type === 'tool_use') {
        out.push({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
      }
    }
  }
  return out;
}

export interface ToolResult {
  toolUseId: string;
  content: unknown; // parsed JSON digest the tool returned
  isError: boolean;
}

/** Every tool result appended to the conversation, with the digest parsed. */
export function toolResults(events: CapturedEvent[]): ToolResult[] {
  const out: ToolResult[] = [];
  for (const m of finalHistory(events)) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content as Anthropic.ToolResultBlockParam[]) {
      if (b.type === 'tool_result') {
        let parsed: unknown = b.content;
        if (typeof b.content === 'string') {
          try {
            parsed = JSON.parse(b.content);
          } catch {
            parsed = b.content;
          }
        }
        out.push({ toolUseId: b.tool_use_id, content: parsed, isError: !!b.is_error });
      }
    }
  }
  return out;
}

/** The parsed result digest for the first call of `toolName`, if any. */
export function resultFor(events: CapturedEvent[], toolName: string): ToolResult | undefined {
  const call = toolCalls(events).find((c) => c.name === toolName);
  if (!call) return undefined;
  return toolResults(events).find((r) => r.toolUseId === call.id);
}

export type Outcome = 'completed' | 'awaiting_approval' | 'iteration_cap' | 'error' | 'unknown';

/** The finish-reason-equivalent outcome, derived from the event stream (the
 * real finish_reason lives in trace metadata, not an AG-UI event). Mirrors the
 * three FinishReason exits in stream.ts plus the route-less error case. */
export function outcome(events: CapturedEvent[]): Outcome {
  if (events.some((e) => e.type === EventType.RUN_ERROR)) return 'error';
  if (pendingCards(events).length > 0) return 'awaiting_approval';
  const hist = finalHistory(events);
  const last = hist[hist.length - 1];
  if (last && last.role === 'assistant' && last.content === ITERATION_CAP_MESSAGE) {
    return 'iteration_cap';
  }
  if (events.some((e) => e.type === EventType.RUN_FINISHED)) return 'completed';
  return 'unknown';
}

/** The code on a RUN_ERROR event, if the run errored. */
export function errorCode(events: CapturedEvent[]): string | undefined {
  const e = events.find((x) => x.type === EventType.RUN_ERROR);
  return e?.code as string | undefined;
}

/** Skip reason for the live suite: it needs an explicit opt-in (RUN_REGRESSION,
 * set by the npm run test:regression scripts) so the plain `npm test` unit run
 * never spends tokens, and an API key. Absent either, the suite skips visibly
 * -- the same degrade-gracefully convention as GET /api/health. */
export function liveSkipReason(): string | undefined {
  if (!process.env.RUN_REGRESSION) {
    return 'set RUN_REGRESSION=1 (npm run test:regression -w server) to run the live suite';
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return 'ANTHROPIC_API_KEY not set — live regression suite skipped';
  }
  return undefined;
}
