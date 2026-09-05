// The registry area: session gate, nav, and the routed view.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { WriteLog } from './after-write';
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

      <!-- SEVEN nav items, which is over the line where a flat row stops
           working. The grouping decision -- probably record versus review -- is
           real and is deliberately NOT made here: it should be made when the
           seventh item exists and is being used, not predicted from six.
           See docs/REGISTRY_SALES.md §12.4. -->
      <header class="border-b border-farm-200 bg-white px-4 py-3">
        <div class="mx-auto flex max-w-4xl flex-wrap items-baseline gap-x-6 gap-y-2">
          <h1 class="text-base font-semibold tracking-tight">Animal registry</h1>
          @if (session.ready()) {
            <nav class="flex gap-4 text-sm" data-role="nav">
              <a routerLink="/add" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Add animal</a>
              <a routerLink="/calving" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Record calving</a>
              <a routerLink="/milking" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Milking</a>
              <a routerLink="/dispatch" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Dispatch</a>
              <a routerLink="/buyers" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Buyers</a>
              <a routerLink="/herd" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Herd</a>
              <a routerLink="/check" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Check</a>
            </nav>
          }
        </div>
      </header>

      <!-- WHAT JUST HAPPENED, without looking for it.
           A cleared form is ambiguous: it looks exactly like a form that was
           never filled in. So the write says which serial it wrote, in a live
           region a screen reader announces and in a line that persists until
           the next write replaces it. Not a toast -- an operator who looks up
           five seconds later should not have to reconstruct it from the herd
           list.
           'aria-live="polite"' rather than assertive: it must not interrupt
           typing, which is the entire activity here. -->
      <div aria-live="polite" aria-atomic="true" class="sr-only" data-role="write-announce">
        {{ writeLog.last() }}
      </div>
      @if (writeLog.last(); as msg) {
        <div class="border-b border-green-200 bg-green-50 px-4 py-1.5 text-center text-xs font-medium text-green-900"
          data-role="write-log">{{ msg }}</div>
      }

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
  protected readonly writeLog = inject(WriteLog);
}
