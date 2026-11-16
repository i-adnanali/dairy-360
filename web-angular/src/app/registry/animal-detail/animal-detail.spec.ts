import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnimalDetailView } from './animal-detail';
import { RegistryApi } from '../api';
import type { AnimalDetail } from '../types';

const tick = async (f: any) => {
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
};

function detail(extra: Record<string, unknown> = {}): AnimalDetail {
  return {
    animal: { id: 'BD-0001', name: 'Noori', sex: 'female', species: 'buffalo', origin: 'born_on_farm', post_no: null, tag_no: null },
    status: { animal_id: 'BD-0001', status: 'lactating', parity: 1, birth_on: '2020-01-01', birth_precision: 'day', open_lactation_id: null },
    events: [],
    ...extra,
  } as AnimalDetail;
}

const view = {
  state: 'window', basis: 'inferred', as_of: '2026-11-16',
  service: { event_id: 'e1', service_type: 'ai', occurred_on: '2026-02-01', date_precision: 'day', exposure_days: null },
  services_in_case: 1, ambiguous_attribution: false,
  conception_earliest: '2026-02-01', conception_latest: '2026-02-01', day_min: 288, day_max: 288,
  window: { opens_on: '2026-11-13', closes_on: '2026-12-23' }, latest_check: null,
};

async function mount(d: AnimalDetail) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: RegistryApi,
        useValue: {
          animal: vi.fn(async () => d),
          list: vi.fn(async () => ({ items: [] })),
          healthGet: vi.fn(async () => ({ tasks: [], withdrawals: [] })),
        },
      },
    ],
  });
  const f = TestBed.createComponent(AnimalDetailView);
  f.componentRef.setInput('id', 'BD-0001');
  await tick(f);
  await tick(f);
  return f.nativeElement as HTMLElement;
}

describe('AnimalDetailView reproduction badge', () => {
  it('draws no reproduction badge when the field is absent', async () => {
    const el = await mount(detail());
    expect(el.querySelector('[data-role="serial"]')).not.toBeNull();
    expect(el.querySelector('[data-role="reproduction"]')).toBeNull();
    expect(el.querySelector('[data-role="reproduction-basis"]')).toBeNull();
  });
  it('draws no reproduction badge when reproduction is null', async () => {
    const el = await mount(detail({ reproduction: null }));
    expect(el.querySelector('[data-role="serial"]')).not.toBeNull();
    expect(el.querySelector('[data-role="reproduction"]')).toBeNull();
    expect(el.querySelector('[data-role="reproduction-basis"]')).toBeNull();
  });
  it('draws the state and its basis when a view is present', async () => {
    const el = await mount(detail({ reproduction: view }));
    const badge = el.querySelector('[data-role="reproduction"]');
    expect(badge?.textContent).toContain('Calving window');
    expect(el.querySelector('[data-role="reproduction-basis"]')?.textContent).toContain('worked out');
  });
});
