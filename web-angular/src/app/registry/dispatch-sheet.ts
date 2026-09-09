import { StatusBadge } from '../ui/surface';
// `/dispatch` -- where the milk went (docs/REGISTRY_SALES.md §12.1).
//
// A sibling of milking-roster.ts, and it should feel like the same motion,
// because it is done by the same person minutes later.
//
// ---------------------------------------------------------------------------
// THE BODY IS IN TWO PARTS, AND THE DIVIDER IS LOAD-BEARING
// ---------------------------------------------------------------------------
// STANDING destinations -- the dodhi, home -- are one row each and untouched
// BLOCKS THE SAVE. OCCASIONAL ones -- the households, who take surplus -- are
// not rows until they took something.
//
// That split is not a convenience. Forcing a household who comes eight days a
// month to answer "took nothing" on the other fifty-two sessions is ~1,400
// deliberate non-events a year, and a mandatory field answered by reflex stops
// protecting the dodhi row too. The cost is stated where it lands: an
// occasional sale nobody records leaves no hole here, and the reconciliation is
// the only thing that catches it -- which is why the footer shows production.
//
// Everything above the divider must be answered; nothing below it must. An
// operator should be able to see whether the sheet is saveable without reading
// it.

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChipGroup } from './chip-group';
import { Cell } from '../ui/cell';
import { Certainty } from '../ui/certainty';
import type { CertaintyState } from '../ui/certainty';
import { NO_RECORD } from './precision-display';
import { FormState } from './form-state';
import { Identifiers } from './identifiers';
import { IdentifierInput } from './identifier-input';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog } from './after-write';
import { amountMinor, formatMinor, formatRate } from './money';
import { farmToday, likelySession } from './today';
import { urlParams } from './url-state';
import type { DispatchSheet, MilkingSession, SheetRow } from './types';
import { Card } from '../ui/surface';
import { ErrorPanel } from '../ui/surface';
import { FieldLabel } from '../ui/text';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { PageHeading } from '../ui/heading';
import { RowDivider } from '../ui/surface';
import { TextLink } from '../ui/text';
import { Button } from '../ui/button';
import { SummaryBar } from '../ui/surface';

/**
 * A row's pending answer.
 *
 * `status: null` is UNTOUCHED, which for a standing destination blocks the save
 * and for an occasional one simply means they are not on the sheet.
 */
interface Draft {
  status: 'taken' | 'none' | null;
  litres: string;
  reason: string;
}

const EMPTY: Draft = { status: null, litres: '', reason: '' };

@Component({
  selector: 'app-dispatch-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StatusBadge,
    Button,
    Card,
    Cell,
    Certainty,
    ChipGroup,
    ErrorPanel,
    FieldLabel,
    HelpText,
    IdentifierInput,
    PageHeading,
    RouterLink,
    RowDivider,
    SessionRequired,
    SummaryBar,
    TextInput,
    TextLink,
  ],
  template: `
    <form class="mx-auto max-w-4xl space-y-4" (submit)="onSubmit($event)">
      <header>
        <h2 appPageHeading>Where the milk went</h2>
        <p appHelp class="mt-1">
          One session, and everything that left the bulk in it — sold and kept. The dodhi and the
          house are on every sheet; a neighbour appears only when they took something.
        </p>
      </header>

      <!-- when -->
      <div appCard>
        <div class="flex flex-wrap items-end gap-4">
          <label class="block">
            <span appFieldLabel>Date</span>
            <input
              type="date"
              data-role="on"
              [value]="on()"
              (change)="setOn($any($event.target).value)"
              appInput
            />
          </label>
          <div>
            <div appFieldLabel inline>Session</div>
            <app-chip-group
              name="session"
              label="Session"
              [options]="sessionChips"
              [value]="session()"
              (changed)="setSession($any($event))"
            />
          </div>
          <div class="ml-auto">
            <app-identifier-input
              field="observed_by"
              label="Handed over by"
              [value]="handedBy()"
              [suggestions]="identifiers.values().observed_by"
              (changed)="handedBy.set($event)"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-content-muted" data-role="today-note">
          Defaults to today and this session — the one place a date is defaulted, because today is a
          fact rather than a guess. Change it to enter a session you missed.
        </p>
      </div>

      @if (loadError(); as e) {
        <p appErrorPanel size="lg" data-role="load-error">{{ e }}</p>
      } @else if (sheet(); as s) {
        @if (s.standing.length === 0 && s.occasional.length === 0) {
          <p appCard empty data-role="nobody">
            Nobody was taking milk on {{ s.occurred_on }}.
            <a routerLink="/milk/buyers" appTextLink tone="strong">Add a buyer</a>
            — and add the house too, so milk kept at home is on the record rather than in the gap.
          </p>
        } @else {
          <!-- MUST be answered -->
          <div class="overflow-hidden rounded-xl border border-line bg-surface-raised">
            <div
              class="border-b border-line-subtle bg-surface-page px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-content-secondary"
              data-role="standing-head"
            >
              Every session — leave none of these unanswered
            </div>
            <table class="w-full text-left text-sm">
              <thead
                class="border-b border-line-subtle text-xs uppercase tracking-wide text-content-muted"
              >
                <tr>
                  <th appCell>Goes to</th>
                  <th appCell numeric nowrap>Yesterday {{ s.previous_session.session }}</th>
                  <th appCell numeric nowrap>Rate</th>
                  <th appCell>Litres</th>
                  <th appCell numeric>Amount</th>
                </tr>
              </thead>
              <tbody>
                @for (row of s.standing; track row.destination_id; let i = $index) {
                  <!-- The standing rows are the ones the header calls "leave
                       none of these unanswered", so they are exactly §3.2's
                       case: a destination lost in the sheet, findable at row
                       scale. The occasional rows below take no such treatment --
                       "nothing to answer here" is their own header. -->
                  <tr
                    appRowDivider
                    [attr.data-row]="row.destination_id"
                    [unanswered]="draft(row.destination_id).status === null"
                    [attr.data-certainty]="
                      draft(row.destination_id).status === null ? 'unanswered' : null
                    "
                  >
                    <td appCell density="compact" nowrap>
                      <span class="text-content-heading">{{ row.name }}</span>
                      @if (!row.billable) {
                        <span appBadge class="ml-2 whitespace-nowrap" data-role="not-billed"
                          >kept, not sold</span
                        >
                      }
                    </td>
                    <td appCell density="compact" numeric tone="secondary" data-role="previous">
                      <span
                        [appCertainty]="previousState(row)"
                        [attr.data-certainty]="previousState(row)"
                        >{{ previousText(row) }}</span
                      >
                    </td>
                    <!-- Right-aligned but NOT numeric, and that is what keeps this
                         sheet its original height.

                         "Rs 7,000.00 / 40 L" is a composite rate label, identical in
                         every row -- not a column of digits anybody scans down. Given
                         the numeric prop it was monospaced, and mono is wider: table
                         layout took the width back off the litres cell, whose wrapping
                         flex row then dropped the "already saved" note onto a second
                         line and grew the sheet 48px. Alignment without the face costs
                         nothing and gives nothing up, because there is nothing here to
                         align against.

                         The AMOUNT column next door keeps numeric and keeps mono. It
                         is a real figure column -- rupees, section 4 -- and it is the
                         reason the litres cell is tighter than it was. It fits. -->
                    <td
                      appCell
                      density="compact"
                      nowrap
                      small
                      tone="muted"
                      class="text-right"
                      data-role="rate"
                    >
                      @if (rateState(row); as st) {
                        <span [appCertainty]="st" [attr.data-certainty]="st">{{
                          rateText(row)
                        }}</span>
                      } @else {
                        {{ rateText(row) }}
                      }
                    </td>
                    <td appCell density="compact">
                      <div class="flex flex-wrap items-center gap-2">
                        <input
                          #cell
                          [attr.data-role]="'litres-' + row.destination_id"
                          inputmode="decimal"
                          [value]="draft(row.destination_id).litres"
                          [disabled]="draft(row.destination_id).status === 'none'"
                          (input)="typeLitres(row.destination_id, $any($event.target).value)"
                          (keydown)="onKey($event, i)"
                          class="w-24 rounded-lg border border-line px-2 py-1 text-sm disabled:bg-surface-page"
                        />
                        <button
                          type="button"
                          [attr.data-role]="'none-' + row.destination_id"
                          (click)="markNone(row.destination_id)"
                          [class]="noneClass(row.destination_id)"
                        >
                          nothing taken
                        </button>
                        @if (draft(row.destination_id).status === 'none') {
                          <input
                            [attr.data-role]="'reason-' + row.destination_id"
                            [value]="draft(row.destination_id).reason"
                            (input)="setReason(row.destination_id, $any($event.target).value)"
                            placeholder="why (optional)"
                            class="w-44 rounded-lg border border-line px-2 py-1 text-sm"
                          />
                        }
                        @if (row.existing) {
                          <span
                            class="text-xs italic text-content-subtle"
                            [attr.data-role]="'saved-' + row.destination_id"
                            >already saved</span
                          >
                        }
                      </div>
                    </td>
                    <td
                      appCell
                      density="compact"
                      numeric
                      tone="secondary"
                      [attr.data-role]="'amount-' + row.destination_id"
                    >
                      <span
                        [appCertainty]="amountState(row)"
                        [attr.data-certainty]="amountState(row)"
                        >{{ amountText(row) }}</span
                      >
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- OFFERED, never required -->
          @if (s.occasional.length > 0) {
            <div
              class="overflow-hidden rounded-xl border border-dashed border-line bg-surface-raised"
            >
              <div
                class="border-b border-line-subtle px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-content-muted"
                data-role="occasional-head"
              >
                Only if they came — nothing to answer here
              </div>
              <table class="w-full text-left text-sm">
                <tbody>
                  @for (row of s.occasional; track row.destination_id) {
                    <tr appRowDivider [attr.data-row]="row.destination_id">
                      <td appCell density="compact" tone="heading">
                        {{ row.name }}
                        @if (rateState(row); as st) {
                          <span
                            class="ml-2 text-xs"
                            [appCertainty]="st"
                            [attr.data-certainty]="st"
                            data-role="rate"
                            >{{ rateText(row) }}</span
                          >
                        } @else {
                          <span class="ml-2 text-xs text-content-subtle" data-role="rate">{{
                            rateText(row)
                          }}</span>
                        }
                      </td>
                      <td appCell density="compact">
                        @if (draft(row.destination_id).status === null) {
                          <button
                            type="button"
                            [attr.data-role]="'add-' + row.destination_id"
                            (click)="addOccasional(row.destination_id)"
                            class="rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs text-content-secondary hover:border-line-strong"
                          >
                            they took some
                          </button>
                        } @else {
                          <div class="flex items-center gap-2">
                            <input
                              [attr.data-role]="'litres-' + row.destination_id"
                              inputmode="decimal"
                              [value]="draft(row.destination_id).litres"
                              (input)="typeLitres(row.destination_id, $any($event.target).value)"
                              class="w-24 rounded-lg border border-line px-2 py-1 text-sm"
                            />
                            <span
                              class="text-sm"
                              [appCertainty]="amountState(row)"
                              [attr.data-certainty]="amountState(row)"
                              [attr.data-role]="'amount-' + row.destination_id"
                              >{{ amountText(row) }}</span
                            >
                            <button
                              type="button"
                              [attr.data-role]="'remove-' + row.destination_id"
                              (click)="removeOccasional(row.destination_id)"
                              class="text-xs text-content-subtle underline hover:text-content-secondary"
                            >
                              didn't come
                            </button>
                          </div>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- THE FOOTER, and the reason it carries production -->
          <div
            appSummaryBar
            class="flex flex-wrap items-center justify-between gap-4 bg-surface-raised"
          >
            <span data-role="resolved">
              <span class="text-content-muted">Answered </span>
              <span class="font-medium text-content-primary"
                >{{ answered() }} of {{ s.standing.length }}</span
              >
              <span class="text-content-muted"> required</span>
            </span>
            <span data-role="out">
              <span class="text-content-muted">Out </span>
              <span class="font-medium text-content-primary">{{ totalLitres() }} L</span>
              <span class="text-content-muted"> · billed </span>
              <span class="font-medium text-content-primary">{{ totalAmount() }}</span>
            </span>
            <span data-role="produced">
              <span class="text-content-muted">Measured this session </span>
              <span class="font-medium text-content-primary"
                >{{ s.produced.measured_litres }} L</span
              >
              @if (s.produced.not_measured > 0) {
                <span class="text-content-muted">
                  · {{ s.produced.not_measured }} milked but not weighed</span
                >
              }
            </span>
          </div>

          <!-- Not an alert. See the comment on producedNote(). -->
          @if (producedNote(); as note) {
            <p
              class="rounded-xl bg-surface-page px-4 py-2 text-xs text-content-secondary"
              data-role="produced-note"
            >
              {{ note }}
            </p>
          }
        }
      } @else {
        <p appHelp data-role="loading">Loading…</p>
      }

      @if (state.formError(fields); as e) {
        <p appErrorPanel data-role="error-form">{{ e }}</p>
      }

      <div class="flex items-center gap-3">
        @if (session_.ready()) {
          <button
            type="submit"
            data-role="submit"
            [appButtonDisabled]="!canSubmit()"
            appButton
            reason="dispatch-submit-reason"
          >
            {{ state.submitting() ? 'Saving…' : 'Save session' }}
          </button>
        } @else {
          <app-session-required what="this session" />
        }
        @if (blockedReason(); as b) {
          <span appHelp data-role="blocked" id="dispatch-submit-reason">{{ b }}</span>
        }
      </div>
    </form>
  `,
})
export class DispatchSheetScreen {
  private readonly api = inject(RegistryApi);
  protected readonly session_ = inject(Session);
  private readonly writeLog = inject(WriteLog);
  protected readonly identifiers = inject(Identifiers);

  private readonly cells = viewChildren<ElementRef<HTMLInputElement>>('cell');

  protected readonly fields = [
    'occurred_on',
    'session',
    'entries',
    'destination_id',
    'litres',
  ] as const;
  protected readonly sessionChips = [
    { value: 'morning', label: 'Morning' },
    { value: 'evening', label: 'Evening' },
  ];
  protected readonly state = new FormState<{
    written: number;
    litres: number;
    amount_minor: number;
    updated: number;
  }>();

  /**
   * The date and session live in the URL, not in a component signal.
   *
   * A bare /milk/... opens today's likely session and STAYS bare; changing
   * either puts it in the query string, at which point the URL names that
   * specific sheet and can be sent to somebody. See url-state.ts.
   */
  private readonly url = urlParams({ on: farmToday(), session: likelySession() });
  protected readonly on = computed(() => this.url.value().on);
  // VALIDATED, not cast: `?session=lunch` is a URL somebody can type, and
  // passing it through would produce a server refusal on a screen that has no
  // field to attach it to.
  protected readonly session = computed<MilkingSession>(() => {
    const raw = this.url.value().session;
    return raw === 'morning' || raw === 'evening' ? raw : likelySession();
  });
  protected readonly handedBy = signal('');

  protected readonly sheet = signal<DispatchSheet | null>(null);
  protected readonly loadError = signal<string | null>(null);
  private readonly drafts = signal<Record<string, Draft>>({});

  constructor() {
    void this.identifiers.refresh();
    effect(() => {
      const on = this.on();
      const s = this.session();
      void this.load(on, s);
    });
  }

  private async load(on: string, session: MilkingSession): Promise<void> {
    try {
      const s = await this.api.dispatchSheet(on, session);
      // A session already saved comes back filled in, so re-opening one is a
      // correction rather than a blank slate that would overwrite it.
      const drafts: Record<string, Draft> = {};
      for (const row of [...s.standing, ...s.occasional]) {
        drafts[row.destination_id] = row.existing
          ? {
              status: row.existing.status,
              litres: row.existing.litres === null ? '' : String(row.existing.litres),
              reason: row.existing.reason ?? '',
            }
          : { ...EMPTY };
      }
      this.drafts.set(drafts);
      this.sheet.set(s);
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected setOn(v: string): void {
    if (v.length > 0) this.url.set({ on: v });
  }

  protected setSession(s: MilkingSession): void {
    this.url.set({ session: s });
  }

  protected draft(id: string): Draft {
    return this.drafts()[id] ?? EMPTY;
  }

  private patch(id: string, d: Partial<Draft>): void {
    this.drafts.update((all) => ({ ...all, [id]: { ...(all[id] ?? EMPTY), ...d } }));
  }

  /**
   * Typing a number IS the answer.
   *
   * Clearing the field returns the row to untouched rather than to a zero: an
   * empty box means nothing was said, and a zero would be a claim that they came
   * and took nothing -- which is what "nothing taken" is for.
   */
  protected typeLitres(id: string, v: string): void {
    const trimmed = v.trim();
    this.patch(id, { litres: v, status: trimmed.length === 0 ? null : 'taken', reason: '' });
  }

  protected markNone(id: string): void {
    const current = this.draft(id).status;
    this.patch(id, current === 'none' ? { ...EMPTY } : { status: 'none', litres: '', reason: '' });
  }

  protected setReason(id: string, v: string): void {
    this.patch(id, { reason: v });
  }

  /** An occasional destination becomes a row only when someone says it did. */
  protected addOccasional(id: string): void {
    this.patch(id, { status: 'taken', litres: '', reason: '' });
  }

  protected removeOccasional(id: string): void {
    this.patch(id, { ...EMPTY });
  }

  /** Enter commits and advances. Same motion as the milking roster. */
  protected onKey(e: KeyboardEvent, index: number): void {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const el = this.cells()[index + 1]?.nativeElement;
    if (el) {
      el.focus();
      if (!el.disabled) el.select();
    }
  }

  protected previousText(row: SheetRow): string {
    const p = row.previous;
    if (!p) return NO_RECORD;
    return p.status === 'taken' ? `${p.litres}` : 'nothing';
  }

  /**
   * The same three branches as a certainty state.
   *
   * `'none'` is DELIBERATELY ABSENT, which is the whole distinction: a
   * destination that was offered milk and took none gave an answer, and one
   * that was never on the sheet that session did not. Both used to render as
   * `tone="secondary"` -- and one of them as a dash and the other as the word
   * `nothing`, so the copy already knew the difference the type did not show.
   */
  protected previousState(row: SheetRow): CertaintyState {
    const p = row.previous;
    if (!p) return 'no-record';
    return p.status === 'taken' ? 'known' : 'absent';
  }

  /**
   * The rate AS AGREED, never converted to per-litre.
   *
   * On the sheet so a wrong-destination entry is visible before it is saved,
   * and in the unit the operator thinks in, so the amount beside it is
   * checkable rather than trusted.
   */
  protected rateText(row: SheetRow): string {
    if (!row.billable) return 'not billed';
    if (row.price === null) return 'no price agreed';
    return formatRate(row.price.price_minor, row.price.price_unit_litres);
  }

  /**
   * The rate cell's certainty -- and `known` IS DELIBERATELY NOT ONE OF THE
   * ANSWERS.
   *
   * §6's `known` treatment carries `font-mono tabular-nums`, and the comment on
   * the rate cell in the template is the record of what that costs here: given
   * the monospace face this composite label grew the sheet 48px, because table
   * layout took the width back off the litres cell. §11 lists it as the single
   * most expensive surprise of phase 4.
   *
   * The rate is a LABEL, identical in every row, not a value whose certainty a
   * reader is weighing -- so it takes a state only when it is saying that
   * something is missing, and otherwise stays exactly as it renders today.
   */
  protected rateState(row: SheetRow): CertaintyState | null {
    if (!row.billable) return 'absent';
    if (row.price === null) return 'no-record';
    return null;
  }

  private rowAmountMinor(row: SheetRow): number {
    const d = this.draft(row.destination_id);
    if (d.status !== 'taken' || !row.billable || row.price === null) return 0;
    const litres = Number(d.litres);
    if (!Number.isFinite(litres)) return 0;
    return amountMinor(litres, row.price.price_minor, row.price.price_unit_litres);
  }

  /**
   * ---------------------------------------------------------------------------
   * TWO OF THE THREE DASHES HERE WERE HIDING A REASON, AND ONE WAS NOT.
   * ---------------------------------------------------------------------------
   * All three branches returned `—`, and §15 rule 1 is that "an absence is
   * named, not blanked ... The one dash permitted is §6's no-record state, which
   * is the absence of an answer rather than an answer."
   *
   *   nothing taken yet    the row is unanswered and already says so, in amber,
   *                        at row scale. The dash is right: there is nothing to
   *                        name that is not already on screen. NO-RECORD.
   *   not billable         a REASON, and one the rate column beside it already
   *                        prints in words. So the amount says it too rather
   *                        than going blank. DELIBERATELY ABSENT.
   *   no agreed price      nobody ever recorded a price. NO-RECORD, but in
   *                        words, because "no price" tells a reader what to go
   *                        and fix and a dash does not.
   *
   * The rule that falls out, and it is the one §6 wants: THE DASH IS FOR WHEN
   * THERE IS NOTHING TO SAY THAT IS NOT ALREADY SAID. Where the absence has a
   * reason worth naming, name it -- and the treatment follows the fact, not the
   * glyph.
   */
  protected amountText(row: SheetRow): string {
    const d = this.draft(row.destination_id);
    if (d.status !== 'taken') return NO_RECORD;
    if (!row.billable) return 'not billed';
    if (row.price === null) return 'no price';
    return formatMinor(this.rowAmountMinor(row));
  }

  protected amountState(row: SheetRow): CertaintyState {
    const d = this.draft(row.destination_id);
    if (d.status !== 'taken') return 'no-record';
    if (!row.billable) return 'absent';
    if (row.price === null) return 'no-record';
    return 'known';
  }

  protected noneClass(id: string): string {
    const base = 'rounded-lg border px-2 py-1 text-xs ';
    return this.draft(id).status === 'none'
      ? base + 'border-line-selected bg-brand text-content-onFill'
      : base + 'border-line bg-surface-raised text-content-secondary hover:border-line-strong';
  }

  private allRows(): SheetRow[] {
    const s = this.sheet();
    return s ? [...s.standing, ...s.occasional] : [];
  }

  protected readonly answered = computed(() => {
    const s = this.sheet();
    if (!s) return 0;
    const d = this.drafts();
    return s.standing.filter((r) => (d[r.destination_id] ?? EMPTY).status !== null).length;
  });

  protected readonly totalLitres = computed(() => {
    const d = this.drafts();
    let sum = 0;
    for (const r of this.allRows()) {
      const draft = d[r.destination_id] ?? EMPTY;
      if (draft.status !== 'taken') continue;
      const v = Number(draft.litres);
      if (Number.isFinite(v)) sum += v;
    }
    return Math.round(sum * 10) / 10;
  });

  protected readonly totalAmount = computed(() => {
    // Recomputed from the drafts rather than shown from the last save, so the
    // number moves as the operator types. The SERVER's figure is authoritative
    // -- see money.ts on why this duplicate exists and what pins it.
    void this.drafts();
    return formatMinor(this.allRows().reduce((s, r) => s + this.rowAmountMinor(r), 0));
  });

  /**
   * A note about production, deliberately NOT an alert.
   *
   * More milk going out than was recorded as produced is what
   * `milked_not_measured` MEANS -- the milk existed, nobody weighed it. Styling
   * that as a warning would fire every day for months and be trained away,
   * taking the real signal with it. So this says what is missing, and only when
   * something is.
   */
  protected readonly producedNote = computed(() => {
    const s = this.sheet();
    if (!s) return null;
    const p = s.produced;
    const missing = Math.max(0, p.expected - p.recorded);
    if (p.not_measured === 0 && missing === 0) return null;
    const parts: string[] = [];
    if (p.not_measured > 0) parts.push(`${p.not_measured} milked but not weighed`);
    if (missing > 0) parts.push(`${missing} in milk with no row yet`);
    return (
      `Production this session is a lower bound — ${parts.join(', ')}. Milk going out can ` +
      `exceed it, and that is the missing measurement rather than missing milk.`
    );
  });

  protected readonly untouchedStanding = computed(() => {
    const s = this.sheet();
    if (!s) return [];
    const d = this.drafts();
    return s.standing.filter((r) => (d[r.destination_id] ?? EMPTY).status === null);
  });

  protected readonly blockedReason = computed(() => {
    const s = this.sheet();
    if (s === null) return 'Loading the sheet.';
    if (s.standing.length === 0 && s.occasional.length === 0) {
      return 'Nobody was taking milk on this date.';
    }
    const left = this.untouchedStanding();
    if (left.length === 0) return null;
    // NAMED, not counted. "2 left" makes the operator hunt, and the hunt is
    // where one gets skipped.
    const names = left
      .slice(0, 3)
      .map((x) => x.name)
      .join(', ');
    return left.length <= 3
      ? `Still to answer: ${names}.`
      : `Still to answer: ${names} and ${left.length - 3} more.`;
  });

  protected readonly canSubmit = computed(
    () => !this.state.submitting() && this.blockedReason() === null,
  );

  protected async onSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canSubmit()) return;

    const s = this.sheet();
    if (!s) return;
    const d = this.drafts();

    // Only rows with an answer are sent. An untouched OCCASIONAL row is not an
    // omission -- it is the normal state of a neighbour who did not come.
    const entries = this.allRows()
      .map((r) => ({ row: r, draft: d[r.destination_id] ?? EMPTY }))
      .filter((x) => x.draft.status !== null)
      .map((x) =>
        x.draft.status === 'taken'
          ? {
              destination_id: x.row.destination_id,
              status: 'taken' as const,
              litres: Number(x.draft.litres),
            }
          : {
              destination_id: x.row.destination_id,
              status: 'none' as const,
              reason: x.draft.reason.trim().length > 0 ? x.draft.reason.trim() : null,
            },
      );

    const result = await this.state.run((key) =>
      this.api.saveDispatchSession(
        {
          occurred_on: s.occurred_on,
          session: s.session,
          observed_by: this.handedBy().trim().length > 0 ? this.handedBy().trim() : null,
          entries,
          ...this.session_.provenance(),
        },
        key,
      ),
    );

    if (result) {
      this.writeLog.announce(
        `${s.occurred_on} ${s.session}: ${result.written} row(s), ${result.litres} L out, ` +
          `${formatMinor(result.amount_minor)} billed` +
          (result.updated > 0 ? ` (${result.updated} corrected)` : ''),
      );
      void this.identifiers.refresh();
      await this.load(this.on(), this.session());
    }
  }
}
