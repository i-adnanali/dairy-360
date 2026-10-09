# Frontend architecture

Current reference. Angular 22 uses standalone components, signals and explicit zoneless change detection. The registry workspace and assistant share presentation primitives, while maintaining separate request and state models.

## Shell and navigation

[app.routes.ts](../../web-angular/src/app/app.routes.ts) declares the routed workspace. [navigation.ts](../../web-angular/src/app/registry/navigation.ts) supplies the shared hierarchy for desktop, mobile and command navigation. The shell owns theme, recording/storage context and assistant presentation. [Application interactions](../reference/ui/application-interactions.md) defines navigation, focus and draft behavior.

## Registry state

Registry components use the HTTP client and [api.ts](../../web-angular/src/app/registry/api.ts). Forms retain native controls, session provenance, local draft state and write guards. Read-list filters and pagination are reflected in URL state where supported. Server responses own calculated metrics, resolved analytics periods and conflict outcomes. Presentation adapters do not recalculate business rules independently.

[form-state.ts](../../web-angular/src/app/registry/form-state.ts) handles form lifecycle; domain-specific behavior remains in the owning screen. Session context does not authenticate a user. Unknown/pending writes retain their exact request and lock conflicting edits.

## Assistant state

[ChatStore](../../web-angular/src/app/core/chat-store.ts) owns opaque model messages, rendered turns, pending cards, loading/error signals, operator decisions and streaming buffers. The opaque model history is separate from the visible transcript and chart datasets.

- `send` ignores new submissions while busy, appends the user message and opens a run.
- `resolve` records each pending card decision once locally. It queues decisions until every card in the batch is resolved, then resumes with the unchanged history and collected approvals.
- `handleEvent` maps streamed text, tool calls, results and `agent.*` events into signals.
- Approval receipts retain the operator decision; tool-result handling determines success, rejection or error. Client deduplication is not a durable server replay guarantee.

The dock/mobile assistant uses shared conversation and composer components. Contextual prompts carry screen context without granting authority to mutate registry records. Long responses can expand; technical tool detail remains disclosed. The [protocol](protocol.md) owns event names and payload boundaries.

## Rendering

Markdown passes through `marked` and a DOMPurify allowlist before HTML binding. Charts use Chart.js through `ng2-charts` with shared theme/presentation components. A semantic data table accompanies chart information. Native inputs, labels and table structure remain accessible to browser and keyboard behavior; a screenshot does not prove assistive-technology acceptance.

Styles use semantic roles and the warm palette defined in the [UI reference](../reference/ui/design-system.md). Components should not copy raw palette values to bypass those roles.

## Development and limits

See [development](../guides/development.md) for startup, [testing](../guides/testing.md) for unit/browser boundaries and [acceptance](../reference/ui/acceptance-status.md) for performed checks. No persistent browser draft store is implied by local form retention. React and the blocking `/api/chat` transport are retired; their comparison belongs to the [port record](../records/ANGULAR_PORT.md).
