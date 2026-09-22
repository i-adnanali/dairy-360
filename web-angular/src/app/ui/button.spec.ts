import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Button } from './button';
@Component({
  imports: [Button],
  template: `<button
      appButton
      [busy]="busy()"
      [appButtonDisabled]="disabled()"
      reason="why"
      (click)="calls = calls + 1"
    >
      {{ busy() ? 'Saving…' : 'Save' }}</button
    ><span id="why">Answer all rows</span
    ><a appButton href="/other" [appButtonDisabled]="disabled()" (click)="calls = calls + 1"
      >Go</a
    >`,
})
class Host {
  busy = signal(false);
  disabled = signal(false);
  calls = 0;
}
describe('shared Button activation', () => {
  it('blocks busy and custom-disabled click handlers and anchor navigation before template listeners', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const b: HTMLButtonElement = f.nativeElement.querySelector('button');
    b.click();
    expect(f.componentInstance.calls).toBe(1);
    f.componentInstance.busy.set(true);
    f.detectChanges();
    b.click();
    expect(f.componentInstance.calls).toBe(1);
    expect(b.getAttribute('aria-busy')).toBe('true');
    f.componentInstance.busy.set(false);
    f.componentInstance.disabled.set(true);
    f.detectChanges();
    b.click();
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-describedby')).toBe('why');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    f.nativeElement.querySelector('a').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(f.componentInstance.calls).toBe(1);
  });
});
