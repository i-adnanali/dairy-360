import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Thin root shell. It held <app-chat-panel /> directly until this cycle added
// routing; the chat panel now lives at /chat and the registry is the root.
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <div class="h-full bg-farm-50 text-farm-900">
      <router-outlet />
    </div>
  `,
})
export class App {}
