import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RegistryApi } from './api';
import { TodayBoard } from './today-board/today-board';
import { CalvingForm } from './calving-form/calving-form';
import type { DayBoard } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const board = (on: string): DayBoard => ({ on, milking: [], dispatch: [],
  payroll: { from_on: on, to_on: on, outstanding: 0, permanent: 0 }, payroll_previous: null });
it('does not let an older date overwrite a newer Today board or publish its error', async () => {
  const old = deferred<DayBoard>();
  const today = vi.fn(async (on: string) => board(on));
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: RegistryApi, useValue: { today } }] });
  const f = TestBed.createComponent(TodayBoard);
  await f.whenStable();
  const c = f.componentInstance as any;
  today.mockReturnValueOnce(old.promise);
  const request = c.load('2026-10-01');
  expect(c.board()).toBeNull();
  await c.load('2026-10-02');
  old.reject(new Error('old request failed')); await request;
  expect(c.board().on).toBe('2026-10-02'); expect(c.loadError()).toBeNull();
});
it('shows failed calf and dam lookups with retry instead of an empty-match conclusion', async () => {
  const candidate = deferred<any[]>();
  const recordCalving = vi.fn();
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: RegistryApi, useValue: {
    damCandidates: async () => { throw new Error('Dam lookup failed'); },
    identifierValues: async () => ({ observed_by: [], acquired_from: [], sire_ref: [] }),
    linkCandidates: () => candidate.promise, recordCalving,
  } }] });
  const f = TestBed.createComponent(CalvingForm); await f.whenStable();
  const c = f.componentInstance as any;
  c.damId.set('A'); c.calfSex.set('female');
  c.when.set({ status: 'complete', value: { occurred_on: '2026-10-01', date_precision: 'day', occurred_time: null }, reading: '' });
  await f.whenStable();
  expect(c.candidateStatus()).toBe('loading');
  c.calfAnswered.set(true);
  await c.submit();
  expect(recordCalving).not.toHaveBeenCalled();
  expect(f.nativeElement.querySelector('[data-role="candidates-empty"]')).toBeNull();
  candidate.reject(new Error('Candidates failed')); await new Promise(resolve => setTimeout(resolve, 0)); await f.whenStable();
  await c.submit();
  expect(recordCalving).not.toHaveBeenCalled();
  expect(c.candidateStatus()).toBe('failed'); expect(c.canSubmit()).toBe(false);
  expect(f.nativeElement.textContent).toContain('Could not load calf candidates');
  expect(f.nativeElement.textContent).toContain('Dam lookup failed');
  expect(f.nativeElement.querySelector('[data-role="candidates-empty"]')).toBeNull();
});

it('keeps keyboard focus in the lookup region when retry replaces its button', async () => {
  const dams = deferred<any[]>(), calves = deferred<any[]>();
  const damCandidates = vi.fn().mockRejectedValueOnce(new Error('Dam lookup failed')).mockReturnValue(dams.promise);
  const linkCandidates = vi.fn().mockRejectedValueOnce(new Error('Calf lookup failed')).mockReturnValue(calves.promise);
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: RegistryApi, useValue: {
    damCandidates, linkCandidates,
    identifierValues: async () => ({ observed_by: [], acquired_from: [], sire_ref: [] }),
  } }] });
  const f = TestBed.createComponent(CalvingForm); await f.whenStable();
  const c = f.componentInstance as any;
  const damRegion = f.nativeElement.querySelector('[aria-label="Dam lookup"]') as HTMLElement;
  const damRetry = damRegion.querySelector('button')!;
  damRetry.focus(); damRetry.click(); await f.whenStable();
  expect(document.activeElement).toBe(damRegion);
  expect(damRegion.textContent).toContain('Loading dams');
  dams.resolve([]); await new Promise(resolve => setTimeout(resolve, 0)); await f.whenStable();
  expect(document.activeElement).toBe(damRegion);
  c.damId.set('A'); c.calfSex.set('female');
  c.when.set({ status: 'complete', value: { occurred_on: '2026-10-01', date_precision: 'day', occurred_time: null }, reading: '' });
  await f.whenStable();
  const calfRegion = f.nativeElement.querySelector('[aria-label="Calf lookup"]') as HTMLElement;
  const calfRetry = calfRegion.querySelector('button')!;
  calfRetry.focus(); calfRetry.click(); await f.whenStable();
  expect(document.activeElement).toBe(calfRegion);
  expect(calfRegion.textContent).toContain('Looking for matching calves');
  calves.resolve([]); await new Promise(resolve => setTimeout(resolve, 0)); await f.whenStable();
  expect(document.activeElement).toBe(calfRegion);
  expect(calfRegion.textContent).toContain('None of these');
});
