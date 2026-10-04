import { ErrorPanel } from "../../ui/surface";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  input,
  viewChild,
} from '@angular/core';
import type { Approval, PendingWrite } from '@dairy/shared';
import { Assistant } from "../../core/assistant";
import { ChatStore } from "../../core/chat-store";
import { Composer } from "../composer/composer";
import { ConfirmationCard } from "../confirmation-card/confirmation-card";
import { EmptyState } from "../empty-state/empty-state";
import { MessageList } from "../message-list/message-list";
import { HelpText } from "../../ui/text";
import { Button } from "../../ui/button";

// Port of web-react/src/components/ChatPanel.tsx.
// Injects ChatStore directly instead of prop-drilling from the root.
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorPanel, Button, Composer, ConfirmationCard, EmptyState, HelpText, MessageList],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanel {
  protected receiptOutcome(id: string): 'awaiting' | 'recorded' | 'refused' | 'unknown' {
    const calls = this.store.renderLog().flatMap(item => item.role === 'assistant' ? item.toolCalls : []);
    const call = calls.find(c => c.toolUseId === id);
    if (call?.reason?.includes('outcome is unknown')) return 'unknown';
    if (call?.status === 'done') return 'recorded';
    if (call?.status === 'error') return 'refused';
    return 'awaiting';
  }
  protected receiptReason(decision: {card: PendingWrite; approved: boolean; reason: string}) {
    if (!decision.approved) return decision.reason;
    const outcome = this.receiptOutcome(decision.card.toolUseId);
    return outcome === 'recorded' ? 'The operation returned a successful result.'
      : outcome === 'unknown' ? 'Check the record before requesting another action. Approval is not proof of execution.'
      : outcome === 'refused' ? 'The operation did not return a successful result. Review the response for details.'
      : decision.reason;
  }
  readonly docked = input(false);
  private followTail = true;
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private readonly decisionFocus = signal(false);
  private decisionToolId: string | null = null;
  protected resolve(approvals: Approval[]): void {
    this.decisionToolId = approvals[0]?.toolUseId ?? null;
    this.decisionFocus.set(true);
    void this.store.resolve(approvals);
  }
  protected trackScroll(): void {
    const el = this.scrollEl()?.nativeElement;
    if (el) this.followTail = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }
  protected readonly store = inject(ChatStore);
  protected readonly assistant = inject(Assistant);

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
      if (!this.decisionFocus()) return;
      this.store.pending();
      if (document.activeElement === document.body || !document.activeElement?.isConnected) {
        (
          this.element.querySelector<HTMLElement>('app-confirmation-card button') ??
          Array.from(
            this.element.querySelectorAll<HTMLElement>('[data-role="decision-status"]'),
          ).find((el) => el.getAttribute('data-tool-use-id') === this.decisionToolId)
        )?.focus();
      }
      this.decisionFocus.set(false);
    });
    afterRenderEffect(() => {
      this.store.renderLog();
      this.store.pending();
      this.store.loading();
      const el = this.scrollEl()?.nativeElement;
      if (this.followTail) el?.scrollTo?.({ top: el.scrollHeight, behavior: 'instant' });
    });
  }

  protected approveAll(pending: PendingWrite[]): void {
    const approvals: Approval[] = pending.map((c) => ({
      toolUseId: c.toolUseId,
      approved: true,
    }));
    this.resolve(approvals);
  }
}
