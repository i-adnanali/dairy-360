// Which milking session a Milk page is on, and the way to the ones either side.
//
// Milking and Dispatch are both "one session" screens. They each had a date
// field, a Morning/Evening chip group and a paragraph explaining why today is
// the default. This replaces all three with one bar: previous session, the
// session in words ("Sun 8 Nov · Today"), next session, and Morning/Evening.
// The date field is still there -- it sits invisibly over the label, so
// clicking the date opens the native picker -- and keeps `data-role="on"`.
//
// Stepping walks sessions, not days: the session before this morning is last
// night's evening. Next stops at today's evening; there is nothing to record
// after that yet.

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { farmToday } from '../today';
import { feedDay, feedRelativeDay, feedWeekday } from '../feed-format';
import type { MilkingSession } from '../types';

export interface SessionSlot {
  on: string;
  session: MilkingSession;
}

/** The session before or after this one. Pure, so it is tested alone. */
export function stepSession(slot: SessionSlot, by: -1 | 1): SessionSlot {
  if (by === 1)
    return slot.session === 'morning'
      ? { on: slot.on, session: 'evening' }
      : { on: shiftDay(slot.on, 1), session: 'morning' };
  return slot.session === 'evening'
    ? { on: slot.on, session: 'morning' }
    : { on: shiftDay(slot.on, -1), session: 'evening' };
}

/** "Evening, Sun 8 Nov" -- how a session is named in a sentence. */
export function sessionName(slot: SessionSlot, today: string = farmToday()): string {
  const word = slot.session === 'morning' ? 'Morning' : 'Evening';
  return `${word}, ${feedWeekday(slot.on)} ${feedDay(slot.on, today)}`;
}

function shiftDay(on: string, days: number): string {
  const [y, m, d] = on.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

@Component({
  selector: 'app-milk-session-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './milk-session-nav.html',
  styleUrl: './milk-session-nav.css',
})
export class MilkSessionNav {
  readonly on = input.required<string>();
  readonly session = input.required<MilkingSession>();
  readonly disabled = input(false);
  readonly changed = output<SessionSlot>();

  protected readonly dayLabel = computed(() => {
    const today = farmToday();
    const rel = feedRelativeDay(this.on(), today);
    const day = `${feedWeekday(this.on())} ${feedDay(this.on(), today)}`;
    return rel === 'Today' || rel === 'Yesterday' ? `${day} · ${rel}` : day;
  });
  protected readonly canNext = computed(
    () => stepSession({ on: this.on(), session: this.session() }, 1).on <= farmToday(),
  );
  protected readonly prevName = computed(() =>
    sessionName(stepSession({ on: this.on(), session: this.session() }, -1)),
  );
  protected readonly nextName = computed(() =>
    sessionName(stepSession({ on: this.on(), session: this.session() }, 1)),
  );

  protected step(by: -1 | 1): void {
    this.changed.emit(stepSession({ on: this.on(), session: this.session() }, by));
  }
  protected pickDay(v: string): void {
    if (v.length > 0 && v !== this.on()) this.changed.emit({ on: v, session: this.session() });
  }
  protected pick(s: MilkingSession): void {
    if (s !== this.session()) this.changed.emit({ on: this.on(), session: s });
  }
}
