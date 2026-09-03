import { TestBed } from '@angular/core/testing';
import { PrecisionDateControl } from './precision-date';
import type { PrecisionDate } from './precision-date';

function make() {
  const fixture = TestBed.createComponent(PrecisionDateControl);
  const emitted: (PrecisionDate | null)[] = [];
  fixture.componentInstance.changed.subscribe((v) => emitted.push(v));
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, emitted };
}

const pick = (el: HTMLElement, p: string) =>
  (el.querySelector(`[data-precision="${p}"]`) as HTMLButtonElement).click();

describe('PrecisionDateControl', () => {
  it('shows NO date input until a precision is chosen, and emits nothing usable', () => {
    // Mirrors NOT NULL with no default: there is no state of this control that
    // produces a date without a precision.
    const { el, emitted } = make();
    expect(el.querySelector('[data-role="year"]')).toBeNull();
    expect(el.querySelector('[data-role="preview"]')).toBeNull();
    expect(emitted.every((v) => v === null)).toBe(true);
  });

  it('has NO day field at month precision -- the mechanism, not a validation', () => {
    // "Type a full date, then downgrade the precision" is how a month row ends
    // up dated the 14th. It is unreachable because the input does not exist.
    const { fixture, el } = make();
    pick(el, 'month');
    fixture.detectChanges();
    expect(el.querySelector('[data-role="year"]')).not.toBeNull();
    expect(el.querySelector('[data-role="month"]')).not.toBeNull();
    expect(el.querySelector('[data-role="day"]')).toBeNull();
    expect(el.querySelector('[data-role="time"]')).toBeNull();
  });

  it('has no month or day field at year precision', () => {
    const { fixture, el } = make();
    pick(el, 'year');
    fixture.detectChanges();
    expect(el.querySelector('[data-role="year"]')).not.toBeNull();
    expect(el.querySelector('[data-role="month"]')).toBeNull();
    expect(el.querySelector('[data-role="day"]')).toBeNull();
  });

  it('offers a time input ONLY at day precision', () => {
    const { fixture, el } = make();
    pick(el, 'day');
    fixture.detectChanges();
    expect(el.querySelector('[data-role="time"]')).not.toBeNull();
    pick(el, 'month');
    fixture.detectChanges();
    expect(el.querySelector('[data-role="time"]')).toBeNull();
  });

  it('emits dates already in the storage convention', () => {
    const { fixture, el, emitted } = make();
    const last = () => emitted[emitted.length - 1]!;

    pick(el, 'day');
    fixture.detectChanges();
    const y = el.querySelector('[data-role="year"]') as HTMLInputElement;
    y.value = '2024';
    y.dispatchEvent(new Event('input'));
    const m = el.querySelector('[data-role="month"]') as HTMLSelectElement;
    m.value = '3';
    m.dispatchEvent(new Event('change'));
    const d = el.querySelector('[data-role="day"]') as HTMLInputElement;
    d.value = '14';
    d.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(last()).toEqual({ occurred_on: '2024-03-14', date_precision: 'day', occurred_time: null });

    // Month -> the 1st. Note the day was 14 a moment ago and does NOT survive.
    pick(el, 'month');
    fixture.detectChanges();
    expect(last()).toEqual({ occurred_on: '2024-03-01', date_precision: 'month', occurred_time: null });

    // Year and estimated -> January 1.
    pick(el, 'year');
    fixture.detectChanges();
    expect(last()).toEqual({ occurred_on: '2024-01-01', date_precision: 'year', occurred_time: null });

    pick(el, 'estimated');
    fixture.detectChanges();
    expect(last()).toEqual({ occurred_on: '2024-01-01', date_precision: 'estimated', occurred_time: null });
  });

  it('drops a time when precision leaves day, so it cannot be sent above it', () => {
    const { fixture, el, emitted } = make();
    pick(el, 'day');
    fixture.detectChanges();
    const t = el.querySelector('[data-role="time"]') as HTMLInputElement;
    t.value = '05:30';
    t.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(emitted[emitted.length - 1]!.occurred_time).toBe('05:30');

    pick(el, 'month');
    fixture.detectChanges();
    expect(emitted[emitted.length - 1]!.occurred_time).toBeNull();
  });

  it('shows the server refusal verbatim', () => {
    const { fixture, el } = make();
    const prose =
      "month precision must be stored as the 1st of the month, got '2024-03-14'. " +
      'A month row dated mid-month means a known date was silently downgraded.';
    fixture.componentRef.setInput('error', prose);
    fixture.detectChanges();
    expect(el.querySelector('[data-role="error"]')!.textContent!.trim()).toBe(prose);
  });

  it('explains that there is no default before anything is chosen', () => {
    const { el } = make();
    expect(el.textContent).toContain('no default');
  });
});
