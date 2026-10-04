import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { Approval, PendingWrite } from '@dairy/shared';
import { Cell } from "../../ui/cell";
import { Button } from "../../ui/button";
import { ScrollRegion } from "../../ui/scroll-region";
import { StatusBadge } from "../../ui/surface";

// Port of web-react/src/components/ConfirmationCard.tsx
@Component({
  selector: 'app-confirmation-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Cell, StatusBadge, ScrollRegion],
  templateUrl: './confirmation-card.html',
  styleUrl: './confirmation-card.css',
})
export class ConfirmationCard {
  readonly card = input.required<PendingWrite>();
  readonly decision = input<'approved' | 'rejected' | null>(null);
  readonly reason = input('');
  readonly outcome = input<'awaiting' | 'recorded' | 'refused' | 'unknown'>('awaiting');
  protected readonly statusLabel = computed(() => {
    const decision = this.decision() || this.resolved();
    if (decision === 'rejected') return 'Rejected';
    if (!decision) return 'Approval requested';
    return { awaiting: 'Approved · awaiting result', recorded: 'Recorded', refused: 'Not recorded', unknown: 'Outcome unknown' }[this.outcome()];
  });
  protected readonly outcomeDescription = computed(() => {
    if ((this.decision() || this.resolved()) === 'rejected') return 'Not authorized; no execution requested.';
    return { awaiting: 'Approval is recorded; waiting for an execution result.', recorded: 'Execution reported success.', refused: 'Execution was refused; no successful result was reported.', unknown: 'No definite execution result. Check the record before attempting another write.' }[this.outcome()];
  });
  protected readonly resolved = signal<'approved' | 'rejected' | null>(null);
  readonly resolve = output<Approval[]>();

  protected approve(): void {
    if (this.resolved() || this.decision()) return;
    this.resolved.set('approved');
    this.resolve.emit([{ toolUseId: this.card().toolUseId, approved: true }]);
  }

  protected reject(): void {
    if (this.resolved() || this.decision()) return;
    this.resolved.set('rejected');
    this.resolve.emit([{ toolUseId: this.card().toolUseId, approved: false }]);
  }
}
