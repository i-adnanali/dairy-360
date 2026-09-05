// The app's first routes. Before this cycle there was no router at all --
// @angular/router was an installed dependency that nothing imported.

import type { Routes } from '@angular/router';
import { RegistryShell } from './registry/registry-shell';

/**
 * The registry is the app's root, and the chat panel moves to /chat.
 *
 * Not a decision about which matters more: this build exists to enter a herd,
 * and the entry surface being one click deep would cost a click ~35 times in
 * the first session. The chat panel is unchanged and unmoved in every other
 * respect -- same component, same store, same SSE transport.
 */
export const routes: Routes = [
  {
    path: '',
    component: RegistryShell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'herd' },
      {
        path: 'herd',
        loadComponent: () => import('./registry/herd-list').then((m) => m.HerdList),
      },
      {
        path: 'add',
        loadComponent: () => import('./registry/animal-form').then((m) => m.AnimalForm),
      },
      {
        path: 'calving',
        loadComponent: () => import('./registry/calving-form').then((m) => m.CalvingForm),
      },
      {
        path: 'milking',
        loadComponent: () =>
          import('./registry/milking-roster').then((m) => m.MilkingRosterScreen),
      },
      {
        path: 'dispatch',
        loadComponent: () =>
          import('./registry/dispatch-sheet').then((m) => m.DispatchSheetScreen),
      },
      {
        path: 'buyers',
        loadComponent: () =>
          import('./registry/destinations-list').then((m) => m.DestinationsList),
      },
      {
        // `:id` is bound to DestinationDetail.id by withComponentInputBinding().
        path: 'buyers/:id',
        loadComponent: () =>
          import('./registry/destination-detail').then((m) => m.DestinationDetail),
      },
      {
        path: 'check',
        loadComponent: () =>
          import('./registry/verification-panel').then((m) => m.VerificationPanel),
      },
      {
        // `:id` is bound to AnimalDetailView.id by withComponentInputBinding().
        path: 'animals/:id',
        loadComponent: () => import('./registry/animal-detail').then((m) => m.AnimalDetailView),
      },
    ],
  },
  {
    path: 'chat',
    loadComponent: () => import('./components/chat-panel').then((m) => m.ChatPanel),
  },
  { path: '**', redirectTo: '' },
];
