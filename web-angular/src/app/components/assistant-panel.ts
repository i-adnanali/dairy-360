import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  signal,
} from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { Assistant } from '../core/assistant';
import { Shortcuts } from '../core/shortcuts';
import { Button } from '../ui/button';
import { ChatPanel } from './chat-panel';

export function isApplePlatform(): boolean {
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}
@Component({
  selector: 'app-assistant-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatPanel, A11yModule, Button],
  host: { id: 'assistant-panel', '[class.assistant-visible]': 'assistant.open()' },
  template: `
    @if (assistant.open()) {
      <aside
        class="assistant-panel bg-surface-page text-content-primary border-l border-line"
        [attr.role]="assistant.narrow() ? 'dialog' : 'complementary'"
        [attr.aria-modal]="assistant.narrow() ? 'true' : null"
        aria-labelledby="assistant-title"
        data-role="assistant-panel"
        [cdkTrapFocus]="assistant.narrow() && !nestedModal()"
        [inert]="nestedModal()"
        tabindex="-1"
      >
        <header class="flex items-center justify-between gap-2 border-b border-line-subtle p-3">
          <h2 id="assistant-title" class="text-sm font-semibold">Dairy 360 assistant</h2>
          <button
            appButton
            variant="secondary"
            size="sm"
            (click)="assistant.close()"
            data-role="assistant-close"
          >
            Close <span class="sr-only">Dairy 360 assistant</span>
          </button>
        </header>
        <div class="min-h-0 min-w-0 flex-1">
          @defer (when assistant.open()) {
            <app-chat-panel [docked]="true" />
          } @placeholder {
            <p role="status" class="p-4">Opening the assistant…</p>
          }
        </div>
      </aside>
    }
  `,
})
export class AssistantPanel {
  protected readonly assistant = inject(Assistant);
  protected readonly nestedModal = signal(false);
  private readonly el: HTMLElement = inject(ElementRef<HTMLElement>).nativeElement;
  constructor() {
    const destroy = inject(DestroyRef);
    const media = typeof matchMedia === 'function' ? matchMedia('(max-width: 1279px)') : null;
    const resize = () => this.assistant.narrow.set(media?.matches ?? false);
    media?.addEventListener('change', resize);
    const undo = inject(Shortcuts).register('mod+/', 'AssistantPanel', () => {
      if (!document.querySelector('[aria-modal="true"]:not(.assistant-panel)'))
        this.assistant.toggle();
    });
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !this.assistant.open()) return;
      if (document.querySelector('[aria-modal="true"]:not(.assistant-panel)')) return;
      e.preventDefault();
      e.stopPropagation();
      this.assistant.close();
    };
    document.addEventListener('keydown', key, true);
    let wasOpen = false;
    let wasNarrow = this.assistant.narrow();
    let wasNested = false;
    afterRenderEffect(() => {
      const open = this.assistant.open();
      const narrow = this.assistant.narrow();
      const nested = this.nestedModal();
      if (open && !nested && (!wasOpen || (narrow && (!wasNarrow || wasNested))))
        this.focusComposer();
      if (!open && wasOpen)
        document.querySelector<HTMLElement>('[data-role="assistant-toggle"]')?.focus();
      wasOpen = open;
      wasNarrow = narrow;
      wasNested = nested;
    });
    // Deferred content arrives after the panel: focus only on that first mount.
    const observer = new MutationObserver(() => {
      this.nestedModal.set(!!document.querySelector('[aria-modal="true"]:not(.assistant-panel)'));
      if (
        !this.nestedModal() &&
        this.assistant.open() &&
        this.el.contains(document.activeElement) &&
        document.activeElement?.matches('aside')
      )
        this.focusComposer();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal'],
    });
    destroy.onDestroy(() => {
      undo();
      observer.disconnect();
      media?.removeEventListener('change', resize);
      document.removeEventListener('keydown', key, true);
    });
  }
  private focusComposer(): void {
    (
      this.el.querySelector<HTMLElement>('textarea:not(:disabled)') ??
      this.el.querySelector<HTMLElement>('aside')
    )?.focus();
  }
}
