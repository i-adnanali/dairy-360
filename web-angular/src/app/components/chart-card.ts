import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import type { Dataset } from '@dairy/shared';
import { HelpText } from '../ui/text';

// Port of web-react/src/components/ChartCard.tsx (Recharts -> Chart.js via ng2-charts).
//
// ---------------------------------------------------------------------------
// TEN HEX LITERALS, RE-POINTED BY HAND. A STOPGAP, NOT PHASE 3.
// ---------------------------------------------------------------------------
// Chart.js takes colours as strings, not classes, so this file never went
// through the token migration and phase 4's re-point could not reach it. Left
// alone it would have held the ONLY old-palette values left in src/ -- brown
// lines and beige gridlines on a neutral card -- visible the moment the agent
// returns a dataset.
//
// So the literals now match the new palette: the primary series takes the brand
// accent, the secondary the disabled grey, and the axes take border-subtle,
// border-default and text-muted. Values copied from styles.css by hand.
//
// THAT IS THE DEFECT, NOT THE FIX. Section 8.1 asks for a chartTheme() factory
// that READS the custom properties, which is phase 3 and also what dark mode
// needs -- a hand-copied hex cannot follow a theme toggle, and it will drift
// from :root the first time anybody edits one and not the other. Two details
// that pass are already recorded: `data` is a computed() so it re-renders for
// free, and `options` needs converting to one (verified against the installed
// ng2-charts 10.0.0 -- BaseChartDirective's ngOnChanges assigns and calls
// update()). getComputedStyle returns "169 96 60", which Chart.js cannot parse,
// so every read needs an rgb() wrapper.
@Component({
  selector: 'app-chart-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective, HelpText],
  template: `
    <div class="rounded-xl border border-line-subtle bg-surface-raised p-4 shadow-sm">
      <div class="mb-2 flex items-baseline justify-between">
        <h3 class="text-sm font-semibold text-content-heading">
          {{ dataset().scopeLabel }} — {{ dataset().interval }}ly yield
        </h3>
        <span appHelp size="xs" tone="subtle">{{ dataset().points.length }} points</span>
      </div>
      <div class="h-56 w-full">
        <canvas baseChart type="line" [data]="data()" [options]="options"></canvas>
      </div>
    </div>
  `,
})
export class ChartCard {
  readonly dataset = input.required<Dataset>();

  protected readonly data = computed<ChartConfiguration<'line'>['data']>(() => {
    const points = this.dataset().points;
    return {
      labels: points.map((p) => p.periodStart),
      datasets: [
        {
          label: 'Total litres',
          data: points.map((p) => p.totalLitres),
          borderColor: '#A9603C',
          backgroundColor: '#A9603C',
          borderWidth: 2,
          pointRadius: 0,
          cubicInterpolationMode: 'monotone',
        },
        {
          label: 'Avg / animal',
          data: points.map((p) => p.avgPerAnimal),
          borderColor: '#A8A69E',
          backgroundColor: '#A8A69E',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          cubicInterpolationMode: 'monotone',
        },
      ],
    };
  });

  protected readonly options: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, labels: { font: { size: 12 } } },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        grid: { color: '#E3E2DE' },
        border: { color: '#CBC9C3' },
        ticks: { font: { size: 11 }, color: '#63615C' },
      },
      y: {
        grid: { color: '#E3E2DE' },
        border: { color: '#CBC9C3' },
        ticks: { font: { size: 11 }, color: '#63615C' },
      },
    },
  };
}
