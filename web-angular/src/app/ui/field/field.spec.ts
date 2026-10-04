import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Field } from './field';
import { TextInput } from "../input";

@Component({ imports: [Field, TextInput], template: `<app-field label="Amount (Rs)" help="Use the agreed amount." [error]="error()"><input appInput name="amount" /></app-field><app-field label="Reference"><input appInput /></app-field>` })
class Fixture { error = signal<string | null>(null); }

describe('Field', () => {
  it('keeps native controls, unique labels and help/error association through recovery', async () => {
    const f = TestBed.createComponent(Fixture);
    f.detectChanges(); await f.whenStable();
    const inputs = Array.from(f.nativeElement.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(inputs[0].labels?.[0].textContent).toBe('Amount (Rs)');
    expect(document.getElementById(inputs[0].getAttribute('aria-describedby')!)?.textContent).toContain('agreed');
    inputs[0].value = '12.';
    f.componentInstance.error.set('Amount refused.');
    f.detectChanges(); await f.whenStable();
    expect(inputs[0].getAttribute('aria-invalid')).toBe('true');
    const ids = inputs[0].getAttribute('aria-describedby')!.split(' ');
    expect(ids.every(id => !!document.getElementById(id))).toBe(true);
    expect(inputs[0].value).toBe('12.');
    f.componentInstance.error.set(null);
    f.detectChanges(); await f.whenStable();
    expect(inputs[0].hasAttribute('aria-invalid')).toBe(false);
    expect(inputs[0].getAttribute('aria-describedby')?.split(' ')).toHaveLength(1);
  });
});
