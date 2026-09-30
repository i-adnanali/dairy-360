import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WriteLock } from './write-lock';
import { FormState } from './form-state';
import { ApiError } from './api';
@Component({ imports: [WriteLock], template: `<form [appWriteLock]="state"><label>Quantity<input name="quantity" aria-describedby="quantity-help" /></label><p id="quantity-help">Original help</p><button type="submit">Save</button></form>` })
class Fixture { state = new FormState(); }

describe('WriteLock field recovery', () => {
  it('associates the exact refusal, focuses the field and retains its draft through recovery', async () => {
    const f = TestBed.createComponent(Fixture); f.detectChanges();
    const input = f.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = '12.';
    f.componentInstance.state.error.set(new ApiError({error:'bad_quantity', field:'quantity', message:'Quantity refused verbatim.'}, true));
    f.changeDetectorRef.markForCheck(); f.detectChanges(); await Promise.resolve(); await f.whenStable();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toContain('quantity-help');
    expect(document.getElementById(ids[1])?.textContent).toBe('Quantity refused verbatim.');
    expect(input.value).toBe('12.');
    f.componentInstance.state.error.set(null); f.changeDetectorRef.markForCheck(); f.detectChanges();
    expect(input.getAttribute('aria-describedby')).toBe('quantity-help');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById(ids[1])).toBeNull();
  });
});
