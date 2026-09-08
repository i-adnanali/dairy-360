import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TurnItem } from '../core/turn-item.type';
import { ChartCard } from './chart-card';
import { MarkdownView } from './markdown-view';
import { ToolCallChip } from './tool-call-chip';

// Port of web-react/src/components/Message.tsx
@Component({
  selector: 'app-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ToolCallChip, ChartCard, MarkdownView],
  template: `
    @if (item().role === 'user') {
      <div class="flex justify-end">
        <div
          class="max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-content-onFill shadow-sm"
        >
          {{ item().text }}
        </div>
      </div>
    } @else if (assistant(); as a) {
      <div class="flex flex-col items-start gap-2">
        @if (a.agent) {
          <span
            class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium lowercase"
            [class]="agentClass()"
            title="Which agent the dispatcher routed this turn to"
          >
            <span class="opacity-60">⟨</span>{{ a.agent }}<span class="opacity-60">⟩</span>
          </span>
        }

        @if (a.text) {
          <div
            class="prose-chat max-w-[85%] rounded-2xl rounded-bl-sm border border-line-subtle bg-surface-raised px-4 py-3 text-sm text-content-primary shadow-sm"
          >
            <app-markdown-view [text]="a.text" />
          </div>
        }

        @if (a.toolCalls.length > 0) {
          <div class="flex flex-wrap gap-1.5">
            @for (tc of a.toolCalls; track tc.toolUseId) {
              <app-tool-call-chip [call]="tc" />
            }
          </div>
        }

        @if (a.datasets.length > 0) {
          <div class="w-full space-y-3">
            @for (ds of a.datasets; track ds.datasetId) {
              <app-chart-card [dataset]="ds" />
            }
          </div>
        }
      </div>
    }
  `,
})
export class Message {
  readonly item = input.required<TurnItem>();

  protected readonly assistant = computed(() => {
    const it = this.item();
    return it.role === 'assistant' ? it : null;
  });

  protected readonly agentClass = computed(() => {
    switch (this.assistant()?.agent) {
      case 'dairy':
        return 'bg-agent-dairy-bg text-agent-dairy-fg border-agent-dairy-line';
      case 'vendor':
        return 'bg-warning-bg text-agent-vendor-fg border-agent-vendor-line';
      case 'both':
        return 'bg-agent-both-bg text-agent-both-fg border-agent-both-line';
      default:
        return 'bg-surface-sunken text-content-muted border-line-subtle';
    }
  });
}
