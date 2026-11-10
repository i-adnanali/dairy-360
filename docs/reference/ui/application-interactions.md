# Application interaction contracts

Current reference for behavior shared across domains. Individual fields, calculations and write APIs belong to the [domain references](../registry/README.md); how states look belongs to the [design system](design-system.md).

## Navigation

The shell groups Today, Analytics, Herd (Animals, Calvings, Health), Milk (Milking, Dispatch, Buyers), Feed (Overview, Days, Crops, Purchases, Catalogue), Labour (People, Payroll), Monitor and Check. Desktop navigation, the phone Menu and the command palette (`Cmd/Ctrl+K`) expose the same hierarchy from [navigation.ts](../../../web-angular/src/app/registry/navigation.ts). The section bar appears only for sections with views. An address under a section with no view of its own (an animal's page, one feeding day) marks its section's nearest view as current. Unknown routes show a recovery screen instead of silently changing location. Escape closes the phone menu and returns focus to its trigger. The first Tab stop is "Skip to content".

On a same-page navigation that only changes the query (a filter, a period, a session), focus stays where it was; a new page moves focus to its heading.

## Today and the session board

Today (`/`) collects work from every section, ranked by consequence. **Needs you now** holds danger items: overdue health tasks, milk withdrawals, urgent camera events, late sessions and approvals waiting. **Also open** holds due-today tasks, notable camera events, unentered payroll and the day's feeding account. Each item links to the place it is resolved. Side panels summarise milk today (seven-day bars: filled complete, open partial, gap no record), last night's camera events and the herd by stage.

The session board in the header shows today's five sessions as answered over expected. In the evening half, an open morning milking or dispatch becomes **Late** and also appears on Today. One open session is lit **Now**; feeding is never late. The tile for the sheet you have open reads **Viewing**, only when it is today's exact sheet ([session-board.ts](../../../web-angular/src/app/registry/session-board/session-board.ts) `selectedSlotKey`).

## Browsing, recording and target safeguards

Reads never require recording. To save, the operator starts recording from the header: who is typing (a previously used name or a new one) and where the records come from (Direct entry, Daily herd sheet, Cycle card, Recall, Import; never defaulted). The gate also states the storage target in words. Recording lasts until it is stopped from the header or the page reloads; opening the gate keeps the current draft. The recorder is not automatically the witness, prescriber, administrator or milker, and provenance is evidence about a record, not authentication.

The storage chip distinguishes the disposable harness, the persistent registry and an unknown target; styling alone is not a storage guarantee.

## URL state and recovery

Date, session, filter, period and page state belongs in the URL where the screen supports it, and Back restores it. Milk session and date steps replace the URL rather than adding history. Filter, sort or page-size changes reset paging. Analytics drilldowns keep the selected period and session. Check restores its scroll position when you come back from a linked sheet.

## Forms and drafts

Native controls keep persistent labels, associated help and errors, and keyboard behavior. Refusals keep entered values. Identifier fields (animal, person, buyer, sire) are type-or-pick suggestion lists so spellings stay consistent. Dates are typed as known (`6 Jul 2023`, `jul 2023`, `2023`, plus a guess box for an estimate); precision is read from what was typed, shown back, and cannot be raised without typing more ([date-parse.ts](../../../web-angular/src/app/registry/date-parse.ts)). Numbered choice groups accept their digit or first letter. `Cmd/Ctrl+Enter` saves from a field when the form is ready.

Session sheets (milking, dispatch, payroll) keep one model across locally paged rows; completeness, validation and save cover the whole session. On the milking sheet, Enter moves to the next animal, `m` records not measured and `n` not milked; bare keys never fire from other text fields. The footer names who is still unanswered and offers "Go to the first"; Save stays disabled with its reason until nothing blocks it. Unsaved sheets show "Not saved yet". Navigation guards state what unsaved edits would be lost; drafts do not survive a reload.

A nested Feed purchase saves independently of the feeding draft. Buyer maintenance opens in a separate tab while the dispatch draft stays.

## Writes, conflicts and completion

Pending or uncertain writes lock conflicting changes, and retries preserve endpoint, payload and key; domain guarantees differ as documented in [shared registry rules](../registry/shared-rules.md). Feed and Health expected revisions reject stale edits and offer explicit review of the saved version. Success receipts require server confirmation. Milking can continue to Dispatch with the same date and session.

## Check

`/check` orders findings by consequence: **Needs an answer** (sessions missing answers, each linking to its sheet), **Contradictions in the records** (invariant violations, each with an owner-language heading, the server sentence, a link built from the violation's structured `target`, and the code under Technical details), **People: worth a look** (neutral), then **Reading the records** (date precision by source, calving intervals, milking sessions answered, where the milk went). Recheck keeps the previous results dimmed and `aria-busy`, and hides any clean verdict until the new result arrives.

## Tables, keyboard and assistant

Only overflowing regions receive a named keyboard stop. Tabs and segmented choices take one Tab stop and move with the arrow keys, Home and End. Menus and dialogs restore focus. The assistant opens beside any page or at `/chat`, toggles with `Cmd/Ctrl+/`, shares one conversation across presentations, and keeps technical tool detail behind disclosures. It reads registry records; proposed writes wait for approval and never target registry records. See [frontend architecture](../../architecture/frontend.md).

## Acceptance scope

[Acceptance status](acceptance-status.md) records what has been verified and which checks were skipped by decision. Historical reasons for these contracts are in the [entry UX](../../records/REGISTRY_ENTRY_UX.md) and [payroll](../../records/REGISTRY_PAYROLL.md) records.
