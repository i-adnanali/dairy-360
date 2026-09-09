import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CommandPalette } from './command-palette';
import { RegistryApi } from './api';
import { Session } from './session';
import { RegistryShell } from './registry-shell';
import { Shortcuts } from '../core/shortcuts';
import { CalvingsList } from './calvings-list';

const storage = () =>
  Promise.resolve({ info: { storage: ':memory:', memory: true }, reachable: true });
const api = {
  storage,
  herd: () => Promise.resolve([{ id: 'BD-0001', name: 'Noori' }]),
  people: () => Promise.resolve([{ person_id: 'p1', identifier: 'imran', name: 'Imran' }]),
  destinations: () => Promise.resolve([{ id: 'd1', name: 'Home' }]),
};
function setup(overrides = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: RegistryApi, useValue: { ...api, ...overrides } },
    ],
  });
}
afterEach(() => TestBed.resetTestingModule());

describe('Phase 7 command palette', () => {
  it('does not fetch records until opened; searches names and serials', async () => {
    const herd = vi.fn(api.herd);
    setup({ herd });
    const f = TestBed.createComponent(CommandPalette);
    f.detectChanges();
    expect(herd).not.toHaveBeenCalled();
    await f.componentInstance.show();
    f.componentInstance.search('bd-0001 noori');
    expect(f.componentInstance.results().map((r) => r.url)).toEqual(['/animals/BD-0001']);
    f.componentInstance.search('imran');
    expect(f.componentInstance.results()[0].url).toBe('/labour/people/p1');
    f.componentInstance.search('Home');
    expect(f.componentInstance.results()[0].url).toBe('/milk/buyers/d1');
  });
  it('refuses write navigation without a session, including Enter', async () => {
    setup();
    const f = TestBed.createComponent(CommandPalette);
    await f.componentInstance.show();
    f.componentInstance.search('Add animal');
    const go = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    f.componentInstance.onKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(go).not.toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(true);
    TestBed.inject(Session).set('recall', 'Adnan');
    f.componentInstance.onKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(go).toHaveBeenCalledWith('/animals/new');
    expect(f.componentInstance.open()).toBe(false);
  });
  it('keeps navigation and other records available when one source fails', async () => {
    setup({ people: () => Promise.reject(new Error('offline')) });
    const f = TestBed.createComponent(CommandPalette);
    await f.componentInstance.show();
    expect(f.componentInstance.error()).toContain('People');
    expect(f.componentInstance.records().length).toBe(2);
    expect(f.componentInstance.results().some((c) => c.url === '/check')).toBe(true);
  });
  it('ignores a stale load after close and a second open', async () => {
    let finish!: (rows: any[]) => void;
    let n = 0;
    setup({
      herd: () =>
        ++n === 1
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve([{ id: 'BD-0002', name: 'Sohni' }]),
    });
    const f = TestBed.createComponent(CommandPalette);
    const first = f.componentInstance.show();
    f.componentInstance.close();
    await f.componentInstance.show();
    finish([{ id: 'BD-OLD', name: 'Old' }]);
    await first;
    expect(f.componentInstance.records().some((r) => r.label.includes('OLD'))).toBe(false);
    expect(f.componentInstance.records().some((r) => r.label.includes('Sohni'))).toBe(true);
  });
  it('unregisters its shortcut when destroyed', () => {
    setup();
    const f = TestBed.createComponent(CommandPalette);
    expect(TestBed.inject(Shortcuts).claimed()).toContain('mod+k');
    f.destroy();
    expect(TestBed.inject(Shortcuts).claimed()).not.toContain('mod+k');
  });
});

@Component({
  template:
    '<form (submit)="save($event)"><input aria-label="Name" value="keep this" /><button type="submit">Save</button></form>',
})
class Entry {
  static saves = 0;
  save(e: Event) {
    e.preventDefault();
    Entry.saves++;
  }
}
async function shell() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([
        { path: '', component: RegistryShell, children: [{ path: 'animals', component: Entry }] },
      ]),
      { provide: RegistryApi, useValue: api },
    ],
  });
  const h = await RouterTestingHarness.create('/animals');
  await h.fixture.whenStable();
  return h;
}
describe('Phase 7 shell', () => {
  it('shows five sections and gates section write actions', async () => {
    const h = await shell();
    const el = h.fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-role="nav"] a').length).toBe(5);
    expect(el.querySelector('[data-role="section-start-session"]')).toBeTruthy();
    expect(el.querySelector('[data-role="section-bar"] a[href="/animals/new"]')).toBeNull();
    TestBed.inject(Session).set('recall', 'Adnan');
    h.detectChanges();
    expect(el.querySelector('[data-role="section-bar"] a[href="/animals/new"]')).toBeTruthy();
  });
  it('submits the focused form through its native handler with the platform chord', async () => {
    const h = await shell();
    Entry.saves = 0;
    const el = h.fixture.nativeElement as HTMLElement;
    const input = el.querySelector('main input')!;
    const apple = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        metaKey: apple,
        ctrlKey: !apple,
      }),
    );
    expect(Entry.saves).toBe(1);
    expect((input as HTMLInputElement).value).toBe('keep this');
  });
  it('keeps an in-progress screen mounted while session setup opens', async () => {
    const h = await shell();
    const el = h.fixture.nativeElement as HTMLElement;
    const input = el.querySelector('main input');
    TestBed.inject(Session).requestSetup();
    h.detectChanges();
    expect(el.querySelector('main input')).toBe(input);
    expect(el.querySelector('[data-role="session-setup"]')).toBeTruthy();
  });
});

describe('Calvings browse', () => {
  it('preserves month precision and marks superseded events', async () => {
    setup({
      calvings: () =>
        Promise.resolve([
          {
            id: 'e1',
            occurred_on: '2020-03-01',
            date_precision: 'month',
            effective: false,
            payload: { outcome: 'live' },
          },
        ]),
    });
    const f = TestBed.createComponent(CalvingsList);
    f.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('2020-03');
    expect(f.nativeElement.textContent).not.toContain('2020-03-01');
    expect(f.nativeElement.textContent).toContain('superseded');
  });
  it('does not render a partial herd as a complete or empty history', async () => {
    setup({ calvings: () => Promise.reject(new Error('failed history')) });
    const f = TestBed.createComponent(CalvingsList);
    f.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('failed history');
    expect(f.nativeElement.querySelector('table')).toBeNull();
  });
});
