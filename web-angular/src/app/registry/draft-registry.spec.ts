import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { DraftRegistry, draftActivate, draftDeactivate } from './draft-registry';
import { MilkingRosterScreen } from "./milking-roster/milking-roster";
import { HealthPage } from "./health-page/health-page";
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionGate } from "./session-gate/session-gate";
import { Target } from './target';

@Component({ template: '<h2>Other page</h2>' })
class Other {}
const roster = (on: string, session: string) => ({
  occurred_on: on,
  session,
  previous_session: { occurred_on: on, session },
  saved: 0,
  rows: Array.from({ length: 26 }, (_, i) => ({
    animal_id: 'BD-' + i,
    name: 'Animal ' + i,
    days_in_milk: 2,
    existing: null,
    previous: null,
    recent_mean: null,
    recent_n: 0,
  })),
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function answer(discard = false) {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-role="${discard ? 'discard-changes' : 'keep-editing'}"]`,
  );
  expect(button).not.toBeNull();
  button!.click();
}
async function setup(path = '/milk/milking?on=2026-09-17&session=morning') {
  const api = {
    identifierValues: vi.fn(async () => ({ observed_by: [], acquired_from: [], sire_ref: [] })),
    milkingRoster: vi.fn(async (on, session) => roster(on, session)),
    saveMilkingSession: vi.fn(),
    herd: vi.fn(async () => []),
    healthGet: vi.fn(async (path: string) =>
      path.includes('/board') ? { tasks: [], open_cases: [], withdrawals: [] } : [],
    ),
    healthWrite: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: RegistryApi, useValue: api },
      provideRouter([
        {
          path: '',
          canActivateChild: [draftActivate],
          children: [
            {
              path: 'milk/milking',
              component: MilkingRosterScreen,
              canDeactivate: [draftDeactivate],
              runGuardsAndResolvers: 'always',
            },
            {
              path: 'animals/health',
              component: HealthPage,
              canDeactivate: [draftDeactivate],
              runGuardsAndResolvers: 'always',
            },
            { path: 'other', component: Other },
          ],
        },
      ]),
    ],
  });
  TestBed.inject(Session).set('direct_entry', 'fixture');
  const h = await RouterTestingHarness.create(path);
  await tick();
  h.detectChanges();
  return { h, api, router: TestBed.inject(Router), drafts: TestBed.inject(DraftRegistry) };
}
function enter(h: RouterTestingHarness, value: string) {
  const input = h.routeNativeElement!.querySelector<HTMLInputElement>('[data-role="litres-BD-0"]')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  h.detectChanges();
}
describe('B1 draft pilots', () => {
  it('keeps dirty milking values, URL and date control on cancelled context or route changes; discard resumes the exact target', async () => {
    const { h, router, api } = await setup();
    enter(h, '7.5');
    const leave = router.navigateByUrl('/other');
    await tick();
    h.detectChanges();
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
    answer();
    expect(await leave).toBe(false);
    expect(
      h.routeNativeElement!.querySelector<HTMLInputElement>('[data-role="litres-BD-0"]')!.value,
    ).toBe('7.5');
    const next = router.navigateByUrl('/milk/milking?on=2026-09-18&session=evening');
    await tick();
    h.detectChanges();
    answer();
    expect(await next).toBe(false);
    expect(router.url).toContain('2026-09-17');
    expect(api.milkingRoster).toHaveBeenCalledTimes(1);
    const discard = router.navigateByUrl('/milk/milking?on=2026-09-18&session=evening');
    await tick();
    h.detectChanges();
    answer(true);
    expect(await discard).toBe(true);
    await tick();
    h.detectChanges();
    expect(api.milkingRoster).toHaveBeenLastCalledWith('2026-09-18', 'evening');
    expect(
      h.routeNativeElement!.querySelector<HTMLInputElement>('[data-role="litres-BD-0"]')!.value,
    ).toBe('');
  });
  it('reverted values and local pages are pristine transitions, while pagination preserves the entire draft', async () => {
    const { h, router, drafts } = await setup();
    enter(h, '3');
    const c = h.routeDebugElement!.componentInstance as any;
    c.tablePage.set(2);
    h.detectChanges();
    expect(drafts.hasChanges()).toBe(true);
    c.tablePage.set(1);
    h.detectChanges();
    expect(
      h.routeNativeElement!.querySelector<HTMLInputElement>('[data-role="litres-BD-0"]')!.value,
    ).toBe('3');
    enter(h, '');
    expect(drafts.hasChanges()).toBe(false);
    expect(await router.navigateByUrl('/other')).toBe(true);
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('keeps observer edits without reloading rows and warns on unload only while dirty', async () => {
    const { h, api, drafts } = await setup();
    const observer =
      h.routeNativeElement!.querySelector<HTMLInputElement>('[data-role=observed_by]')!;
    observer.value = 'fixture milker';
    observer.dispatchEvent(new Event('input'));
    h.detectChanges();
    await tick();
    expect(api.milkingRoster).toHaveBeenCalledTimes(1);
    expect(drafts.hasChanges()).toBe(true);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    observer.value = '';
    observer.dispatchEvent(new Event('input'));
    h.detectChanges();
    await tick();
    expect(drafts.hasChanges()).toBe(false);
    const pristine = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pristine);
    expect(pristine.defaultPrevented).toBe(false);
  });
  it('guards recorder/source changes before applying attribution', async () => {
    const { h } = await setup();
    enter(h, '4.5');
    // The target remains an isolated fixture; no storage API is involved here.
    vi.spyOn(TestBed.inject(Target), 'probe').mockResolvedValue('harness');
    TestBed.inject(Target).probed.set(true);
    TestBed.inject(Target).kind.set('harness');
    const gate = TestBed.createComponent(SessionGate);
    gate.detectChanges();
    const c = gate.componentInstance as any;
    c.form.set('recall');
    c.who.set('another fixture recorder');
    const update = c.start();
    await tick();
    gate.detectChanges();
    answer();
    await update;
    expect(TestBed.inject(Session).recordedBy()).toBe('fixture');
    expect(
      h.routeNativeElement!.querySelector<HTMLInputElement>('[data-role="litres-BD-0"]')!.value,
    ).toBe('4.5');
    const discard = c.start();
    await tick();
    gate.detectChanges();
    answer(true);
    await discard;
    expect(TestBed.inject(Session).recordedBy()).toBe('another fixture recorder');
    gate.destroy();
  });
  it('blocks navigation during a save and suppresses duplicate submit', async () => {
    const { h, api, router } = await setup();
    const c = h.routeDebugElement!.componentInstance as any;
    let resolve!: (v: unknown) => void;
    api.saveMilkingSession.mockImplementation(() => new Promise((r) => (resolve = r)));
    for (let i = 0; i < 26; i++) c.mark('BD-' + i, 'milked_not_measured');
    const save = c.submit();
    void c.submit();
    expect(api.saveMilkingSession).toHaveBeenCalledTimes(1);
    h.detectChanges();
    expect(h.routeNativeElement!.querySelector<HTMLInputElement>('[data-role=observed_by]')!.disabled).toBe(true);
    c.setMilkedBy('late edit');
    expect(c.milkedBy()).toBe('');
    const leave = router.navigateByUrl('/other');
    await tick();
    h.detectChanges();
    expect(document.querySelector('[data-role=discard-changes]')).toBeNull();
    expect(document.body.textContent).toContain('Saving; wait for the result.');
    answer();
    expect(await leave).toBe(false);
    resolve({ written: 26, measured: 0, updated: 0 });
    await save;
    expect(await router.navigateByUrl('/other')).toBe(true);
  });
  it('rejects a late roster response from an older context', async () => {
    const { h, api, router } = await setup();
    let old!: (v: unknown) => void;
    api.milkingRoster.mockImplementationOnce(() => new Promise((r) => (old = r)) as any);
    await router.navigateByUrl('/milk/milking?on=2026-09-18&session=morning');
    await tick();
    await router.navigateByUrl('/milk/milking?on=2026-09-19&session=morning');
    await tick();
    old(roster('2026-09-18', 'morning'));
    await tick();
    h.detectChanges();
    const c = h.routeDebugElement!.componentInstance as any;
    expect(c.roster().occurred_on).toBe('2026-09-19');
  });
  it('protects Health editor, round and action cancellation through the same dialog', async () => {
    const { h, router, drafts } = await setup('/animals/health');
    const c = h.routeDebugElement!.componentInstance as any;
    await c.create('visits');
    c.form.vet = 'Fixture vet';
    h.detectChanges();
    const close = c.closeEditor();
    await tick();
    h.detectChanges();
    answer();
    await close;
    expect(c.form.vet).toBe('Fixture vet');
    expect(c.editorOpen).toBe(true);
    const round = c.openRound();
    await tick();
    h.detectChanges();
    answer(true);
    await round;
    c.roundConfirmed = true;
    h.detectChanges();
    expect(drafts.hasChanges()).toBe(true);
    const leave = router.navigateByUrl('/other');
    await tick();
    h.detectChanges();
    answer();
    expect(await leave).toBe(false);
    const action = c.openAction({ id: 'task', revision: 1 });
    await tick();
    h.detectChanges();
    answer(true);
    await action;
    c.action = 'cancel';
    h.detectChanges();
    expect(drafts.hasChanges()).toBe(true);
  });
});
