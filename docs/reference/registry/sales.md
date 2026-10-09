# Milk dispatch, buyers and sales

Current reference for `/milk/dispatch`, `/milk/buyers` and buyer statements. [Shared rules](shared-rules.md) define provenance and retry boundaries.

## Destinations and dispatch states

A destination represents where milk goes, including billable buyers and non-sale household/staff use. Activity dates and standing status determine expected answers. Staff destinations name a person, are non-billable, and are unique per staff member; they must not collapse into one aggregate staff row.

| State | Meaning |
|---|---|
| No row | Dispatch answer is missing |
| `taken` | Recorded positive litres; billable dispatch carries its agreed rate |
| `none` | Explicit no milk taken |

Standing destinations require explicit session answers according to the sheet's completeness rules. Occasional destinations do not create automatic zero rows. Preserving explicit `none` versus absent is essential to reconciliation coverage.

## Rates and money

Agreements are effective-dated. A saved dispatch captures `price_minor` and `price_unit_litres`; editing later prices does not recalculate historical transactions. Non-billable destinations cannot carry a billable rate.

`amountMinor = Math.round(litres × priceMinor / unitLitres)`. Money is integer paisa; the lot size has no implicit one-litre default. Example: 12.5 L at Rs 7,000 / 40 L costs Rs 2,187.50. Amounts are derived from saved facts and rounded once at the measurement-to-money boundary.

Buyer balance is the sum of billable dispatch amounts less payment amounts. Cash/bank payments are positive; adjustments are signed and require explanatory notes. Opening balances use explicit adjustments rather than an invented transaction history. Corrections to an agreed opening adjustment should preserve the disagreement through a further adjustment.

## Workflows and corrections

Dispatch uses one draft across local pages with whole-session validation/save. Buyer maintenance can open in a separate tab without discarding that draft. Statements retain rates, source context and payment history; browsing requires no recording session. Browser printing expands all loaded deliveries, payments and agreed rates, includes monthly totals, repeats buyer identity and column context, and excludes navigation/payment-entry controls. Screen pagination is restored after printing. Use A4 portrait at 100% scale; Safari output was checked with 35 deliveries and 30 payments. See [acceptance status](../ui/acceptance-status.md) for evidence and print limitations.

Older effective dispatch/payment rows can be corrected or removed under domain rules; they do not yet have a generic immutable revision trail. Process-local request replay differs from Feed/Health durability. Do not extend one domain's guarantee to another.

## Reconciliation

Measured production minus recorded dispatch is a signed difference, not proof of loss, waste, theft or stock. Separate sold and non-sale litres; preserve missing/partial production and standing-dispatch coverage. [Analytics](analytics.md) owns qualified dashboard calculations. Staff allowance versus collection belongs to [payroll](payroll.md), not an automatic buyer bill.

## Interfaces and limits

Sources: [destinations.ts](../../../server/src/registry/destinations.ts), [dispatch.ts](../../../server/src/registry/dispatch.ts), [ledger.ts](../../../server/src/registry/ledger.ts), [money.ts](../../../server/src/registry/money.ts) and [routes.ts](../../../server/src/registry/routes.ts). Sales assistant reads are documented in [tools](../integrations/assistant-tools.md).

No structured tank carryover or automatic loss inference is established. Revision-history work remains in [OPEN](../../OPEN.md). The [sales record](../../records/REGISTRY_SALES.md) preserves migration DDL, original decisions and delivery evidence.
