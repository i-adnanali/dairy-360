import { StatusBadge } from "../../ui/surface";
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
import { precisionParts } from "../precision-display";
import type { PrecisionParts } from "../precision-display";

@Component({
  selector: 'app-event-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusBadge, Certainty, Qualifier],
  templateUrl: './event-list.html',
  styleUrl: './event-list.css',
})
export class EventList {
  /** The event's date at the precision it was known to. See precision-display.ts. */
  protected when(e: TimelineEvent): PrecisionParts {
    return precisionParts(e.occurred_on, e.date_precision);
  }

  readonly events = input.required<TimelineEvent[]>();

  /**
   * The override record on an event, when a guard was stepped past to write it.
   *
   * Two columns since migration 4, so this no longer has to defend against a
   * malformed sub-object -- the database refuses an unknown check and a reason
   * with no check, which is most of what the old shape-checking was for.
   */
  protected override(e: TimelineEvent): { check: string; reason: string | null } | null {
    return e.override_check == null ? null : { check: e.override_check, reason: e.override_reason };
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
        return t;
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
        const bits = [`dam ${s('dam_id') ?? '?'}`];
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
        return null;
    }
  }
}
