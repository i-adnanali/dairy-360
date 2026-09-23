import { Component, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RegistryApi } from './api';
import { Session } from './session';
import { DraftRegistry, draftActivate } from './draft-registry';
import { AnimalForm } from './animal-form';
import { CalvingForm } from './calving-form';
import { EventForm } from './event-form';
import { CorrectionForm } from './correction-form';
import { DispatchSheetScreen } from './dispatch-sheet';
import { PayrollRunScreen } from './payroll-run';
import { PeopleList } from './people-list';
import { PersonDetail } from './person-detail';
import { DestinationsList } from './destinations-list';
import { DestinationDetail } from './destination-detail';

@Component({ template: 'Destination' })
class Destination {}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const matrix: [string, Type<any>, string, string, Record<string, unknown>][] = [
  ['animal', AnimalForm, 'name', 'Partially entered animal', {}],
  ['calving', CalvingForm, 'sireRef', 'Partially entered sire', {}],
  ['event', EventForm, 'text', 'Partially entered event', { animalId: 'BD-fixture' }],
  ['correction', CorrectionForm, 'notes', 'Correction draft', { events: [] }],
  ['dispatch', DispatchSheetScreen, 'handedBy', 'Dispatch observer', {}],
  ['payroll', PayrollRunScreen, 'observedBy', 'Payroll observer', {}],
  ['person', PeopleList, 'contact', '0123', {}],
  ['engagement', PeopleList, 'engageRole', 'Worker', {}],
  ['person payment', PersonDetail, 'note', 'Payment draft', { id: 'person-fixture' }],
  ['close engagement', PersonDetail, 'endReason', 'Closing draft', { id: 'person-fixture' }],
  ['destination', DestinationsList, 'name', 'Buyer draft', {}],
  ['price', DestinationsList, 'priceAmount', '7100', {}],
  ['buyer payment', DestinationDetail, 'note', 'Buyer payment draft', { id: 'buyer-fixture' }],
];
describe('Every rendered non-pilot writer participates in route safety', () => {
  it.each(matrix)(
    '%s retains on Keep, reverts to pristine, and discards before intended navigation',
    async (_name, component, field, value, inputs) => {
      const api = {
        identifierValues: async () => ({ observed_by: [], acquired_from: [], sire_ref: [] }),
        duplicateCandidates: async () => [],
        damCandidates: async () => [],
        linkCandidates: async () => [],
        list: async () => ({ items: [], totalItems: 0, totalPages: 0, page: 1, pageSize: 25 }),
        destinations: async () => [],
        people: async () => [],
        person: async () => null,
        statement: async () => null,
        dispatchSheet: async (on: string, session: string) => ({
          occurred_on: on,
          session,
          standing: [],
          occasional: [],
          litres: 0,
          amount_minor: 0,
          saved: 0,
          produced: {
            measured_litres: 0,
            measured_count: 0,
            unmeasured_count: 0,
            not_milked_count: 0,
          },
          previous_session: { occurred_on: on, session },
        }),
        payrollRun: async () => ({
          permanent: [],
          daily: [],
          daily_candidates: [],
          total_minor: 0,
          answered: 0,
          outstanding: 0,
        }),
      };
      TestBed.configureTestingModule({
        providers: [
          { provide: RegistryApi, useValue: api },
          provideRouter([
            {
              path: '',
              canActivateChild: [draftActivate],
              children: [{ path: 'other', component: Destination }],
            },
          ]),
        ],
      });
      TestBed.inject(Session).set('direct_entry', 'fixture');
      const f = TestBed.createComponent(component);
      for (const [key, val] of Object.entries(inputs)) f.componentRef.setInput(key, val);
      f.detectChanges();
      await tick();
      f.detectChanges();
      const registry = TestBed.inject(DraftRegistry),
        router = TestBed.inject(Router);
      expect(registry.hasChanges()).toBe(false);
      const original = f.componentInstance[field]();
      f.componentInstance[field].set(value);
      f.detectChanges();
      const leave = router.navigateByUrl('/other');
      await tick();
      f.detectChanges();
      expect(document.querySelectorAll('app-draft-dialog').length).toBe(1);
      document.querySelector<HTMLButtonElement>('[data-role=keep-editing]')!.click();
      expect(await leave).toBe(false);
      expect(router.url).toBe('/');
      expect(f.componentInstance[field]()).toBe(value);
      f.componentInstance[field].set(original);
      f.detectChanges();
      expect(registry.hasChanges()).toBe(false);
      f.componentInstance[field].set(value);
      f.detectChanges();
      const discard = router.navigateByUrl('/other');
      await tick();
      f.detectChanges();
      document.querySelector<HTMLButtonElement>('[data-role=discard-changes]')!.click();
      expect(await discard).toBe(true);
      expect(router.url).toBe('/other');
      expect(f.componentInstance[field]()).toBe(original);
      f.destroy();
      expect(registry.hasChanges()).toBe(false);
    },
  );
});
