import { ApplicationRef } from '@angular/core';
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
  return (await mountFixture(() => d)).nativeElement as HTMLElement;
}

async function mountFixture(
  byId: (id: string) => AnimalDetail,
  health: { tasks: unknown[]; withdrawals: unknown[] } = { tasks: [], withdrawals: [] },
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: RegistryApi,
        useValue: {
          animal: vi.fn(async (id: string) => byId(id)),
          list: vi.fn(async () => ({ items: [] })),
          healthGet: vi.fn(async () => health),
          identifierValues: vi.fn(async () => ({ observed_by: [], acquired_from: [], sire_ref: [] })),
        },
      },
    ],
  });
  const f = TestBed.createComponent(AnimalDetailView);
  f.componentRef.setInput('id', 'BD-0001');
  await tick(f);
  await tick(f);
  return f;
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

async function openBreeding(el: HTMLElement): Promise<HTMLElement> {
  (el.querySelector('[data-tab="breeding"]') as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r));
  TestBed.inject(ApplicationRef).tick();
  return el.querySelector('[data-role="breeding-tab"]') as HTMLElement;
}

describe('AnimalDetailView Breeding tab', () => {
  it('no Breeding tab when the server sends no reproduction key', async () => {
    const el = await mount(detail());
    expect(el.querySelector('[data-tab="events"]')).not.toBeNull();
    expect(el.querySelector('[data-tab="breeding"]')).toBeNull();
  });
  it('no Breeding tab for a male', async () => {
    const d = detail({ reproduction: null });
    d.animal.sex = 'male';
    const el = await mount(d);
    expect(el.querySelector('[data-tab="events"]')).not.toBeNull();
    expect(el.querySelector('[data-tab="breeding"]')).toBeNull();
  });
  it('the tab says no service when the view is null', async () => {
    const tab = await openBreeding(await mount(detail({ reproduction: null, breeding_entry: false })));
    expect(tab.querySelector('[data-role="no-service"]')?.textContent).toContain('No service recorded.');
  });
  it('the tab shows the pregnancy and the closed note outside the pilot', async () => {
    const tab = await openBreeding(await mount(detail({ reproduction: view, breeding_entry: false })));
    const text = tab.textContent ?? '';
    expect(text).toContain('Calving window');
    expect(text).toContain('worked out');
    expect(text).toContain('Day 288');
    expect(tab.querySelector('[data-role="entry-closed"]')?.textContent).toContain(
      'Breeding entry is open only for the animals in the pilot.',
    );
    expect(tab.querySelector('app-breeding-form')).toBeNull();
  });
  it('the form appears for a pilot animal', async () => {
    const tab = await openBreeding(await mount(detail({ reproduction: view, breeding_entry: true })));
    expect(tab.querySelector('app-breeding-form')).not.toBeNull();
    expect(tab.querySelector('[data-role="entry-closed"]')).toBeNull();
  });
  it('the tab shows each derived note under the pregnancy', async () => {
    const tab = await openBreeding(
      await mount(detail({
        reproduction: view, breeding_entry: false,
        reproduction_notes: [{ code: 'wide_window', text: 'The calving window is wider because the service date is known to the month only.' }],
      })),
    );
    const notes = [...tab.querySelectorAll('[data-role="note"]')];
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain('The calving window is wider because the service date is known to the month only.');
    expect(notes[0].querySelector('[appQualifier]')).not.toBeNull();
    expect(tab.querySelector('[data-role="this-pregnancy"] ~ [data-role="note"]')).not.toBeNull();
  });
  it('a month-wide service says it is a range', async () => {
    const tab = await openBreeding(
      await mount(detail({ reproduction: { ...view, conception_latest: '2026-02-28' }, breeding_entry: false })),
    );
    const note = tab.querySelector('[data-role="range-note"]')?.textContent ?? '';
    expect(note).toContain('1 Feb 2026');
    expect(note).toContain('28 Feb 2026');
  });
  it('the tab order is the mockup\'s', async () => {
    const el = await mount(detail({ reproduction: null }));
    const labels = [...el.querySelectorAll('[data-tab]')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Timeline', 'Breeding', 'Add an event', 'Correct a calving']);
  });
  it('falls back to Timeline when the next animal has no Breeding tab', async () => {
    const bull = detail({ reproduction: null });
    bull.animal = { ...bull.animal, id: 'BD-0002', sex: 'male' };
    const f = await mountFixture((id) => (id === 'BD-0002' ? bull : detail({ reproduction: view, breeding_entry: false })));
    const el = f.nativeElement as HTMLElement;
    expect(await openBreeding(el)).not.toBeNull();
    f.componentRef.setInput('id', 'BD-0002');
    await tick(f);
    await tick(f);
    expect(el.querySelector('[data-role="serial"]')?.textContent).toContain('BD-0002');
    expect(el.querySelector('[data-role="breeding-tab"]')).toBeNull();
    const timeline = el.querySelector('[data-tab="events"]');
    expect(timeline?.getAttribute('aria-selected')).toBe('true');
    expect(timeline?.getAttribute('tabindex')).toBe('0');
  });
});

describe('AnimalDetailView open breeding tasks', () => {
  it('lists a breeding task under "Open for this animal", linked to Breeding', async () => {
    const el = await mount(detail({
      reproduction: view, breeding_entry: false, reproduction_notes: [],
      breeding_tasks: [{ kind: 'calving_watch', animal_id: 'BD-0001', standing: 'due', day_min: 288, day_max: 288, red_from: 319, red_on: '2026-12-17' }],
    }));
    const open = el.querySelector('[data-role="open-now"]');
    expect(open).not.toBeNull();
    const row = open!.querySelector('[data-role="open-breeding-task"]')!;
    expect(row.textContent).toContain('Calving watch');
    expect(row.closest('.open-item')!.querySelector('[appBadge]')!.textContent).toContain('Due');
    const link = [...open!.querySelectorAll('a')].find((a) => a.textContent?.includes('Open in Breeding'));
    expect(link?.getAttribute('href')).toBe('/animals/breeding?animal=BD-0001');
    expect(open!.textContent).not.toContain('Open in Health');
  });
  it('lists the breeding row after the health row, each with its own link', async () => {
    const f = await mountFixture(
      () => detail({
        reproduction: view, breeding_entry: false, reproduction_notes: [],
        breeding_tasks: [{ kind: 'calving_watch', animal_id: 'BD-0001', standing: 'due', day_min: 288, day_max: 288, red_from: 319, red_on: '2026-12-17' }],
      }),
      { tasks: [{ id: 't1', kind: 'administration', standing: 'due', animal_id: 'BD-0001', instructions: 'Vaccine' }], withdrawals: [] },
    );
    // The health board is a second, optional read: let it land.
    await tick(f);
    const open = (f.nativeElement as HTMLElement).querySelector('[data-role="open-now"]')!;
    const health = open.querySelector('[data-role="open-task"]')!;
    const breeding = open.querySelector('[data-role="open-breeding-task"]')!;
    expect(health.textContent).toContain('Vaccine');
    expect(breeding.textContent).toContain('Calving watch');
    expect(health.compareDocumentPosition(breeding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const links = [...open.querySelectorAll('a')].map((a) => a.textContent?.trim());
    expect(links).toContain('Open in Health');
    expect(links).toContain('Open in Breeding');
  });
  it('draws no open section when there are no breeding tasks and nothing from health', async () => {
    const el = await mount(detail({ reproduction: view, breeding_entry: false, breeding_tasks: [] }));
    expect(el.querySelector('[data-role="open-now"]')).toBeNull();
  });
});
