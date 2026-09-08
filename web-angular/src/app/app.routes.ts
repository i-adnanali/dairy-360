// The app's routes.
//
// ---------------------------------------------------------------------------
// URLs NAME THINGS; THE NAV GROUPS BY ACTIVITY. THEY ARE DIFFERENT JOBS.
// ---------------------------------------------------------------------------
// registry-shell.ts groups the nav as RECORD versus REVIEW, which is what you
// came here to do. This table groups by SUBJECT, which is what a link points
// at. A URL that encoded the mood you were in -- /record/milking -- would put
// the same subject in two places and mean nothing to anyone receiving it.
//
// The three prefixes are the three axes the design documents already argue for
// and are not invented here: the animal record (REGISTRY.md), milk and its
// counterparties (REGISTRY_SALES.md, "a different axis ... the first registry
// tables with no animal_id"), and the people the farm employs
// (REGISTRY_PAYROLL.md §1, "a third axis"). Step 5's breeding events, feed and
// treatment land under /animals; quality pricing lands under /milk; absences
// land under /labour. That is the whole reason for the depth -- a flat space
// was fine at five screens and would need this restructure again at fifteen.
//
// ---------------------------------------------------------------------------
// WHY / IS NO LONGER /herd
// ---------------------------------------------------------------------------
// It used to redirect there, and the reason was written down: "this build
// exists to enter a herd, and the entry surface being one click deep would cost
// a click ~35 times in the first session." That was an argument about the
// BACKFILL, which OPEN.md records as still not having run -- and there are now
// three subsystems, so landing on one of them privileges it arbitrarily.
//
// `/` is now a screen that answers "what still needs recording?", which is the
// question somebody actually opens this app holding.
//
// ---------------------------------------------------------------------------
// ORDER IS LOAD-BEARING IN ONE PLACE
// ---------------------------------------------------------------------------
// `animals/new` MUST precede `animals/:id`, or the router matches the literal
// as an id and the add form becomes unreachable. `animals/calvings/new` has
// three segments so it cannot collide, but it is listed with the other literals
// rather than after the parameterised route, so the rule reads as one rule.

import type { Routes } from '@angular/router';
import { RegistryShell } from './registry/registry-shell';

export const routes: Routes = [
  {
    path: '',
    component: RegistryShell,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./registry/today-board').then((m) => m.TodayBoard),
      },

      // --- the animal record -------------------------------------------------
      {
        // BEFORE `animals/:id`. See the header.
        path: 'animals/new',
        // NOTHING TO BROWSE HERE: the screen is a form, so arriving without a
        // recording session should ask for one immediately rather than render a
        // form whose submit is a prompt. See registry-shell.ts.
        data: { writes: true },
        loadComponent: () => import('./registry/animal-form').then((m) => m.AnimalForm),
      },
      {
        path: 'animals/calvings/new',
        data: { writes: true },
        loadComponent: () => import('./registry/calving-form').then((m) => m.CalvingForm),
      },
      {
        path: 'animals',
        loadComponent: () => import('./registry/herd-list').then((m) => m.HerdList),
      },
      {
        // `:id` is bound to AnimalDetailView.id by withComponentInputBinding().
        path: 'animals/:id',
        loadComponent: () => import('./registry/animal-detail').then((m) => m.AnimalDetailView),
      },

      // --- milk: production, disposition, and who it goes to ------------------
      //
      // Milking and dispatch sit under ONE prefix deliberately. They are the
      // same motion by the same person minutes apart, they reconcile against
      // each other, and REGISTRY_SALES.md §15 asks whether they should become
      // one screen. Splitting them across two prefixes -- production under
      // /animals because registry_milkings has an animal_id, disposition under
      // /buyers because registry_dispatches has a destination_id -- would file
      // them by their foreign key rather than by what they are.
      {
        path: 'milk/milking',
        loadComponent: () =>
          import('./registry/milking-roster').then((m) => m.MilkingRosterScreen),
      },
      {
        path: 'milk/dispatch',
        loadComponent: () =>
          import('./registry/dispatch-sheet').then((m) => m.DispatchSheetScreen),
      },
      {
        path: 'milk/buyers',
        loadComponent: () =>
          import('./registry/destinations-list').then((m) => m.DestinationsList),
      },
      {
        // `:id` is bound to DestinationDetail.id by withComponentInputBinding().
        path: 'milk/buyers/:id',
        loadComponent: () =>
          import('./registry/destination-detail').then((m) => m.DestinationDetail),
      },

      // --- labour -------------------------------------------------------------
      {
        path: 'labour/payroll',
        loadComponent: () => import('./registry/payroll-run').then((m) => m.PayrollRunScreen),
      },
      {
        path: 'labour/people',
        loadComponent: () => import('./registry/people-list').then((m) => m.PeopleList),
      },
      {
        // `:id` is bound to PersonDetail.id by withComponentInputBinding().
        path: 'labour/people/:id',
        loadComponent: () => import('./registry/person-detail').then((m) => m.PersonDetail),
      },

      // --- cross-cutting ------------------------------------------------------
      //
      // /check verifies all three axes, so it belongs to none of them and stays
      // at the top level.
      {
        path: 'check',
        loadComponent: () =>
          import('./registry/verification-panel').then((m) => m.VerificationPanel),
      },

      // -----------------------------------------------------------------------
      // THE ASSISTANT, MOVED IN FROM THE TOP LEVEL. Phase 6a, UI_SYSTEM.md §9.2.
      // -----------------------------------------------------------------------
      // This was a SIBLING of the shell rather than a child of it, which is why
      // the panel rendered with no banner, no session bar and no nav -- and why
      // it needed its own copy of the theme toggle to be usable in dark mode at
      // all. It was not a design decision; it was where a ported React route
      // landed.
      //
      // Moving it in is a one-line change and NOT sufficient on its own. The
      // panel's root is `mx-auto flex h-full max-w-3xl flex-col` with a
      // `flex-1 overflow-y-auto` region and a pinned composer, and a component
      // host is `display: inline` by default -- so as a plain child of <main>
      // its `h-full` resolves against `auto` and the whole chain collapses.
      // styles.css carries the `display: block; height: 100%` that holds it up,
      // and templates.spec.ts now guards the list it belongs to.
      {
        path: 'chat',
        loadComponent: () => import('./components/chat-panel').then((m) => m.ChatPanel),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
