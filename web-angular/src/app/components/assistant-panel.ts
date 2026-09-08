// The assistant, docked. Phase 6b of docs/UI_SYSTEM.md, spec in §13.1.
//
// ---------------------------------------------------------------------------
// OVERLAY, NOT PUSH, AND §13.1 GIVES THE REASON
// ---------------------------------------------------------------------------
//   "Pushing reflows every table mid-sitting, and a transcription surface
//    should not move under the person using it. The assistant is a
//    consultation."
//
// So the panel is absolutely positioned over the content region rather than
// being a flex sibling of it. The herd list is seven columns and the dispatch
// sheet six; taking 320px off them every time somebody asks a question would
// re-wrap every row, and the row you were reading would not be where you left
// it.
//
// ---------------------------------------------------------------------------
// THE DIM DOES NOT TAKE THE CLICKS, WHICH IS WHAT MAKES IT A CONSULTATION
// ---------------------------------------------------------------------------
// `pointer-events-none` on the dim. A scrim that swallows clicks is a modal,
// and a modal is the opposite of what this is for: §13.4's case is somebody
// reading a figure off the table while asking about it. So the content beneath
// stays clickable, scrollable and selectable, and the dim is purely a statement
// about where attention is.
//
// §16 records "whether the assistant panel's dim is right at all" as UNDECIDED,
// and it is right to -- "dimming a table you are transcribing from is a cost".
// It is built as specified so the cost can be felt rather than argued about.
// One step, not a blackout: `surface-page` at 60%, which recedes the content
// without making it unreadable.
//
// ---------------------------------------------------------------------------
// ONE BREAKPOINT, AT 1100px, WRITTEN AS AN ARBITRARY VARIANT ON PURPOSE
// ---------------------------------------------------------------------------
// §13.1: "Below 1100px viewport width it takes the full content area. This is
// the app's ONLY breakpoint, and it exists because 320px plus a 1400px table
// does not fit a 1280px laptop."
//
// `max-[1100px]:` rather than a named screen in tailwind.config.js. A named
// breakpoint is an invitation -- the moment `assistant:` exists in the config
// the next person reaches for it, and the app has a responsive system it never
// decided to have. Two arbitrary variants in one file are visible, local, and
// awkward enough to make somebody read this comment before adding a third.
//
// At full width the dim is hidden: there is nothing showing beneath to recede.
//
// ---------------------------------------------------------------------------
// @defer, AND IT IS NOT A MICRO-OPTIMISATION -- IT IS 362kB
// ---------------------------------------------------------------------------
// The shell imports this panel statically, because the toggle has to work on
// every screen. Without the @defer below, that made ChatPanel part of the
// INITIAL bundle -- and ChatPanel pulls MarkdownView (marked + DOMPurify) and
// ChartCard (Chart.js) with it. Measured: 541.98 kB -> 903.81 kB, a 67% jump,
// on an app whose 500 kB budget §11 already records as exceeded.
//
// Those three libraries were lazy before this phase for a good reason -- they
// arrived with `loadComponent` on the /chat route -- and folding the chat into
// the chrome must not undo that. §13.1 says the panel is DEFAULT CLOSED, which
// makes `when assistant.open()` exactly the right trigger: the operator who
// never opens the assistant never downloads a charting library, and the one who
// does pays for it once, at the moment they ask for it.
//
// After: 555.12 kB initial, so the panel costs 13.14 kB rather than 361.83 --
// this component, the Assistant service, the Shortcuts registry and Angular's
// deferred-block runtime. The three libraries are back in a lazy chunk where
// they were.

import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { Assistant } from '../core/assistant';
import { Shortcuts } from '../core/shortcuts';
import { ChatPanel } from './chat-panel';

/** Cmd on macOS, Ctrl elsewhere -- the same test shortcuts.ts makes. */
export function isApplePlatform(): boolean {
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

@Component({
  selector: 'app-assistant-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatPanel],
  template: `
    @if (assistant.open()) {
      <!-- The dim. Visual only -- see the header. -->
      <div
        class="pointer-events-none absolute inset-0 z-10 bg-surface-page/60 max-[1100px]:hidden"
        aria-hidden="true"
        data-role="assistant-dim"
      ></div>

      <!-- aria-label rather than aria-labelledby: the panel's heading lives
           inside ChatPanel, which is ALSO mounted as a route, so pointing at it
           by id would name an element that exists twice the moment somebody
           opens /chat with the panel open. -->
      <aside
        class="absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-line
          bg-surface-page shadow-xl max-[1100px]:w-full max-[1100px]:border-l-0"
        aria-label="Farm assistant"
        data-role="assistant-panel"
      >
        <div class="flex items-center justify-between border-b border-line-subtle px-3 py-2">
          <span class="text-xs font-medium uppercase tracking-wide text-content-muted">
            Assistant
          </span>
          <button
            type="button"
            (click)="assistant.close()"
            class="rounded-sm px-2 py-1 text-xs text-content-muted hover:text-content-primary
              focus:outline-none focus-visible:ring-2 focus-visible:ring-focus
              focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page"
            data-role="assistant-close"
          >
            Close
            <!-- The chord is PRINTED, for the reason milking-roster.ts prints
                 its m and n accelerators in the table header: a shortcut nobody
                 can see is a shortcut nobody uses. -->
            <span class="ml-1 font-mono text-content-subtle">{{ chordLabel }}</span>
          </button>
        </div>

        <!-- min-h-0 is load-bearing here for the reason §9.2 works out for
             main, in reverse: this div IS a flex item and it does NOT scroll,
             so its automatic minimum size holds it open at its content height
             and the chat panel inside would overflow the aside rather than
             scroll within it. -->
        <div class="min-h-0 flex-1">
          <!-- See the header: this is what keeps Chart.js, marked and DOMPurify
               out of the initial bundle now that the shell imports this panel
               statically. -->
          @defer (when assistant.open()) {
            <app-chat-panel />
          } @placeholder {
            <p class="px-6 py-6 text-xs text-content-muted">Opening the assistant…</p>
          }
        </div>
      </aside>
    }
  `,
})
export class AssistantPanel {
  protected readonly assistant = inject(Assistant);
  private readonly shortcuts = inject(Shortcuts);

  /**
   * What to print on the close button.
   *
   * Read from the platform rather than hardcoded, because printing `⌘/` to
   * somebody on Linux is worse than printing nothing: it is a shortcut that
   * demonstrably does not work, which teaches them to stop reading the hints.
   */
  protected readonly chordLabel = isApplePlatform() ? '⌘/' : 'Ctrl+/';

  constructor() {
    const undo = this.shortcuts.register('mod+/', 'AssistantPanel', () =>
      this.assistant.toggle(),
    );
    // The panel is rendered by the shell and lives as long as the app, so this
    // is belt and braces -- and it is what keeps the registry honest if that
    // ever stops being true. See shortcuts.ts: a registration that is never
    // undone leaves the chord taken and makes the NEXT one throw.
    inject(DestroyRef).onDestroy(undo);
  }
}
