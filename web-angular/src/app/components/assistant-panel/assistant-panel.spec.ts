import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AssistantPanel } from './assistant-panel';
import { Assistant } from "../../core/assistant";

// ---------------------------------------------------------------------------
// The docked panel. Phase 6b, §13.1.
// ---------------------------------------------------------------------------
// Three of §13.1's five properties are geometry and are checked here as
// classes, because the alternative is a screenshot -- and §8.2 already records
// that this whole surface is one no fixture screen can show. The other two
// (persistence, and the header toggle) belong to Assistant and RegistryShell.

function render() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(AssistantPanel);
  const assistant = TestBed.inject(Assistant);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    assistant,
    panel: () => el.querySelector('[data-role="assistant-panel"]'),
    dim: () => el.querySelector('[data-role="assistant-dim"]'),
    close: () => el.querySelector('[data-role="assistant-close"]') as HTMLButtonElement | null,
    open: () => {
      assistant.open.set(true);
      fixture.detectChanges();
    },
  };
}

describe('AssistantPanel — §13.1', () => {
  it('renders nothing at all when closed', () => {
    // §13.1: "Default closed." Not hidden -- absent, so nothing in it is
    // focusable, announced, or in the tab order while it is away.
    const p = render();
    p.assistant.open.set(false);
    p.fixture.detectChanges();
    expect(p.panel()).toBeNull();
    expect(p.dim()).toBeNull();
  });

  it('uses a named nonmodal region with no backdrop at desktop', () => {
    const p = render();
    p.assistant.narrow.set(false);
    p.open();
    expect(p.panel()!.getAttribute('role')).toBe('complementary');
    expect(p.panel()!.hasAttribute('aria-modal')).toBe(false);
    expect(p.fixture.nativeElement.id).toBe('assistant-panel');
    expect(p.dim()).toBeNull();
  });
  it('changes modal semantics without replacing the panel and closes on Escape', () => {
    const p = render();
    p.open();
    const panel = p.panel();
    p.assistant.narrow.set(true);
    p.fixture.detectChanges();
    expect(p.panel()).toBe(panel);
    expect(panel!.getAttribute('aria-modal')).toBe('true');
    expect(panel!.getAttribute('role')).toBe('dialog');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    p.fixture.detectChanges();
    expect(p.panel()).toBeNull();
  });
  it('leaves Escape to a nested confirmation', () => {
    const p = render();
    p.open();
    const nested = document.createElement('div');
    nested.setAttribute('aria-modal', 'true');
    document.body.append(nested);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(p.assistant.open()).toBe(true);
    nested.remove();
    p.close()!.click();
    expect(p.assistant.open()).toBe(false);
  });
});

describe('Assistant — state and the context line', () => {
  function service() {
    TestBed.resetTestingModule();
    return TestBed.inject(Assistant);
  }

  it('starts closed', () => {
    try {
      sessionStorage.clear();
    } catch {
      /* blocked storage */
    }
    expect(service().open()).toBe(false);
  });

  it('remembers being open across a fresh injection, per SESSION', () => {
    // §13.1: "State persisted per session, not per route." Per route would mean
    // the panel opening and closing as somebody moves between the roster and
    // the herd list, which is the opposite of a consultation.
    const a = service();
    a.toggle();
    expect(a.open()).toBe(true);
    // TestBed.tick(), because the write goes through an `effect` and Angular
    // effects are SCHEDULED rather than synchronous. Same pattern theme.spec.ts
    // uses for the same reason.
    //
    // An effect rather than a write inside toggle(): the effect also catches a
    // direct `open.set(...)`, which is how the panel's own harness above drives
    // it, and a persistence path that only some callers take is a persistence
    // path that is wrong for the rest.
    TestBed.tick();
    expect(service().open()).toBe(true);
  });

  it('survives storage being blocked outright', () => {
    // A private window, or a browser set to block site data, THROWS on
    // sessionStorage rather than returning null. theme.spec.ts pins the same
    // for its own reads. The panel still works; it just is not remembered.
    const real = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      const a = service();
      expect(a.open()).toBe(false);
      a.toggle();
      expect(() => TestBed.tick()).not.toThrow();
      expect(a.open()).toBe(true);
    } finally {
      if (real) Object.defineProperty(window, 'sessionStorage', real);
    }
  });

  it('phrases the context line, and is ABSENT rather than generic', () => {
    // The location label explicitly says it is not forwarded to the model.
    const a = service();
    expect(a.contextLine()).toBeNull();
    a.context.set('BD-0003');
    expect(a.contextLine()).toContain('Viewing BD-0003');
    expect(a.contextLine()).toContain('this location is not sent');
    a.context.set('the evening roster');
    expect(a.contextLine()).toContain('Viewing the evening roster');
    a.context.set('');
    expect(a.contextLine()).toBeNull();
  });
});
