// `/payroll` -- the monthly run (docs/REGISTRY_PAYROLL.md §12.1).
//
// A sibling of dispatch-sheet.ts, with one difference: the period is a month
// rather than a session, so this is opened monthly rather than twice a day.
//
// ---------------------------------------------------------------------------
// THE PRE-FILLED FIGURE IS A DEFAULT AND MUST LOOK LIKE ONE
// ---------------------------------------------------------------------------
// The agreement supplies it; the operator is EXPECTED to change it. A month
// with four days' leave is settled by conversation, not arithmetic, and a
// pre-filled amount that looks read-only is exactly how that month gets paid in
// full by reflex. So the field is an ordinary editable input, the agreement is
// shown beside it as a separate read-only line, and the two are visibly
// different things.
//
// Nothing here computes a salary from the calendar. If a proration ever appears
// in this file, the system has started inventing a number nobody agreed to.
//
// ---------------------------------------------------------------------------
// SALARIED ABOVE THE DIVIDER, DIHARI BELOW -- AND THE ORDER IS NOT COSMETIC
// ---------------------------------------------------------------------------
// Everything above must be answered; nothing below must. An operator should be
// able to see whether the run is saveable without reading it. Same structure
// and same reasoning as standing versus occasional destinations.
//
// ---------------------------------------------------------------------------
// A PLAIN ADD-A-DAY FORM, DELIBERATELY -- NO SHORTLIST, NO TWO-CLICK PATH
// ---------------------------------------------------------------------------
// Asked before the build: dihari are hired A FEW TIMES A MONTH. At that cadence
// an accelerator optimises a motion performed a handful of times, and it would
// cost a shortlist that has to be derived, ranked and kept honest. This is the
// same measurement that cut the batch price change from the sales cycle. Build
// it if the cadence turns out to be weekly.

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { FormState } from './form-state';
import { IdentifierInput } from './identifier-input';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog } from './after-write';
import { formatMinor, formatPeriodRate, minorToRupees, rupeesToMinor } from './money';
import { farmToday } from './today';
import { urlParams } from './url-state';
import type { PayrollRun, PayrollRunRow } from './types';
import { Card } from '../ui/surface';
import { Certainty } from '../ui/certainty';
import { NO_RECORD } from './precision-display';
import { ErrorPanel } from '../ui/surface';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { PageHeading } from '../ui/heading';
import { SectionHeading } from '../ui/heading';
import { Button } from '../ui/button';

/** The first of the month `on` falls in, and the last. Farm-local, no clock. */
export function monthBounds(on: string): { from: string; to: string } {
  const [y, m] = on.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

interface DihariDraft {
  engagement_id: string;
  on: string;
  amount: string;
}

@Component({
  selector: 'app-payroll-run',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    Card,
    Certainty,
    ErrorPanel,
    HelpText,
    IdentifierInput,
    PageHeading,
    SectionHeading,
    SessionRequired,
    TextInput,
  ],
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <header class="space-y-3">
        <h2 appPageHeading>Payroll</h2>
        <div class="flex flex-wrap items-end gap-4">
          <label class="space-y-1">
            <span class="block text-xs font-medium uppercase tracking-wide text-content-muted">From</span>
            <input type="date" [value]="from()" (change)="setFrom($any($event.target).value)" appInput density="comfortable" data-role="from" />
          </label>
          <label class="space-y-1">
            <span class="block text-xs font-medium uppercase tracking-wide text-content-muted">To</span>
            <input type="date" [value]="to()" (change)="setTo($any($event.target).value)" appInput density="comfortable" data-role="to" />
          </label>
          <label class="space-y-1">
            <span class="block text-xs font-medium uppercase tracking-wide text-content-muted">
              Paid out by
            </span>
            <app-identifier-input field="observed_by" label="Paid out by" name="observed_by"
              [value]="observedBy()" (changed)="observedBy.set($event)" />
          </label>
        </div>
      </header>

      @if (loadError(); as e) {
        <p appErrorPanel size="lg" data-role="load-error">{{ e }}</p>
      }

      @if (run(); as r) {
        <!-- Salaried. Above the divider: every row must be answered. -->
        <section class="space-y-3" data-role="permanent">
          <h3 appSectionHeading>
            Salaried <span class="font-normal text-content-muted">— every row needs a figure</span>
          </h3>

          @if (r.permanent.length === 0) {
            <p appCard empty
              data-role="no-permanent">
              Nobody was on a salaried stint in this period.
            </p>
          } @else {
            <ul class="space-y-2">
              @for (row of r.permanent; track row.engagement.id) {
                <li class="rounded-xl border border-line-subtle bg-surface-raised p-3"
                  [attr.data-engagement]="row.engagement.id">
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span class="font-mono text-sm text-content-primary">{{ row.person.identifier }}</span>
                      @if (row.engagement.role) {
                        <span class="ml-2 text-xs text-content-subtle">{{ row.engagement.role }}</span>
                      }
                    </div>
                    <!-- The AGREEMENT, read-only and visibly separate from the
                         figure being entered. -->
                    <span appHelp size="xs" data-role="agreement">
                      @if (row.term) {
                        agreed {{ rate(row) }}
                      } @else {
                        <span class="text-danger-soft">no package agreed — record one first</span>
                      }
                    </span>
                  </div>

                  <div class="mt-2 flex flex-wrap items-center gap-3">
                    <label class="flex items-center gap-2">
                      <span appHelp size="xs">Rs</span>
                      <input type="text" inputmode="decimal"
                        [value]="amountOf(row)" (input)="setAmount(row, $any($event.target).value)"
                        [disabled]="!row.term" appInput density="comfortable" class="w-32 text-right font-mono tabular-nums disabled:bg-surface-page"
                        [attr.data-role]="'amount-' + row.person.identifier" />
                    </label>
                    @if (row.existing) {
                      <span appHelp size="xs" tone="subtle" data-role="already-saved">
                        already recorded as {{ formatMinor(row.existing.amount_minor) }}
                      </span>
                    }
                  </div>

                  <!-- The package report, per person. The allowance is on the
                       agreement; the litres are dispatch rows. That they can
                       differ is information, not an error. -->
                  <!-- "to date" when the period is still running. Without it a
                       2 L/day allowance opened on the 7th reads as a 46 L
                       shortfall made of days that have not happened. -->
                  @if (row.milk; as m) {
                    <p class="mt-2 text-xs text-content-muted" data-role="milk">
                      milk allowance
                      <!-- No allowance on the agreement is a no-record, not a
                           zero: a person with no milk in their package has no
                           expected figure to compare against, which is why
                           "differs()" returns false for null rather than
                           treating it as 0 L due. -->
                      <span [appCertainty]="m.expected_litres === null ? 'no-record' : 'known'"
                        [attr.data-certainty]="m.expected_litres === null ? 'no-record' : 'known'"
                      >{{ m.expected_litres ?? noRecord }}</span> L due{{ m.partial ? ' to date' : '' }},
                      <span [class.text-warning-fg]="differs(m.expected_litres, m.taken_litres)">
                        {{ m.taken_litres }} L taken
                      </span>
                      @if (m.partial) {
                        <span class="text-content-subtle">(through {{ m.through_on }})</span>
                      }
                    </p>
                  }
                  @if (packageLines(row); as lines) {
                    @if (lines.length > 0) {
                      <p appHelp size="xs" tone="subtle" class="mt-1" data-role="package">{{ lines.join(' · ') }}</p>
                    }
                  }
                </li>
              }
            </ul>
          }
        </section>

        <hr class="border-line" />

        <!-- Dihari. Below the divider: nothing here is required, because most
             months most of them were never hired. -->
        <section class="space-y-3" data-role="daily">
          <h3 appSectionHeading>
            Dihari <span class="font-normal text-content-muted">— only the days somebody worked</span>
          </h3>

          @if (r.daily.length > 0) {
            <ul class="space-y-1 text-sm" data-role="daily-rows">
              @for (d of r.daily; track d.id) {
                <li class="flex items-baseline justify-between rounded-lg bg-surface-raised px-3 py-2">
                  <span><span class="font-mono text-xs">{{ d.person.identifier }}</span> — {{ d.from_on }}</span>
                  <span class="font-mono tabular-nums">{{ formatMinor(d.amount_minor) }}</span>
                </li>
              }
            </ul>
          }

          @if (r.daily_candidates.length === 0) {
            <p appHelp size="xs" tone="subtle" data-role="no-dihari">
              No dihari stints in this period. Open one on the People screen.
            </p>
          } @else {
            @for (draft of drafts(); track $index) {
              <div class="flex flex-wrap items-end gap-2 rounded-lg border border-line-subtle bg-surface-raised p-2"
                data-role="dihari-draft">
                <label class="space-y-1">
                  <span class="block text-xs text-content-muted">Who</span>
                  <select [value]="draft.engagement_id"
                    (change)="setDraft($index, { engagement_id: $any($event.target).value })" appInput>
                    <option value="">Choose…</option>
                    @for (c of r.daily_candidates; track c.engagement.id) {
                      <option [value]="c.engagement.id">{{ c.person.identifier }}</option>
                    }
                  </select>
                </label>
                <label class="space-y-1">
                  <span class="block text-xs text-content-muted">Day</span>
                  <input type="date" [value]="draft.on"
                    (change)="setDraft($index, { on: $any($event.target).value })" appInput />
                </label>
                <label class="space-y-1">
                  <span class="block text-xs text-content-muted">Rs</span>
                  <input type="text" inputmode="decimal" [value]="draft.amount"
                    (input)="setDraft($index, { amount: $any($event.target).value })" appInput class="w-28 text-right font-mono tabular-nums" />
                </label>
                <button type="button" (click)="removeDraft($index)"
                  class="rounded-lg px-2 py-1.5 text-xs text-content-muted underline">remove</button>
              </div>
            }
            <button type="button" (click)="addDraft()"
              class="rounded-lg border border-line px-3 py-1.5 text-sm text-content-heading"
              data-role="add-day">Add a day</button>
          }
        </section>

        <!-- Footer: what this run costs, and whether it can be saved. -->
        <footer class="space-y-3 rounded-xl border border-line bg-surface-page p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-3 text-sm">
            <span class="font-medium text-content-primary" data-role="answered">
              {{ answeredCount() }} of {{ r.permanent.length }} salaried answered
            </span>
            <span class="font-mono tabular-nums text-content-primary" data-role="total">
              {{ formatMinor(draftTotalMinor()) }}
            </span>
          </div>

          @if (state.formError(['entries', 'from_on', 'to_on']); as msg) {
            <p appErrorPanel data-role="save-error">{{ msg }}</p>
          }
          @if (state.fieldError('entries'); as msg) {
            <p appErrorPanel data-role="entries-error">{{ msg }}</p>
          }

          @if (session.ready()) {
            <button type="button" (click)="save()" [appButtonDisabled]="!canSave()" appButton
              data-role="save" reason="payroll-save-reason">
              {{ state.submitting() ? 'Saving…' : 'Save run' }}
            </button>
          } @else {
            <app-session-required what="this run" />
          }
          @if (!allAnswered()) {
            <p appHelp size="xs" data-role="blocked" id="payroll-save-reason">
              Every salaried person in this period needs a figure. If somebody was paid nothing,
              enter nothing and say why in a note — an omission is not an answer.
            </p>
          }
        </footer>
      } @else {
        <p appHelp tone="subtle">Loading…</p>
      }
    </div>
  `,
})
export class PayrollRunScreen {
  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  private readonly writeLog = inject(WriteLog);

  /**
   * The period lives in the URL. A bare /labour/payroll opens the current month
   * and stays bare; changing either date names that run in the query string, so
   * the Today board can link straight to last month's unanswered run.
   */
  private readonly bounds = monthBounds(farmToday());
  private readonly url = urlParams({ from: this.bounds.from, to: this.bounds.to });
  protected readonly from = computed(() => this.url.value().from);
  protected readonly to = computed(() => this.url.value().to);
  protected readonly observedBy = signal('');

  protected readonly run = signal<PayrollRun | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly state = new FormState<{
    from_on: string;
    to_on: string;
    written: number;
    updated: number;
    total_minor: number;
  }>();

  /** Rupee strings, keyed by engagement. Kept as TEXT until submit, so a
   *  half-typed figure is never silently rounded. */
  protected readonly amounts = signal<Record<string, string>>({});
  protected readonly drafts = signal<DihariDraft[]>([]);

  protected readonly formatMinor = formatMinor;

  constructor() {
    // Driven by the URL rather than by the date controls, so a link that
    // arrives with ?from=&to= already set loads that period -- which is the
    // whole point of putting the period in the URL.
    effect(() => {
      const from = this.from();
      const to = this.to();
      void this.load(from, to);
    });
  }

  private async load(from: string, to: string): Promise<void> {
    try {
      const r = await this.api.payrollRun(from, to);
      this.run.set(r);
      // Pre-fill from what is already recorded, else from the agreement. A row
      // already saved must come back showing the SAVED figure, not the default,
      // or re-opening the run would silently offer to overwrite a corrected
      // month with the agreement.
      const next: Record<string, string> = {};
      for (const row of r.permanent) {
        const minor = row.existing?.amount_minor ?? row.suggested_minor;
        next[row.engagement.id] = minor === null || minor === undefined ? '' : minorToRupees(minor);
      }
      this.amounts.set(next);
      this.drafts.set([]);
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected setFrom(v: string): void {
    if (v.length > 0) this.url.set({ from: v });
  }

  protected setTo(v: string): void {
    if (v.length > 0) this.url.set({ to: v });
  }

  /** §6's no-record glyph, for the template. An en dash. */
  protected readonly noRecord = NO_RECORD;

  /**
   * The no-record branch is UNREACHABLE and is left as a type-level fallback:
   * the only call site sits inside `@if (row.term)`, and a person with no
   * agreement gets the red "no package agreed" line instead. Kept rather than
   * thrown, because `row.term` is nullable and the compiler is right to ask.
   */
  protected rate(row: PayrollRunRow): string {
    return row.term ? formatPeriodRate(row.term.cash_minor, row.term.cash_period) : NO_RECORD;
  }

  /** The in-kind lines, as prose. Never totalled -- see §4.5. */
  protected packageLines(row: PayrollRunRow): string[] {
    return row.benefits
      .filter((b) => b.kind !== 'milk')
      .map((b) =>
        b.quantity === null
          ? b.kind === 'other'
            ? (b.note ?? 'other')
            : b.kind
          : `${b.quantity} ${b.unit} ${b.kind} / ${b.period}`,
      );
  }

  protected differs(expected: number | null, taken: number): boolean {
    if (expected === null) return false;
    return Math.abs(expected - taken) > 0.05;
  }

  protected amountOf(row: PayrollRunRow): string {
    return this.amounts()[row.engagement.id] ?? '';
  }

  protected setAmount(row: PayrollRunRow, value: string): void {
    this.amounts.update((m) => ({ ...m, [row.engagement.id]: value }));
  }

  protected addDraft(): void {
    this.drafts.update((d) => [
      ...d,
      { engagement_id: '', on: this.to(), amount: this.suggestedDihari() },
    ]);
  }

  private suggestedDihari(): string {
    const c = this.run()?.daily_candidates[0];
    return c?.suggested_minor ? minorToRupees(c.suggested_minor) : '';
  }

  protected setDraft(i: number, patch: Partial<DihariDraft>): void {
    this.drafts.update((d) => d.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  }

  protected removeDraft(i: number): void {
    this.drafts.update((d) => d.filter((_, n) => n !== i));
  }

  protected readonly answeredCount = computed(() => {
    const r = this.run();
    if (!r) return 0;
    return r.permanent.filter((row) => rupeesToMinor(this.amountOf(row)) !== null).length;
  });

  protected readonly allAnswered = computed(() => {
    const r = this.run();
    if (!r) return false;
    return r.permanent.every((row) => rupeesToMinor(this.amountOf(row)) !== null);
  });

  /**
   * What this run would cost, from what is TYPED -- not from what is saved.
   *
   * The footer has to move as the operator edits, or the number is a
   * description of the last save rather than of the thing being agreed to.
   */
  protected readonly draftTotalMinor = computed(() => {
    const r = this.run();
    if (!r) return 0;
    let total = 0;
    for (const row of r.permanent) total += rupeesToMinor(this.amountOf(row)) ?? 0;
    for (const d of this.drafts()) total += rupeesToMinor(d.amount) ?? 0;
    for (const d of r.daily) total += d.amount_minor;
    return total;
  });

  protected readonly canSave = computed(
    () => !this.state.submitting() && this.allAnswered() && this.run() !== null,
  );

  protected async save(): Promise<void> {
    const r = this.run();
    if (!r || !this.canSave()) return;

    const entries: Record<string, unknown>[] = r.permanent.map((row) => ({
      engagement_id: row.engagement.id,
      amount_minor: rupeesToMinor(this.amountOf(row)),
    }));
    for (const d of this.drafts()) {
      const minor = rupeesToMinor(d.amount);
      if (d.engagement_id.length === 0 || minor === null) continue;
      entries.push({ engagement_id: d.engagement_id, from_on: d.on, amount_minor: minor });
    }

    const observed = this.observedBy().trim();
    const result = await this.state.run((key) =>
      this.api.saveRun(
        {
          from_on: this.from(),
          to_on: this.to(),
          entries: observed.length > 0 ? entries.map((e) => ({ ...e, observed_by: observed })) : entries,
          ...this.session.provenance(),
        },
        key,
      ),
    );
    if (result) {
      this.writeLog.announce(
        `Payroll ${this.from()} to ${this.to()}: ${result.written} recorded, ` +
          `${formatMinor(result.total_minor)}`,
      );
      await this.load(this.from(), this.to());
    }
  }
}
