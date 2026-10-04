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
import { Assistant } from "../../core/assistant";
import { TextInput } from "../../ui/input";
import { Button } from "../../ui/button";

// Port of web-react/src/components/Composer.tsx
@Component({
  selector: 'app-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TextInput],
  templateUrl: './composer.html',
  styleUrl: './composer.css',
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
