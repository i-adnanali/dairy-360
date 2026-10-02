# Registry HTTP surface

Current reference for the route table checked by `registry.routes.test.ts`. All paths below are relative to `/api/registry` where indicated. [Shared rules](shared-rules.md) qualify domain-specific retry and revision handling; Feed and Health durable keys are exceptions to older process-local behavior.

## HTTP surface

Mounted at `/api/registry` on the real server ([index.ts](../../../server/src/index.ts)), outside the `isSeeded()` guard — the registry has nothing to do with the demo seed, and an unseeded database is the normal state for a machine that only enters herd records.

| | Route | |
|---|---|---|
| GET | `/analytics/overview` | full-period milk metrics, coverage, chart buckets and paginated detail; see [Analytics](analytics.md) |
| GET | `/analytics/production` | production-oriented analytics response with paginated animals |
| GET | `/analytics/reconciliation` | reconciliation-oriented analytics response with paginated sessions |
| GET | `/lists/:kind` | paginated animals, calvings, destinations or people; catalogs retain their original endpoints |
| GET | `/animals` | herd table: identity + derived status + effective event count |
| GET | `/animals/:id` | one animal, its status, and its **full** event list |
| GET | `/animals/:id/calvings` | the correction picker's source |
| GET | `/animals/:id/milkings` | one animal's yield, each row's lactation **derived** rather than stored |
| GET | `/link-candidates?dam=&calf_sex=&occurred_on=&date_precision=` | link-mode picker |
| GET | `/dam-candidates` | females, departed ones marked |
| GET | `/duplicate-candidates?name=&post_no=&tag_no=&sex=&exclude_id=` | near-duplicate animals; a soft signal no write consults |
| GET | `/identifier-values` | previously-used `observed_by` / `acquired_from` / `sire_ref`, for the datalists |
| GET | `/milking/roster?on=&session=` | who was in milk on that date, with days-in-milk and the comparable session |
| GET | `/destinations?as_of=` | who milk goes to, with the price in force on that date |
| GET | `/destinations/:id` | one buyer's statement: months, running balance, price history |
| GET | `/balances` | balances for the billable destinations; home is absent, not zero |
| GET | `/dispatch/sheet?on=&session=` | the daily sheet, split into standing and occasional |
| GET | `/reconcile?from=&to=` | produced against dispatched; `gap_pct` is null when production is incomplete |
| GET | `/today?on=` | the day board: which sessions and which payroll month still need recording |
| GET | `/people?as_of=` | everybody on file, with what is owed; people with no open stint are flagged, not hidden |
| GET | `/people/:id?as_of=` | one person's statement: stints, package, wage periods, payments, balance |
| GET | `/engagements/:id/terms` | the package history for one stint, benefits included |
| GET | `/payroll/run?from=&to=` | the run: who must be answered, and which dihari days are already in |
| GET | `/storage` | which database this router writes to |
| GET | `/verification?as_of=` | invariants, histogram, intervals, milk completeness, and the labour report |
| POST | `/animals` | `addAcquiredAnimal` |
| POST | `/events` | `appendLifeEvent` |
| POST | `/calvings` | `recordCalving` — `calf_id` present means link mode |
| POST | `/calvings/:eventId/correction` | `correctCalving` |
| POST | `/milking/session` | one whole session, all rows or none |
| POST | `/milking/session/delete` | remove a session, or one animal's row in it |
| POST | `/destinations` | `addDestination` |
| POST | `/destinations/:id` | `updateDestination` — amend in place; `kind`, `billable` and `started_on` are not amendable |
| POST | `/destinations/:id/prices` | `setPrice` — a new agreement from a date; the lot size is required |
| POST | `/dispatch/session` | one whole session, all rows or none |
| POST | `/dispatch/session/delete` | remove a session, or one destination's row in it |
| POST | `/payments` | `recordPayment` — only an `adjustment` may be signed, and it must say why |
| POST | `/payments/:id/delete` | remove one payment, by id |
| POST | `/people` | `addPerson` — the identifier is set here and is never amendable |
| POST | `/people/:id` | `updatePerson` — name and contact only; `identifier` is accepted so it can be refused with an explanation |
| POST | `/people/:id/engagements` | `addEngagement` — overlapping an existing stint is deliberately not refused |
| POST | `/engagements/:id` | `updateEngagement` — amend the role, or close the stint |
| POST | `/engagements/:id/terms` | `setTerm` — a new package from a date, its in-kind lines included |
| POST | `/terms/:id/correct` | `correctTerm` — for a figure typed wrong and caught immediately |
| POST | `/payroll/run` | one whole run, all rows or none; every salaried engagement in the period must have a figure |
| POST | `/payroll/run/delete` | remove wage periods by explicit id |
| POST | `/wage-payments` | `recordWagePayment` — only an `adjustment` may be signed, and it must say why |
| POST | `/wage-payments/:id/delete` | remove one wage payment, by id |
| POST | `/rebuild` | `registry:rebuild` |
| GET | `/feed/recipients` | Date-specific herd and milking recipient suggestions |
| GET | `/feed/history` | Date-range daily coverage |
| GET | `/feed/overview` | Recorded costs, quantities and feeding coverage |
| GET | `/feed/daily/on/:on` | One effective summary by local date |
| GET | `/feed/items` | List records |
| GET | `/feed/items/:id` | Review record |
| GET | `/feed/items/:id/revisions` | Recoverable correction history |
| POST | `/feed/items` | Create with provenance and revision 0 |
| POST | `/feed/items/:id` | Correct with expected revision |
| POST | `/feed/items/:id/delete` | Remove with reference protection; identities refuse and use archive instead |
| GET | `/feed/crops` | List records |
| GET | `/feed/crops/:id` | Review record |
| GET | `/feed/crops/:id/revisions` | Recoverable correction history |
| POST | `/feed/crops` | Create with provenance and revision 0 |
| POST | `/feed/crops/:id` | Correct with expected revision |
| POST | `/feed/crops/:id/delete` | Remove with reference protection; identities refuse and use archive instead |
| GET | `/feed/expenses` | List records |
| GET | `/feed/expenses/:id` | Review record |
| GET | `/feed/expenses/:id/revisions` | Recoverable correction history |
| POST | `/feed/expenses` | Create with provenance and revision 0 |
| POST | `/feed/expenses/:id` | Correct with expected revision |
| POST | `/feed/expenses/:id/delete` | Remove with reference protection; identities refuse and use archive instead |
| GET | `/feed/purchases` | List records |
| GET | `/feed/purchases/:id` | Review record |
| GET | `/feed/purchases/:id/revisions` | Recoverable correction history |
| POST | `/feed/purchases` | Create with provenance and revision 0 |
| POST | `/feed/purchases/:id` | Correct with expected revision |
| POST | `/feed/purchases/:id/delete` | Remove with reference protection; identities refuse and use archive instead |
| GET | `/feed/daily` | List records |
| GET | `/feed/daily/:id` | Review record |
| GET | `/feed/daily/:id/revisions` | Recoverable correction history |
| POST | `/feed/daily` | Create with provenance and revision 0 |
| POST | `/feed/daily/:id` | Correct with expected revision |
| POST | `/feed/daily/:id/delete` | Remove with reference protection; identities refuse and use archive instead |


## Requests and errors

`registryRouter(db)` takes an explicit database handle so the memory harness and persistent app use the same route definitions. Writes except rebuild require request keys and provenance. See [shared rules](shared-rules.md#corrections-and-retry-guarantees) for process-local versus durable replay and Feed/Health revision handling.

`GET /storage` identifies the storage target; it does not authenticate an operator. Event reads retain superseded records for history. Calf-candidate reads expose eligible and ineligible candidates with reasons, and `recordCalving` independently rechecks the same rules on save. Domain errors map to structured HTTP responses so clients preserve input and name the refusal.

Health routes are mounted separately; their record, revision and attachment contracts are described in [Health](health.md#interfaces) and implemented in [health-routes.ts](../../../server/src/registry/health-routes.ts). The root route-table test does not claim exhaustive nested Health route documentation coverage.

The [original registry record](../../records/REGISTRY.md#http-surface) preserves historical protocol rationale. Executable source owns detailed payload schemas.
