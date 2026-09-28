import { TestBed } from '@angular/core/testing';
import type { PendingWrite } from '@dairy/shared';
import { ChatStore } from '../core/chat-store';
import { ChatPanel } from './chat-panel';
import { Assistant } from '../core/assistant';

describe('ChatPanel', () => {
  let store: ChatStore;

  function mount() {
    const fixture = TestBed.createComponent(ChatPanel);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    // Standalone fixtures must not inherit the persisted dock preference from other suites.
    TestBed.inject(Assistant).open.set(false);
    store = TestBed.inject(ChatStore);
  });

  it('shows the empty state when there is no render log', () => {
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-empty-state')).toBeTruthy();
    expect(el.querySelector('app-message-list')).toBeNull();
  });

  it('shows the message list and a Thinking indicator while loading', () => {
    store.renderLog.set([{ id: 'u1', role: 'user', text: 'hi' }]);
    store.loading.set(true);
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-message-list')).toBeTruthy();
    expect(el.querySelector('app-empty-state')).toBeNull();
    expect(el.textContent).toContain('Thinking');
  });

  it('renders confirmation cards and an "Approve all" button for multiple pending writes', () => {
    const pending: PendingWrite[] = [
      { toolUseId: 'w1', toolName: 'log_milking', summary: 's1', details: [] },
      { toolUseId: 'w2', toolName: 'log_milking', summary: 's2', details: [] },
    ];
    store.renderLog.set([{ id: 'u1', role: 'user', text: 'log it' }]);
    store.pending.set(pending);
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-confirmation-card')).toHaveLength(2);
    expect(el.textContent).toContain('Approve all (2)');
  });

  it('hides "Approve all" for a single pending write', () => {
    store.renderLog.set([{ id: 'u1', role: 'user', text: 'log it' }]);
    store.pending.set([{ toolUseId: 'w1', toolName: 'log_milking', summary: 's1', details: [] }]);
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-confirmation-card')).toHaveLength(1);
    expect(el.textContent).not.toContain('Approve all');
  });

  it('renders the error banner', () => {
    store.error.set('Request failed (503)');
    const fixture = mount();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Request failed (503)');
  });

  it('keeps the busy composer focusable but read-only (pending)', () => {
    store.pending.set([{ toolUseId: 'w1', toolName: 'log_milking', summary: 's1', details: [] }]);
    const fixture = mount();
    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    expect(textarea.readOnly).toBe(true);
    expect(textarea.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('B5 single composer and draft', () => {
  it('yields the standalone composer to the dock and restores its draft', async () => {
    const { Assistant } = await import('../core/assistant');
    const a = TestBed.inject(Assistant);
    a.open.set(false);
    a.draft.set('unsent synthetic draft');
    const route = TestBed.createComponent(ChatPanel);
    route.detectChanges();
    expect(route.nativeElement.querySelector('textarea').value).toBe('unsent synthetic draft');
    a.open.set(true);
    route.detectChanges();
    expect(route.nativeElement.querySelector('textarea')).toBeNull();
    const dock = TestBed.createComponent(ChatPanel);
    dock.componentRef.setInput('docked', true);
    dock.detectChanges();
    expect(dock.nativeElement.querySelectorAll('textarea')).toHaveLength(1);
    expect(dock.nativeElement.querySelector('textarea').value).toBe('unsent synthetic draft');
    dock.destroy();
    a.open.set(false);
    route.detectChanges();
    expect(route.nativeElement.querySelector('textarea').value).toBe('unsent synthetic draft');
  });
});

describe('B5 reading and decision focus', () => {
  it('does not force-scroll a reader who moved away from the response tail', () => {
    const fixture = TestBed.createComponent(ChatPanel);
    fixture.componentRef.setInput('docked', true);
    fixture.detectChanges();
    const scroll = (fixture.nativeElement as HTMLElement).querySelector(
      '.overflow-y-auto',
    ) as HTMLElement;
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 200 },
    });
    const spy = vi.fn();
    scroll.scrollTo = spy;
    scroll.dispatchEvent(new Event('scroll'));
    TestBed.inject(ChatStore).renderLog.set([
      {
        id: 'stream',
        role: 'assistant',
        text: 'Next streamed segment',
        toolCalls: [],
        datasets: [],
        agent: null,
      },
    ]);
    fixture.detectChanges();
    expect(spy).not.toHaveBeenCalled();
  });
  it('focuses the newly resolved card rather than an earlier decision', async () => {
    const { HttpAgent } = await import('@ag-ui/client');
    const spy = vi.spyOn(HttpAgent.prototype, 'runAgent').mockResolvedValue({} as never);
    const store = TestBed.inject(ChatStore);
    const card = (id: string) => ({ toolUseId: id, toolName: 'write', summary: id, details: [] });
    store.decisions.set([{ card: card('earlier'), approved: true, reason: 'Previously approved' }]);
    store.pending.set([card('current')]);
    const fixture = TestBed.createComponent(ChatPanel);
    fixture.componentRef.setInput('docked', true);
    fixture.detectChanges();
    const reject = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-confirmation-card button'),
    ).find((b) => b.textContent?.trim() === 'Reject') as HTMLButtonElement;
    reject.focus();
    reject.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement?.getAttribute('data-tool-use-id')).toBe('current');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
