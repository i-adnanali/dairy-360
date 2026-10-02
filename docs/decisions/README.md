# Architecture decisions

This index exposes established decisions without rewriting their original rationale or assigning retrospective approval dates. New substantial decisions should state context, alternatives, chosen behavior, consequences, status and supersession links in a focused record.

| Decision | Current contract | Original rationale |
|---|---|---|
| Registry/demo data boundary | [System](../architecture/system.md) | [Registry record](../records/REGISTRY.md#the-demo--registry-fork) |
| Event source versus projections | [Shared rules](../reference/registry/shared-rules.md) | [Projection decision](../records/REGISTRY.md#decision-4--source-of-truth-and-the-projection-rule) |
| Stateless approval and streaming resume | [Protocol](../architecture/protocol.md) | [AG-UI decisions](../records/AGUI_MIGRATION.md) |
| One Angular frontend; retired React transport | [Frontend](../architecture/frontend.md) | [Retirement](../records/AGUI_MIGRATION.md#section-3---react-frontend-and-apichat-archived) |
| Domain routing in one process | [Assistant](../architecture/assistant.md) | [Multi-agent decision](../records/MULTI_AGENT.md) |
| Preserve uncertainty and precision | [UI](../reference/ui/design-system.md) | [Original certainty vocabulary](../records/UI_SYSTEM.md#6-the-certainty-vocabulary--built-in-phase-5) |
| Saved rates, quantities and recipient snapshots | [Registry references](../reference/registry/README.md) | [Sales](../records/REGISTRY_SALES.md), [Feed](../records/REGISTRY_FEED.md) |
| Authentication deferred | [System limits](../architecture/system.md#limits-and-evidence) | [Unapproved brainstorm](../records/AUTH_HANDOFF.md) |

These are navigation links into preserved decisions, not a claim that every old proposal was implemented unchanged.
