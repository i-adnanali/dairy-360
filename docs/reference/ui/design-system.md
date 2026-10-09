# UI design system

Current reference, consolidated 2 October 2026. This page owns presentation contracts; [application interactions](application-interactions.md) owns navigation and workflow behavior. Domain-specific meaning belongs to [registry references](../registry/README.md).

## Foundations

Preserve the warm palette in light and dark themes. Consume semantic CSS roles in [styles.css](../../../web-angular/src/styles.css) and shared directives/components in [ui/](../../../web-angular/src/app/ui), not copied palette literals. Theme switching follows the existing light/dark/system model.

Resting decorative borders and control boundaries have different purposes. Use the dedicated control-boundary role for necessary input boundaries. Disabled/no-record text remains legible; do not restore old held contrast exceptions. [Contrast tooling](../../../scripts/check-contrast.mjs) is an automated token/consumer gate, not full accessibility certification.

Keep type, spacing and tabular figures consistent. Qualify approximate dates and uncertain quantities near their value. Colour is supplementary to text/shape; a badge cannot silently change the underlying meaning.

## Component contracts

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

The [local specimen](../../implementation/geist-screen-evidence/ui-specimen.html) preserves the 1 October compiled stylesheet and synthetic examples. It demonstrates light/dark, normal/invalid/readonly/disabled inputs, a busy button, empty/error content, long text, numeric table overflow and narrow width. It is a presentation specimen, not proof of Angular directive behavior or device accessibility. Actual component interactions are separately recorded in [acceptance status and evidence](acceptance-status.md).

## Preserve these meanings

Missing, unknown, unmeasured, not performed and explicit zero differ. Dates display only their recorded precision. Keep source/recorder and correction history discoverable. Historical rates and recipient snapshots belong to saved records. Pending/unknown writes lock editing and retry the same endpoint, payload and key. A planned dose is not administration; recorded wages are not payment; purchase cost is not consumed-feed cost. No presentation change may weaken those contracts.


## Implementation rules

- Use native buttons, inputs, labels, headings and tables. Shared directives enhance rather than replace their semantics.
- Keep shared semantic rules after the relevant utility layers so generic utilities do not accidentally override role styles.
- Inputs need a visible focus indicator and associated errors; placeholders are examples, not labels.
- Identifier links remain links. Row hover does not make a noninteractive row a button.
- Copy describes observations and actions without inferring clinical efficacy, payment, successful execution or data completeness.
- Theme-aware charts keep equivalent tabular data, units, qualifications and readable legends.

## Validation and history

Run template and contrast checks and inspect changed workflows in both themes and narrow layouts. Keyboard/focus, error recovery and long content require interaction checks beyond screenshots. See [testing](../../guides/testing.md).

The full original phase narrative is preserved as [UI-system history](../../records/UI_SYSTEM.md). Historical phase completion does not establish current exhaustive acceptance. [Current screenshots](../../images/current/README.md) are separate from behavioral evidence.
