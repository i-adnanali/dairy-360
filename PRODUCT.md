# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the farm owner. They always read and enter every record themselves at a laptop, and that is not expected to change. Farm workers never use the app. They report verbally or on paper, and appear in the data only as the people who observed something ("observed by"). The owner also reviews what the AI assistant and the camera-based farm monitor report.

Two jobs, in this order of frequency once the herd is entered:

1. **Daily recording.** Answer what today still needs: milking sessions, milk dispatch and sales, feeding, health doses and checks, payroll periods.
2. **Review and decide.** See what needs attention (overdue health work, active withdrawals, flagged farm events, actions the assistant proposes) and act on it.

A third, one-off job comes first: the **backfill**, which means entering the existing herd from memory, paper cycle cards and daily herd sheets over a small number of sittings. It has not run yet (docs/OPEN.md, OPEN-001/002).

## Product Purpose

Dairy 360 is the farm's own record of its animals, milk, feed, health and people, plus an optional assistant that answers questions from those records and proposes changes for the owner to approve. Success means the owner can trust every number on screen: they know where it came from, how certain it is, and what still needs doing today, without asking anyone.

## Positioning

A record that shows its own uncertainty and provenance. Approximate dates stay approximate, missing records stay distinct from zero, wages earned stay distinct from payments, and approval stays distinct from successful execution. Every write carries its source (recall, cycle card, daily herd sheet…), who typed it and who saw it. The assistant reads the registry, but cannot write to it: proposed agent writes are gated behind an explicit approval and target only the assistant's own domains. A general herd-management or chat product could not truthfully claim these guarantees.

## Operating Context

- **Laptop, localhost, single user.** Not a phone in the shed, not offline-first, not multi-user, not hosted.
- **One buffalo dairy farm in Pakistan.** Time zone Asia/Karachi; money in rupees; litres for milk.
- **Herd under 40 animals.** The owner knows each animal by name, serial and post number. Lists, pickers and rosters can show the whole herd. Search exists for speed, not because the herd is too big to see.
- **Paper sources.** Cycle cards and daily herd sheets are real inputs, and the recording session records which one is being transcribed.
- **Optional integrations.** Camera event ingestion and classification (Frigate / Double Take) feeds farm events. Self-hosted Langfuse tracing.
- **Assistant.** AG-UI over SSE streaming. Read tools run automatically; write tools pause on an approval card and run only after approval.

## Capabilities and Constraints

- **Delivered (v0.15.0):**
  - Today board
  - Herd (animals, calvings, health, life report)
  - Milk (milking roster, dispatch, buyers, statements)
  - Feed
  - Labour (people, payroll)
  - Analytics
  - Data checks
  - Command palette
  - Assistant (page and side panel)
  - Light / dark / system theme
- **Not delivered:**
  - A Farm Monitor review screen. Farm events are reachable only through the assistant.
  - A dedicated lactation view.
  - A departure flow outside generic events and corrections.
- **Terminology** (binding: use the farm's own words, in English UI text):
  - Female life stages: `majj` (adult female), `choti`, `katti`.
  - Male life stages: `katta` (young male) and `sandda` (grown bull). These are confirmed by the owner on 6 Nov 2026. They supersede the "male terms stay in English until known" open item in docs/records/REGISTRY_ENTRY_UX.md. The UI shows a male calf as katta and a stored `male` as sandda (8 Nov 2026).
- **Language:** English with the farm's herd vocabulary. No Urdu or RTL interface is planned.
- **Must be preserved by any presentation change** (see docs/reference/ui/design-system.md, "Preserve these meanings"):
  - Date precision.
  - Missing, unknown, unmeasured, not performed and zero as distinct values.
  - Source, recorder and correction history kept discoverable.
  - Historical rates and recipient snapshots belong to the saved record.
  - Pending or unknown writes lock editing and retry the same request.
  - A planned dose is not an administered one.
  - Recorded wages are not payment.
- **Open product facts** (not decided here; see docs/OPEN.md):
  - Restricted overnight zones beyond the feed store.
  - Calf age and double-entry thresholds.
  - Staff opening balances.
  - Leave deductibility.

## Brand Commitments

- Name: **Dairy 360**. The browser title still reads "Dairy Farm Agent", which is legacy.
- Voice: plain and exact. State uncertainty next to the value it qualifies, and never round it away.
- No logo or other identity assets exist yet.

## Evidence on Hand

- Synthetic, memory-only fixtures:
  - `npm run harness:app`: 31 animals with milk, health, feed and payroll records.
  - `npm run harness:analytics`
- Screenshots:
  - docs/images/current/
  - docs/ui-audit-2026-11/
- Earlier design reviews in docs/reviews/ (untracked).
- The UI audit of 6 Nov 2026: docs/ui-audit-2026-11.md.
- **No real herd data is entered yet.** The persistent registry is empty. Future work must not present synthetic animals, figures, people or testimonials as real farm data.

## Product Principles

1. **Attention first.** The first screen answers "what needs me now?", ranked by consequence: unsafe or overdue before outstanding before done.
2. **Every number is trustworthy or visibly qualified.** Precision, coverage and provenance sit next to the value. A truncated, partial or unknown result never looks final.
3. **The system's receipt outranks the model's prose.** What was actually recorded or executed is authoritative. The assistant's text is commentary on it. *(Proposed in the 6 Nov 2026 audit; not yet confirmed by the owner.)*
4. **Recognition over recall.** Anything the database knows is offered, not typed: animals, people, sires, sources. A typo must not create a new person or animal.
5. **Speak the farm's language, not the data model's.** Use herd terms and plain labels; keep rationale out of the way of entry.

## Accessibility & Inclusion

WCAG 2.2 AA for text and control contrast in both themes, enforced by `npm run check:contrast`. The UI must be fully keyboard-operable. Status must never rely on colour alone.
