import { RouterLink } from '@angular/router';
import { labourPresentation } from "../check-presentation";
import { ScrollRegion } from "../../ui/scroll-region";
import { LocalPagination } from "../../ui/local-pagination/local-pagination";
import { ShellActions } from "../navigation";
// The verification read: invariants, precision histogram, calving intervals.
//
// ---------------------------------------------------------------------------
// READ-ONLY, AND NOTHING BRANCHES ON IT
// ---------------------------------------------------------------------------
// Two conditions this view is built under, both deliberate:
//
//   1. NO VIEW BRANCHES ON IT. No other component reads this data, nothing is
//      hidden or enabled by it, no form consults it before submitting. It is a
//      window, not a gate -- the moment something depends on it, it stops being
//      a diagnostic and becomes load-bearing, and then a wrong number here
//      breaks entry instead of informing it.
//
//   2. VISIBLY DIAGNOSTIC, NOT DECORATIVE. Numbers to read, not a badge that
//      turns green. A green tick invites you to glance at the colour and stop
//      looking, which is how a check you do not read becomes a check that is
//      not a check. So: counts, a histogram you have to interpret, and
//      violations printed in full with their invariant numbers.
//
// It exists because the alternative was switching to a terminal mid-entry to
// read the histogram, which nobody keeps doing past animal five.

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RegistryApi } from "../api";
import { urlParams } from "../url-state";
import { formatMinor, formatRate } from "../money";
import { farmToday } from "../today";
import type { Reconciliation, Verification } from "../types";
import { Certainty } from "../../ui/certainty";
import { NO_RECORD } from "../precision-display";
import { Cell } from "../../ui/cell";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { HelpText } from "../../ui/text";
import { PageHeading } from "../../ui/heading";
import { RowDivider } from "../../ui/surface";
import { SectionHeading } from "../../ui/heading";
import { SectionLabel } from "../../ui/text";
import { SubHeading } from "../../ui/heading";

@Component({
  selector: 'app-verification-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LocalPagination,
    RouterLink,
    ScrollRegion,
    Card,
    Cell,
    Certainty,
    ErrorPanel,
    HelpText,
    PageHeading,
    RowDivider,
    SectionHeading,
    SectionLabel,
    SubHeading,
  ],
  templateUrl: './verification-panel.html',
  styleUrl: './verification-panel.css',
})
export class VerificationPanel {
  /** §6's no-record glyph, for the template. An en dash. */
  protected readonly noRecord = NO_RECORD;

  private readonly api = inject(RegistryApi);

  protected readonly metadata = (context: unknown) =>
    context ? JSON.stringify(context, null, 2) : 'No structured context supplied';
  protected readonly humanCode = (code: string) =>
    code
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .replace(/^./, (s) => s.toUpperCase());
  protected readonly labour = labourPresentation;
  protected readonly loading = signal(false);
  protected readonly reconcileError = signal('');
  private request = 0;
  protected readonly v = signal<Verification | null>(null);
  protected readonly reconciliation = signal<Reconciliation | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly actions = inject(ShellActions);
  constructor() {
    effect(() => {
      this.actions.recheck();
      void this.load();
    });
  }

  /**
   * `?as_of=` pins the run to a date. Absent -- the normal case -- means today,
   * and the URL stays bare so a bookmark to /check keeps meaning "now".
   *
   * There is deliberately NO date control for this. /check answers "how does it
   * look", and a date picker would invite treating it as a history browser,
   * which it is not. The parameter exists so a violation can be reproduced from
   * a link somebody sent.
   */
  private readonly url = urlParams({ as_of: '' });
  protected readonly asOf = computed(() => this.url.value().as_of || undefined);

  protected async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.loadError.set(null);
    this.reconcileError.set('');
    const [verification, reconciliation] = await Promise.allSettled([
      this.api.verification(this.asOf()),
      this.api.reconcile(this.rangeStart(), farmToday()),
    ]);
    if (request !== this.request) return;
    if (verification.status === 'fulfilled') this.v.set(verification.value);
    else this.loadError.set(String(verification.reason));
    if (reconciliation.status === 'fulfilled') this.reconciliation.set(reconciliation.value);
    else {
      this.reconciliation.set(null);
      this.reconcileError.set(String(reconciliation.reason));
    }
    this.loading.set(false);
  }

  /** The trailing window the gap is reported over. */
  private rangeStart(): string {
    const [y, m, d] = farmToday().split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - RECONCILE_DAYS + 1)).toISOString().slice(0, 10);
  }

  protected money(minor: number): string {
    return formatMinor(minor);
  }

  protected rate(minor: number, unit: number): string {
    return formatRate(minor, unit);
  }
}

/** Trailing days the /check reconciliation covers. A diagnostic window. */
const RECONCILE_DAYS = 30;
