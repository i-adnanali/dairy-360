import { reportPrintPages } from './print-pages';

// jsdom has no physical layout. Model a bounded page so these regressions
// exercise pagination and exact text retention, not jsdom's zero-size defaults.
function measuredPages(capacity: number) {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(capacity);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLElement) {
    return this.textContent?.length || 0;
  });
}
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it('repeats identity and moves heading, note and first record together', () => {
  measuredPages(120);
  const source = document.createElement('div');
  source.innerHTML = `<section><p>${'previous '.repeat(8)}</p></section>
    <section><h3 id="record-heading">Timeline</h3><p>Explanation</p>
    <app-local-pagination class="no-print">Next</app-local-pagination>
    <article><p>First record</p><details><summary>Source</summary><p>Recorder</p></details></article>
    <article><p>Second record</p><a href="/attachment">Attached</a></article></section>`;
  const original = source.innerHTML;
  const root = reportPrintPages(source, 'BD-0001 · Noori · Generated precise-time');
  const pages = Array.from(root.querySelectorAll('.life-print-page'));
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.every(p => p.querySelector('.life-print-header')?.textContent === 'BD-0001 · Noori · Generated precise-time')).toBe(true);
  const headingPage = pages.find(p => p.textContent?.includes('Timeline'))!;
  expect(headingPage.textContent).toContain('Explanation');
  expect(headingPage.textContent).toContain('First record');
  expect(root.querySelectorAll('details:not([open])')).toHaveLength(0);
  expect(root.querySelector('app-local-pagination')).toBeNull();
  expect(root.querySelector('[id]')).toBeNull();
  expect(root.querySelector('a')?.getAttribute('href')).toBe('/attachment');
  expect(source.innerHTML).toBe(original);
});

it('retains every character of oversized notes, indivisible tokens and complete audit JSON', () => {
  measuredPages(90);
  const note = 'begin '+ 'long words\n'.repeat(50) + 'X'.repeat(180) + ' END';
  const audit = JSON.stringify({ unknown: [note, null, 0], corrections: { retained: true } }, null, 2);
  const source = document.createElement('div');
  const section = document.createElement('section');
  const heading = document.createElement('h3'); heading.textContent = 'Milk';
  const record = document.createElement('article');
  const p = document.createElement('p'); p.textContent = note;
  record.append(p); section.append(heading, record);
  const appendix = document.createElement('section');
  const pre = document.createElement('pre'); pre.textContent = audit; appendix.append(pre);
  source.append(section, appendix);
  const root = reportPrintPages(source, 'Identity');
  const contents = Array.from(root.querySelectorAll('.life-print-content'));
  expect(contents.map(p => p.textContent).join('')).toBe('Animal lifetime reportMilk'+note+audit);
  expect(contents.every(p => p.scrollHeight <= p.clientHeight)).toBe(true);
  expect(contents.length).toBeGreaterThan(10);
});

it('uses the remaining page space for oversized records without isolating short fields', () => {
  measuredPages(120);
  const source = document.createElement('div');
  source.innerHTML = `<section><h3>Milk</h3><p>Explanation</p><article>
    <p>Milking</p><p>Date: month known</p><p>Recorder: fixture</p>
    <details><summary>Source</summary><p>${'long '.repeat(70)}</p></details>
    </article></section>`;
  const root = reportPrintPages(source, 'Identity');
  const first = Array.from(root.querySelectorAll('.life-print-content')).find(p => p.textContent?.includes('Milk'))!;
  expect(first.textContent).toContain('MilkExplanationMilkingDate: month knownRecorder: fixtureSource');
  expect(root.querySelectorAll('.life-print-page').length).toBeLessThanOrEqual(5);
});

it('measures oversized records against the space left by a wrapped identity', () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.parentElement?.classList.contains('life-print-page')) return 75;
    // A detached fit probe must explicitly use the sheet's reduced capacity.
    return this.style.height ? Number.parseFloat(this.style.height) : 250;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLElement) {
    return this.textContent?.length || 0;
  });
  const source = document.createElement('div');
  const note = 'Retained long record '.repeat(12);
  source.innerHTML = `<section><h3>Milk</h3><article><p>${note}</p></article></section>`;
  const identity = 'An unusually long animal identity '.repeat(14);
  const root = reportPrintPages(source, identity);
  const contents = Array.from(root.querySelectorAll<HTMLElement>('.life-print-content'));
  expect(contents.every(p => p.scrollHeight <= p.clientHeight)).toBe(true);
  expect(contents.map(p => p.textContent).join('')).toBe('Animal lifetime reportMilk' + note);
  expect(Array.from(root.querySelectorAll('.life-print-header')).every(p => p.textContent === identity)).toBe(true);
});
