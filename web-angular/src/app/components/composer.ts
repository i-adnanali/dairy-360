import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  inject,
  ElementRef,
  viewChild,
  afterRenderEffect,
  DestroyRef,
} from '@angular/core';
import { Assistant } from '../core/assistant';
import { TextInput } from '../ui/input';
import { Button } from '../ui/button';

// Port of web-react/src/components/Composer.tsx
@Component({
  selector: 'app-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TextInput],
  template: `
    <div class="border-t border-line-subtle bg-surface-page px-6 py-4">
      <p id="assistant-composer-help" class="mb-2 text-xs text-content-muted">
        {{
          disabled()
            ? 'Assistant busy or awaiting approval; sending is unavailable.'
            : 'Enter to send · Shift+Enter for a new line'
        }}
      </p>
      <div class="flex items-end gap-2">
        <textarea
          #field
          appInput
          density="comfortable"
          aria-label="Message to Dairy 360 assistant"
          aria-describedby="assistant-composer-help"
          [value]="value()"
          (input)="value.set($any($event.target).value)"
          (keydown)="onKeydown($event)"
          [readOnly]="disabled()"
          [attr.aria-disabled]="disabled() ? true : null"
          rows="1"
          [placeholder]="placeholder()"
          class="min-w-0 max-h-40 min-h-[44px] flex-1 resize-none bg-surface-raised text-content-primary read-only:bg-surface-sunken"
        ></textarea>
        <button (click)="submit()" [appButtonDisabled]="disabled() || !value().trim()" appButton>
          Send
        </button>
      </div>
    </div>
  `,
})
export class Composer {
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');
  constructor() {
    afterRenderEffect(() => {
      this.value();
      this.resize();
    });
    let width = 0;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const next = entries[0]?.contentRect.width ?? 0;
            if (next !== width) {
              width = next;
              this.resize();
            }
          });
    afterRenderEffect(() => {
      const field = this.field()?.nativeElement;
      if (field) observer?.observe(field);
    });
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
  }
  private resize(): void {
    const field = this.field()?.nativeElement;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = Math.min(160, Math.max(44, field.scrollHeight + 2)) + 'px';
  }
  readonly disabled = input(false);
  readonly send = output<string>();

  protected readonly value = inject(Assistant).draft;

  protected readonly placeholder = computed(() =>
    this.disabled()
      ? 'Resolve the pending action above to continue…'
      : 'Ask about the herd, or request an action…',
  );

  protected submit(): void {
    const text = this.value().trim();
    if (!text || this.disabled()) return;
    this.send.emit(text);
    this.value.set('');
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.submit();
    }
  }
}
