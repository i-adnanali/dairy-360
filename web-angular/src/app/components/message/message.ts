import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TurnItem } from "../../core/turn-item.type";
import { ChartCard } from "../chart-card/chart-card";
import { MarkdownView } from "../markdown-view/markdown-view";
import { ToolCallChip } from "../tool-call-chip/tool-call-chip";

// One turn. Phase 6b of docs/records/UI_SYSTEM.md, spec in §13.3.
//
// ---------------------------------------------------------------------------
// THE PERSON'S TURN IS QUIET AND THE ANSWER IS NOT A CARD
// ---------------------------------------------------------------------------
// §13.3, and it is a straight inversion of what was here:
//
//   "The person's own turn is quiet -- surface-sunken with a line-subtle
//    border, right-aligned, content-secondary. It is currently the
//    HIGHEST-CONTRAST ELEMENT ON THE PAGE while the answer is a low-contrast
//    card. You know what you typed."
//
// It was `bg-brand text-content-onFill` -- the brand fill, the loudest thing
// the palette has, spent on the one piece of text in the conversation whose
// author already knows it. The answer, meanwhile, sat inside a bordered card
// with a shadow, which is a container asking to be skimmed past.
//
// So the answer becomes plain content on the panel surface: no card, no border,
// no shadow, `content-primary`. Markdown still styles it -- `.prose-chat` is
// what makes an h2 in a reply read as a heading, and §8.2 records that no
// fixture produces a reply, so those rules have to be verified by injection
// rather than by screenshot.
//
// ---------------------------------------------------------------------------
// THE TOOL CHIP IS A FOOTNOTE, SO IT GOES LAST
// ---------------------------------------------------------------------------
// It used to render between the text and the charts, which put it directly
// above a chart it had nothing to do with. §13.3: "It is a footnote about how
// the answer was produced, and today it reads as a header for the chart
// beneath it." Moved below the datasets, which is the bottom of the turn.
//
// ---------------------------------------------------------------------------
// AND THE VENDOR CHIP LEAVES AMBER, WHICH §4.3 ALREADY CLAIMED IT HAD
// ---------------------------------------------------------------------------
// §4.3: "`vendor` has left amber, which was the point: a vendor answer used to
// wear the same colour as an unanswered milking row." The foreground and the
// border moved to the agent ramp in the phase-4 re-point. The BACKGROUND did
// not -- `bg-warning-bg` survived at agentClass()'s vendor arm, so the chip
// still rendered on the warning role, in the content area, which is the one
// place §4.2.1 says amber may not be. Found by PHASE5_PRECHECK.md's census,
// which is what a census is for.
@Component({
  selector: 'app-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ToolCallChip, ChartCard, MarkdownView],
  templateUrl: './message.html',
  styleUrl: './message.css',
})
export class Message {
  readonly item = input.required<TurnItem>();

  protected readonly assistant = computed(() => {
    const it = this.item();
    return it.role === 'assistant' ? it : null;
  });

  protected readonly agentClass = computed(() => {
    switch (this.assistant()?.agent) {
      case 'dairy':
        return 'bg-agent-dairy-bg text-agent-dairy-fg border-agent-dairy-line';
      case 'vendor':
        // WAS `bg-warning-bg`. See the header: the only site in the app that
        // mixed a categorical ramp with a role, and the last of the phase-4
        // re-point's leftovers.
        return 'bg-agent-vendor-bg text-agent-vendor-fg border-agent-vendor-line';
      case 'both':
        return 'bg-agent-both-bg text-agent-both-fg border-agent-both-line';
      default:
        return 'bg-surface-sunken text-content-muted border-line-subtle';
    }
  });
}
