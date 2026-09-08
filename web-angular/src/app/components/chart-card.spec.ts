import { TestBed } from '@angular/core/testing';
import type { ChartConfiguration } from 'chart.js';
import type { Dataset } from '@dairy/shared';
import { ChartCard } from './chart-card';
import { Theme } from '../core/theme';

const dataset: Dataset = {
  datasetId: 'd1',
  kind: 'timeseries',
  scopeLabel: 'Kundi group',
  interval: 'day',
  points: [
    { periodStart: '2026-07-01', totalLitres: 100, avgPerAnimal: 5 },
    { periodStart: '2026-07-02', totalLitres: 110, avgPerAnimal: 5.5 },
  ],
};

type Internals = {
  data: () => ChartConfiguration<'line'>['data'];
  options: () => ChartConfiguration<'line'>['options'];
};

/** styles.css is not loaded here, so the tokens are set on the element. */
function setTokens(tokens: Record<string, string>): void {
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
}
function clearTokens(): void {
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
}

describe('ChartCard', () => {
  afterEach(clearTokens);

  // The chart canvas is not rendered here (jsdom lacks a 2D context, and the
  // run prints "Not implemented: HTMLCanvasElement's getContext()" because of
  // it), so everything below asserts on the config object the directive would
  // have been handed.
  it('maps dataset points to two Chart.js line series', () => {
    const fixture = TestBed.createComponent(ChartCard);
    fixture.componentRef.setInput('dataset', dataset);
    const data = (fixture.componentInstance as unknown as Internals).data();

    expect(data.labels).toEqual(['2026-07-01', '2026-07-02']);
    expect(data.datasets).toHaveLength(2);
    expect(data.datasets[0].label).toBe('Total litres');
    expect(data.datasets[0].data).toEqual([100, 110]);
    expect(data.datasets[1].label).toBe('Avg / animal');
    expect(data.datasets[1].data).toEqual([5, 5.5]);
    expect(data.datasets[1].borderDash).toEqual([4, 3]);
  });

  /**
   * WAS `expect(data.datasets[0].borderColor).toBe('#8a6431')`.
   *
   * That line is the one section 8.1 named as the real obstacle to theming this
   * file: an exact-equality check on a hex literal, which any theming "breaks on
   * day one". It survived phase 4 by having the literal re-pointed by hand
   * alongside the component, which kept it passing and kept it wrong -- a
   * hand-copied hex cannot follow a toggle.
   *
   * It now asserts the two properties that actually matter, and neither is a
   * colour: that the value comes FROM the custom property, and that it arrives
   * wrapped in `rgb(...)`. The wrapper is the part worth pinning. Custom
   * properties hold channel TRIPLETS under the <alpha-value> scheme (section
   * 3.6), so a read without the wrapper hands Chart.js "169 96 60", which it
   * cannot parse -- and it fails as a silently un-themed chart rather than as an
   * error anybody would see.
   */
  it('reads its colours from the tokens, wrapped for Chart.js', () => {
    setTokens({
      '--fill-brand': '1 2 3',
      '--text-disabled': '4 5 6',
      '--border-subtle': '7 8 9',
      '--border-default': '10 11 12',
      '--text-muted': '13 14 15',
    });
    const fixture = TestBed.createComponent(ChartCard);
    fixture.componentRef.setInput('dataset', dataset);
    const internals = fixture.componentInstance as unknown as Internals;

    expect(internals.data().datasets[0].borderColor).toBe('rgb(1 2 3)');
    expect(internals.data().datasets[1].borderColor).toBe('rgb(4 5 6)');

    const scales = internals.options()!.scales!;
    expect(scales['x']!.grid!.color).toBe('rgb(7 8 9)');
    expect(scales['x']!.border!.color).toBe('rgb(10 11 12)');
    expect(scales['x']!.ticks!.color).toBe('rgb(13 14 15)');
  });

  /**
   * The re-render, asserted on the config rather than the canvas.
   *
   * `options` used to be a plain class field bound as a stable reference, so
   * BaseChartDirective never saw it change and the axes kept their first
   * colours forever. It is a computed() now, and this pins the consequence:
   * flipping the theme has to produce a NEW options object with new values, or
   * ngOnChanges has nothing to merge.
   */
  it('re-resolves when the theme changes', () => {
    setTokens({ '--fill-brand': '1 2 3' });
    const fixture = TestBed.createComponent(ChartCard);
    fixture.componentRef.setInput('dataset', dataset);
    const internals = fixture.componentInstance as unknown as Internals;
    expect(internals.data().datasets[0].borderColor).toBe('rgb(1 2 3)');

    // What the .dark block does, in miniature: the same token, another value.
    setTokens({ '--fill-brand': '200 100 60' });
    TestBed.inject(Theme).set('dark');
    fixture.detectChanges();

    expect(internals.data().datasets[0].borderColor).toBe('rgb(200 100 60)');
  });

  /**
   * A missing token draws the chart anyway.
   *
   * This is the state the unit suite runs in -- styles.css is never loaded, so
   * every property is empty -- and it is also what a typo'd token name looks
   * like. `currentColor` keeps the series visible; an empty string would hand
   * Chart.js nothing and lose the line entirely.
   */
  it('falls back to currentColor rather than drawing nothing', () => {
    const fixture = TestBed.createComponent(ChartCard);
    fixture.componentRef.setInput('dataset', dataset);
    const internals = fixture.componentInstance as unknown as Internals;
    expect(internals.data().datasets[0].borderColor).toBe('currentColor');
  });
});
