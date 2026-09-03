import { TestBed } from '@angular/core/testing';
import { IDENTIFIER_GUIDANCE, IdentifierInput } from './identifier-input';
import type { IdentifierField } from './identifier-input';

function make(field: IdentifierField, suggestions: string[] = [], value = '') {
  const fixture = TestBed.createComponent(IdentifierInput);
  const emitted: string[] = [];
  fixture.componentInstance.changed.subscribe((v) => emitted.push(v));
  fixture.componentRef.setInput('field', field);
  fixture.componentRef.setInput('label', 'Observed by');
  fixture.componentRef.setInput('suggestions', suggestions);
  fixture.componentRef.setInput('value', value);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, emitted };
}

describe('IdentifierInput', () => {
  it('offers previously-used values as a datalist, not a dropdown', () => {
    // A <select> would force every new person through an "add new" flow, which
    // is how a name ends up typed into the wrong field to get past it. A
    // datalist suggests and never constrains.
    const { el } = make('observed_by', ['abdul', 'rashid']);
    const input = el.querySelector('[data-role="observed_by"]') as HTMLInputElement;
    const list = el.querySelector('datalist')!;

    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('list')).toBe(list.getAttribute('id'));
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual([
      'abdul',
      'rashid',
    ]);
  });

  it('still accepts a value that is not in the list', () => {
    const { fixture, el, emitted } = make('observed_by', ['abdul']);
    const input = el.querySelector('[data-role="observed_by"]') as HTMLInputElement;
    input.value = 'someone new';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(emitted[emitted.length - 1]).toBe('someone new');
  });

  it('behaves as a plain text field when there are no suggestions', () => {
    // The state of a fresh registry. It must not look broken.
    const { el } = make('observed_by', []);
    expect(el.querySelector('[data-role="observed_by"]')).not.toBeNull();
    expect(el.querySelectorAll('datalist option').length).toBe(0);
  });

  it('gives each field its own datalist id', () => {
    // Two datalists sharing an id would silently make one win for both inputs,
    // and the workbench will have several of these on one page.
    const a = make('observed_by', ['x']);
    const b = make('sire_ref', ['y']);
    expect(a.el.querySelector('datalist')!.getAttribute('id')).not.toBe(
      b.el.querySelector('datalist')!.getAttribute('id'),
    );
  });

  it('tells every identifier field to be a stable identifier', () => {
    // The guidance that prevents abdul/Abdul/abdul_r was on `recorded_by`
    // alone. It belongs on every free-text identifier, and living in one
    // constant is what stops three forms drifting apart again.
    for (const field of ['observed_by', 'acquired_from', 'sire_ref'] as IdentifierField[]) {
      const { el } = make(field);
      const hint = el.querySelector(`[data-role="${field}-hint"]`)!;
      expect(hint.textContent).toContain('stable identifier, not a display name');
    }
  });

  it('keeps the observed_by rule that a witness is a claim, not a default', () => {
    const { el } = make('observed_by');
    const hint = el.querySelector('[data-role="observed_by-hint"]')!.textContent!;
    expect(hint).toContain('Leave blank unless someone did');
    expect(hint).toContain('nobody observed a purchase record');
  });

  it('marks every identifier field optional', () => {
    for (const field of ['observed_by', 'acquired_from', 'sire_ref'] as IdentifierField[]) {
      const { el } = make(field);
      expect(el.textContent).toContain('(optional)');
    }
  });

  it('has one guidance string per field and no field without one', () => {
    expect(Object.keys(IDENTIFIER_GUIDANCE).sort()).toEqual([
      'acquired_from',
      'observed_by',
      'sire_ref',
    ]);
  });
});
