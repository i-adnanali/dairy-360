# Application interaction contracts

Current reference for behavior shared across domains. Individual fields, calculations and write APIs belong to the [domain references](../registry/README.md).

## Navigation and Today

The shell groups Today, Herd, Milk, Feed, Labour, Analytics and Check. Desktop navigation, mobile Menu and the command palette expose the same hierarchy from [navigation.ts](../../../web-angular/src/app/registry/navigation.ts). Unknown routes show a recovery screen instead of silently changing location. Escape closes the mobile menu and returns focus to its trigger.

Today is the operational entry point at `/`. Its selected farm-local date scopes milking, dispatch and feeding links. Outstanding, partially recorded and recorded sessions remain distinct. Health work links to the task board. Payroll summaries describe wage recording; they must not imply payments were made or that no money is owed.

## Browsing, recording and target safeguards

Reads do not require a recording session. Write forms collect explicit recorder/source and retain the storage-target gate. Recorder is not automatically the witness, prescriber, administrator or milker. Provenance is evidence about a record, not authentication.

Opening provenance setup must retain the current draft. The target indicator must accurately distinguish the disposable harness from persistent storage; visual styling alone is not a storage guarantee.

## URL state and recovery

Shareable date/session/filter/page state belongs in the URL where the screen supports it. Back navigation restores that scope. Filter, sort or page-size changes reset paging appropriately. A recovery/reset action clears the relevant filters rather than silently showing unrelated records. Analytics drilldowns retain selected period/session and resolve links to the matching source.

## Forms and drafts

Native controls keep persistent labels, associated help/errors and keyboard behavior. Refusals keep entered values. Conditional sections may hide blank irrelevant fields, but existing values and errors force disclosure. Navigation guards state the consequences of losing unsaved edits. Refresh does not promise draft persistence across reloads.

Editable session sheets retain one full model across locally paged rows. Completeness, validation and save operate on the entire intended session, never only the visible page. On error, reveal/navigate to the relevant field and preserve other entries.

A nested Feed purchase saves independently. Returning to the feeding draft requires explicit linking if the purchase was fed; cancelling the draft does not undo that purchase. Buyer maintenance can open separately while preserving the dispatch draft.

## Writes, conflicts and completion

Pending or uncertain writes lock conflicting changes. Exact-request retries preserve endpoint, payload and key; domain guarantees differ as documented in [shared registry rules](../registry/shared-rules.md). Do not change a pending request into a different operation.

Feed/Health expected revisions reject stale edits. Preserve the draft and offer explicit review/adoption of the saved version; never overwrite an occupied date or newer revision silently. Before/after summaries preserve date precision and uncertainty.

Success receipts require server confirmation. Milking can then continue to Dispatch with matching date/session. Assistant approval receipts record authorization separately from execution results.

## Tables, keyboard and assistant

Only meaningful overflow regions receive a named keyboard stop. Keep identity and critical values visible without replacing native table semantics. Menus and dialogs restore focus appropriately; labels cannot depend on placeholders or hover alone.

The command palette uses `Cmd/Ctrl+K`; shortcut handling must respect text-entry contexts and existing owners. The assistant shares conversation state across dock/mobile presentation, retains draft consequences and keeps technical details available through disclosures. See [frontend architecture](../../architecture/frontend.md).

## Evidence and outstanding acceptance

[Screen-specific acceptance](../../implementation/geist-screen-evidence/ACCEPTANCE.md) records executed synthetic browser checks separately from source/tests. Native devices, screen readers, zoom, print/export, live execution, operator trials and exhaustive fault injection remain independently tracked. Historical reasons for these contracts are in the [entry UX](../../records/REGISTRY_ENTRY_UX.md) and [payroll](../../records/REGISTRY_PAYROLL.md) records.
