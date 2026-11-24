// The session board: today's fixed recording sessions, in order, with the
// current one lit. The signature of the Session Board direction
// (web-angular/.impeccable/surfaces/, direction contract).
//
// ---------------------------------------------------------------------------
// NO CLOCK TIMES ON THE SLOTS
// ---------------------------------------------------------------------------
// The farm's real session times are an open decision (PRODUCT.md). The app only
// knows morning and evening, and `likelySession()` guesses which half of the day
// it is. A slot that printed 05:30 would be inventing a fact, so slots carry the
// session's name and its recorded count, never a time.
//
// ---------------------------------------------------------------------------
// WHICH SLOT IS LIT
// ---------------------------------------------------------------------------
// The first still-open slot of the current half of the day. An open MORNING slot
// once the evening has started is not lit -- it is LATE, and says so in words, so
// a missed session reads as missed rather than as the thing to do next.

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';

import { RegistryApi } from '../api';
import { WriteLog } from '../after-write';
import { farmToday, likelySession } from '../today';
import type { DayBoard, SessionStanding } from '../types';

export type SlotState = 'done' | 'open' | 'lit' | 'late' | 'none';

export interface Slot {
  key: string;
  label: string;
  half: 'morning' | 'evening';
  state: SlotState;
  /** "0 of 6", "Recorded", "Nothing expected". */
  figure: string;
  caption: string;
  link: string[];
  query: Record<string, string>;
}

/** Pure, so the lighting rule is testable without a component. */
export function buildSlots(b: DayBoard, half: 'morning' | 'evening'): Slot[] {
  const standing = (rows: SessionStanding[], s: 'morning' | 'evening') =>
    rows.find((r) => r.session === s);
  const fromStanding = (
    key: string,
    label: string,
    s: 'morning' | 'evening',
    row: SessionStanding | undefined,
    link: string,
    noun: string,
  ): Slot => {
    const base = { key, label, half: s, link: [link], query: { on: b.on, session: s } };
    if (!row || row.expected === 0)
      return { ...base, state: 'none', figure: '—', caption: 'Nothing expected' };
    if (row.complete)
      return { ...base, state: 'done', figure: `${row.recorded}/${row.expected}`, caption: 'Recorded' };
    return {
      ...base,
      state: 'open',
      figure: `${row.recorded}/${row.expected}`,
      caption: `${noun} recorded`,
    };
  };
  const feedDone = !b.feed || b.feed.state === 'complete';
  const slots: Slot[] = [
    fromStanding('milk-morning', 'Morning milking', 'morning', standing(b.milking, 'morning'), '/milk/milking', 'animals'),
    fromStanding('dispatch-morning', 'Morning dispatch', 'morning', standing(b.dispatch, 'morning'), '/milk/dispatch', 'buyers'),
    {
      key: 'feed',
      label: 'Feeding',
      half: 'morning',
      state: feedDone ? 'done' : 'open',
      figure: feedDone ? 'Done' : 'Open',
      caption: feedDone ? 'Recorded' : 'Not recorded',
      link: ['/feed/daily', b.on],
      query: {},
    },
    fromStanding('milk-evening', 'Evening milking', 'evening', standing(b.milking, 'evening'), '/milk/milking', 'animals'),
    fromStanding('dispatch-evening', 'Evening dispatch', 'evening', standing(b.dispatch, 'evening'), '/milk/dispatch', 'buyers'),
  ];
  // Feeding happens through the day: it is never late, and may be lit in either half.
  for (const s of slots)
    if (s.state === 'open' && half === 'evening' && s.half === 'morning' && s.key !== 'feed') {
      s.state = 'late';
      s.caption = 'Late · ' + s.caption;
    }
  const lit = slots.find(
    (s) => s.state === 'open' && (s.half === half || s.key === 'feed'),
  ) ?? slots.find((s) => s.state === 'open');
  if (lit) lit.state = 'lit';
  return slots;
}

/**
 * Pure: which slot is the sheet you are VIEWING -- marked quietly ("Viewing"),
 * never filled. Only that exact sheet, today: the board is today's status, so
 * the Feed overview, a crop, or 3 Nov's milking sheet is not "Feeding" or
 * "Morning milking" and must not claim to be. It used to fill by section, and
 * the solid tile outshone the page title and the "Now" session beside it.
 * A sheet opened without `?session=` shows the likely session, so it marks that one.
 */
export function selectedSlotKey(
  url: string,
  half: 'morning' | 'evening',
  today: string = farmToday(),
): string | null {
  const [path, query = ''] = url.split('#')[0].split('?');
  const params = new URLSearchParams(query);
  const s = params.get('session');
  const session = s === 'morning' || s === 'evening' ? s : half;
  const on = params.get('on');
  if (on && on !== today) return null;
  if (path === '/milk/milking') return `milk-${session}`;
  if (path === '/milk/dispatch') return `dispatch-${session}`;
  if (path === '/feed/daily' || path === `/feed/daily/${today}`) return 'feed';
  return null;
}

@Component({
  selector: 'app-session-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './session-board.html',
  styleUrl: './session-board.css',
})
export class SessionBoard {

  private readonly api = inject(RegistryApi);
  private readonly writeLog = inject(WriteLog);
  private readonly board = signal<DayBoard | null>(null);
  private sequence = 0;

  protected readonly slots = computed(() => {
    const b = this.board();
    return b ? buildSlots(b, likelySession()) : [];
  });
  private readonly router = inject(Router);
  private readonly url = signal(this.router.url);
  protected readonly selected = computed(() => (this.board() ? selectedSlotKey(this.url(), likelySession()) : null));
  protected readonly allDone = computed(
    () => this.slots().length > 0 && this.slots().every((s) => s.state === 'done' || s.state === 'none'),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => ++this.sequence);
    // Re-read after every write (the board is the thing a write changes) and
    // after every navigation, so returning from the roster shows the new count.
    effect(() => {
      this.writeLog.last();
      void this.load();
    });
    // On a phone the board is one sideways-scrolling row; keep the session due
    // NOW in view, or else the sheet you are viewing.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const injector = inject(Injector);
    effect(() => {
      // The session due NOW first: scrolling to the viewed sheet pushed "Now"
      // off the right edge of a phone.
      const key = this.slots().find((s) => s.state === 'lit')?.key ?? this.selected();
      if (!key) return;
      afterNextRender(() => {
        const el = host.querySelector<HTMLElement>(`[data-slot="${key}"]`);
        const row = el?.closest('ol');
        if (el && row && row.scrollWidth > row.clientWidth)
          row.scrollTo({ left: el.offsetLeft - row.offsetLeft - 16, behavior: 'smooth' });
      }, { injector });
    });
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => {
        this.url.set(this.router.url);
        void this.load();
      });
  }

  private async load(): Promise<void> {
    const n = ++this.sequence;
    try {
      const b = await this.api.today(farmToday());
      if (n === this.sequence) this.board.set(b);
    } catch {
      // The board is orientation, not data entry: on failure it stays as it
      // was (or absent), and Today's own load reports the error in words.
    }
  }
}
