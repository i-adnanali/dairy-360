// The registry area: session gate, nav, and the routed view.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Session } from './session';
import { SessionBar } from './session-bar';
import { SessionGate } from './session-gate';

@Component({
  selector: 'app-registry-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SessionBar, SessionGate],
  template: `
    <div class="flex h-full flex-col bg-farm-50 text-farm-900">
      <app-session-bar />

      <header class="border-b border-farm-200 bg-white px-4 py-3">
        <div class="mx-auto flex max-w-4xl flex-wrap items-baseline gap-x-6 gap-y-2">
          <h1 class="text-base font-semibold tracking-tight">Animal registry</h1>
          @if (session.ready()) {
            <nav class="flex gap-4 text-sm" data-role="nav">
              <a routerLink="/add" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Add animal</a>
              <a routerLink="/calving" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Record calving</a>
              <a routerLink="/herd" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Herd</a>
              <a routerLink="/check" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Check</a>
            </nav>
          }
        </div>
      </header>

      <main class="flex-1 overflow-y-auto px-4 py-6">
        @if (session.ready()) {
          <router-outlet />
        } @else {
          <app-session-gate />
        }
      </main>
    </div>
  `,
})
export class RegistryShell {
  protected readonly session = inject(Session);
}
