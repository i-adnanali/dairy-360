import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AssistantPanel } from './assistant-panel';
import { Assistant } from '../core/assistant';

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

  it('is 320px, docked right, and OVERLAYS rather than pushes', () => {
    const p = render();
    p.open();
    const cls = p.panel()!.className;
    expect(cls).toContain('w-80'); // 320px
    expect(cls).toContain('right-0');
    // `absolute` is the whole of "overlay, not push": a flex sibling of <main>
    // would take the 320px off the content and reflow every table mid-sitting.
    expect(cls).toContain('absolute');
  });

  it('takes the full content area below 1100px, the app ONE breakpoint', () => {
    const p = render();
    p.open();
    // §13.1: "This is the app's only breakpoint, and it exists because 320px
    // plus a 1400px table does not fit a 1280px laptop." Written as an
    // arbitrary variant rather than a named screen in tailwind.config.js -- see
    // the component header for why that is deliberate.
    expect(p.panel()!.className).toContain('max-[1100px]:w-full');
    expect(p.dim()!.className).toContain('max-[1100px]:hidden');
  });

  it('dims the content WITHOUT taking its clicks', () => {
    const p = render();
    p.open();
    const cls = p.dim()!.className;
    // The line between a consultation and a modal. §13.4's case is reading a
    // figure off the table while asking about it, so the table stays clickable,
    // scrollable and selectable.
    expect(cls).toContain('pointer-events-none');
    // One step, not a blackout, and not a black scrim: the page's own ground at
    // 60% recedes the content without making it unreadable.
    expect(cls).toContain('bg-surface-page/60');
    expect(p.dim()!.getAttribute('aria-hidden')).toBe('true');
  });

  it('closes from its own button, and PRINTS the chord', () => {
    const p = render();
    p.open();
    // "A shortcut nobody can see is a shortcut nobody uses" -- the lesson
    // milking-roster.ts records for its m/n accelerators, applied here.
    expect(p.close()!.textContent).toMatch(/⌘\/|Ctrl\+\//);
    p.close()!.click();
    p.fixture.detectChanges();
    expect(p.assistant.open()).toBe(false);
    expect(p.panel()).toBeNull();
  });
});

describe('Assistant — state and the context line', () => {
  function service() {
    TestBed.resetTestingModule();
    return TestBed.inject(Assistant);
  }

  it('starts closed', () => {
    try { sessionStorage.clear(); } catch { /* blocked storage */ }
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
      get() { throw new Error('blocked'); },
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
    // §13.2's claim is that the line resolves a pronoun -- "how does HER
    // interval compare" on an animal route. A line reading "Reading the app"
    // resolves nothing while training the eye to skip the one place that does.
    const a = service();
    expect(a.contextLine()).toBeNull();
    a.context.set('BD-0003');
    expect(a.contextLine()).toBe('Reading BD-0003');
    a.context.set('the evening roster');
    expect(a.contextLine()).toBe('Reading the evening roster');
    a.context.set('');
    expect(a.contextLine()).toBeNull();
  });
});
