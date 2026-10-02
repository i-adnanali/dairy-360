# Dairy 360 — current UI reference

> Historical record retained during the 2 October 2026 documentation reorganization.
> Original status statements and measurements apply to their named baselines.
> Use the [current documentation index](../README.md) for maintained contracts and procedures.

1 October 2026. Read this before the historical narrative in [UI_SYSTEM.md](UI_SYSTEM.md). The warm palette and certainty vocabulary remain authoritative. Screen completion and acceptance are tracked independently in [the recommendation checklist](../implementation/GEIST-IMPLEMENTATION.md).

| Role | Contract | Native consumer / example |
|---|---|---|
| Page | Title before filters; entry 720px, review 1400px, report 1100px | People, purchase entry, lifetime report |
| Type | Page 24/32; section 18/24; body 16/24; help 14/20; metadata 12/16 | PageHeading, SectionHeading, HelpText; tabular numbers for quantities |
| Field | Persistent label; 6px internal gap; 16px between groups; error/help IDs | Field projects native appInput; existing associated labels remain valid |
| Input | Separate control boundary; mobile 16px text and 44px target | Input, PrecisionDate; raw input remains unchanged on refusal |
| Actions | Label remains during busy state; repeated activation blocked | Button; approval remains distinct from execution |
| Surfaces | Resting card, elevated menu and dialog roles; 16px mobile / 24px dialog inset | Card and shared dialog/menu CSS; never stack cards just for spacing |
| Review table | Identity and critical values first; named local overflow and keyboard stop only when overflowing | ScrollRegion + Cell; People balance, Herd status |
| Entry sheet | One native control tree; identity adjacent to entry; full collection validation | Milking, Dispatch, Payroll |
| Metric | Number and qualification together; no invented zero or loss inference | Metric with domain-owned value/qualifier |
| Chart | Responsive panel, adjacent qualification, equivalent semantic data table | ChartPanel, CoverageNotice, ChartDataTable in analytics and assistant |
| Drilldown | Preserve period/session/filter scope and links to source | RecordDrilldown and analytics URL state |
| Exceptions | Hide only blank irrelevant explanations; values/errors force visibility | Health historical reasons; hidden controls retain model values |
| Navigation | Complete mobile Menu hierarchy; Escape restores trigger focus | Shell; unknown addresses show recovery instead of redirecting silently |

## State gallery

The [local specimen](../implementation/geist-screen-evidence/ui-specimen.html) uses the current compiled stylesheet and synthetic examples. It demonstrates light/dark, normal/invalid/readonly/disabled inputs, a busy button, empty/error content, long text, numeric table overflow and narrow width. It is a presentation specimen, not proof of Angular directive behavior or device accessibility. Actual component interactions are separately recorded in [acceptance](../implementation/geist-screen-evidence/ACCEPTANCE.md).

## Preserve these meanings

Missing, unknown, unmeasured, not performed and explicit zero differ. Dates display only their recorded precision. Keep source/recorder and correction history discoverable. Historical rates and recipient snapshots belong to saved records. Pending/unknown writes lock editing and retry the same endpoint, payload and key. A planned dose is not administration; recorded wages are not payment; purchase cost is not consumed-feed cost. No presentation change may weaken those contracts.
