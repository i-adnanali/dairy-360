import { Component, DestroyRef, Injectable, inject } from '@angular/core';
import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Router, CanActivateChildFn, CanDeactivateFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Button } from '../ui/button';

/** Callbacks read current semantic values, including raw incomplete input. */
export interface DraftParticipant {
  owner: string;
  context: () => string;
  description: () => string;
  snapshot: () => string;
  baseline: () => string;
  dirty: () => boolean;
  pending: () => boolean;
  unresolved?: () => boolean;
  discard: () => void;
  replaces: (url: string) => boolean;
}
@Component({
  selector: 'app-draft-dialog',
  imports: [Button],
  template: `<section
    class="rounded-xl border border-line bg-surface-raised p-6 text-content-primary shadow-xl space-y-4"
  >
    <h2 id="draft-title" class="text-lg font-semibold">
      {{
        data.title ||
          (data.unresolved
            ? 'Resolve the save outcome before leaving.'
            : data.pending
              ? 'Saving; wait for the result.'
              : 'Discard unsaved changes?')
      }}
    </h2>
    <p id="draft-description">{{ data.description }}</p>
    <div class="flex flex-wrap gap-3">
      <button appButton variant="secondary" data-role="keep-editing" (click)="ref.close(false)">
        {{ data.cancelLabel || 'Keep editing' }}
      </button>
      @if (!data.pending) {
        <button appButton intent="danger" data-role="discard-changes" (click)="ref.close(true)">
          {{ data.confirmLabel || 'Discard changes' }}
        </button>
      }
    </div>
  </section>`,
})
export class DraftDialog {
  readonly data = inject<{
    pending: boolean;
    unresolved: boolean;
    description: string;
    title?: string;
    cancelLabel?: string;
    confirmLabel?: string;
  }>(DIALOG_DATA);
  readonly ref = inject(DialogRef<boolean>);
}
@Injectable({ providedIn: 'root' })
export class DraftRegistry {
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);
  private readonly participants = new Map<string, DraftParticipant>();
  private navigationId = -1;
  private navigationResult: Promise<boolean> | null = null;
  private transition: Promise<boolean> | null = null;
  private listening = false;
  private readonly unload = (e: BeforeUnloadEvent) => {
    if ([...this.participants.values()].some((p) => p.dirty() || p.pending())) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  constructor() {
    inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', this.unload));
  }
  async confirm(title: string, description: string, confirmLabel: string): Promise<boolean> {
    if (this.transition) return false;
    const ref = this.dialog.open<boolean>(DraftDialog, {
      data: { title, description, confirmLabel, cancelLabel: 'Cancel', pending: false },
      ariaModal: true,
      ariaLabelledBy: 'draft-title',
      ariaDescribedBy: 'draft-description',
      autoFocus: '[data-role="keep-editing"]',
      restoreFocus: true,
      width: 'min(32rem, calc(100vw - 2rem))',
    });
    this.transition = firstValueFrom(ref.closed)
      .then((value) => value === true)
      .finally(() => (this.transition = null));
    return this.transition;
  }
  register(p: DraftParticipant, destroy: DestroyRef) {
    if (this.participants.has(p.owner)) throw new Error('Duplicate draft owner: ' + p.owner);
    this.participants.set(p.owner, p);
    destroy.onDestroy(() => {
      this.participants.delete(p.owner);
      this.syncUnload();
    });
    this.syncUnload();
  }
  hasChanges(affected: (p: DraftParticipant) => boolean = () => true) {
    return [...this.participants.values()].some((p) => affected(p) && (p.dirty() || p.pending()));
  }
  syncUnload() {
    const needed = [...this.participants.values()].some((p) => p.dirty() || p.pending());
    if (needed === this.listening) return;
    this.listening = needed;
    if (needed) window.addEventListener('beforeunload', this.unload);
    else window.removeEventListener('beforeunload', this.unload);
  }
  guard(url: string): Promise<boolean> {
    const id = this.router.getCurrentNavigation()?.id ?? -1;
    if (id >= 0 && id === this.navigationId && this.navigationResult) return this.navigationResult;
    this.navigationId = id;
    return (this.navigationResult = this.request((p) => p.replaces(url)));
  }
  request(affected: (p: DraftParticipant) => boolean = () => true): Promise<boolean> {
    // A second attempted destination must not silently replace the first one.
    if (this.transition) return Promise.resolve(false);
    const selected = [...this.participants.values()].filter(
      (p) => affected(p) && (p.dirty() || p.pending()),
    );
    if (!selected.length) return Promise.resolve(true);
    const pending = selected.some((p) => p.pending());
    const ref = this.dialog.open<boolean>(DraftDialog, {
      data: {
        pending,
        unresolved: selected.some((p) => p.unresolved?.()),
        description: selected.map((p) => p.description()).join('; '),
      },
      ariaModal: true,
      ariaLabelledBy: 'draft-title',
      ariaDescribedBy: 'draft-description',
      autoFocus: '[data-role="keep-editing"]',
      restoreFocus: true,
      width: 'min(32rem, calc(100vw - 2rem))',
    });
    this.transition = firstValueFrom(ref.closed)
      .then((answer) => {
        if (answer !== true || pending || selected.some((p) => p.pending())) return false;
        selected.forEach((p) => p.discard());
        this.syncUnload();
        return true;
      })
      .finally(() => {
        this.transition = null;
      });
    return this.transition;
  }
}
export const draftDeactivate: CanDeactivateFn<unknown> = (_component, _route, _state, next) =>
  inject(DraftRegistry).guard(next.url);
export const draftActivate: CanActivateChildFn = (_route, state) =>
  inject(DraftRegistry).guard(state.url);
