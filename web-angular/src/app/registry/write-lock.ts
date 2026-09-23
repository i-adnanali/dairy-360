import { ApiError } from './api';
import { Directive, ElementRef, OnDestroy, DoCheck, inject, input } from '@angular/core';

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
  }
  ngDoCheck() {
    const error = this.appWriteLock().error?.() ?? null;
    if (error && error !== this.lastError) {
      queueMicrotask(() => {
        if (!this.alive) return;
        const summary = Array.from(
          this.host.querySelectorAll<HTMLElement>('[apperrorpanel], [role="alert"]'),
        ).find((el) => el.textContent?.includes(error.message));
        if (summary) {
          summary.tabIndex = -1;
          summary.focus();
        }
      });
    }
    this.lastError = error;
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
    this.host.removeEventListener('click', this.click, true);
    this.message?.remove();
  }
}
