import { TestBed } from '@angular/core/testing';
import type { ToolCallView } from '@dairy/shared';
import { ToolCallChip } from './tool-call-chip';

const call: ToolCallView = {
  toolUseId: 't1',
  name: 'get_milk_timeseries',
  status: 'done',
  argSummary: '{"group":"Kundi"}',
};

describe('ToolCallChip', () => {
  it('renders name + status and toggles the arg summary on click', () => {
    const fixture = TestBed.createComponent(ToolCallChip);
    fixture.componentRef.setInput('call', call);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('get_milk_timeseries');
    expect(el.textContent).toContain('done');
    expect(el.textContent).not.toContain('{"group":"Kundi"}');

    el.querySelector('button')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('{"group":"Kundi"}');
  });

  it('applies error styling for error status', () => {
    const fixture = TestBed.createComponent(ToolCallChip);
    fixture.componentRef.setInput('call', { ...call, status: 'error' });
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    // `text-red-700` until the token migration. The literal is gone, not the
    // meaning: `danger.soft` exists precisely BECAUSE this assertion pins red-700
    // and the danger role is fixed at red-800, so the role could not express it.
    // Asserting the token rather than the hex keeps the check and lets phase 4
    // re-point the value.
    expect(button.className).toContain('text-danger-soft');
  });
});

// ---------------------------------------------------------------------------
// §13.3: the chip draws from the AGENT RAMP, not from `success`. Phase 6b.
// ---------------------------------------------------------------------------

describe('ToolCallChip — the agent ramp, §4.3 and §13.3', () => {
  function chip(agent: string | null, status: ToolCallView['status'] = 'done') {
    const fixture = TestBed.createComponent(ToolCallChip);
    fixture.componentRef.setInput('call', { ...call, status });
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('button')!;
  }

  it('wears the colour of the agent whose turn it belongs to', () => {
    // §4.3: "a completed tool call is not a settled balance." A green tick says
    // the answer is correct; all the chip knows is that a function returned.
    // Its job is to say WHICH READER was used, which is the same categorical
    // question the agent tag above it answers -- so it takes the same colour
    // and the two read as one statement about one turn.
    expect(chip('dairy').className).toContain('bg-agent-dairy-bg');
    expect(chip('vendor').className).toContain('bg-agent-vendor-bg');
    expect(chip('both').className).toContain('bg-agent-both-bg');
  });

  it('falls through to the ramp neutral value when no agent was named', () => {
    // The ramp's fourth value, and the same one `agentClass()` uses. A chip
    // that guessed an agent would be worse than a neutral one.
    expect(chip(null).className).toContain('bg-surface-sunken');
    expect(chip(null).className).not.toContain('agent-');
  });

  it('no longer spends --success-dot on a function that returned', () => {
    // PHASE5_PRECHECK.md §1 found this the one derived dark value NOT
    // contrast-matched to its light counterpart: 2.54:1 on a card in light,
    // 8.95:1 in dark -- a drift of +253%, nearly invisible in one mode and the
    // loudest thing on the chip in the other.
    const dot = (agent: string | null) => {
      const fixture = TestBed.createComponent(ToolCallChip);
      fixture.componentRef.setInput('call', call);
      fixture.componentRef.setInput('agent', agent);
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).querySelector('span')!.className;
    };
    expect(dot('dairy')).not.toContain('success');
    expect(dot('dairy')).toContain('bg-agent-dairy-fg');
    expect(dot(null)).not.toContain('success');
  });

  it('KEEPS the danger role for an error, on every agent', () => {
    // A tool call that failed IS an error, so the role is the right vocabulary
    // -- and `text-danger-soft` is pinned by the assertion above, which is why
    // `danger.soft` exists at all (§4.2).
    for (const agent of ['dairy', 'vendor', 'both', null]) {
      expect(chip(agent, 'error').className).toContain('text-danger-soft');
      expect(chip(agent, 'error').className).not.toContain('agent-');
    }
  });
});
