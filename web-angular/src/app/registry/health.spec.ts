import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HealthPage } from './health-page';
import { RegistryApi, ApiError } from './api';
import { Session } from './session';
import { routes } from '../app.routes';

describe('health management', () => {
  let write: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    write = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: RegistryApi,
          useValue: {
            healthGet: (path: string) =>
              Promise.resolve(
                path.includes('/board')
                  ? { tasks: [], overdue: 0, due: 0, upcoming: 0, open_cases: [], withdrawals: [] }
                  : [],
              ),
            herd: () => Promise.resolve([]),
            healthWrite: write,
          },
        },
      ],
    });
  });
  it('gates forms and submissions until provenance is set, preserving the draft', async () => {
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    Array.from(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.trim() === 'Start vet visit')!
      .click();
    await f.whenStable();
    c.form.vet = 'Doctor';
    f.detectChanges();
    expect(f.nativeElement.querySelector('app-session-required')).not.toBeNull();
    expect(f.nativeElement.querySelector('input[name="vet"]')).toBeNull();
    await c.save();
    expect(write).not.toHaveBeenCalled();
    TestBed.inject(Session).set('direct_entry', 'operator');
    await f.whenStable();
    f.detectChanges();
    expect(c.form.vet).toBe('Doctor');
    expect(f.nativeElement.querySelector('input[name="vet"]')).not.toBeNull();
  });
  it('preserves inputs and retry key when a save outcome is uncertain', async () => {
    write.mockRejectedValue(
      new ApiError({ error: 'network_unreachable', message: 'Network unavailable' }, false),
    );
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'operator');
    c.create('visits');
    c.form.vet = 'Doctor';
    await c.save();
    await c.save();
    expect(write.mock.calls[0][2]).toBe(write.mock.calls[1][2]);
    expect(c.form.vet).toBe('Doctor');
  });
  it('does not erase visit purpose after a save or replace it with the correction reason', async () => {
    const saved = {
      id: 'visit',
      entity: 'visits',
      revision: 1,
      reason: 'Routine examination',
      vet: 'Doctor',
    };
    write.mockResolvedValue(saved);
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'operator');
    c.create('visits');
    c.form.reason = 'Routine examination';
    await c.save();
    expect(c.form.reason).toBe('Routine examination');
    expect(c.form.correction_reason).toBe('');
  });
  it('keeps health literal route before the animal serial route', () => {
    const paths = routes[0].children!.map((r) => r.path);
    expect(paths.indexOf('animals/health')).toBeLessThan(paths.indexOf('animals/:id'));
    expect(paths).toContain('animals/:id/report');
  });
});
