import { TestBed } from '@angular/core/testing';
import type { TurnItem } from '../core/turn-item.type';
import { Message } from './message';

describe('Message', () => {
  it('renders a right-aligned bubble for user turns', () => {
    const item: TurnItem = { id: 'u1', role: 'user', text: 'How is the herd?' };
    const fixture = TestBed.createComponent(Message);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('How is the herd?');
    expect(el.querySelector('.justify-end')).toBeTruthy();
  });

  // NOTE: datasets are omitted here because Chart.js needs a real canvas
  // context (unavailable in jsdom). Chart data mapping is covered by
  // chart-card.spec.ts and rendering parity is verified in the Phase 5 QA pass.
  it('renders assistant markdown text and tool-call chips', () => {
    const item: TurnItem = {
      id: 'a1',
      role: 'assistant',
      text: 'Here is the **summary**.',
      toolCalls: [
        { toolUseId: 't1', name: 'get_milk_timeseries', status: 'done', argSummary: '{}' },
      ],
      datasets: [],
      agent: 'dairy',
    };
    const fixture = TestBed.createComponent(Message);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Here is the summary.');
    // markdown renders bold as <strong>
    expect(el.querySelector('strong')?.textContent).toBe('summary');
    expect(el.querySelector('app-tool-call-chip')).toBeTruthy();
    // the per-turn agent tag (Cycle 2) renders the selected agent
    expect(el.textContent).toContain('dairy');
  });

  // -------------------------------------------------------------------------
  // §13.3's message treatment. Phase 6b.
  // -------------------------------------------------------------------------

  function assistant(overrides: Partial<Extract<TurnItem, { role: 'assistant' }>> = {}) {
    const item = {
      id: 'a1',
      role: 'assistant' as const,
      text: 'Here is the summary.',
      toolCalls: [
        { toolUseId: 't1', name: 'get_milk_timeseries', status: 'done', argSummary: '{}' },
      ],
      datasets: [],
      agent: 'dairy',
      ...overrides,
    } as TurnItem;
    const fixture = TestBed.createComponent(Message);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('QUIETS the person own turn, which was the loudest thing on the page', () => {
    const item: TurnItem = { id: 'u1', role: 'user', text: 'How is the herd?' };
    const fixture = TestBed.createComponent(Message);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    const bubble = (fixture.nativeElement as HTMLElement)
      .querySelector('[data-role="user-turn"]')!;

    // §13.3: "It is currently the highest-contrast element on the page while
    // the answer is a low-contrast card. You know what you typed." It was
    // `bg-brand text-content-onFill` -- the brand fill, spent on the one piece
    // of text whose author already knows it.
    expect(bubble.className).not.toContain('bg-brand');
    expect(bubble.className).not.toContain('content-onFill');
    expect(bubble.className).toContain('bg-surface-sunken');
    expect(bubble.className).toContain('border-line-subtle');
    expect(bubble.className).toContain('text-content-secondary');
  });

  it('renders the answer as PLAIN CONTENT, not a card', () => {
    const answer = assistant().querySelector('[data-role="answer"]')!;
    // §13.3: "The answer is plain content on the panel surface, no card,
    // content-primary, markdown styled per §8.2." A bordered card with a
    // shadow is a container asking to be skimmed past.
    expect(answer.className).toContain('text-content-primary');
    expect(answer.className).toContain('prose-chat');
    expect(answer.className).not.toContain('border');
    expect(answer.className).not.toContain('shadow');
    expect(answer.className).not.toContain('bg-surface-raised');
  });

  it('puts the tool chip BELOW the answer and below the charts', () => {
    // §13.3: "It is a footnote about how the answer was produced, and today it
    // reads as a header for the chart beneath it." Asserted as document ORDER,
    // because that is the actual claim -- a class check would pass with the
    // chip back above the datasets.
    const el = assistant();
    const answer = el.querySelector('[data-role="answer"]')!;
    const chips = el.querySelector('[data-role="tool-calls"]')!;
    expect(answer.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('takes the vendor chip OFF amber, which §4.3 already claimed it had', () => {
    // The half-migrated site PHASE5_PRECHECK.md's census found: the foreground
    // and border moved to the agent ramp in the phase-4 re-point and the
    // background did not, so the vendor chip still rendered on the warning
    // role in the content area -- the one place §4.2.1 forbids.
    const tag = assistant({ agent: 'vendor' }).querySelector('span[title]')!;
    expect(tag.className).not.toContain('warning');
    expect(tag.className).toContain('bg-agent-vendor-bg');
    expect(tag.className).toContain('text-agent-vendor-fg');
  });
});
