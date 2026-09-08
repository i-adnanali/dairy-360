import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { ToolCallView } from '@dairy/shared';

// A footnote about how an answer was produced. Phase 6b, docs/UI_SYSTEM.md §13.3.
//
// ---------------------------------------------------------------------------
// IT DRAWS FROM THE AGENT RAMP, AND NOT FROM `success`
// ---------------------------------------------------------------------------
// §4.3: "The tool-call chip (§13.3) also draws from this ramp rather than from
// success -- A COMPLETED TOOL CALL IS NOT A SETTLED BALANCE."
//
// That is the argument §4.3 makes for the ramp existing at all, applied one
// element further. `agentClass()` needs four values meaning WHICH AGENT
// ANSWERED, not error/outstanding/settled, and a green tick on a tool call says
// the second thing about the first: it reads as an assertion that the answer is
// correct, when all it knows is that a function returned. The chip's job is to
// say which reader was used, which is the same categorical question the agent
// chip above it answers -- so it takes the same colour, and the two read as one
// statement about one turn instead of two unrelated badges.
//
// THE ERROR STATE STAYS ON `danger`, unchanged. A tool call that failed IS an
// error, so the role is the right vocabulary and `text-danger-soft` is pinned
// by this component's own spec (§4.2 -- danger-soft exists BECAUSE that
// assertion needs red-700 and the role is fixed at red-800).
//
// THE DOT LOSES `--success-dot`, WHICH IS ALSO A MEASUREMENT. PHASE5_PRECHECK.md
// §1 found it the one derived dark value that is not contrast-matched to its
// light counterpart: 2.54:1 on a card in light, 8.95:1 in dark, a drift of
// +253%. Nearly invisible in one mode and the loudest thing on the chip in the
// other. Neither is a WCAG failure, because the status is also in words right
// beside it -- but the asymmetry was real, and the ramp's foreground has no
// such split.
@Component({
  selector: 'app-tool-call-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      (click)="open.set(!open())"
      class="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1
        text-xs transition hover:brightness-95 dark:hover:brightness-110"
      [class]="chipClass()"
      [title]="call().argSummary"
    >
      <span class="h-1.5 w-1.5 rounded-full" [class]="dotClass()"></span>
      <span class="font-medium">{{ call().name }}</span>
      <span class="opacity-70">{{ call().status }}</span>
      @if (open()) {
        <span class="ml-1 truncate font-mono opacity-80">{{ call().argSummary }}</span>
      }
    </button>
  `,
})
export class ToolCallChip {
  readonly call = input.required<ToolCallView>();

  /**
   * Which agent's turn this chip belongs to, so it can wear that agent's colour.
   *
   * Optional, and `null` falls through to the ramp's neutral fourth value -- the
   * same one `agentClass()` uses when the dispatcher named no agent. A chip that
   * guessed an agent would be worse than a neutral one.
   */
  readonly agent = input<string | null>(null);

  protected readonly open = signal(false);
  protected readonly isError = computed(() => this.call().status === 'error');

  protected readonly chipClass = computed(() => {
    if (this.isError()) return 'border-danger-line bg-danger-bg text-danger-soft';
    switch (this.agent()) {
      case 'dairy':
        return 'border-agent-dairy-line bg-agent-dairy-bg text-agent-dairy-fg';
      case 'vendor':
        return 'border-agent-vendor-line bg-agent-vendor-bg text-agent-vendor-fg';
      case 'both':
        return 'border-agent-both-line bg-agent-both-bg text-agent-both-fg';
      default:
        return 'border-line-subtle bg-surface-sunken text-content-secondary';
    }
  });

  protected readonly dotClass = computed(() => {
    if (this.isError()) return 'bg-danger-dot';
    switch (this.agent()) {
      case 'dairy':
        return 'bg-agent-dairy-fg';
      case 'vendor':
        return 'bg-agent-vendor-fg';
      case 'both':
        return 'bg-agent-both-fg';
      default:
        return 'bg-content-subtle';
    }
  });
}
