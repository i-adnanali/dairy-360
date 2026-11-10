# Maintain documentation

Use this guide when changing application behavior, moving a document or refreshing evidence. Documentation lives beside source and should change with the behavior it describes.

## Choose the owner

Use a guide for tasks, a reference for contracts and architecture for explanation. Give the page a clear scope, relevant source links and limitations. Shared rules belong in a single owning reference with explicit domain exceptions. Brief repetition is useful when it prevents a dangerous misunderstanding; duplicated evolving contracts are not.

Keep historical proposals and decisions in `records/`, where source comments cite them. Preserve dates, baselines, decisions and uncertainty; a new record can supersede a decision but must not make an old test appear freshly executed. Do not commit bulk verification output (logs, PDFs, screenshot sets): state the result and the commit it applies to in [acceptance status](../reference/ui/acceptance-status.md).

## Make a change

1. Update the current owning page and any affected examples.
2. Link related pages rather than duplicating commands or calculations.
3. If moving a file, update Markdown links, heading fragments, repository-relative source comments and executable consumers. Source code can read Markdown fixtures; inspect usages before renaming.
4. Add a records/decision index entry when preserving an important historical decision. Do not invent approval dates or decision IDs for old work.
5. Run `npm run check:docs` and `git diff --check`. Run tests for any executable consumers you change.

The checker validates local paths/anchors against the repository file inventory, excluding local-only review artifacts, and checks image manifest data. Describe intentionally unpublished records as local-only paths rather than checkout links. It does not prove prose accuracy or external service availability. Link line fragments into source only when useful; prefer a stable source file/function over a line number that will drift.

## Screenshots and validation

Capture current UI from synthetic memory-only data, following the refresh steps in the [gallery](../images/current/README.md). Record source commit, loaded build, route/state, theme, viewport and image hash in its manifest, and keep JSON snapshots and image files consistent. When the UI changes, replace the affected images rather than keeping old captures alongside.

Documentation-only source-comment changes do not require a new screenshot if rendered code/assets are unchanged. If behavior/style changes, rebuild and refresh affected images. A screenshot does not prove keyboard, screen-reader, native-device, print/export or live executor acceptance.

Keep the latest suite totals and build warnings in acceptance status; guides link there. Update [OPEN](../OPEN.md) when an item changes, retaining a link to its original rationale rather than rewriting a closed record.

## Review checklist

Can a reader tell what is current, find the task without knowing a delivery cycle, and understand recovery? Are unknown values, historical rates, source provenance and retry limits stated accurately? Does every acceptance claim point to work actually performed? Are real data, secrets and private captures absent?
