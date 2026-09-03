// Session provenance: set once, shown always, applied to every write.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Session } from './session';
import { RegistryApi } from './api';
import type { SourceForm } from './types';

@Component({
  selector: 'app-session-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (harness(); as h) {
      <!-- Which database am I pointed at should never be a guess: the forms
           write real records. -->
      <div class="bg-amber-200 px-4 py-1.5 text-center text-xs font-medium text-amber-900"
        data-role="harness-banner">
        Harness — {{ h.storage }} fixture data, discarded when the process exits. This is not the real registry.
      </div>
    }

    @if (session.ready()) {
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-farm-200 bg-farm-50 px-4 py-2 text-xs"
        data-role="session-summary">
        <span class="text-farm-600">Recording as</span>
        <span class="font-medium text-farm-900">{{ session.recordedBy() }}</span>
        <span class="text-farm-600">from</span>
        <span class="font-medium text-farm-900">{{ session.sourceForm() }}</span>
        <button type="button" data-role="change-session" (click)="session.clear()"
          class="ml-auto text-farm-700 underline">Change</button>
      </div>
    }
  `,
})
export class SessionBar {
  protected readonly session = inject(Session);
  private readonly api = inject(RegistryApi);
  protected readonly harness = signal<{ storage: string } | null>(null);

  constructor() {
    void this.api.harnessInfo().then((h) => this.harness.set(h));
  }
}
