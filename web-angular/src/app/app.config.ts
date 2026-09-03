import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideCharts(withDefaultRegisterables()),
    // The app's first router and first HttpClient. Everything before this cycle
    // reached the server through @ag-ui/client's SSE transport, and
    // @angular/router / @angular/forms were installed but never imported.
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
  ],
};
