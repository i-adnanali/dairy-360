# B2 verification evidence — 2026-09-23

The backend on port 6460 is an isolated `:memory:` registry harness; the production UI on 6462 proxies to it. No farm database was seeded or modified. Browser actions used synthetic provenance `spec-review`. One synthetic crop correction was saved (sowing date `Mar 2023`, revision 2), then reopened to verify normalized storage and month precision. Other browser drafts were discarded; Health void was cancelled.

`fixture-clock.mjs` fixes the **backend and seed processes only** at 2026-09-17T12:00Z, keeping the existing date-relative fixture useful. The frontend uses the real clock, 2026-09-23; historical contexts were explicitly selected where required. No application clock or seed code changed. The preloader is verification-only, not imported by the application.

## Captures

- `feed-correction-light.jpg` / `.txt`: desktop saved author adnan versus proposed spec-review; correction review.
- `crop-mobile-light.jpg`, `crop-mobile-dark.jpg`, `crop-month-initialization.txt`: shared historical dates, optional time hidden, month precision retained on initialization.
- `health-correction-mobile-dark.jpg`, `health-correction-final.txt`: original visit reason preserved separately from correction reason, original/current attribution, cancellation of shared void confirmation. The image was taken immediately after cancellation, before the busy state settled; the subsequent browser check verified the retained draft and explicit discard/close.
- `payroll-navigation-dark.jpg`: shared discard dialog during navigation from a changed payroll.
- `health-saved-desktop-dark.jpg`, `health-saved-final.txt`: final bundle, saved history without an active recording session, one saved view, no Save action, focus on its heading.

Captures document the B2 iteration, not a full visual acceptance gallery. Source fingerprints describe the final source. The last build adds workflow date/period to Dispatch/Payroll discard descriptions; the earlier Payroll capture still shows its route description. The final bundle was reloaded and checked. Browser version was not exposed by the supported API.

## Additional browser checks

- Feed unchanged/reverted correction disabled; review retains entries; route Keep retains draft, Discard resumes intended route. Saved metadata remains independent of current session.
- Crop correction initial focus, month initialization, successful synthetic save/reopen, no spurious leave prompt.
- Health saved view → correction focuses Date; unchanged Save disabled; visit reason survives correction input; void Cancel initially focused and makes no write; Close/Discard removes editor and returns focus to View / edit. Document width 390 at a 390px viewport.
- Dispatch raw `12.` retained when a date switch is cancelled; native date, URL and focus restored. Discard on Morning → Evening clears the old draft and resumes the requested session.
- Payroll amount retained when period change or browser Back is cancelled. Changing recorder then choosing Keep retains the original session and amount. Explicit discard resumes People navigation.

Command logs and protected-constraint comparison accompany these captures. Lost responses, conflicts, duplicate submits and attachment retry were verified with isolated mocked API responses in regression tests, not by interrupting a real write.
