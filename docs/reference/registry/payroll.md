# People and payroll

Current reference for `/labour/people`, person statements and `/labour/payroll`. Navigation, Today and recording-session behavior are defined in [application interactions](../ui/application-interactions.md), not owned by payroll.

## Entities and terms

A person, an employment stint and a pay package are separate records. A person can return in another engagement; overlaps are reviewable without silently merging identities. Engagements distinguish permanent and daily work. Effective-dated terms define cash amount/period and in-kind benefit rows. A later agreement must not rewrite the past.

Milk, flour, accommodation and other benefits remain quantities/terms, not invented monetary values. There is no stored imputed value column. Recorder/witness names in older observations do not become foreign keys to employment identities.

## Wages and payments

Wage periods belong to engagements and store the actual recorded earned amount. Suggested amounts from terms are aids, not proof that wages were paid. Wage-period overlaps are invalid; an engagement overlap is a separate review concern. Bonuses use their supported kind and date contract.

Payments belong to a person, allowing one handover to settle multiple engagements. Balance is `sum(wage period amounts) − sum(payment amounts)` across that person's engagements. Positive means the farm owes the person. Cash/bank payments must be positive. Adjustments are signed with a note; deductions reduce the balance through an adjustment rather than a fictitious negative wage.

Money is integer minor units. Dates are exact operational dates; animal-history precision does not apply. Saved wage amounts are authoritative rather than recomputed from today's package. [money.ts](../../../server/src/registry/money.ts) owns suggestion arithmetic and rounding.

## Milk allowances

Each staff member's milk destination is non-billable and linked to that person. Dispatch records are the actual milk taken; the package states entitlement. Payroll reads those records without copying them. Comparison must distinguish an elapsed period from a full-month allowance.

Excess taken is not automatically charged as a buyer sale. Any agreed wage adjustment is explicit and documented. Do not infer a financial value for other in-kind benefits or silently net them against cash.

## Workflows and persistence

People lists prioritize identity, engagement and balance; person detail makes payment actions available before lengthy history. Payroll recording and payment are clearly separate actions. Session forms retain drafts and hidden-page validation, and refusals retain values.

Migrations 6–7 introduced the labour tables and staff-destination link. Older mutable wage/payment records do not have Feed/Health-style immutable revision history. Corrections/removals and process-local retry handling retain their existing domain boundaries. Source/witness fields are not identical on wage periods and payments; do not invent missing provenance columns.

## Interfaces and limits

Sources: [people.ts](../../../server/src/registry/people.ts), [payroll.ts](../../../server/src/registry/payroll.ts), [routes.ts](../../../server/src/registry/routes.ts), [schema.ts](../../../server/src/registry/schema.ts). Leave/absence policy remains deferred. Operator practice questions and acceptance are tracked in [OPEN](../../OPEN.md).

The [payroll record](../../records/REGISTRY_PAYROLL.md) preserves the detailed original model, migration DDL and worked reasoning. Its application-wide navigation sections are historical context; the current interaction reference owns that behavior.
