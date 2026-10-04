import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface WithdrawalNotice {
  animal_id?: string;
  administration_id?: string;
  revision?: number;
  target: string;
  status: string;
  instruction?: string;
  until?: string;
  issuer?: string;
  product_name?: string;
}
/** Missing reference/revision is not evidence that two instructions are duplicates. */
export function groupWithdrawals(notices: WithdrawalNotice[]) {
  const seen = new Set<string>();
  const groups = new Map<string, { animal: string; medium: string; records: WithdrawalNotice[] }>();
  for (const notice of notices) {
    if (notice.administration_id && notice.revision !== undefined) {
      const reference = JSON.stringify([
        notice.animal_id,
        notice.target,
        notice.administration_id,
        notice.revision,
      ]);
      if (seen.has(reference)) continue;
      seen.add(reference);
    }
    const key = JSON.stringify([notice.animal_id, notice.target]);
    const group = groups.get(key) ?? {
      animal: notice.animal_id ?? '',
      medium: notice.target,
      records: [],
    };
    group.records.push(notice);
    groups.set(key, group);
  }
  return [...groups.values()];
}
@Component({
  selector: 'app-withdrawal-notices',
  imports: [RouterLink],
  templateUrl: './withdrawal-notices.html',
  styleUrl: './withdrawal-notices.css',
})
export class WithdrawalNotices {
  protected unknownEnds(records: WithdrawalNotice[]) {
    return records.filter((w) => !w.until).length;
  }
  protected knownEnds(records: WithdrawalNotice[]) {
    return [...new Set(records.map((w) => w.until).filter((end): end is string => !!end))];
  }
  readonly localSource = input(false);
  readonly source = output<string>();
  readonly notices = input<WithdrawalNotice[]>([]);
  readonly expanded = input(false);
  protected readonly groups = computed(() => groupWithdrawals(this.notices()));
}
