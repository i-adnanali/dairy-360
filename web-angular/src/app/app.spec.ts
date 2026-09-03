import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  // The root became a router shell in the registry cycle. It used to hold
  // <app-chat-panel /> directly; the chat panel now lives at /chat, unchanged
  // in every other respect, and the registry is the root because this build
  // exists to enter a herd.
  it('renders a router outlet rather than a fixed panel', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
    expect(compiled.querySelector('app-chat-panel')).toBeNull();
  });
});
