import { Directive } from '@angular/core';

/** Presentation only: domain adapters retain ownership of values and qualifications. */
@Directive({ selector: '[appMetric]', host: { class: 'min-w-0 rounded-xl border border-line bg-surface-raised p-4' } })
export class Metric {}
@Directive({ selector: '[appCoverageNotice]', host: { class: 'text-sm leading-5 text-content-muted' } })
export class CoverageNotice {}
@Directive({ selector: '[appChartPanel]', host: { class: 'min-w-0 rounded-xl border border-line bg-surface-raised p-4 sm:p-5' } })
export class ChartPanel {}
@Directive({ selector: 'table[appChartDataTable]', host: { class: 'w-full text-sm text-left' } })
export class ChartDataTable {}
@Directive({ selector: '[appRecordDrilldown]', host: { class: 'min-w-0 space-y-3' } })
export class RecordDrilldown {}
