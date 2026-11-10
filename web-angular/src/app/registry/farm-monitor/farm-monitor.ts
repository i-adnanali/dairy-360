// /monitor -- what the cameras saw, and which of it was flagged.
//
// Before this screen, classified farm events were reachable only by asking the
// assistant (audit F02, gap G1). It is READ-ONLY: flags are written through the
// assistant's approval card, which is the one write path farm events have.
//
// WINDOWS ARE FARM-LOCAL. "Last night" is 18:00 yesterday to 06:00 today in
// farm time (UTC+5, no DST), because that is the window the overnight flags
// are about -- the restricted-zone rule is an overnight rule.

import { Segmented } from "../../ui/selection";
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RegistryApi, type FarmEventRow, type FarmEventsWindow } from '../api';
import { urlParams } from '../url-state';
import { farmMoment, farmToday } from '../today';
import { PageHeading } from '../../ui/heading';
import { HelpText } from '../../ui/text';
import { ErrorPanel } from '../../ui/surface';

export type MonitorWindow = 'night' | '24h' | '7d';

/** Pure: the [from, to) instants for a window, in farm time. */
export function windowFor(w: MonitorWindow, now = new Date()): { from: string; to: string } {
  const to = now.toISOString();
  if (w === '24h') return { from: new Date(now.getTime() - 24 * 3600_000).toISOString(), to };
  if (w === '7d') return { from: new Date(now.getTime() - 7 * 24 * 3600_000).toISOString(), to };
  const [y, m, d] = farmToday(now).split('-').map(Number);
  // 06:00 farm time today = 01:00Z; if that is still ahead, "last night" is the one before.
  let end = Date.UTC(y, m - 1, d, 1, 0);
  if (end > now.getTime()) end -= 24 * 3600_000;
  return { from: new Date(end - 12 * 3600_000).toISOString(), to: new Date(end).toISOString() };
}

const WHAT: Record<FarmEventRow['event_type'], string> = {
  detection: 'Person detected',
  face_match: 'Recognised',
  unknown_cluster: 'Unrecognised face',
};

@Component({
  selector: 'app-farm-monitor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented, PageHeading, HelpText, ErrorPanel],
  templateUrl: './farm-monitor.html',
  styleUrl: './farm-monitor.css',
})
export class FarmMonitor {
  private readonly api = inject(RegistryApi);
  private readonly url = urlParams({ window: 'night', show: 'all', event: '' });
  /** ?event= from Today: that event is marked and brought into view. */
  protected readonly marked = computed(() => this.url.value().event);
  protected readonly window = computed(() => this.url.value().window as MonitorWindow);
  protected readonly show = computed(() => this.url.value().show as 'all' | 'flagged');

  protected readonly data = signal<FarmEventsWindow | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);

  protected readonly windows: { id: MonitorWindow; label: string }[] = [
    { id: 'night', label: 'Last night' },
    { id: '24h', label: 'Last 24 hours' },
    { id: '7d', label: 'Last 7 days' },
  ];

  protected readonly rows = computed(() => {
    const events = this.data()?.events ?? [];
    return this.show() === 'flagged' ? events.filter((e) => e.flagged) : events;
  });
  protected readonly counts = computed(() => {
    const events = this.data()?.events ?? [];
    return {
      all: events.length,
      urgent: events.filter((e) => e.flag_severity === 'urgent').length,
      notable: events.filter((e) => e.flag_severity === 'notable').length,
    };
  });

  private sequence = 0;
  constructor() {
    effect(() => void this.load(this.window()));
  }

  private async load(w: MonitorWindow): Promise<void> {
    const n = ++this.sequence;
    this.loading.set(true);
    this.error.set(null);
    try {
      const { from, to } = windowFor(w);
      const d = await this.api.farmEvents(from, to);
      if (n !== this.sequence) return;
      this.data.set(d);
      const id = this.marked();
      if (id)
        setTimeout(() => document.querySelector<HTMLElement>(`[data-event="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: 'center' }));
    } catch (e) {
      if (n !== this.sequence) return;
      this.data.set(null);
      const msg = e instanceof Error ? e.message : String(e);
      this.error.set(
        /404|Not Found/i.test(msg)
          ? 'Farm monitor is not connected on this server, so there are no camera events to show.'
          : `Could not load farm events: ${msg}`,
      );
    } finally {
      if (n === this.sequence) this.loading.set(false);
    }
  }

  protected setWindow(w: MonitorWindow) { void this.url.set({ window: w }); }
  protected setShow(s: 'all' | 'flagged') { void this.url.set({ show: s }); }
  protected retry() { void this.load(this.window()); }

  protected when(e: FarmEventRow): string { return farmMoment(e.occurred_at); }
  protected where(e: FarmEventRow): string {
    return [e.zone?.replace(/_/g, ' '), e.camera_id.replace(/^cam_/, '').replace(/_/g, ' ') + ' camera']
      .filter(Boolean)
      .join(' · ');
  }
  protected what(e: FarmEventRow): string {
    return WHAT[e.event_type] + (e.identity ? ` · ${e.identity}` : '');
  }
  protected confidence(e: FarmEventRow): string {
    return e.confidence === null ? '—' : `${Math.round(e.confidence * 100)}%`;
  }
}
