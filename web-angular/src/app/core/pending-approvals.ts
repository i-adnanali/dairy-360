// How many proposed writes are waiting on the owner -- and nothing else.
//
// WHY THIS IS NOT JUST ChatStore.pending(). ChatStore imports the AG-UI client,
// which lives in the lazily loaded chat chunk. The shell needs the count on
// every screen (the Assistant button, Today's attention list); injecting
// ChatStore there pulled ~280 kB of agent client into the initial bundle. So
// ChatStore publishes the count here and the shell reads this, which imports
// nothing.

import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PendingApprovals {
  readonly count = signal(0);
}
