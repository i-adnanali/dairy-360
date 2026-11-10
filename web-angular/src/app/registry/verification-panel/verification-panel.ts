import { IdentifierLink } from '../../ui/navigation';
import { dayText, periodText } from '../labour-format';
import { SOURCE_FORMS, feedLabel } from '../feed-format';
import { RouterLink } from '@angular/router';
import { errorText, labourPresentation, precisionWords, sentence, violationHeading } from "../check-presentation";
import { readableParts } from "../precision-display";
import { farmMoment } from "../today";
import { Button } from "../../ui/button";
import { Router } from '@angular/router';
import type { DatePrecision, Violation } from "../types";
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
  DestroyRef,
  Injector,
  afterNextRender,
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
import { HelpText, TextLink } from "../../ui/text";
import { PageHeading } from "../../ui/heading";
import { RowDivider } from "../../ui/surface";
import { SectionHeading } from "../../ui/heading";
import { SubHeading } from "../../ui/heading";

@Component({
  selector: 'app-verification-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
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
    IdentifierLink,
    SubHeading,
    TextLink,
  ],
  templateUrl: './verification-panel.html',
  styleUrl: './verification-panel.css',
})
export class VerificationPanel {
  // Words, not stored values (UI_SYSTEM §6.1): "8 Nov 2026", "31 animals",
  // "Cycle card", "Evening".
  protected readonly day = dayText;
  protected readonly period = periodText;
  protected count(n: number, noun: string) {
    return `${n} ${n === 1 ? noun : noun + 's'}`;
  }
  protected word(v: string | null | undefined) {
    return feedLabel(v ?? '');
  }
  protected source(form: string) {
    return SOURCE_FORMS[form] ?? feedLabel(form);
  }
  /** §6's no-record glyph, for the template. An en dash. */
  protected readonly noRecord = NO_RECORD;

  private readonly api = inject(RegistryApi);

  protected readonly metadata = (context: unknown) =>
    context ? JSON.stringify(context, null, 2) : 'No structured context supplied';
  protected readonly labour = labourPresentation;
  protected readonly heading = violationHeading;
  protected readonly sentence = sentence;
  protected readonly precisionWords = precisionWords;
  protected readonly loading = signal(false);
  /** When the results on screen were read: "9 Nov, 14:05". */
  protected readonly checkedAt = signal('');
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
    // Recorded as the reader scrolls: by the time a destroy hook runs, this
    // page's content is already gone and <main> has collapsed to the top.
    const main = document.querySelector('main');
    const onScroll = () => (savedScroll = main?.scrollTop ?? 0);
    main?.addEventListener('scroll', onScroll, { passive: true });
    inject(DestroyRef).onDestroy(() => main?.removeEventListener('scroll', onScroll));
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
    // The previous results STAY on screen, dimmed and marked busy: clearing
    // them collapsed the page and threw the reader back to the top on every
    // Recheck. What may not stay is a CLEAN verdict -- "No contradictions",
    // "Nothing needs an answer" -- which the template hides while loading or
    // after a failure, because an old all-clear must never read as a current one.
    const end = this.asOf() ?? farmToday();
    const [verification, reconciliation] = await Promise.allSettled([
      this.api.verification(this.asOf()),
      this.api.reconcile(this.rangeStart(end), end),
    ]);
    if (request !== this.request) return;
    if (verification.status === 'fulfilled') {
      this.v.set(verification.value);
      this.checkedAt.set(farmMoment(new Date().toISOString()));
    } else this.loadError.set(errorText(verification.reason));
    if (reconciliation.status === 'fulfilled') this.reconciliation.set(reconciliation.value);
    else {
      this.reconciliation.set(null);
      this.reconcileError.set(errorText(reconciliation.reason));
    }
    this.loading.set(false);
    this.restoreScroll();
  }

  // ---- Coming back keeps your place ------------------------------------
  // The natural loop is: open the sheet a gap links to, answer it, press Back,
  // Recheck. Back used to land at the top every time (the scroller is <main>,
  // which the router's scroll restoration does not cover).
  private readonly injector = inject(Injector);
  private readonly back = inject(Router).getCurrentNavigation()?.trigger === 'popstate';
  private restored = false;
  private restoreScroll(): void {
    if (this.restored) return;
    this.restored = true;
    if (!this.back || !savedScroll) return;
    const top = savedScroll;
    afterNextRender(() => document.querySelector('main')?.scrollTo({ top }), { injector: this.injector });
  }

  // ---- Needs an answer ----------------------------------------------------
  /**
   * Everything on this page that asks the owner to DO something, first, in
   * words, each with the place to do it. It was spread over five cards, and the
   * one real gap was an amber "4" three screens down.
   */
  protected readonly attention = computed(() => {
    const data = this.v();
    const r = this.reconciliation();
    const items: { text: string; link: { path: string; query?: Record<string, string> } | null; label: string }[] = [];
    for (const s of data?.milking?.recent ?? []) {
      const missing = s.expected - s.recorded;
      if (missing > 0)
        items.push({
          text: `${this.day(s.occurred_on)} ${this.word(s.session).toLowerCase()} milking: ${this.count(missing, 'animal')} not answered`,
          link: { path: '/milk/milking', query: { on: s.occurred_on, session: s.session } },
          label: 'Open the sheet',
        });
    }
    for (const s of r?.incomplete ?? []) {
      const missing = s.expected_standing - s.recorded_standing;
      items.push({
        text: `${this.day(s.occurred_on)} ${this.word(s.session).toLowerCase()} dispatch: ${this.count(missing, 'buyer')} not answered`,
        link: { path: '/milk/dispatch', query: { on: s.occurred_on, session: s.session } },
        label: 'Open the sheet',
      });
    }
    return items;
  });

  /** Where a contradiction can be fixed, from the server's structured target. */
  protected fixLink(x: Violation): { path: unknown[]; query?: Record<string, string>; label: string } | null {
    const t = x.target;
    if (!t) return null;
    if (t.kind === 'animal') return { path: ['/animals', t.id], label: 'Open ' + t.id };
    return {
      path: [t.kind === 'milking' ? '/milk/milking' : '/milk/dispatch'],
      query: { on: t.on, session: t.session },
      label: `Open the ${this.day(t.on)} ${this.word(t.session).toLowerCase()} ${t.kind} sheet`,
    };
  }

  /** In-page jump that keeps the URL (a bare `#id` would leave the app's base). */
  protected jump(id: string): void {
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: 'start' });
    el?.querySelector<HTMLElement>('h3')?.setAttribute('tabindex', '-1');
    el?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  }

  /** A date at the precision it was known: "Jun 2021", not "1 Jun 2021". */
  protected dated(on: string, precision: DatePrecision) {
    return readableParts(on, precision);
  }

  /** "Recall: 5 of 45 dates give an exact day" -- the sum the reader used to do. */
  protected readonly exactShare = computed(() => {
    const rows = this.v()?.histogram ?? [];
    const by = new Map<string, { exact: number; total: number }>();
    for (const r of rows) {
      const b = by.get(r.source_form) ?? { exact: 0, total: 0 };
      b.total += r.count;
      if (r.date_precision === 'day') b.exact += r.count;
      by.set(r.source_form, b);
    }
    return [...by.entries()].map(([form, b]) => ({
      source: this.source(form),
      exact: b.exact,
      total: b.total,
      pct: b.total ? Math.round((100 * b.exact) / b.total) : null,
    }));
  });

  /** The trailing window the gap is reported over. */
  private rangeStart(end: string): string {
    const [y, m, d] = end.split('-').map(Number);
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

/** Where /check was scrolled when the reader left it, for Back. */
let savedScroll = 0;
