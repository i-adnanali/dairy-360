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
import type { TimelineEvent } from './types';
import { HelpText } from '../ui/text';

@Component({
  selector: 'app-event-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HelpText],
  template: `
    @if (events().length === 0) {
      <p class="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-content-muted"
        data-role="empty">
        No events yet. An animal's record starts with its origin event.
      </p>
    } @else {
      <ol class="space-y-2" data-role="events">
        @for (e of events(); track e.id) {
          <li
            [attr.data-event]="e.id"
            [attr.data-effective]="e.effective"
            class="rounded-xl border px-4 py-3"
            [class]="e.effective ? 'border-line bg-surface-raised' : 'border-line-subtle bg-surface-page'"
          >
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                class="text-sm font-semibold"
                [class]="e.effective ? 'text-content-primary' : 'text-content-disabled line-through'"
                data-role="type"
              >{{ label(e.type) }}</span>

              <span
                class="text-sm"
                [class]="e.effective ? 'text-content-heading' : 'text-content-disabled line-through'"
                data-role="when"
              >
                {{ e.occurred_on }}{{ e.occurred_time ? ' ' + e.occurred_time : '' }}
                <span appHelp size="xs">({{ e.date_precision }})</span>
              </span>

              @if (!e.effective) {
                <span class="rounded bg-brand-badge px-1.5 py-0.5 text-xs font-medium text-content-secondary"
                  data-role="superseded-badge">superseded</span>
              }

              <span class="ml-auto font-mono text-xs text-content-subtle" data-role="id">{{ e.id }}</span>
            </div>

            @if (!e.effective && e.superseded_by_id) {
              <p class="mt-1 text-xs text-content-secondary" data-role="replaced-by">
                replaced by <span class="font-mono">{{ e.superseded_by_id }}</span>
              </p>
            }
            @if (e.supersedes_id) {
              <p class="mt-1 text-xs text-content-secondary" data-role="replaces">
                replaces <span class="font-mono">{{ e.supersedes_id }}</span>
              </p>
            }

            @if (summary(e); as s) {
              <p class="mt-1 text-sm" [class]="e.effective ? 'text-content-secondary' : 'text-content-disabled'"
                data-role="summary">{{ s }}</p>
            }

            <!-- An overridden check is part of how the record explains itself:
                 without this the log holds the fact and nobody ever sees it. -->
            @if (override(e); as o) {
              <p class="mt-1.5 rounded-lg bg-warning-bg px-2 py-1 text-xs text-warning-strong"
                data-role="override">
                Written over the <span class="font-mono">{{ o.check }}</span> check{{ o.reason ? ' — ' + o.reason : '' }}
                @if (!o.reason) { <span class="italic">— no reason recorded</span> }
              </p>
            }

            <p class="mt-1.5 text-xs text-content-subtle" data-role="provenance">
              {{ e.source_form }}{{ e.source_ref ? ' · ' + e.source_ref : '' }}
              · recorded by {{ e.recorded_by }}
              @if (e.observed_by) { · observed by {{ e.observed_by }} }
              @else { · <span class="italic">no witness recorded</span> }
            </p>
          </li>
        }
      </ol>
    }
  `,
})
export class EventList {
  readonly events = input.required<TimelineEvent[]>();

  /**
   * The override record on an event, when a guard was stepped past to write it.
   *
   * Two columns since migration 4, so this no longer has to defend against a
   * malformed sub-object -- the database refuses an unknown check and a reason
   * with no check, which is most of what the old shape-checking was for.
   */
  protected override(e: TimelineEvent): { check: string; reason: string | null } | null {
    return e.override_check === null
      ? null
      : { check: e.override_check, reason: e.override_reason };
  }

  protected label(t: string): string {
    switch (t) {
      case 'birth': return 'Born';
      case 'acquired': return 'Acquired';
      case 'calving': return 'Calved';
      case 'dry_off': return 'Dried off';
      case 'departure': return 'Left the farm';
      case 'note': return 'Note';
      default: return t;
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
        bits.push(`calving ${s('calving_event_id') ?? '?'}`);
        return bits.join(' · ');
      }
      case 'acquired': {
        const bits: string[] = [];
        const from = s('from');
        if (from) bits.push(`from ${from}`);
        const bOn = s('estimated_birth_on');
        if (bOn) bits.push(`born ${bOn} (${s('estimated_birth_precision') ?? '?'})`);
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
