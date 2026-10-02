# Maintain documentation

Use this guide when changing application behavior, moving a document or refreshing evidence. Documentation lives beside source and should change with the behavior it describes.

## Choose the owner

Use a guide for tasks, a reference for contracts and architecture for explanation. Give the page a clear scope, relevant source links and limitations. Shared rules belong in a single owning reference with explicit domain exceptions. Brief repetition is useful when it prevents a dangerous misunderstanding; duplicated evolving contracts are not.

Keep historical proposals and delivery measurements in `records/` or existing implementation evidence. Preserve dates, baselines, decisions and uncertainty. A new implementation record can supersede a decision; it must not make an old test appear freshly executed.

## Make a change

1. Update the current owning page and any affected examples.
2. Link related pages rather than duplicating commands or calculations.
3. If moving a file, update Markdown links, heading fragments, repository-relative source comments and executable consumers. Source code can read Markdown fixtures; inspect usages before renaming.
4. Add a records/decision index entry when preserving an important historical decision. Do not invent approval dates or decision IDs for old work.
5. Run `npm run check:docs` and `git diff --check`. Run tests for any executable consumers you change.

The checker validates local paths/anchors and image manifest data; it does not prove prose accuracy or external service availability. Link line fragments into source only when useful; prefer a stable source file/function over a line number that will drift.

## Screenshots and validation

Capture current UI from synthetic memory-only data. Record source commit, loaded build, route/state, theme, viewport and image hash in the current gallery manifest. Keep JSON snapshots and image files consistent. Historical captures retain their original provenance and must not be relabelled as current.

Documentation-only source-comment changes do not require a new screenshot if rendered code/assets are unchanged. If behavior/style changes, rebuild and refresh affected images. A screenshot does not prove keyboard, screen-reader, native-device, print/export or live executor acceptance.

Keep current suite totals and build warnings in dated acceptance evidence; guides link to that record. Update [OPEN](../OPEN.md) when an item changes, retaining a link to its original rationale rather than rewriting a closed record.

## Review checklist

Can a reader tell what is current, find the task without knowing a delivery cycle, and understand recovery? Are unknown values, historical rates, source provenance and retry limits stated accurately? Does every acceptance claim point to work actually performed? Are real data, secrets and private captures absent?
