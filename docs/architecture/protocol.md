# Assistant streaming protocol

Current reference for `POST /api/agent/run`. Sources: [server route](../../server/src/index.ts), [stream loop](../../server/src/agent/stream.ts), [shared contracts](../../shared/src/types.ts), and [client store](../../web-angular/src/app/core/chat-store.ts).

## Request and ownership

The client uses `@ag-ui/client` `HttpAgent`. Each request carries AG-UI run/thread identifiers and `forwardedProps` containing opaque Anthropic messages and optional approvals. Approvals identify `toolUseId` and the boolean decision. The client owns history between runs; the server processes the supplied history for that run.

## Event contract

| Event | Consumer meaning |
|---|---|
| `RUN_STARTED` | A run began, not evidence of a write |
| `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END` | Assemble streamed assistant text |
| `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END` | Assemble tool identity and arguments |
| `TOOL_CALL_RESULT` | Tool result; update the matching call, including calls created before a resume |
| CUSTOM `agent.selection` | Dairy/vendor/both selection for the turn |
| CUSTOM `agent.dataset` | Display dataset, separate from model digest |
| CUSTOM `agent.messages` | Updated opaque model history for subsequent requests |
| CUSTOM `agent.pending` | Proposed write cards requiring operator decisions |
| `RUN_FINISHED` | Run ended normally or paused; does not itself mean execution success |
| `RUN_ERROR` | Run failure; do not invent a successful write result |

Use shared event constants rather than duplicating string literals. Historical `dairy.*` names in migration records are not the current event contract.

## Approval and resume

An unresolved write emits pending cards and ends with plain `RUN_FINISHED`. The application does not use the standard AG-UI interrupt/resume array; it resumes through a fresh run carrying `forwardedProps.approvals` and the unchanged pre-write history. This avoids the client interrupt-state requirement for a different resume shape.

The frontend collects all decisions in a pending batch before resuming. The server reuses the pending tool calls, guards identifiers again and executes approved calls; rejected calls yield declined results. Reads may execute again for model context. A resumed result can update a tool chip from the preceding run without a new start event.

Approval is distinct from a successful result. A dropped connection can leave execution uncertain. There is no durable cross-request replay store for assistant writes; do not apply registry exact-request retry promises to this transport.

## Data shaping and errors

Executors return a model digest and optional display dataset. Only the digest goes into model tool results. Client charts receive datasets over the custom channel. Structured read errors can be shown to the model for recovery. Mid-stream failures are not blindly retried with a fallback model; fallback is restricted to eligible failures before content has streamed.

## History and validation

`POST /api/chat` and the React client are retired. The original transport choices and reversal are preserved in [the migration record](../records/AGUI_MIGRATION.md). [Testing](../guides/testing.md) distinguishes unit coverage, synthetic browser behavior and live executor acceptance.
