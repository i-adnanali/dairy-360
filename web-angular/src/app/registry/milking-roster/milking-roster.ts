import { WithdrawalNotices } from "../withdrawal-notices/withdrawal-notices";
import { WriteLock } from "../write-lock";
import { DraftRegistry } from "../draft-registry";
import { DestroyRef } from '@angular/core';
import { ScrollRegion } from "../../ui/scroll-region";
import { Pagination } from "../../ui/pagination/pagination";
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
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChildren,
  untracked,
} from '@angular/core';
import { ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RegistryApi } from "../api";
import { FormState } from "../form-state";
import { Session } from "../session";
import { SessionRequired } from "../session-required/session-required";
import { WriteLog, focusAfterWrite } from "../after-write";
import { ChipGroup } from "../chip-group/chip-group";
import { Cell } from "../../ui/cell";
import { Certainty } from "../../ui/certainty";
import { NO_RECORD, approximateQuantity } from "../precision-display";
import type { CertaintyState } from "../../ui/certainty";
import { IdentifierInput } from "../identifier-input/identifier-input";
import { Identifiers } from "../identifiers";
import { farmToday, likelySession } from "../today";
import { urlParams } from "../url-state";
import type { MilkingRoster, MilkingSession, MilkingStatus, RosterRow } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { FieldLabel } from "../../ui/text";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { RowDivider } from "../../ui/surface";
import { TextLink } from "../../ui/text";
import { Button } from "../../ui/button";
import { SummaryBar } from "../../ui/surface";

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
  imports: [
    WithdrawalNotices,
    WriteLock,
    Pagination,
    ScrollRegion,
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
  templateUrl: './milking-roster.html',
  styleUrl: './milking-roster.css',
})
export class MilkingRosterScreen {
  protected readonly tablePage = signal(1);
  protected readonly tableSize = signal(25);
  protected readonly pageError = signal('');
  protected readonly invalidAnimal = signal<string | null>(null);
  protected tableOffset(): number {
    return (this.tablePage() - 1) * this.tableSize();
  }
  private readonly api = inject(RegistryApi);
  protected readonly session_ = inject(Session);
  protected readonly savedContext = signal<{on: string; session: string} | null>(null);
  private readonly writeLog = inject(WriteLog);
  protected readonly identifiers = inject(Identifiers);

  private readonly cells = viewChildren<ElementRef<HTMLInputElement>>('cell');

  protected readonly fields = [
    'occurred_on',
    'session',
    'entries',
    'animal_id',
    'yield_litres',
  ] as const;
  protected readonly sessionChips = [
    { value: 'morning', label: 'Morning' },
    { value: 'evening', label: 'Evening' },
  ];
  protected readonly state = new FormState<{
    written: number;
    measured: number;
    updated: number;
  }>();

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

  /** §6's no-record glyph, for the template. An en dash. */
  protected readonly noRecord = NO_RECORD;

  protected readonly roster = signal<MilkingRoster | null>(null);
  protected readonly loadError = signal<string | null>(null);
  private readonly drafts = signal<Record<string, Draft>>({});

  private readonly registry = inject(DraftRegistry);
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly baseline = signal('');
  private baselineDrafts: Record<string, Draft> = {};
  private baselineObserver = '';
  private loadGeneration = 0;
  private snapshot() {
    return JSON.stringify({ drafts: this.drafts(), observer: this.milkedBy() });
  }
  private acceptBaseline(observer = this.milkedBy()) {
    this.baselineDrafts = structuredClone(this.drafts());
    this.baselineObserver = observer;
    this.baseline.set(JSON.stringify({ drafts: this.drafts(), observer }));
  }
  constructor() {
    const defaults = { on: this.on(), session: this.session() };
    this.acceptBaseline();
    this.registry.register(
      {
        owner: 'milking',
        context: () => this.on() + '/' + this.session(),
        description: () => 'Milking · ' + this.on() + ' · ' + this.session(),
        snapshot: () => this.snapshot(),
        baseline: () => this.baseline(),
        dirty: () => this.snapshot() !== this.baseline(),
        pending: () => this.state.locked(),
        unresolved: () => this.state.uncertain(),
        discard: () => {
          this.drafts.set(structuredClone(this.baselineDrafts));
          this.milkedBy.set(this.baselineObserver);
          this.state.reset();
        },
        replaces: (url) => {
          const u = new URL(url, 'http://local');
          return (
            u.pathname !== '/milk/milking' ||
            (u.searchParams.get('on') || defaults.on) !== this.on() ||
            (u.searchParams.get('session') || defaults.session) !== this.session()
          );
        },
      },
      inject(DestroyRef),
    );
    effect(() => {
      this.snapshot();
      this.baseline();
      this.state.locked();
      this.registry.syncUnload();
    });
    void this.identifiers.refresh();
    // One effect over date+session rather than a call in each setter, which is
    // how one setter ends up forgetting to reload and the screen shows a roster
    // for a date it is no longer displaying.
    effect(() => {
      const on = this.on();
      const s = this.session();
      void untracked(() => this.load(on, s));
    });
  }

  private async load(on: string, session: MilkingSession): Promise<void> {
    const generation = ++this.loadGeneration;
    const observer = this.milkedBy();
    this.roster.set(null);
    this.tablePage.set(1);
    this.pageError.set('');
    try {
      const r = await this.api.milkingRoster(on, session);
      if (generation !== this.loadGeneration) return;
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
      this.acceptBaseline(observer);
      this.loadError.set(null);
    } catch (e) {
      if (generation !== this.loadGeneration) return;
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected setOn(v: string): void {
    if (v.length > 0)
      void this.url.set({ on: v }).then(() => {
        const control = this.element.nativeElement.querySelector(
          '[data-role=on]',
        ) as HTMLInputElement | null;
        if (control) control.value = this.on();
      });
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
    if (this.state.locked()) return;
    const trimmed = v.trim();
    this.patch(id, { litres: v, status: trimmed.length === 0 ? null : 'measured', reason: '' });
  }

  protected mark(id: string, status: MilkingStatus): void {
    if (this.state.locked()) return;
    const current = this.draft(id).status;
    // Clicking the active one again returns the row to untouched, so a
    // mis-click is undone the same way it was made.
    this.patch(id, current === status ? { ...EMPTY } : { status, litres: '', reason: '' });
  }

  protected setMilkedBy(value: string): void {
    if (!this.state.locked()) this.milkedBy.set(value);
  }

  protected setReason(id: string, v: string): void {
    if (this.state.locked()) return;
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

  protected showUnanswered(): void {
    const id = this.untouched()[0]?.animal_id;
    const index = this.roster()?.rows.findIndex((r) => r.animal_id === id) ?? -1;
    if (index >= 0) this.focusRow(index);
  }

  private focusRow(index: number): void {
    if (index >= (this.roster()?.rows.length ?? 0)) return;
    this.tablePage.set(Math.floor(index / this.tableSize()) + 1);
    setTimeout(() => {
      const el = this.cells()[index % this.tableSize()]?.nativeElement;
      el?.focus();
      if (el && !el.disabled) el.select();
    }, 0);
  }

  protected previousText(row: RosterRow): string {
    const p = row.previous;
    if (!p) return NO_RECORD;
    if (p.status === 'measured') return `${p.yield_litres}`;
    return p.status === 'not_milked' ? 'not milked' : 'not measured';
  }

  /**
   * The same four branches as `previousText`, as a certainty state.
   *
   * ONE FUNCTION WOULD HAVE BEEN NEATER AND WOULD HAVE BEEN WRONG. Returning
   * `{ text, state }` puts two `previousState(row)` calls in the template on
   * every change detection pass through a 31-row table, or forces a `@let`;
   * two pure switch statements over the same three-value union cost nothing and
   * the compiler checks both are exhaustive.
   *
   * `not_milked` is DELIBERATELY ABSENT and not no-record, which is the
   * distinction §6 exists for: "no milk was taken" is an answer somebody gave.
   * A `previous` of `null` is the absence of the answer -- either no row was
   * saved for that session, or she was not in milk then. The roster cannot tell
   * those two apart and does not pretend to.
   */
  protected previousState(row: RosterRow): CertaintyState {
    const p = row.previous;
    if (!p) return 'no-record';
    return p.status === 'measured' ? 'known' : 'absent';
  }

  /** The recent mean, marked approximate with §6.1's tilde. */
  protected meanText(row: RosterRow): string {
    return row.recent_mean === null ? NO_RECORD : approximateQuantity(row.recent_mean);
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
      ? base + 'border-line-selected bg-brand text-content-onFill'
      : base + 'border-line bg-surface-raised text-content-secondary hover:border-line-strong';
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
    const names = left
      .slice(0, 3)
      .map((x) => x.name ?? x.animal_id)
      .join(', ');
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
    if (this.state.submitting() || r === null || this.blockedReason() !== null) return;
    const d = this.drafts();
    const invalid = r.rows.findIndex((row) => {
      const draft = d[row.animal_id] ?? EMPTY;
      return (
        draft.status === 'measured' &&
        (!draft.litres.trim() || !Number.isFinite(Number(draft.litres)) || Number(draft.litres) < 0)
      );
    });
    if (invalid >= 0) {
      this.invalidAnimal.set(r.rows[invalid].animal_id);
      this.pageError.set(
        'Enter a valid non-negative milk measurement for ' + r.rows[invalid].animal_id,
      );
      this.focusRow(invalid);
      return;
    }
    this.pageError.set('');
    this.invalidAnimal.set(null);

    const entries = r.rows.map((row) => {
      const draft = d[row.animal_id] ?? EMPTY;
      const base: Record<string, unknown> = { animal_id: row.animal_id, status: draft.status };
      if (draft.status === 'measured') base['yield_litres'] = Number(draft.litres);
      if (draft.status === 'not_milked' && draft.reason.trim().length > 0) {
        base['reason'] = draft.reason.trim();
      }
      return base;
    });

    const saved = await this.state.runRequest(
      () =>
        [
          {
            occurred_on: r.occurred_on,
            session: r.session,
            observed_by: blank(this.milkedBy()),
            entries,
            ...this.session_.provenance(),
          },
        ] as const,
      (request, key) => this.api.saveMilkingSession(request[0], key),
    );

    if (!saved)
      setTimeout(
        () => this.element.nativeElement.querySelector('#milking-server-error')?.focus(),
        0,
      );
    if (saved) {
      this.savedContext.set({on: r.occurred_on, session: r.session});
      this.acceptBaseline();
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
