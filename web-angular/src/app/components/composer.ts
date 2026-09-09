import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Button } from '../ui/button';

// Port of web-react/src/components/Composer.tsx
@Component({
  selector: 'app-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div class="border-t border-line-subtle bg-surface-page px-6 py-4">
      <div class="flex items-end gap-2">
        <textarea
          [value]="value()"
          (input)="value.set($any($event.target).value)"
          (keydown)="onKeydown($event)"
          [disabled]="disabled()"
          rows="1"
          [placeholder]="placeholder()"
          class="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface-raised px-3 py-2.5 text-sm text-content-primary outline-none focus:border-focus focus:shadow-[0_0_0_1px_rgb(var(--focus-ring))] disabled:bg-surface-sunken disabled:text-content-disabled"
        ></textarea>
        <button (click)="submit()" [appButtonDisabled]="disabled() || !value().trim()" appButton>
          Send
        </button>
      </div>
    </div>
  `,
})
export class Composer {
  readonly disabled = input(false);
  readonly send = output<string>();

  protected readonly value = signal('');

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.submit();
    }
  }
}
