// One milking session. The whole feature is this screen; the rest is reading.
//
// ---------------------------------------------------------------------------
// THE ROSTER IS DERIVED, NEVER PICKED
// ---------------------------------------------------------------------------
// Membership is "has a lactation covering this date", computed by the server.
// There is no dropdown, no search, and no way to leave an animal off the list --
// which is what makes an omission DELIBERATE rather than possible. Every other
// entry screen in this app starts by choosing an animal; this one cannot,
// because the thing it has to guarantee is that nobody was skipped.
//
// ---------------------------------------------------------------------------
// FOUR ROW STATES, AND A PARTIAL SESSION IS SAVEABLE ON PURPOSE
// ---------------------------------------------------------------------------
// untouched | measured | milked, not measured | not milked.
//
// `untouched` BLOCKS the save and names the animal, so nobody is dropped by
// accident. But "not measured" is one keystroke away, so an animal can be
// dropped DELIBERATELY and the omission is recorded as one.
//
// If a number were the only way to save, an operator on a session they did not
// measure would type a plausible one -- the same failure as requiring prose to
// clear a guard and getting "yes". A fabricated yield is worse than a recorded
// gap, because a gap is visible to whoever reads the row later and a
// fabrication is visible to nobody. The farm's current practice is to measure
// only when a drop is noticed, so `milked_not_measured` is expected to be the
// majority state at first. It is a first-class answer, not a failure to answer.
//
// ---------------------------------------------------------------------------
// TYPING, NOT CLICKING
// ---------------------------------------------------------------------------
// A dozen numbers should be one continuous motion. In any row's field:
//
//     digits   a measurement
//     Enter    commit and move to the next row
//     m        milked, not measured -- and move on
//     n        not milked -- and move on
//
// The letters are free because the field is numeric, and they are PRINTED in
// the header rather than only implemented: a shortcut nobody can see is a
// shortcut nobody uses, which is the lesson the chip accelerators already
// learned.

import {
  ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChildren,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RegistryApi } from './api';
import { FormState } from './form-state';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog, focusAfterWrite } from './after-write';
import { ChipGroup } from './chip-group';
import { IdentifierInput } from './identifier-input';
import { Identifiers } from './identifiers';
import { farmToday, likelySession } from './today';
import { urlParams } from './url-state';
import type { MilkingRoster, MilkingSession, MilkingStatus, RosterRow } from './types';

/** What the operator has said about one animal. `null` status = untouched. */
interface Draft {
  status: MilkingStatus | null;
  /** Raw text, so a half-typed number is never silently a different number. */
  litres: string;
  reason: string;
}

const EMPTY: Draft = { status: null, litres: '', reason: '' };

/**
 * How far from her own recent mean a figure has to be before it is questioned.
 *
 * PROVISIONAL, in the sense CALF_MAX_AGE_MONTHS is: chosen to be loose rather
 * than tight, because the cost of a warning you read past is nothing and the
 * cost of one that fires on every real fluctuation is that they stop being read.
 * Retune against real data once there is a season of it.
 */
export const OUT_OF_BAND = 0.5;

@Component({
  selector: 'app-milking-roster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipGroup, IdentifierInput, RouterLink, SessionRequired],
  template: `
    <form class="mx-auto max-w-4xl space-y-4" (submit)="onSubmit($event)">
      <header>
        <h2 class="text-lg font-semibold text-farm-900">Record a milking</h2>
        <p class="mt-1 text-sm text-farm-600">
          Everyone in milk on this date, in one pass. An animal left untouched blocks the save —
          if she was milked and nobody weighed it, say so; that is a real answer and a guessed
          number is not.
        </p>
      </header>

      <!-- when -->
      <div class="rounded-xl border border-farm-300 bg-white p-4">
        <div class="flex flex-wrap items-end gap-4">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-farm-700">Date</span>
            <input type="date" data-role="on" [value]="on()" (change)="setOn($any($event.target).value)"
              class="rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
          </label>
          <div>
            <div class="mb-1 text-xs font-medium text-farm-700">Session</div>
            <app-chip-group
              name="session" label="Session" [options]="sessionChips" [value]="session()"
              (changed)="setSession($any($event))"
            />
          </div>
          <div class="ml-auto">
            <app-identifier-input
              field="observed_by" label="Milked by"
              [value]="milkedBy()" [suggestions]="identifiers.values().observed_by"
              (changed)="milkedBy.set($event)"
            />
          </div>
        </div>
        <!-- Today is a legitimate default HERE, and only here: today is a fact,
             not a guess. Said out loud so it does not read as the no-default
             rule being forgotten. -->
        <p class="mt-2 text-xs text-farm-600" data-role="today-note">
          Defaults to today and this session — the one place a date is defaulted, because today is
          a fact rather than a guess. Change it to enter a session you missed.
        </p>
      </div>

      @if (loadError(); as e) {
        <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" data-role="load-error">{{ e }}</p>
      } @else if (roster(); as r) {
        @if (r.rows.length === 0) {
          <p class="rounded-xl border border-farm-300 bg-white p-4 text-sm text-farm-600"
            data-role="nobody">
            No animal was in milk on {{ r.occurred_on }}. A female is in milk from her calving until
            she is dried off — <a routerLink="/animals/calvings/new" class="font-medium text-farm-800 underline">record a calving</a>
            and she will be here.
          </p>
        } @else {
          <div class="overflow-hidden rounded-xl border border-farm-300 bg-white">
            <table class="w-full text-left text-sm">
              <thead class="border-b border-farm-200 text-xs uppercase tracking-wide text-farm-600">
                <tr>
                  <th class="px-3 py-2">Animal</th>
                  <th class="px-3 py-2 text-right">Days in milk</th>
                  <!-- The SAME session yesterday, never this morning: morning
                       and evening are separated by an unknown interval and are
                       not comparable. Same rule for the mean. -->
                  <th class="px-3 py-2 text-right">Yesterday {{ r.previous_session.session }}</th>
                  <th class="px-3 py-2 text-right">Recent {{ r.session }} mean</th>
                  <th class="px-3 py-2">Litres — or <span class="font-mono">m</span> / <span class="font-mono">n</span></th>
                </tr>
              </thead>
              <tbody>
                @for (row of r.rows; track row.animal_id; let i = $index) {
                  <tr class="border-t border-farm-100" [attr.data-row]="row.animal_id">
                    <td class="px-3 py-1.5">
                      <span class="font-mono text-farm-800">{{ row.animal_id }}</span>
                      <span class="ml-2 text-farm-700">{{ row.name ?? '—' }}</span>
                    </td>
                    <td class="px-3 py-1.5 text-right text-farm-700" data-role="dim">{{ row.days_in_milk }}</td>
                    <td class="px-3 py-1.5 text-right text-farm-700" data-role="previous">
                      {{ previousText(row) }}
                    </td>
                    <td class="px-3 py-1.5 text-right text-farm-700" data-role="mean">
                      {{ row.recent_mean === null ? '—' : row.recent_mean }}
                    </td>
                    <td class="px-3 py-1.5">
                      <div class="flex flex-wrap items-center gap-2">
                        <input
                          #cell
                          [attr.data-role]="'litres-' + row.animal_id"
                          inputmode="decimal"
                          [value]="draft(row.animal_id).litres"
                          [disabled]="draft(row.animal_id).status !== null && draft(row.animal_id).status !== 'measured'"
                          (input)="typeLitres(row.animal_id, $any($event.target).value)"
                          (keydown)="onKey($event, i)"
                          class="w-24 rounded-lg border border-farm-300 px-2 py-1 text-sm disabled:bg-farm-50"
                        />
                        <button type="button" [attr.data-role]="'m-' + row.animal_id"
                          (click)="mark(row.animal_id, 'milked_not_measured')"
                          [class]="chipClass(row.animal_id, 'milked_not_measured')"
                        >not measured</button>
                        <button type="button" [attr.data-role]="'n-' + row.animal_id"
                          (click)="mark(row.animal_id, 'not_milked')"
                          [class]="chipClass(row.animal_id, 'not_milked')"
                        >not milked</button>

                        @if (draft(row.animal_id).status === 'not_milked') {
                          <input [attr.data-role]="'reason-' + row.animal_id"
                            [value]="draft(row.animal_id).reason"
                            (input)="setReason(row.animal_id, $any($event.target).value)"
                            placeholder="why (optional)"
                            class="w-44 rounded-lg border border-farm-300 px-2 py-1 text-sm" />
                        }
                        @if (outOfBand(row); as msg) {
                          <span class="rounded-lg bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
                            [attr.data-role]="'band-' + row.animal_id">{{ msg }}</span>
                        }
                        @if (row.existing) {
                          <span class="text-xs italic text-farm-500"
                            [attr.data-role]="'saved-' + row.animal_id">already saved</span>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- The total catches a ten-fold typo that no per-row rule will,
               because the operator knows roughly what the herd gives. -->
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-farm-300 bg-farm-50 px-4 py-3 text-sm">
            <span data-role="resolved">
              <span class="font-medium text-farm-900">{{ resolved() }}</span>
              <span class="text-farm-600"> of {{ r.rows.length }} answered</span>
            </span>
            <span data-role="total">
              <span class="text-farm-600">Herd total </span>
              <span class="font-medium text-farm-900">{{ total() }} L</span>
              <span class="text-farm-600"> from {{ measuredCount() }} measured</span>
            </span>
          </div>
        }
      } @else {
        <p class="text-sm text-farm-600" data-role="loading">Loading…</p>
      }

      @if (state.formError(fields); as e) {
        <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="error-form">{{ e }}</p>
      }

      <div class="flex items-center gap-3">
        @if (session_.ready()) {
          <button type="submit" data-role="submit" [disabled]="!canSubmit()"
            class="rounded-xl bg-farm-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-farm-300"
          >{{ state.submitting() ? 'Saving…' : 'Save session' }}</button>
        } @else {
          <app-session-required what="this session" />
        }
        @if (blockedReason(); as b) {
          <span class="text-sm text-farm-600" data-role="blocked">{{ b }}</span>
        }
      </div>
    </form>
  `,
})
export class MilkingRosterScreen {
  private readonly api = inject(RegistryApi);
  protected readonly session_ = inject(Session);
  private readonly writeLog = inject(WriteLog);
  protected readonly identifiers = inject(Identifiers);

  private readonly cells = viewChildren<ElementRef<HTMLInputElement>>('cell');

  protected readonly fields = ['occurred_on', 'session', 'entries', 'animal_id', 'yield_litres'] as const;
  protected readonly sessionChips = [
    { value: 'morning', label: 'Morning' },
    { value: 'evening', label: 'Evening' },
  ];
  protected readonly state = new FormState<{ written: number; measured: number; updated: number }>();

  /**
   * The date and session live in the URL, not in a component signal.
   *
   * A bare /milk/milking opens today's likely session and STAYS bare; changing
   * either puts it in the query string, at which point the URL names that
   * specific roster and can be sent to somebody. See url-state.ts.
   */
  private readonly url = urlParams({ on: farmToday(), session: likelySession() });
  protected readonly on = computed(() => this.url.value().on);
  /**
   * Inferred from the clock, then SHOWN AND CHANGEABLE -- and now overridable
   * by the URL as well.
   *
   * The same parse-then-show-back contract as the date control, for the same
   * reason: an inference the operator cannot see is a default by another name.
   * Before 13:00 local the morning session is the one being entered; after it,
   * the evening.
   *
   * VALIDATED, not cast: `?session=lunch` is a URL somebody can type, and
   * passing it through would produce a server refusal on a screen with no field
   * to attach it to.
   */
  protected readonly session = computed<MilkingSession>(() => {
    const raw = this.url.value().session;
    return raw === 'morning' || raw === 'evening' ? raw : likelySession();
  });
  protected readonly milkedBy = signal('');

  protected readonly roster = signal<MilkingRoster | null>(null);
  protected readonly loadError = signal<string | null>(null);
  private readonly drafts = signal<Record<string, Draft>>({});

  constructor() {
    void this.identifiers.refresh();
    // One effect over date+session rather than a call in each setter, which is
    // how one setter ends up forgetting to reload and the screen shows a roster
    // for a date it is no longer displaying.
    effect(() => {
      const on = this.on();
      const s = this.session();
      void this.load(on, s);
    });
  }

  private async load(on: string, session: MilkingSession): Promise<void> {
    try {
      const r = await this.api.milkingRoster(on, session);
      // A session already saved comes back filled in, so re-opening one is a
      // correction rather than a blank slate that would overwrite it.
      const drafts: Record<string, Draft> = {};
      for (const row of r.rows) {
        drafts[row.animal_id] = row.existing
          ? {
              status: row.existing.status,
              litres: row.existing.yield_litres === null ? '' : String(row.existing.yield_litres),
              reason: row.existing.reason ?? '',
            }
          : { ...EMPTY };
      }
      this.drafts.set(drafts);
      this.roster.set(r);
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
   * Typing a number IS the answer -- there is no separate "measured" button.
   *
   * Clearing the field returns the row to untouched rather than to a zero: an
   * empty box means nothing was said, and a zero is a claim that she gave
   * nothing, which is what `not_milked` is for.
   */
  protected typeLitres(id: string, v: string): void {
    const trimmed = v.trim();
    this.patch(id, { litres: v, status: trimmed.length === 0 ? null : 'measured', reason: '' });
  }

  protected mark(id: string, status: MilkingStatus): void {
    const current = this.draft(id).status;
    // Clicking the active one again returns the row to untouched, so a
    // mis-click is undone the same way it was made.
    this.patch(
      id,
      current === status ? { ...EMPTY } : { status, litres: '', reason: '' },
    );
  }

  protected setReason(id: string, v: string): void {
    this.patch(id, { reason: v });
  }

  /** Enter commits and advances; `m` and `n` answer without leaving the keyboard. */
  protected onKey(e: KeyboardEvent, index: number): void {
    const rows = this.roster()?.rows ?? [];
    const row = rows[index];
    if (!row) return;

    if (e.key === 'Enter') {
      // Not a submit: a dozen rows means Enter is "next", and submitting from
      // row three would be the opposite of what the hands expect.
      e.preventDefault();
      this.focusRow(index + 1);
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      this.mark(row.animal_id, 'milked_not_measured');
      this.focusRow(index + 1);
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      this.mark(row.animal_id, 'not_milked');
      this.focusRow(index + 1);
    }
  }

  private focusRow(index: number): void {
    const cells = this.cells();
    const el = cells[index]?.nativeElement;
    if (el && !el.disabled) {
      el.focus();
      el.select();
    } else if (el) {
      el.focus();
    }
  }

  protected previousText(row: RosterRow): string {
    const p = row.previous;
    if (!p) return '—';
    if (p.status === 'measured') return `${p.yield_litres}`;
    return p.status === 'not_milked' ? 'not milked' : 'not measured';
  }

  /**
   * A soft hint, never a refusal.
   *
   * A real collapse in yield is precisely the row worth having, so refusing it
   * would be the system inventing plausibility. This only says the number is
   * unlike her recent ones, which is what catches a misplaced decimal.
   */
  protected outOfBand(row: RosterRow): string | null {
    const d = this.draft(row.animal_id);
    if (d.status !== 'measured' || row.recent_mean === null || row.recent_mean <= 0) return null;
    const v = Number(d.litres);
    if (!Number.isFinite(v)) return null;
    const ratio = Math.abs(v - row.recent_mean) / row.recent_mean;
    if (ratio < OUT_OF_BAND) return null;
    return `unlike her recent ${row.recent_mean} L — check the decimal`;
  }

  protected chipClass(id: string, status: MilkingStatus): string {
    const base = 'rounded-lg border px-2 py-1 text-xs ';
    return this.draft(id).status === status
      ? base + 'border-farm-600 bg-farm-600 text-white'
      : base + 'border-farm-300 bg-white text-farm-700 hover:border-farm-400';
  }

  protected readonly resolved = computed(() => {
    const rows = this.roster()?.rows ?? [];
    const d = this.drafts();
    return rows.filter((r) => (d[r.animal_id] ?? EMPTY).status !== null).length;
  });

  protected readonly measuredCount = computed(() => {
    const rows = this.roster()?.rows ?? [];
    const d = this.drafts();
    return rows.filter((r) => (d[r.animal_id] ?? EMPTY).status === 'measured').length;
  });

  protected readonly total = computed(() => {
    const rows = this.roster()?.rows ?? [];
    const d = this.drafts();
    let sum = 0;
    for (const r of rows) {
      const draft = d[r.animal_id] ?? EMPTY;
      if (draft.status !== 'measured') continue;
      const v = Number(draft.litres);
      if (Number.isFinite(v)) sum += v;
    }
    // One decimal: the scale reads to 0.1 and a float sum otherwise shows
    // 43.800000000000004, which reads as precision nobody has.
    return Math.round(sum * 10) / 10;
  });

  /**
   * The untouched rows, named.
   *
   * Naming them is the point: "3 animals left" makes the operator hunt, and the
   * hunt is where one gets skipped.
   */
  protected readonly untouched = computed(() => {
    const rows = this.roster()?.rows ?? [];
    const d = this.drafts();
    return rows.filter((r) => (d[r.animal_id] ?? EMPTY).status === null);
  });

  protected readonly blockedReason = computed(() => {
    const r = this.roster();
    if (r === null) return 'Loading the roster.';
    if (r.rows.length === 0) return 'Nobody was in milk on this date.';
    const left = this.untouched();
    if (left.length === 0) return null;
    const names = left.slice(0, 3).map((x) => x.name ?? x.animal_id).join(', ');
    return left.length <= 3
      ? `Still to answer: ${names}.`
      : `Still to answer: ${names} and ${left.length - 3} more.`;
  });

  protected readonly canSubmit = computed(
    () => !this.state.submitting() && this.blockedReason() === null,
  );

  protected onSubmit(e: Event): void {
    e.preventDefault();
    void this.submit();
  }

  protected async submit(): Promise<void> {
    const r = this.roster();
    if (r === null || this.blockedReason() !== null) return;
    const d = this.drafts();

    const entries = r.rows.map((row) => {
      const draft = d[row.animal_id] ?? EMPTY;
      const base: Record<string, unknown> = { animal_id: row.animal_id, status: draft.status };
      if (draft.status === 'measured') base['yield_litres'] = Number(draft.litres);
      if (draft.status === 'not_milked' && draft.reason.trim().length > 0) {
        base['reason'] = draft.reason.trim();
      }
      return base;
    });

    const saved = await this.state.run((key) =>
      this.api.saveMilkingSession(
        {
          occurred_on: r.occurred_on,
          session: r.session,
          observed_by: blank(this.milkedBy()),
          entries,
          ...this.session_.provenance(),
        },
        key,
      ),
    );

    if (saved) {
      void this.identifiers.refresh();
      this.writeLog.announce(
        `Saved ${r.session} of ${r.occurred_on} — ${saved.written} animal(s), ` +
          `${saved.measured} measured${saved.updated > 0 ? `, ${saved.updated} corrected` : ''}.`,
      );
      // Reload rather than clear: the session is now saved, and showing it back
      // is what lets a wrong figure be spotted and re-entered. A cleared roster
      // would look exactly like one that was never filled in.
      await this.load(r.occurred_on, r.session);
      focusAfterWrite(this.cells()[0]?.nativeElement);
    }
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
