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
