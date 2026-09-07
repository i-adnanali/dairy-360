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
  imports: [IdentifierInput, SessionRequired],
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <header class="space-y-3">
        <h2 class="text-lg font-semibold text-farm-900">Payroll</h2>
        <div class="flex flex-wrap items-end gap-4">
          <label class="space-y-1">
            <span class="block text-xs font-medium uppercase tracking-wide text-farm-600">From</span>
            <input type="date" [value]="from()" (change)="setFrom($any($event.target).value)"
              class="rounded-lg border border-farm-300 px-3 py-2 text-sm" data-role="from" />
          </label>
          <label class="space-y-1">
            <span class="block text-xs font-medium uppercase tracking-wide text-farm-600">To</span>
            <input type="date" [value]="to()" (change)="setTo($any($event.target).value)"
              class="rounded-lg border border-farm-300 px-3 py-2 text-sm" data-role="to" />
          </label>
          <label class="space-y-1">
            <span class="block text-xs font-medium uppercase tracking-wide text-farm-600">
              Paid out by
            </span>
            <app-identifier-input field="observed_by" label="Paid out by" name="observed_by"
              [value]="observedBy()" (changed)="observedBy.set($event)" />
          </label>
        </div>
      </header>

      @if (loadError(); as e) {
        <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" data-role="load-error">{{ e }}</p>
      }

      @if (run(); as r) {
        <!-- Salaried. Above the divider: every row must be answered. -->
        <section class="space-y-3" data-role="permanent">
          <h3 class="text-sm font-semibold text-farm-900">
            Salaried <span class="font-normal text-farm-600">— every row needs a figure</span>
          </h3>

          @if (r.permanent.length === 0) {
            <p class="rounded-xl border border-farm-300 bg-white p-4 text-sm text-farm-600"
              data-role="no-permanent">
              Nobody was on a salaried stint in this period.
            </p>
          } @else {
            <ul class="space-y-2">
              @for (row of r.permanent; track row.engagement.id) {
                <li class="rounded-xl border border-farm-200 bg-white p-3"
                  [attr.data-engagement]="row.engagement.id">
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span class="font-mono text-sm text-farm-900">{{ row.person.identifier }}</span>
                      @if (row.engagement.role) {
                        <span class="ml-2 text-xs text-farm-500">{{ row.engagement.role }}</span>
                      }
                    </div>
                    <!-- The AGREEMENT, read-only and visibly separate from the
                         figure being entered. -->
                    <span class="text-xs text-farm-600" data-role="agreement">
                      @if (row.term) {
                        agreed {{ rate(row) }}
                      } @else {
                        <span class="text-red-700">no package agreed — record one first</span>
                      }
                    </span>
                  </div>

                  <div class="mt-2 flex flex-wrap items-center gap-3">
                    <label class="flex items-center gap-2">
                      <span class="text-xs text-farm-600">Rs</span>
                      <input type="text" inputmode="decimal"
                        [value]="amountOf(row)" (input)="setAmount(row, $any($event.target).value)"
                        [disabled]="!row.term"
                        class="w-32 rounded-lg border border-farm-300 px-3 py-2 text-right text-sm
                          tabular-nums disabled:bg-farm-50"
                        [attr.data-role]="'amount-' + row.person.identifier" />
                    </label>
                    @if (row.existing) {
                      <span class="text-xs text-farm-500" data-role="already-saved">
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
                    <p class="mt-2 text-xs text-farm-600" data-role="milk">
                      milk allowance
                      {{ m.expected_litres ?? '—' }} L due{{ m.partial ? ' to date' : '' }},
                      <span [class.text-amber-800]="differs(m.expected_litres, m.taken_litres)">
                        {{ m.taken_litres }} L taken
                      </span>
                      @if (m.partial) {
                        <span class="text-farm-500">(through {{ m.through_on }})</span>
                      }
                    </p>
                  }
                  @if (packageLines(row); as lines) {
                    @if (lines.length > 0) {
                      <p class="mt-1 text-xs text-farm-500" data-role="package">{{ lines.join(' · ') }}</p>
                    }
                  }
                </li>
              }
            </ul>
          }
        </section>

        <hr class="border-farm-300" />

        <!-- Dihari. Below the divider: nothing here is required, because most
             months most of them were never hired. -->
        <section class="space-y-3" data-role="daily">
          <h3 class="text-sm font-semibold text-farm-900">
            Dihari <span class="font-normal text-farm-600">— only the days somebody worked</span>
          </h3>

          @if (r.daily.length > 0) {
            <ul class="space-y-1 text-sm" data-role="daily-rows">
              @for (d of r.daily; track d.id) {
                <li class="flex items-baseline justify-between rounded-lg bg-white px-3 py-2">
                  <span><span class="font-mono text-xs">{{ d.person.identifier }}</span> — {{ d.from_on }}</span>
                  <span class="tabular-nums">{{ formatMinor(d.amount_minor) }}</span>
                </li>
              }
            </ul>
          }

          @if (r.daily_candidates.length === 0) {
            <p class="text-xs text-farm-500" data-role="no-dihari">
              No dihari stints in this period. Open one on the People screen.
            </p>
          } @else {
            @for (draft of drafts(); track $index) {
              <div class="flex flex-wrap items-end gap-2 rounded-lg border border-farm-200 bg-white p-2"
                data-role="dihari-draft">
                <label class="space-y-1">
                  <span class="block text-xs text-farm-600">Who</span>
                  <select [value]="draft.engagement_id"
                    (change)="setDraft($index, { engagement_id: $any($event.target).value })"
                    class="rounded-lg border border-farm-300 px-2 py-1.5 text-sm">
                    <option value="">Choose…</option>
                    @for (c of r.daily_candidates; track c.engagement.id) {
                      <option [value]="c.engagement.id">{{ c.person.identifier }}</option>
                    }
                  </select>
                </label>
                <label class="space-y-1">
                  <span class="block text-xs text-farm-600">Day</span>
                  <input type="date" [value]="draft.on"
                    (change)="setDraft($index, { on: $any($event.target).value })"
                    class="rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
                </label>
                <label class="space-y-1">
                  <span class="block text-xs text-farm-600">Rs</span>
                  <input type="text" inputmode="decimal" [value]="draft.amount"
                    (input)="setDraft($index, { amount: $any($event.target).value })"
                    class="w-28 rounded-lg border border-farm-300 px-2 py-1.5 text-right text-sm tabular-nums" />
                </label>
                <button type="button" (click)="removeDraft($index)"
                  class="rounded-lg px-2 py-1.5 text-xs text-farm-600 underline">remove</button>
              </div>
            }
            <button type="button" (click)="addDraft()"
              class="rounded-lg border border-farm-300 px-3 py-1.5 text-sm text-farm-800"
              data-role="add-day">Add a day</button>
          }
        </section>

        <!-- Footer: what this run costs, and whether it can be saved. -->
        <footer class="space-y-3 rounded-xl border border-farm-300 bg-farm-50 p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-3 text-sm">
            <span class="font-medium text-farm-900" data-role="answered">
              {{ answeredCount() }} of {{ r.permanent.length }} salaried answered
            </span>
            <span class="tabular-nums text-farm-900" data-role="total">
              {{ formatMinor(draftTotalMinor()) }}
            </span>
          </div>

          @if (state.formError(['entries', 'from_on', 'to_on']); as msg) {
            <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="save-error">{{ msg }}</p>
          }
          @if (state.fieldError('entries'); as msg) {
            <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="entries-error">{{ msg }}</p>
          }

          @if (session.ready()) {
            <button type="button" (click)="save()" [disabled]="!canSave()"
              class="rounded-lg bg-farm-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              data-role="save">
              {{ state.submitting() ? 'Saving…' : 'Save run' }}
            </button>
          } @else {
            <app-session-required what="this run" />
          }
          @if (!allAnswered()) {
            <p class="text-xs text-farm-600" data-role="blocked">
              Every salaried person in this period needs a figure. If somebody was paid nothing,
              enter nothing and say why in a note — an omission is not an answer.
            </p>
          }
        </footer>
      } @else {
        <p class="text-sm text-farm-500">Loading…</p>
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

  protected rate(row: PayrollRunRow): string {
    return row.term ? formatPeriodRate(row.term.cash_minor, row.term.cash_period) : '—';
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
