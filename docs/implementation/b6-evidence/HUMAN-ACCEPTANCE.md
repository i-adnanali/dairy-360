# Outstanding acceptance — reproducible handoff

No operator, screen-reader or real-phone participant was present for B6. Nothing below is a recorded pass or an approval to ship. Use only the synthetic harness in README.md; confirm the header says **harness · in memory**. Never point these instructions at the real farm database. Backend/seed time is fixed at 2026-09-17; select that date explicitly in the browser. Frontend defaults follow the actual date.

Record tester, role, date, OS/browser/version, assistive technology/version, device/viewport, theme, source-manifest hash, fixture and exact steps, observed result, assistance/misinterpretations, pass/fail and artifact path. Stop and record failures; do not silently replace a gate with a related unit test.

## Operator walkthrough (specification §10.3)

1. Start session Direct entry / `b6-operator` on UI 6502. Open Milking, select 2026-09-17 evening. Enter measured 0 for one animal, a nonzero amount for another, Not measured for one and Not milked for one; answer remaining rows. Ask the operator to explain the four different facts. Use only synthetic amounts.
2. Interrupt after a partial raw value `12.`. Use Search → Dispatch, choose Keep. Confirm exact raw value, date/session and provenance remain. Repeat with Back, then deliberately change date and Discard. Return and complete the evening roster. Record needed assistance; do not invent timing gains.
3. Open Feed → 2026-09-17. Ask who recorded the saved account (adnan). Edit the note, Review; ask who will record the correction (`b6-operator`). Revert and verify no correction can be saved. Make a new synthetic change, review and save only on the memory harness.
4. Open Health at 2026-09-17. Find Fixture overdue, then its original instruction. Identify the difference between a planned task, recorded dose and instruction with an unknown end. Ask whether “Needs clarification” means clinical clearance (it must not).
5. Open Analytics at 2026-09-17, all sessions. Read partial coverage beside Difference. Ask the operator to explain why it does not establish a complete loss/wastage figure. Open Show data and a dated link with keyboard.
6. Open Check. Read Recorded wage differs from agreement. Ask whether this proves cash was paid (it does not). Follow the structured person link and identify the separate payment history.
7. Record completion, errors, misinterpretations and assistance per step. Release requires this representative walkthrough or an explicit recorded decision to ship without it; B6 contains neither.

The separate five-animal protected-form trial remains outstanding. It is a prerequisite to reconsidering the held field/date/write-log decisions, not permission to change those forms now.

## Screen reader and keyboard

Use VoiceOver/Safari or NVDA/Chrome on the synthetic UI. Record the actual pair/version.

- Navigate headings: Analytics must land on Milk analytics; all other pages on the page title. Read People Identifier: the name is concise, help is its description; induce a duplicate/refusal in memory and check the field error and invalid state.
- Read Dam, per-animal Litres, per-person Wage amount (Rs), round outcome and repeated task actions. Confirm subject/context distinguish controls. Check five certainty meanings without relying on colour.
- Tab/Shift+Tab through a dirty-draft dialog: initial Keep, Escape retains fields, Discard resumes intended navigation, focus returns sensibly.
- Open assistant at 1279px: title/dialog announced, outside content inert, Tab trapped, Escape closes and returns to trigger. At 1280px main remains operable. Cross while open and confirm one composer, retained draft and conversation. Check nested palette/confirmation ownership.
- Navigate chart data and overflowing comparison regions using keyboard. Verify offscreen columns can be reached and focus remains visible. Test errors, loading, pending approval, rejected and unknown-outcome messages; retry must never silently approve/replay.

## Real phone / native zoom / grayscale

Use a real phone with its software keyboard, not a reduced desktop viewport. Use a secure local test setup that reaches only the synthetic harness; do not expose farm storage. At 360/390 CSS px, enter bottom-row Milking, Dispatch and Payroll values: keyboard must not cover the focused field, sticky summary must not overlap it, and no writable field may require horizontal scrolling. Rotate while typing and verify the raw draft survives.

In a browser with a displayed zoom control set actual zoom to 200%; record screenshot of the control plus page. Confirm measured CSS viewport change/reflow, readable text, reachable actions and local comparison overflow. Repeat protected entry, operational sheet, Health, statement, Life report and assistant. Restore 100%. B6's Meta+= produced no observable zoom; its viewport matrix is not a substitute.

Use OS grayscale or a documented desaturated capture to distinguish measured, approximate, absent, no-record and unanswered. Ask the operator to explain them. The six resting-border contrast exceptions remain held even if the operator can use the controls.

## Native Life report PDF and JSON

1. Run the B6 read-only report fixture and UI 6504. Open `/animals/BD-0001/report`, clear From/Through, enable Include corrections and Apply. Confirm Milk (101), 5,050 measured litres and “Corrections included”. The fixture adds nested unknown fields and `future_domain`.
2. Change Milk to page two. Click Print / Save as PDF in a browser whose native print UI is available. Save the actual PDF. Inspect every page, including last record `fixture-milk-100`, first record `fixture-milk-0`, corrections, technical audit, identifiers, precision dates and expanded sources. Check page breaks for cut-off rows, repeated table headers where applicable and no missing pages. Repeat dark source theme; print output must be legible. Record page count and PDF checksum. Do not substitute a screenshot of the print DOM.
3. Click Export complete JSON and locate the completed browser download. Parse that exact downloaded file; compare against the full API response using `compare-native-json.mjs` and the report URL including the same filters/corrections flag. Inspect unknown markers `B6-unknown-100`, `future-final`, nested null and zero. Record actual filename, byte count, checksum and comparison output. A Blob spy or separately saved API response is not a completed download.
4. Preserve the PDF and actual downloaded JSON as evidence, with the final source-manifest checksum and browser version. Current B6 native output is OPEN because the in-app browser returned neither inspectable artifact.

## Live assistant integration

B5/B6 synthetic traffic is not a live assistant run. If live integration is required, arrange an explicitly isolated test executor with no real farm data and separately authorized service access. Exercise read, proposal, denial, approval, executor failure and uncertain response; inspect server-side write counts and verify there is no silent approval/replay. Do not enable production writes or reuse a production database to close this gate.
