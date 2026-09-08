import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { ToolCallView } from '@dairy/shared';

// Port of web-react/src/components/ToolCallChip.tsx
@Component({
  selector: 'app-tool-call-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      (click)="open.set(!open())"
      class="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition"
      [class]="chipClass()"
      [title]="call().argSummary"
    >
      <span class="h-1.5 w-1.5 rounded-full" [class]="dotClass()"></span>
      <span class="font-medium">{{ call().name }}</span>
      <span class="opacity-70">{{ call().status }}</span>
      @if (open()) {
        <span class="ml-1 truncate font-mono opacity-80">{{ call().argSummary }}</span>
      }
    </button>
  `,
})
export class ToolCallChip {
  readonly call = input.required<ToolCallView>();

  protected readonly open = signal(false);
  protected readonly isError = computed(() => this.call().status === 'error');

  protected readonly chipClass = computed(() =>
    this.isError()
      ? 'border-danger-line bg-danger-bg text-danger-soft'
      : 'border-line-subtle bg-surface-sunken text-content-secondary hover:bg-brand-badge',
  );

  protected readonly dotClass = computed(() =>
    this.isError() ? 'bg-danger-dot' : 'bg-success-dot',
  );
}
