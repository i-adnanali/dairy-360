import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionGate } from './session-gate/session-gate';
import { SessionBar } from './session-bar/session-bar';
import { Session } from './session';
import { Target } from './target';
import { RegistryApi } from './api';
import { WriteLog } from './after-write';

function setup(recorded_by: string[] = ['adnan', 'zainab']) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: RegistryApi, useValue: {
        identifierValues: () => Promise.resolve({ observed_by: [], acquired_from: [], sire_ref: [], recorded_by }),
        storage: () => Promise.resolve({ info: { storage: ':memory:', memory: true }, reachable: true }),
      } },
    ],
  });
  const target = TestBed.inject(Target);
  vi.spyOn(target, 'probe').mockResolvedValue(undefined as never);
  vi.spyOn(target, 'probed').mockReturnValue(true);
  vi.spyOn(target, 'pending').mockReturnValue(false);
  vi.spyOn(target, 'kind').mockReturnValue('harness');
  return TestBed.inject(Session);
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('recording panel', () => {
  it('says what is missing instead of a silently disabled Start', async () => {
    setup();
    const f = TestBed.createComponent(SessionGate);
    f.detectChanges(); await flush(); f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-role="start-blocked"]')!.textContent).toContain('Say who is typing and where the records come from');
    (el.querySelector('[data-chip="direct_entry"]') as HTMLButtonElement).click(); f.detectChanges();
    expect(el.querySelector('[data-role="start-blocked"]')!.textContent).toContain('Say who is typing.');
  });

  it('offers names already used, most-used first, as one-tap choices', async () => {
    setup();
    const f = TestBed.createComponent(SessionGate);
    f.detectChanges(); await flush(); f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const names = Array.from(el.querySelectorAll('[aria-label="Names used before"] button')).map((b) => b.textContent!.trim());
    expect(names).toEqual(['adnan', 'zainab']);
    (el.querySelector('[aria-label="Names used before"] button') as HTMLButtonElement).click(); f.detectChanges();
    expect((el.querySelector('[data-role="recorded-by"]') as HTMLInputElement).value).toBe('adnan');
  });

  it('lists Direct entry first, and number keys choose a source outside text fields', async () => {
    setup();
    const f = TestBed.createComponent(SessionGate);
    f.detectChanges(); await flush(); f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-chip]')!.getAttribute('data-chip')).toBe('direct_entry');
    el.querySelector('form')!.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    f.detectChanges();
    expect(el.querySelector('[data-chip="recall"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('names the purpose when a form asked for it, and announces the start', async () => {
    const session = setup();
    const f = TestBed.createComponent(SessionGate);
    f.componentRef.setInput('purpose', 'this crop');
    f.detectChanges(); await flush(); f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-role="gate-purpose"]')!.textContent).toContain('To save this crop');
    (el.querySelector('[data-chip="direct_entry"]') as HTMLButtonElement).click();
    const who = el.querySelector('[data-role="recorded-by"]') as HTMLInputElement;
    who.value = 'adnan'; who.dispatchEvent(new Event('input')); f.detectChanges();
    (el.querySelector('[data-role="start"]') as HTMLButtonElement).click(); await flush();
    expect(session.ready()).toBe(true);
    expect(TestBed.inject(WriteLog).last()).toBe('Recording started: adnan · Direct entry');
  });

  it('Cancel emits, so the shell can close the panel', async () => {
    setup();
    const f = TestBed.createComponent(SessionGate);
    const cancelled = vi.fn();
    f.componentInstance.cancelled.subscribe(cancelled);
    f.detectChanges();
    (f.nativeElement.querySelector('[data-role="gate-cancel"]') as HTMLButtonElement).click();
    expect(cancelled).toHaveBeenCalled();
  });
});

describe('recording in the header', () => {
  it('Start recording when idle; a Change / Stop menu while recording', async () => {
    const session = setup();
    const f = TestBed.createComponent(SessionBar);
    f.componentRef.setInput('mode', 'session');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-role="start-session"]')!.textContent).toContain('Start recording');
    session.set('direct_entry', 'adnan'); f.detectChanges();
    const chip = el.querySelector('[data-role="change-session"]') as HTMLButtonElement;
    expect(chip.textContent).toContain('Recording · adnan · Direct entry');
    chip.click(); f.detectChanges();
    (el.querySelector('[data-role="recording-stop"]') as HTMLButtonElement).click(); await flush(); f.detectChanges();
    expect(session.ready()).toBe(false);
    expect(session.setupOpen()).toBe(false);
    expect(el.querySelector('[data-role="start-session"]')).not.toBeNull();
  });

  it('Change reopens the panel without clearing the session', () => {
    const session = setup();
    session.set('recall', 'adnan');
    session.requestSetup('a payment');
    expect(session.purpose()).toBe('a payment');
    session.dismissSetup();
    expect(session.ready()).toBe(true);
    expect(session.purpose()).toBeNull();
  });
});
