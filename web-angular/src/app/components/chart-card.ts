import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import type { Dataset } from '@dairy/shared';
import { Button } from '../ui/button';
import { Cell } from '../ui/cell';
import { Card } from '../ui/surface';
import { ScrollRegion } from '../ui/scroll-region';
import { HelpText } from '../ui/text';
import { Theme } from '../core/theme';

// Port of web-react/src/components/ChartCard.tsx (Recharts -> Chart.js via ng2-charts).
//
// ---------------------------------------------------------------------------
// chartTheme(): TEN HEX LITERALS BECOME TEN TOKEN READS
// ---------------------------------------------------------------------------
// Chart.js takes colours as STRINGS, not classes, so this file could not go
// through the token migration and phase 4's re-point could not reach it. For one
// commit the literals were re-pointed by hand, which left the app correct in
// light and guaranteed to be wrong in dark: a copied hex cannot follow a toggle.
//
// Now they are read from the custom properties at render time, which is what
// section 8.1 asked for and what dark mode needs.
//
// THE rgb() WRAPPER IS NOT OPTIONAL. getComputedStyle on one of these returns
// "169 96 60" -- the channel triplet the <alpha-value> scheme forces -- and
// Chart.js cannot parse that. Every read goes through rgbOf(). This is the
// interaction between sections 3.6 and 8.1 that neither section noticed on its
// own, and it fails as an invisible un-themed chart rather than as an error.
//
// WHY `options` HAD TO BECOME A computed()
// It was a plain class field bound as [options]="options" -- a stable reference,
// so BaseChartDirective never saw a change and the axes kept their first colours
// forever while the datasets re-rendered. Verified against the installed
// ng2-charts 10.0.0 rather than assumed: `options` is a classic input declared
// with usesOnChanges, and ngOnChanges takes the non-first-change branch, does
// Object.assign(chart.config.options, config.options) and then update()
// (fesm2022/ng2-charts.mjs:94-106). The merge is shallow, which is fine here
// because everything themed sits under `scales` and that whole sub-object is
// replaced by reference.
//
// jsdom HAS NO 2D CONTEXT -- the suite prints "Not implemented:
// HTMLCanvasElement's getContext()" on every run -- so nothing here can be
// tested by rendering a canvas. chart-card.spec.ts asserts on the config object
// instead, which is why it could pin a literal in the first place.

@Component({
  selector: 'app-chart-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective, HelpText, Button, Cell, Card, ScrollRegion],
  template: `
    <div appCard>
      <div class="mb-2 flex items-baseline justify-between">
        <h3 class="text-sm font-semibold text-content-heading">
          {{ dataset().scopeLabel }} —
          {{
            dataset().interval === 'day'
              ? 'daily'
              : dataset().interval === 'week'
                ? 'weekly'
                : 'monthly'
          }}
          yield
        </h3>
        <span appHelp size="xs" tone="subtle">{{ dataset().points.length }} points</span>
      </div>
      @if (dataset().points.length) {
        <div class="h-56 w-full" aria-hidden="true">
          <canvas baseChart type="line" [data]="data()" [options]="options()"></canvas>
        </div>
        <button
          appButton
          variant="secondary"
          size="sm"
          (click)="showData.set(!showData())"
          [attr.aria-expanded]="showData()"
        >
          {{ showData() ? 'Hide data' : 'Show data'
          }}<span class="sr-only"> for {{ dataset().scopeLabel }}</span>
        </button>
        @if (showData()) {
          <div appScrollRegion="Assistant chart data">
            <table class="w-full text-sm">
              <caption>
                {{
                  dataset().scopeLabel
                }}
                ·
                {{
                  dataset().interval
                }}
                · equivalent chart data
              </caption>
              <thead>
                <tr>
                  <th appCell scope="col">Period</th>
                  <th appCell numeric scope="col">Total litres</th>
                  <th appCell numeric scope="col">Average per animal (L)</th>
                </tr>
              </thead>
              <tbody>
                @for (point of dataset().points; track $index) {
                  <tr>
                    <th appCell nowrap scope="row">{{ point.periodStart }}</th>
                    <td appCell numeric>{{ point.totalLitres }}</td>
                    <td appCell numeric>{{ point.avgPerAnimal }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else {
        <p class="text-sm text-content-muted">No data returned for this chart.</p>
      }
    </div>
  `,
})
export class ChartCard {
  protected readonly showData = signal(false);
  readonly dataset = input.required<Dataset>();

  private readonly theme = inject(Theme);

  /**
   * The chart's colours, resolved from :root at render time.
   *
   * Reads `theme.resolved()` FIRST and does nothing with it. That is the whole
   * mechanism: it makes this computed depend on the theme signal, so flipping
   * the toggle invalidates it, which re-evaluates `data()` and `options()`,
   * which hands BaseChartDirective new object references. Without that line the
   * getComputedStyle calls below would still be correct and would simply never
   * run again.
   */
  private readonly palette = computed(() => {
    this.theme.resolved();
    const css = getComputedStyle(document.documentElement);
    const rgbOf = (token: string) => {
      const channels = css.getPropertyValue(token).trim();
      // Empty when the property is missing -- a typo'd token name, or this
      // running before styles.css has loaded. Falling back to `currentColor`
      // keeps the chart drawn rather than invisible.
      return channels.length > 0 ? `rgb(${channels})` : 'currentColor';
    };
    return {
      series: rgbOf('--fill-brand'),
      seriesAlt: rgbOf('--text-secondary'),
      grid: rgbOf('--border-subtle'),
      axis: rgbOf('--border-default'),
      ticks: rgbOf('--text-muted'),
      legend: rgbOf('--text-secondary'),
    };
  });

  protected readonly data = computed<ChartConfiguration<'line'>['data']>(() => {
    const points = this.dataset().points;
    const c = this.palette();
    return {
      labels: points.map((p) => p.periodStart),
      datasets: [
        {
          label: 'Total litres',
          data: points.map((p) => p.totalLitres),
          borderColor: c.series,
          backgroundColor: c.series,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Avg / animal',
          data: points.map((p) => p.avgPerAnimal),
          borderColor: c.seriesAlt,
          backgroundColor: c.seriesAlt,
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          tension: 0,
        },
      ],
    };
  });

  protected readonly options = computed<ChartConfiguration<'line'>['options']>(() => {
    const c = this.palette();
    const axis = {
      grid: { color: c.grid },
      border: { color: c.axis },
      ticks: { font: { size: 11 }, color: c.ticks },
    };
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { font: { size: 12 }, color: c.legend } },
        tooltip: { enabled: true },
      },
      scales: { x: axis, y: axis },
    };
  });
}
