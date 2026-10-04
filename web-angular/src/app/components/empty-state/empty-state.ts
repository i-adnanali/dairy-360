import { Assistant } from "../../core/assistant";
import { Button } from "../../ui/button";
import { Card } from "../../ui/surface";
import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';

const STARTERS = [
  "How did the Kundi group's milk yield trend over the last 30 days?",
  'Which animals have a health event due in the next two weeks?',
  "Log this morning's milking for the Kundi group.",
];

// Port of web-react/src/components/EmptyState.tsx
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Card],
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.css',
})
export class EmptyState {
  readonly pick = output<string>();
  private readonly assistant = inject(Assistant);
  protected readonly starters = computed(() => {
    const context = this.assistant.context();
    if (!context) return STARTERS;
    return [`Review ${context} and explain what is missing.`, `Summarize the recorded facts for ${context}.`, `What should I check before recording changes for ${context}?`];
  });
}
