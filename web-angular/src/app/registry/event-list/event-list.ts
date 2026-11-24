import { StatusBadge } from "../../ui/surface";
import { Button } from "../../ui/button";
// One animal's event list.
//
// ---------------------------------------------------------------------------
// LOAD-BEARING, NOT DISPLAY
// ---------------------------------------------------------------------------
// This is the only window into whether a correction did what was meant. So:
//
//   - SUPERSEDED EVENTS ARE SHOWN, struck through, naming what replaced them.
//     Filtering them out would make a successful correction indistinguishable
//     from a silent no-op, and there would be nothing to check.
//   - Event ids are rendered. They are what a correction targets, and seeing
//     the id in the list is how you confirm the right row moved.
//   - `effective` is rendered as the visual state, not inferred from anything.
//
// Precision is shown on every date. Never a bare date -- hiding the qualifier
// manufactures confidence the record does not have.

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TimelineEvent } from "../types";
import { Certainty, Qualifier } from "../../ui/certainty";
import { precisionParts, readableParts } from "../precision-display";
import type { PrecisionParts } from "../precision-display";
import { BREEDING_TYPES, breedingDetail, breedingTitle } from "../breeding-words";


@Component({
  selector: 'app-event-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusBadge, Certainty, Qualifier, Button],
  templateUrl: './event-list.html',
  styleUrl: './event-list.css',
})
export class EventList {
  /** The event's date at the precision it was known to. See precision-display.ts. */
  protected when(e: TimelineEvent): PrecisionParts {
    return readableParts(e.occurred_on, e.date_precision);
  }

  readonly events = input.required<TimelineEvent[]>();
  /**
   * Offers Correct on each effective breeding row, and is called with the row's
   * event. Null offers nothing: the calving correction's copy of the list, and
   * an animal whose breeding entry is closed. A calving has its own correction.
   */
  readonly correct = input<((e: TimelineEvent) => void) | null>(null);
  protected correctable(e: TimelineEvent): boolean {
    return this.correct() !== null && e.superseded_by_id === null && BREEDING_TYPES.has(e.type);
  }
  /** The animal page reads newest first; the correction view keeps the log's order. */
  readonly newestFirst = input(false);
  protected readonly ordered = computed(() => {
    const e = this.events();
    return this.newestFirst()
      ? [...e].sort((a, b) => (a.occurred_on === b.occurred_on ? (b.occurred_time ?? '').localeCompare(a.occurred_time ?? '') : a.occurred_on < b.occurred_on ? 1 : -1))
      : e;
  });
  /** "Cycle card" rather than cycle_card -- the same words the session panel uses. */
  protected source(form: string): string {
    return ({ daily_herd_sheet: 'Daily herd sheet', cycle_card: 'Cycle card', direct_entry: 'Direct entry', import: 'Import', recall: 'Recall' } as Record<string, string>)[form] ?? form;
  }

  /**
   * The source's own reference. A daily sheet's reference is its date: shown in
   * words, and dropped when it is the event's own day, where it says nothing new.
   */
  protected sourceRef(e: TimelineEvent): string | null {
    const ref = e.source_ref;
    if (!ref) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) return ref;
    if (ref === e.occurred_on && e.date_precision === 'day') return null;
    return 'sheet of ' + readableParts(ref, 'day').figure;
  }

  /**
   * The override record on an event, when a guard was stepped past to write it.
   *
   * A list of checks and one reason since migration 12. The database refuses an
   * unknown check and a reason with no check, so nothing here defends against a
   * malformed record; the wire may omit the list, which reads as none.
   */
  protected override(e: TimelineEvent): { checks: string[]; reason: string | null } | null {
    const checks = e.override_checks ?? [];
    return checks.length === 0 ? null : { checks, reason: e.override_reason };
  }

  protected label(t: string): string {
    switch (t) {
      case 'birth':
        return 'Born';
      case 'acquired':
        return 'Acquired';
      case 'calving':
        return 'Calved';
      case 'dry_off':
        return 'Dried off';
      case 'departure':
        return 'Left the farm';
      case 'note':
        return 'Note';
      default:
        return breedingTitle(t) ?? t;
    }
  }

  /** A one-line read of the payload. Deliberately plain text, not a table. */
  protected summary(e: TimelineEvent): string | null {
    const p = e.payload;
    const s = (k: string): string | null => (typeof p[k] === 'string' ? (p[k] as string) : null);
    switch (e.type) {
      case 'calving': {
        const bits = [`calf ${s('calf_id') ?? '?'}`, s('calf_sex'), s('outcome')].filter(Boolean);
        const a = s('assistance');
        if (a) bits.push(`assistance: ${a}`);
        const n = s('notes');
        if (n) bits.push(n);
        return bits.join(' · ');
      }
      case 'birth': {
        // dam_id null is a statement, not a gap: born here, mother not known.
        const bits = [p['dam_id'] === null ? 'born here, mother not known' : `dam ${s('dam_id') ?? '?'}`];
        const sire = s('sire_ref');
        if (sire) bits.push(`sire ${sire}`);

        return bits.join(' · ');
      }
      case 'acquired': {
        const bits: string[] = [];
        const from = s('from');
        if (from) bits.push(`from ${from}`);
        const bOn = s('estimated_birth_on');
        if (bOn) {
          const rawPrecision = s('estimated_birth_precision');
          const precision = rawPrecision && ['day', 'month', 'year', 'estimated'].includes(rawPrecision) ? rawPrecision as TimelineEvent['date_precision'] : null;
          const birth = precisionParts(bOn, precision);
          bits.push(`born ${birth.figure}${birth.qualifier ? ' (' + birth.qualifier + ')' : precision ? '' : ' (precision unknown)'}`);
        }
        else bits.push('no birth date given');
        const n = s('notes');
        if (n) bits.push(n);
        return bits.join(' · ');
      }
      case 'departure': {
        const bits = [s('reason') ?? '?'];
        const to = s('to');
        if (to) bits.push(`to ${to}`);
        const cause = s('cause');
        if (cause) bits.push(cause);
        return bits.join(' · ');
      }
      case 'dry_off': {
        const r = s('reason');
        return r ? `reason: ${r}` : null;
      }
      case 'note':
        return s('text');
      default:
        return breedingDetail(e.type, p);
    }
  }
}
