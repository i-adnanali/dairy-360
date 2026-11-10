import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Segmented, TabBar } from './selection';

@Component({
  imports: [TabBar, Segmented],
  template: `
    <div appTabBar aria-label="Views">
      @for (t of tabs; track t) {
        <button type="button" role="tab" [attr.aria-selected]="tab() === t" [attr.tabindex]="tab() === t ? 0 : -1" (click)="tab.set(t)">{{ t }}</button>
      }
    </div>
    <div appSegmented role="group" aria-label="Period">
      @for (v of values; track v) {
        <button type="button" [attr.aria-pressed]="value() === v" (click)="value.set(v)">{{ v }}</button>
      }
    </div>
  `,
})
class Host {
  tabs = ['To do', 'Records', 'Medicines'];
  values = ['Day', 'Week', 'Month'];
  tab = signal('To do');
  value = signal('Week');
}

function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

describe('selection primitives', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('a tab bar is a tablist with one Tab stop, and arrows move and select', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const list = el.querySelector('[appTabBar]')!;
    expect(list.getAttribute('role')).toBe('tablist');
    expect(list.classList).toContain('tab-bar');
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.filter((t) => t.tabIndex === 0).length).toBe(1);
    tabs[0].focus();
    key(tabs[0], 'ArrowRight');
    f.detectChanges();
    expect(f.componentInstance.tab()).toBe('Records');
    expect(document.activeElement).toBe(tabs[1]);
    key(tabs[1], 'End');
    f.detectChanges();
    expect(f.componentInstance.tab()).toBe('Medicines');
    key(tabs[2], 'ArrowRight');
    f.detectChanges();
    expect(f.componentInstance.tab()).toBe('To do');
  });

  it('a segmented control keeps pressed buttons and moves with the arrows', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const seg = el.querySelector('[appSegmented]')!;
    expect(seg.classList).toContain('segmented');
    const buttons = Array.from(seg.querySelectorAll<HTMLButtonElement>('button'));
    buttons[1].focus();
    key(buttons[1], 'ArrowLeft');
    f.detectChanges();
    expect(f.componentInstance.value()).toBe('Day');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    key(buttons[0], 'ArrowLeft');
    f.detectChanges();
    expect(f.componentInstance.value()).toBe('Month');
  });

  it('ignores keys with a modifier, so browser shortcuts still work', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const b = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[appSegmented] button')!;
    b.focus();
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true, bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.value()).toBe('Week');
  });
});
