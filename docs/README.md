# Documentation index

Two kinds of document live here, and they have opposite lifecycles.

- **Reference** describes what is true *now*. If it disagrees with the code, the
  code is right and the document is stale — fix the document.
- **Record** describes what was decided *then*, and why. Each one is closed and
  tied to a git tag. Do not edit a closed record to reflect later changes; the
  later change gets its own record, and the older one gets a banner pointing at it.

Everything in [`archive/`](archive/) is superseded and kept only for its reasoning.
Nothing there describes anything that currently exists.

---

## Start here

| If you want to… | Read |
|---|---|
| Run it locally, or fix a broken setup | [DEVELOPMENT.md](DEVELOPMENT.md) |
| Understand how the system fits together | [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) |
| Understand the agent loop, guardrails, tool contracts | [TECHNICAL.md](TECHNICAL.md) |
| Work on the real-animal records | [REGISTRY.md](REGISTRY.md) |
| Work on milk sales, home use, buyer balances | [REGISTRY_SALES.md](REGISTRY_SALES.md) |
| Work on employees, packages and wages | [REGISTRY_PAYROLL.md](REGISTRY_PAYROLL.md) |
| Work on the frontend | [ANGULAR_PORT.md](ANGULAR_PORT.md) |
| Find out why a URL looks the way it does, or what `/` shows | [REGISTRY_PAYROLL.md §12.3–§12.6](REGISTRY_PAYROLL.md#123-navigation-and-url-structure--the-change-that-forced-both-decisions) |
| Change the wire protocol | [AGUI_MIGRATION.md](AGUI_MIGRATION.md) |
| Know what is still unfinished | [OPEN.md](OPEN.md) |

---

## Reference — keep these current

| Doc | Covers | Depth |
|---|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Prereqs, the two `.env` files, build, test, the harness/real loop split, backups, fresh-clone walkthrough, common failures | Every command verified against a real run; unverifiable claims are marked **UNVERIFIED** |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | Architecture, the agentic workflow end to end, read/write split, digest-vs-dataset, guardrails, data model, wire contract | Medium — the layer between the root [README](../README.md) and TECHNICAL.md |
| [TECHNICAL.md](TECHNICAL.md) | The loop internals, the eight guardrails, tool contracts, constants | Deep. Highest signal-per-line here |
| [ANGULAR_PORT.md](ANGULAR_PORT.md) | Angular 22 state service, component tree, the deliberate omissions | Deep |
| [AGUI_MIGRATION.md](AGUI_MIGRATION.md) | The AG-UI/SSE protocol, custom event channels, the interrupt/resume boundary, the React archival decision | Deep |
| [REGISTRY.md](REGISTRY.md) | Real-animal records: schema, migrations, append-only guarantee, calving transaction, projections, CLI, HTTP surface, entry UI, invariants | Deep. The single most load-bearing document in the repo |
| [REGISTRY_ENTRY_UX.md](REGISTRY_ENTRY_UX.md) | The entry surface — screens, the change list with build status, the defaults rule, the five-animal trial | Deep |
| [UI_SYSTEM.md](UI_SYSTEM.md) | The design system: token vocabulary, the certainty axis, fifteen primitives, dark mode, the seven phases. Phases 0–2 built; 3–7 unstarted | Deep. Read the status line first — five counts in the body are superseded |
| [REGISTRY_MILKING.md](REGISTRY_MILKING.md) | Per-animal milk yield: the four row states, session/time model, migration 3, the `/milk/milking` roster | Deep |
| [REGISTRY_SALES.md](REGISTRY_SALES.md) | Milk sales, home use and the buyer ledger: destinations, effective-dated prices in 40-litre lots, the daily dispatch sheet, the reconciliation, migrations 4–5 | Deep |
| [REGISTRY_PAYROLL.md](REGISTRY_PAYROLL.md) | Labour: people and engagements, effective-dated packages with in-kind benefits, dihari, the monthly run, the wage ledger, migrations 6–7. Also §12.3–§12.6: the URL structure, the day board at `/`, and why reads need no recording session | Deep |
| [FARM_EVENTS.md](FARM_EVENTS.md) | Camera-event ingestion: the real Frigate and Double Take payload shapes, normalization, the `farm_events` model | Deep. Cited from `payloadShape.ts`, `db.ts`, `shared/types.ts` |

`FARM_EVENTS.md` is also a Cycle 4 record. It is listed here because its payload
contract is still the live specification, not history.

---

## Record — closed, one per cycle

Each maps to a git tag. Read them for *why*, not for *what is true now*.

| Cycle | Doc | Tag | Subject |
|---|---|---|---|
| 1 | [OBSERVABILITY.md](OBSERVABILITY.md) | `v0.4.0` | Langfuse tracing over the agent loop |
| 2 | [MULTI_AGENT.md](MULTI_AGENT.md) | `v0.5.0` | Two agents, one process, a keyword dispatcher, reconciliation |
| 3 | [REGRESSION.md](REGRESSION.md) | `v0.6.0` | Live-model eval suite, 12 scenarios, CI wiring |
| 4 | [FARM_EVENTS.md](FARM_EVENTS.md) | `v0.7.0` | Ingestion, real payload shapes, the scenario generator |
| 5 | [FARM_MONITOR.md](FARM_MONITOR.md) | `v0.8.0` | Deterministic classification, thresholds, `FARM_TZ` |
| 6 | *(no document)* | — | Live-model tool-selection testing; never written up |
| 7 · step 1 | [cycle-7-live-camera-validation.md](cycle-7-live-camera-validation.md) | `v0.9.0` | Live Frigate camera, payload deltas measured against Cycle 4's assumptions |
| 7 · FU-3 | [Cycle7-fu3-double-take-validation.md](Cycle7-fu3-double-take-validation.md) | `v0.10.0` | Double Take + DeepStack on arm64, three blocking issues resolved |
| 8 | [REGISTRY.md](REGISTRY.md) | `v0.11.0`, `v0.11.1` | The animal registry: schema, calving transaction, HTTP surface (also reference — see above) |
| 8 · entry | [REGISTRY_ENTRY_UX.md](REGISTRY_ENTRY_UX.md) | `v0.12.0`…`v0.15.0` | The entry surface, built in three passes. Items 7–9 and 6b are still below the cut line |
| 8 · yield | [REGISTRY_MILKING.md](REGISTRY_MILKING.md) | untagged (`46d29c7`) | Per-animal milk yield, migration 3 |
| 9 | [REGISTRY_TOOLS.md](REGISTRY_TOOLS.md) | untagged (`f3262d7`) | Registry read tools for the agent, and the six evals that matter |
| — · sales | [REGISTRY_SALES.md](REGISTRY_SALES.md) | untagged | Milk sales, home use and the buyer ledger, migrations 4–5 (also reference — see above) |
| — · labour | [REGISTRY_PAYROLL.md](REGISTRY_PAYROLL.md) | untagged | People, packages, dihari and the wage ledger, migrations 6–7 (also reference — see above) |

**Neither [REGISTRY_SALES.md](REGISTRY_SALES.md) nor
[REGISTRY_PAYROLL.md](REGISTRY_PAYROLL.md) has a cycle number, on purpose.** The registry's step
numbering is about the animal record. The sales tables were the first with no `animal_id` in them;
the labour tables hang off neither an animal nor a counterparty but off a person the farm employs.
Three axes, which the step numbering should not absorb. The last section of each is the part worth
reading twice — seven things building sales changed about its plan, six for labour, and in both
cases the most expensive one was a fixture that looked right on screen and was wrong in the data.

[cycle-7-followups.md](cycle-7-followups.md) sits deliberately outside the table.
It holds the six findings (FU-1…FU-6) that came out of Cycle 7 and were *not*
fixed in the slice that found them. It is open work, not a closed record — which
is why it is a separate file from the two Cycle 7 validation documents, both of
which are closed.

---

## Archive — superseded, do not implement from

| Doc | Superseded by |
|---|---|
| [archive/ANIMAL_REGISTRY_DECISION_DOCUMENT.md](archive/ANIMAL_REGISTRY_DECISION_DOCUMENT.md) | Revision 2 in full; never implemented |
| [archive/ANIMAL_REGISTRY_DECISION_DOCUMENT_V2.md](archive/ANIMAL_REGISTRY_DECISION_DOCUMENT_V2.md) | [REGISTRY.md](REGISTRY.md), which records what was actually built |
| [archive/REGISTRY_UI_REFINEMENT.md](archive/REGISTRY_UI_REFINEMENT.md) | [REGISTRY_ENTRY_UX.md](REGISTRY_ENTRY_UX.md) §11, "Pre-trial amendment" |

---

## Conventions

**Filenames are load-bearing.** Roughly 130 code comments cite documents by path
(`// see docs/FARM_EVENTS.md`) and another ~170 by bare name, across ~40 source
files. Renaming or moving a document means updating those citations in the same
commit, or the reference goes dead silently. That is why the names here are
inconsistent (`SCREAMING_SNAKE`, `cycle-7-...`, `Cycle7-fu3-...`) and why they
have been left that way.

**Every document carries its status in the first ten lines** — complete and
tagged, partially built with the cut line named, or superseded with a banner.
A new document without one is incomplete.

**Records get banners, not edits.** When a later cycle changes something a closed
record describes, the record gets a pointer at the top ("Extended by Cycle 5…")
and keeps its original text. See the top of [FARM_EVENTS.md](FARM_EVENTS.md) for
the pattern.
