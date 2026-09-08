import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { Approval, PendingWrite } from '@dairy/shared';
import { ChatStore } from '../core/chat-store';
import { Composer } from './composer';
import { ConfirmationCard } from './confirmation-card';
import { EmptyState } from './empty-state';
import { MessageList } from './message-list';
import { ThemeToggle } from '../ui/theme-toggle';
import { HelpText } from '../ui/text';
import { Button } from '../ui/button';

// Port of web-react/src/components/ChatPanel.tsx.
// Injects ChatStore directly instead of prop-drilling from the root.
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button, Composer, ConfirmationCard, EmptyState, HelpText, MessageList, ThemeToggle,
  ],
  template: `
    <div class="mx-auto flex h-full max-w-3xl flex-col">
      <header class="border-b border-line-subtle bg-surface-page/80 px-6 py-4 backdrop-blur">
        <!-- The chat is a TOP-LEVEL route (app.routes.ts), so it renders outside
             the registry shell and gets no header from it. It therefore needs its
             own copy of the toggle, and will stop needing it when section 9 folds
             this panel into the shell. -->
        <div class="flex items-baseline justify-between gap-4">
          <h1 class="text-lg font-semibold tracking-tight">Baghicha Dairy Co. — Farm Agent</h1>
          <app-theme-toggle />
        </div>
        <p appHelp>
          Ask about your herd, milk, feed, and health, or your vendors, deliveries, and balances —
          and take actions with confirmation.
        </p>
      </header>

      <!-- STATUS, NOT THE STREAM. Section 7 asks for aria-live on "streaming
           chat output", and putting a live region around the streaming text
           itself is the wrong reading of it: aria-live re-announces its region
           on every mutation, and a token-by-token stream mutates dozens of
           times per reply. A screen reader would restart the answer from the
           beginning on every token and finish none of them.
           So this announces the TRANSITIONS -- thinking, then the answer having
           arrived, or a refusal -- and leaves the prose to be read on demand,
           which is how somebody reads an answer anyway. Same shape as the
           registry's write log, including a counter so two identical statuses in
           a row still re-announce. aria-live="polite" because it must not
           interrupt typing. -->
      <div aria-live="polite" aria-atomic="true" class="sr-only" data-role="chat-announce">
        {{ announcement() }}
      </div>

      <div #scrollEl class="flex-1 overflow-y-auto px-6 py-6">
        @if (store.isEmpty()) {
          <app-empty-state (pick)="store.send($event)" />
        } @else {
          <app-message-list [renderLog]="store.renderLog()" />
        }

        @if (store.loading()) {
          <div class="mt-4 flex items-center gap-2 text-sm text-content-subtle">
            <span class="h-2 w-2 animate-pulse rounded-full bg-mark-pending"></span>
            Thinking…
          </div>
        }

        @if (store.pending(); as pending) {
          @if (pending.length > 0) {
            <div class="mt-4 space-y-3">
              @for (card of pending; track card.toolUseId) {
                <app-confirmation-card [card]="card" (resolve)="store.resolve($event)" />
              }
              @if (pending.length > 1) {
                <button appButton size="sm"
                  (click)="approveAll(pending)"
                >
                  Approve all ({{ pending.length }})
                </button>
              }
            </div>
          }
        }

        @if (store.error(); as error) {
          <div class="mt-4 rounded-md border border-danger-line bg-danger-bg px-4 py-3 text-sm text-danger-soft">
            {{ error }}
          </div>
        }
      </div>

      <app-composer [disabled]="store.busy()" (send)="store.send($event)" />
    </div>
  `,
})
export class ChatPanel {
  protected readonly store = inject(ChatStore);

  /** Bumped per transition, so an identical status re-announces. */
  private readonly turn = signal(0);

  /**
   * What a screen reader hears, and only when something changed.
   *
   * `pending` is checked before `loading` on purpose: an agent proposing a
   * write is the one state where the operator must act, and it should not be
   * described as "answer ready".
   */
  protected readonly announcement = computed(() => {
    void this.turn();
    if (this.store.error()) return 'The request failed. ' + this.store.error();
    const pending = this.store.pending();
    if (pending && pending.length > 0) {
      return pending.length === 1
        ? 'One change is waiting for your approval.'
        : `${pending.length} changes are waiting for your approval.`;
    }
    if (this.store.loading()) return 'Working on it.';
    return this.store.isEmpty() ? '' : 'Answer ready.';
  });
  private readonly scrollEl = viewChild<ElementRef<HTMLDivElement>>('scrollEl');

  constructor() {
    // Replaces React's useRef + useEffect([renderLog, pending, loading]).
    // afterRenderEffect re-runs after the DOM is updated whenever the tracked
    // signals change, so scrollHeight reflects the newly rendered content.
    // One effect per concern: this one only tracks the STATE the announcement
    // describes, so it does not fire on every streamed token the way the scroll
    // effect below deliberately does.
    effect(() => {
      this.store.loading();
      this.store.pending();
      this.store.error();
      this.turn.update((n) => n + 1);
    });

    afterRenderEffect(() => {
      this.store.renderLog();
      this.store.pending();
      this.store.loading();
      const el = this.scrollEl()?.nativeElement;
      el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }

  protected approveAll(pending: PendingWrite[]): void {
    const approvals: Approval[] = pending.map((c) => ({
      toolUseId: c.toolUseId,
      approved: true,
    }));
    this.store.resolve(approvals);
  }
}
