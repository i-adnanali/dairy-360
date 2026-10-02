# Animals and calving

Current reference for animal identity, effective lifecycle events and derived herd state. [Shared rules](shared-rules.md) define time, provenance and retry boundaries.

## Model and invariants

`registry_animals` holds identity; `registry_animal_events` holds source history. Status, parentage and lactations are projections rebuilt from effective events. Superseded events remain available for provenance. Serial allocation is durable and independent of editable tag/name text.

Animal events are append-only. Per-connection SQLite configuration and triggers participate in that guarantee; opening a new connection must preserve the required settings. Corrections append superseding facts rather than rewriting original history. Identity corrections follow their separate domain path.

Calving is a transaction: the dam's calving, calf identity or eligible existing calf link, birth history, parentage and projections must agree atomically. A stillborn calf still has an identity and birth event and the calving still contributes to parity/lactation history. The link picker exposes ineligible candidates with reasons; server validation rechecks eligibility at save time.

Changing a calving date uses the coupled correction operation so the dam and calf histories cannot diverge. Existing milk measurements retain animal/date identity rather than a fragile lactation projection ID. Event ordering is canonical, not dependent on insertion order.

## Time and display

Birth, acquisition and historical events retain exact/month/year precision and estimation. Display truncates to recorded precision instead of presenting synthetic January/first-day dates as known facts. Calving intervals qualify approximate history separately; do not pool measured and uncertain intervals into an unqualified mean.

The current projection uses an 18-month provisional calf threshold; other life-stage transitions are event-driven. Calving validation includes the domain gestation floor and duplicate-entry protections. Supported overrides must preserve their reason/provenance; the gestation floor is not silently bypassed by presentation code.

## Workflows

Herd search and filters lead to animal identity and history. Animal detail combines identity and readable effective event history while retaining correction/source access. Calving entry queries eligible calves rather than asking the operator to guess whether an identity exists. Precision-aware before/after summaries support correction review.

Reads work without a recording session; writes retain recorder/source and target safeguards. Drafts, refusals and recovery follow [application interactions](../ui/application-interactions.md). Health and feed participation link to their independent domain records. [Life reports](health.md) combine recorded facts without inferring profitability or medical conclusions.

## Interfaces and source

- [entry.ts](../../../server/src/registry/entry.ts): identity operations.
- [calving.ts](../../../server/src/registry/calving.ts): calving transaction and validation.
- [project.ts](../../../server/src/registry/project.ts): effective-history projection.
- [routes.ts](../../../server/src/registry/routes.ts): HTTP requests, validation and error mapping.
- [CLI guide](../../guides/registry-cli.md): explicit add/event/calving/correction/rebuild commands.

The API returns superseded history where needed and structured errors rather than hiding invalid candidates or fabricating missing values. [Check](../../OPEN.md) and source invariant tests distinguish hard violations from incomplete history.

## Limits and evidence

Real backfill and the five-animal operator trial are not declared complete. No current database contents are inferred from old empty-registry checks. Original decisions, event taxonomy and migration DDL are preserved in [the registry record](../../records/REGISTRY.md); current schema/types remain executable authority for field-level constraints.
