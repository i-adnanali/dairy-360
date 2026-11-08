import { DestroyRef } from '@angular/core';
// `/` -- what needs the owner now.
//
// ---------------------------------------------------------------------------
// SESSION BOARD REDESIGN (6 Nov 2026)
// ---------------------------------------------------------------------------
// Direction contract: web-angular/.impeccable/surfaces/ (Today surface brief).
// The day's sessions moved up into the shell's session board, which is lit at
// the current one. This screen ranks everything else by consequence:
//
//   Needs you now   unsafe or overdue: overdue health work, milk that must not
//                   be sold, actions the assistant is waiting on, late sessions
//   Also open       answerable today: health due today, last month's payroll
//   (sidebar)       milk over the last 7 days, the herd in the farm's terms
//
// Every row is actionable or it is not on the page -- the rule this screen was
// first written under still holds; the sidebar is orientation, not a to-do.
//
// THE PAYROLL LINE PROMPTS ABOUT LAST MONTH, NOT THIS ONE. The current month is
// outstanding for the whole of it, so it is stated in passing and never flagged.

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RegistryApi, type FarmEventRow, type FarmEventsWindow } from "../api";
import { windowFor } from "../farm-monitor/farm-monitor";
import { farmMoment, farmToday, likelySession } from "../today";
import { urlParams } from "../url-state";
import type { DayBoard, HerdRow } from "../types";
import type { HealthBoard } from "../health-workflows";
import { lifeStage } from "../life-stage";
import { buildSlots } from "../session-board/session-board";
import { ErrorPanel } from "../../ui/surface";
import { HelpText } from "../../ui/text";
import { PageHeading } from "../../ui/heading";
import { PendingApprovals } from "../../core/pending-approvals";
import { Assistant } from "../../core/assistant";
import type { AnalyticsReport } from '@dairy/shared';

export interface AttentionItem {
  key: string;
  severity: 'danger' | 'warning';
  /** "Overdue", "Not for sale", "Awaiting approval". Never colour alone. */
  badge: string;
  subject: string;
  what: string;
  when: string;
  action: string;
  link?: string[];
  query?: Record<string, string>;
  /** For items that open the assistant rather than a route. */
  opensAssistant?: boolean;
}

export interface MilkDay {
  on: string;
  label: string;
  litres: number | null;
  /** Measurements still pending or missing for the day: the bar is a floor, not a total. */
  partial: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

function shortDate(on: string): string {
  const [, m, d] = on.split('-').map(Number);
  return `${d} ${SHORT[m - 1]}`;
}


const TASK_KIND: Record<string, string> = {
  administration: 'Dose',
  recheck: 'Recheck',
  test: 'Test',
  examination: 'Examination',
};

/** Pure: the ranked attention list. Danger first, then warning; stable within. */
export function attentionItems(
  board: DayBoard,
  health: HealthBoard | null,
  pendingApprovals: number,
  half: 'morning' | 'evening',
  names: ReadonlyMap<string, string | null> = new Map(),
  flaggedEvents: readonly FarmEventRow[] = [],
): { now: AttentionItem[]; open: AttentionItem[] } {
  const now: AttentionItem[] = [];
  const open: AttentionItem[] = [];
  for (const t of health?.tasks ?? []) {
    const subject = t.animal_name ? `${t.animal_id} ${t.animal_name}` : String(t.animal_id ?? '');
    const what = [TASK_KIND[t.kind] ?? t.kind, (t as { instructions?: string }).instructions]
      .filter(Boolean)
      .join(' · ');
    if (t.standing === 'overdue')
      now.push({
        key: 'task-' + t.id, severity: 'danger', badge: 'Overdue', subject, what,
        when: 'Due ' + shortDate(t.due_on), action: 'Open task', link: ['/animals/health'],
        query: { animal: String(t.animal_id ?? ''), task: t.id },
      });
    else if (t.standing === 'due')
      open.push({
        key: 'task-' + t.id, severity: 'warning', badge: 'Due today', subject, what,
        when: 'Today', action: 'Open task', link: ['/animals/health'],
        query: { animal: String(t.animal_id ?? ''), task: t.id },
      });
  }
  for (const w of health?.withdrawals ?? []) {
    if (w.target !== 'milk') continue;
    const id = String(w.animal_id ?? '');
    const subject = names.get(id) ? `${id} ${names.get(id)}` : id;
    // A milk withdrawal with no known end is still a withdrawal: the milk is not
    // for sale until somebody clarifies it. Unknown is never read as "clear".
    now.push({
      key: `wd-${w.administration_id}-${w.target}`,
      severity: 'danger',
      badge: 'Not for sale',
      subject,
      what: 'Milk withdrawal' + (w.product_name ? ' · ' + w.product_name : ''),
      when: w.until ? 'Until ' + farmMoment(w.until) : 'End unknown · clarify',
      // Her withdrawals lead the Health page once it is filtered to her.
      action: 'Open withdrawal',
      link: ['/animals/health'],
      query: { animal: id },
    });
  }
  if (pendingApprovals > 0)
    now.push({
      key: 'approvals', severity: 'warning', badge: 'Awaiting approval',
      subject: 'Assistant',
      what: pendingApprovals === 1 ? 'One proposed change is waiting for you' : `${pendingApprovals} proposed changes are waiting for you`,
      when: 'Nothing is written until you approve', action: 'Review', opensAssistant: true,
    });
  for (const s of buildSlots(board, half))
    if (s.state === 'late')
      now.push({
        key: 'late-' + s.key, severity: 'danger', badge: 'Late', subject: s.label,
        what: s.caption.replace(/^Late · /, ''), when: 'Earlier today', action: 'Record',
        link: s.link, query: s.query,
      });
  if (board.payroll_previous) {
    const p = board.payroll_previous;
    const [y, m] = p.from_on.split('-').map(Number);
    open.push({
      key: 'payroll-previous', severity: 'warning', badge: 'Unanswered',
      subject: `Payroll · ${MONTHS[m - 1]} ${y}`,
      what: `${p.outstanding} of ${p.permanent} salaried still to enter`,
      when: 'Last month', action: 'Enter', link: ['/labour/payroll'],
      query: { from: p.from_on, to: p.to_on },
    });
  }
  for (const e of flaggedEvents) {
    const item: AttentionItem = {
      key: 'event-' + e.id,
      severity: e.flag_severity === 'urgent' ? 'danger' : 'warning',
      badge: e.flag_severity === 'urgent' ? 'Urgent' : 'Notable',
      subject: (e.zone ?? e.camera_id).replace(/_/g, ' '),
      what: e.flag_reason ?? 'Flagged camera event',
      when: farmMoment(e.occurred_at),
      action: 'Open event',
      link: ['/monitor'],
      // The same window Today read it from, with the event marked.
      query: { window: 'night', event: e.id },
    };
    (e.flag_severity === 'urgent' ? now : open).push(item);
  }
  const rank = (i: AttentionItem) => (i.severity === 'danger' ? 0 : 1);
  now.sort((a, b) => rank(a) - rank(b));
  return { now, open };
}

/** Pure: seven days ending `on`, from two calendar-week reports. */
export function milkWeek(on: string, reports: AnalyticsReport[]): MilkDay[] {
  const byDay = new Map<string, { litres: number | null; partial: boolean }>();
  for (const r of reports)
    for (const b of r.buckets) {
      const prev = byDay.get(b.on);
      const litres = b.produced;
      const partial = b.coverage.pending > 0 || b.coverage.missing > 0 || (r.scope.inProgress && b.on === r.scope.on);
      byDay.set(b.on, {
        litres: prev?.litres == null ? litres : litres == null ? prev.litres : prev.litres + litres,
        partial: (prev?.partial ?? false) || partial,
      });
    }
  const days: MilkDay[] = [];
  const [y, m, d] = on.split('-').map(Number);
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    const key = dt.toISOString().slice(0, 10);
    const v = byDay.get(key);
    days.push({ on: key, label: shortDate(key), litres: v?.litres ?? null, partial: v?.partial ?? false });
  }
  return days;
}

@Component({
  selector: 'app-today-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorPanel, HelpText, PageHeading, RouterLink],
  templateUrl: './today-board.html',
  styleUrl: './today-board.css',
})
export class TodayBoard {
  private readonly api = inject(RegistryApi);
  private readonly approvals = inject(PendingApprovals).count;
  protected readonly assistant = inject(Assistant);

  protected readonly board = signal<DayBoard | null>(null);
  protected readonly health = signal<HealthBoard | null>(null);
  protected readonly herd = signal<HerdRow[] | null>(null);
  protected readonly week = signal<MilkDay[] | null>(null);
  protected readonly night = signal<FarmEventsWindow | null>(null);
  protected readonly loadError = signal<string | null>(null);

  /**
   * `?on=` opens the board on another day. There is deliberately NO date
   * control for it: this screen answers "what needs me NOW". The parameter
   * exists so a day can be reproduced from a link.
   */
  private readonly url = urlParams({ on: farmToday() });
  protected readonly on = computed(() => this.url.value().on);

  constructor() {
    inject(DestroyRef).onDestroy(() => ++this.loadSequence);
    effect(() => {
      const on = this.on();
      void this.load(on);
    });
  }

  private loadSequence = 0;
  private async load(on: string): Promise<void> {
    const sequence = ++this.loadSequence;
    this.board.set(null);
    this.loadError.set(null);
    try {
      const board = await this.api.today(on);
      if (sequence !== this.loadSequence) return;
      this.board.set(board);
      this.loadError.set(null);
    } catch (e) {
      if (sequence !== this.loadSequence) return;
      this.loadError.set(e instanceof Error ? e.message : String(e));
      return;
    }
    // The rest is enrichment: each fails on its own without hiding the board.
    // A missing method (a narrow test double) reads the same as a failed call.
    void this.optional(sequence, () => this.api.healthGet<HealthBoard>('health/board?on=' + on), this.health);
    void this.optional(sequence, () => this.api.herd(), this.herd);
    void this.optional(
      sequence,
      async () => {
        const [y, m, d] = on.split('-').map(Number);
        const weekAgo = new Date(Date.UTC(y, m - 1, d - 6)).toISOString().slice(0, 10);
        const reports = await Promise.all([
          this.api.analytics({ view: 'week', on: weekAgo }),
          this.api.analytics({ view: 'week', on }),
        ]);
        return milkWeek(on, reports);
      },
      this.week,
    );
    void this.optional(sequence, () => {
      const w = windowFor('night');
      return this.api.farmEvents(w.from, w.to);
    }, this.night);
  }

  private async optional<T>(sequence: number, read: () => Promise<T>, into: { set(v: T | null): void }) {
    into.set(null);
    try {
      const v = await read();
      if (sequence === this.loadSequence) into.set(v);
    } catch {
      if (sequence === this.loadSequence) into.set(null);
    }
  }

  protected readonly attention = computed(() => {
    const b = this.board();
    if (!b) return { now: [], open: [] };
    const names = new Map((this.herd() ?? []).map((r) => [r.id, r.name] as const));
    const flagged = (this.night()?.events ?? []).filter((e) => e.flagged);
    return attentionItems(b, this.health(), this.approvals(), likelySession(), names, flagged);
  });

  /** Last night's camera events, flagged first. Absent when the monitor is not connected. */
  protected readonly overnight = computed(() => {
    const n = this.night();
    if (!n) return null;
    const flagged = n.events
      .filter((e) => e.flagged)
      .sort((a, b) => (a.flag_severity === 'urgent' ? 0 : 1) - (b.flag_severity === 'urgent' ? 0 : 1))
      .map((e) => ({ ...e, reason: `${farmMoment(e.occurred_at).split(', ')[1]} · ${e.flag_reason ?? ''}` }));
    return { total: n.events.length, flagged };
  });

  /** The registry is empty: the setup checklist replaces the attention list. */
  protected readonly emptyRegistry = computed(() => this.herd()?.length === 0);

  /**
   * True only when there is genuinely nothing to do. Includes last month's
   * payroll: "nothing outstanding" while it is unpaid would be the one wrong
   * thing this screen could say, because it is the line somebody would trust.
   */
  protected readonly allClear = computed(() => {
    const b = this.board();
    if (!b) return false;
    const a = this.attention();
    return (
      a.now.length === 0 &&
      a.open.length === 0 &&
      b.milking.every((s) => s.complete) &&
      b.dispatch.every((s) => s.complete) &&
      b.payroll_previous === null &&
      (!b.feed || b.feed.state === 'complete') &&
      (!b.health || (b.health.overdue === 0 && b.health.due === 0 && b.health.withdrawals.length === 0))
    );
  });

  /** What is lit on the session board, for the all-clear line. */
  protected readonly nextSession = computed(() => {
    const b = this.board();
    return b ? buildSlots(b, likelySession()).find((s) => s.state === 'lit') ?? null : null;
  });

  protected readonly herdCounts = computed(() => {
    const rows = this.herd();
    if (!rows) return null;
    const count = new Map<string, number>();
    let present = 0;
    for (const r of rows) {
      const s = lifeStage(r.status, r.sex);
      const label = !s ? 'unknown' : s.qualifier ? `${s.term} · ${s.qualifier}` : s.term;
      count.set(label, (count.get(label) ?? 0) + 1);
      if (r.status !== 'departed') present++;
    }
    const order = ['majj · in milk', 'majj · dry', 'choti', 'katti'];
    const parts = [...count.entries()]
      .filter(([k]) => k !== 'departed')
      .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    return { present, parts, departed: count.get('departed') ?? 0 };
  });

  /** The 7-day graph: bar heights, and which day was lowest among complete days. */
  protected readonly graph = computed(() => {
    const days = this.week();
    if (!days) return null;
    const max = Math.max(1, ...days.map((d) => d.litres ?? 0));
    const complete = days.filter((d) => d.litres !== null && !d.partial);
    const lowest = complete.length >= 2
      ? complete.reduce((a, b) => ((b.litres as number) < (a.litres as number) ? b : a))
      : null;
    const today = days[days.length - 1];
    return {
      days: days.map((d) => ({ ...d, pct: d.litres === null ? 0 : Math.max(4, (d.litres / max) * 100), lowest: d === lowest })),
      lowest,
      today,
    };
  });

  protected litres(n: number | null): string {
    return n === null ? '—' : `${Math.round(n * 10) / 10} L`;
  }

  /** Farm-local, formatted without Intl -- see money.ts on host ICU data. */
  protected prettyDate(): string {
    const on = this.board()?.on ?? farmToday();
    const [y, m, d] = on.split('-').map(Number);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const day = days[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${day} ${d} ${MONTHS[m - 1]} ${y}`;
  }

  protected monthName(from: string): string {
    const [y, m] = from.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
}
