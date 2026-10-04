import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { DestinationDetail } from "./destination-detail/destination-detail";
import { PersonDetail } from "./person-detail/person-detail";
import { RegistryApi, ApiError } from './api';
import { Session } from './session';
import { signedRupeesToMinor, rupeesToMinor } from './money';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const statement = (id: string) => ({ destination_id: id, person_id: id, identifier: id,
  name: id, billable: true, prices: [], litres: 0, months: [], engagements: [], packages: [], balance_minor: 10000,
  billed_minor: 10000, paid_minor: 0, earned_minor: 10000 });

for (const component of [DestinationDetail, PersonDetail]) {
  describe(`${component.name} verified payment identity`, () => {
    let api: any;
    let fixture: any;
    let view: any;
    beforeEach(async () => {
      api = { statement: vi.fn(async (id: string) => statement(id)),
        person: vi.fn(async (id: string) => statement(id)),
        recordPayment: vi.fn(async () => ({ id: 'payment', amount_minor: 1000 })),
        recordWagePayment: vi.fn(async () => ({ id: 'payment', amount_minor: 1000 })),
        identifierValues: async () => ({ observed_by: [], acquired_from: [], sire_ref: [] }) };
      TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: RegistryApi, useValue: api }] });
      TestBed.inject(Session).set('direct_entry', 'tester');
      fixture = TestBed.createComponent(component as typeof DestinationDetail);
      fixture.componentRef.setInput('id', 'A');
      fixture.detectChanges();
      await fixture.whenStable();
      view = fixture.componentInstance;
    });
    for (const field of ['amount_minor', 'method', 'note', 'occurred_on']) {
      it(`shows a payment refusal for ${field}`, async () => {
        view.payState.error.set(new ApiError({ error: 'refused', field, message: `Refused ${field}` }, true));
        await fixture.whenStable();
        expect(fixture.nativeElement.textContent).toContain(`Refused ${field}`);
      });
    }
    it('blocks payment while B is pending or failed and clears A identity', async () => {
      const pending = deferred<any>();
      api.statement.mockReturnValue(pending.promise); api.person.mockReturnValue(pending.promise);
      fixture.componentRef.setInput('id', 'B'); fixture.detectChanges();
      view.amount.set('10');
      expect(view.statement()).toBeNull();
      expect(view.canPay()).toBe(false);
      await view.submitPayment(new Event('submit'));
      expect(api.recordPayment).not.toHaveBeenCalled();
      expect(api.recordWagePayment).not.toHaveBeenCalled();
      pending.reject(new Error('B failed')); await fixture.whenStable();
      expect(view.loadError()).toBe('B failed'); expect(view.canPay()).toBe(false);
    });
    it('ignores an old failure after a newer successful load', async () => {
      const pending = deferred<any>();
      api.statement.mockReturnValueOnce(pending.promise); api.person.mockReturnValueOnce(pending.promise);
      const old = view.load('A');
      fixture.componentRef.setInput('id', 'B'); fixture.detectChanges();
      await fixture.whenStable();
      pending.reject(new Error('old failure')); await old;
      expect(view.statement().name).toBe('B'); expect(view.loadError()).toBeNull();
    });
    it('records both adjustment directions and requires a nonzero amount and note', async () => {
      view.method.set('adjustment'); view.amount.set('10');
      expect(view.canPay()).toBe(false);
      view.note.set('settlement'); expect(view.canPay()).toBe(true);
      await view.submitPayment(new Event('submit'));
      const write = component === DestinationDetail ? api.recordPayment : api.recordWagePayment;
      expect(write.mock.calls[0][0].amount_minor).toBe(1000);
      view.amount.set(component === PersonDetail ? '-10' : '10'); view.note.set('correction');
      if (component === DestinationDetail) view.negative.set(false);
      await view.submitPayment(new Event('submit'));
      expect(write.mock.calls[1][0].amount_minor).toBe(-1000);
      view.amount.set('0'); expect(view.canPay()).toBe(false);
      view.method.set('cash'); view.amount.set('-10'); expect(view.canPay()).toBe(false);
    });
  });
}

it('parses signed adjustments without changing unsigned money entry', () => {
  expect(signedRupeesToMinor('-10.25')).toBe(-1025);
  expect(signedRupeesToMinor('+10')).toBe(1000);
  expect(signedRupeesToMinor('-0.001')).toBeNull();
  expect(rupeesToMinor('-10')).toBeNull();
});
