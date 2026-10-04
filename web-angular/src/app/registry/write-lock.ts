import { ApiError } from './api';
import { Directive, ElementRef, OnDestroy, DoCheck, afterRenderEffect, inject, input } from '@angular/core';

let nextError = 0;

/** Keep native entry controls inert while saving or resolving a lost response.
 * Submit remains reachable: repeating it retries the frozen request, never edited data. */
@Directive({ selector: '[appWriteLock]' })
export class WriteLock implements DoCheck, OnDestroy {
  readonly appWriteLock = input.required<{
    locked: () => boolean;
    uncertain: () => boolean;
    error?: () => ApiError | null;
  }>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly disabled = new Map<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    boolean
  >();
  private message: HTMLElement | null = null;
  private lastError: ApiError | null = null;
  private alive = true;
  private fieldMessage: HTMLElement | null = null;
  private fieldControl: HTMLElement | null = null;
  private previousDescription: string | null = null;
  private previousInvalid: string | null = null;
  private clearFieldError() {
    if (this.fieldControl) {
      for (const [attribute, value] of [['aria-describedby', this.previousDescription], ['aria-invalid', this.previousInvalid]]) {
        if (value === null) this.fieldControl.removeAttribute(attribute!);
        else this.fieldControl.setAttribute(attribute!, value!);
      }
    }
    this.fieldMessage?.remove();
    this.fieldMessage = null;
    this.fieldControl = null;
  }
  private readonly click = (e: Event) => {
    if (!this.appWriteLock().locked()) return;
    const button = (e.target as Element).closest('button');
    if (button && button.type !== 'submit' && !button.hasAttribute('data-write-retry')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  constructor() {
    this.host.addEventListener('click', this.click, true);
    afterRenderEffect(() => this.updateError());
  }
  private updateError() {
    const error = this.appWriteLock().error?.() ?? null;
    if (error !== this.lastError) this.clearFieldError();
    if (error && error !== this.lastError) {
      queueMicrotask(() => {
        if (!this.alive || this.appWriteLock().error?.() !== error) return;
        const controls = Array.from(this.host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea'));
        const invalid = controls.find(el => el.getAttribute('aria-invalid') === 'true');
        const named = error.isRefusal && error.field ? controls.find(el => el.name === error.field) : null;
        const control = invalid ?? named;
        if (control && !control.disabled) {
          if (!invalid && named) {
            this.fieldControl = named;
            this.previousDescription = named.getAttribute('aria-describedby');
            this.previousInvalid = named.getAttribute('aria-invalid');
            this.fieldMessage = document.createElement('p');
            this.fieldMessage.id = 'write-field-error-' + ++nextError;
            this.fieldMessage.className = 'text-sm text-danger-fg mt-1';
            this.fieldMessage.setAttribute('role', 'status');
            this.fieldMessage.textContent = error.message;
            named.parentElement?.insertAdjacentElement('afterend', this.fieldMessage);
            named.setAttribute('aria-describedby', [this.previousDescription, this.fieldMessage.id].filter(Boolean).join(' '));
            named.setAttribute('aria-invalid', 'true');
          }
          control.focus();
          return;
        }
        let summary = Array.from(
          this.host.querySelectorAll<HTMLElement>('[apperrorpanel], [role="alert"]'),
        ).find((el) => el.textContent?.includes(error.message));
        if (!summary) {
          summary = document.createElement('p');
          summary.id = 'write-summary-error-' + ++nextError;
          summary.className = 'text-sm text-danger-fg mt-1';
          summary.setAttribute('role', 'alert');
          summary.textContent = error.message;
          this.host.append(summary);
          this.fieldMessage = summary;
          this.fieldControl = this.host;
          this.previousDescription = this.host.getAttribute('aria-describedby');
          this.previousInvalid = this.host.getAttribute('aria-invalid');
          this.host.setAttribute('aria-describedby', [this.previousDescription, summary.id].filter(Boolean).join(' '));
        }
        if (summary) {
          summary.tabIndex = -1;
          summary.focus();
        }
      });
    }
    this.lastError = error;
  }
  ngDoCheck() {
    const locked = this.appWriteLock().locked();
    if (locked)
      this.host
        .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input,select,textarea',
        )
        .forEach((control) => {
          if (!this.disabled.has(control)) this.disabled.set(control, control.disabled);
          control.disabled = true;
        });
    else {
      this.disabled.forEach((value, control) => (control.disabled = value));
      this.disabled.clear();
    }
    if (this.appWriteLock().uncertain() && !this.message) {
      this.message = document.createElement('p');
      this.message.setAttribute('role', 'status');
      this.message.className = 'text-sm text-content-primary';
      this.message.textContent =
        'The save outcome is unknown. Your entries are locked. Use the save action again to retry the exact same request before editing or leaving.';
      this.host.prepend(this.message);
    } else if (!this.appWriteLock().uncertain() && this.message) {
      this.message.remove();
      this.message = null;
    }
  }
  ngOnDestroy() {
    this.alive = false;
    this.clearFieldError();
    this.host.removeEventListener('click', this.click, true);
    this.message?.remove();
  }
}
