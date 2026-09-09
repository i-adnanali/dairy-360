# Archive — superseded, kept for the reasoning

These are superseded proposals, not current specifications. Some ideas were
implemented with changes; others were rejected. The record preserves what was
believed, what evidence corrected it, and what that cost.
Do not implement from any of them.

Every file carries a banner at the top saying what supersedes it. If one ever
loses its banner, that is a bug.

## What is here

**The animal registry planning pair.** Two revisions, neither implemented as
written, both superseded by [REGISTRY.md](../REGISTRY.md), which records what was
actually built.

- [ANIMAL_REGISTRY_DECISION_DOCUMENT.md](ANIMAL_REGISTRY_DECISION_DOCUMENT.md) —
  revision 1, written **without repo access**. Four things in it are outright
  false, including a two-database split that was withdrawn and a claim about 100
  synthetic buffaloes where there are 14. Revision 2 §0 disposes of every item by
  name.
- [ANIMAL_REGISTRY_DECISION_DOCUMENT_V2.md](ANIMAL_REGISTRY_DECISION_DOCUMENT_V2.md) —
  revision 2, corrected against a validation pass and marked ready to implement.
  It was, and the build then diverged from it in places; REGISTRY.md is the
  authority on where.

The pair is worth keeping together: §0 of revision 2 is a worked example of the
validate-first step catching three errors that shared one cause — treating a
handover summary as repo evidence.

**The registry UI refinement proposal.**

- [REGISTRY_UI_REFINEMENT.md](REGISTRY_UI_REFINEMENT.md) — written against
  screenshots without repo access, and validated on 2026-09-04. Most of it
  proposed building things that already existed. What survived is §3.8 (a real
  defect, described with the wrong mechanism) and the calf-sex default. The
  authoritative outcome is
  [REGISTRY_ENTRY_UX.md §11, "Pre-trial amendment"](../REGISTRY_ENTRY_UX.md#11-still-open),
  which strikes three of its items explicitly so nobody reads them later as open
  work.

## Why archived rather than deleted

Two of the three exist to record a *method* failure, not a design failure. Both
registry revision 1 and the UI refinement document were written without repo
access and were wrong in the same direction — inferring structure that was not
there. Deleting them would leave the corrections in REGISTRY.md and
REGISTRY_ENTRY_UX.md pointing at nothing, and would lose the only evidence that
the validate-first step earns its cost.
