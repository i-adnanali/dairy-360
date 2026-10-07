// TASK ONLY: separate bundle, never included in main.ts or production output.
import { bootstrapApplication } from '@angular/platform-browser';
import { Router, NavigationEnd, BaseRouteReuseStrategy, RouteReuseStrategy, ActivatedRouteSnapshot } from '@angular/router';
import { appConfig } from './app/app.config';
import { App } from './app/app/app';
import { Target } from './app/registry/target';
class AcceptanceReuse extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot) {
    const reuse = super.shouldReuseRoute(future, current);
    if (future.routeConfig?.path === 'animals/health') {
      document.documentElement.dataset['healthReuse'] = `${reuse}: ${JSON.stringify(current.queryParams)} -> ${JSON.stringify(future.queryParams)}`;
    }
    return reuse;
  }
}
bootstrapApplication(App, {...appConfig, providers: [...appConfig.providers, {provide: RouteReuseStrategy, useClass: AcceptanceReuse}]}).then(ref => {
  const router = ref.injector.get(Router);
  const target = ref.injector.get(Target);
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;bottom:0;right:0;background:white;color:black;z-index:10000;padding:8px;border:2px solid blue';
  panel.setAttribute('aria-label','Isolated acceptance driver');
  const input = document.createElement('input');
  input.setAttribute('aria-label','Driver route');
  input.value = '/animals/health';
  const log = document.createElement('output');
  log.setAttribute('aria-label','Driver outcome');
  const navigate = document.createElement('button');
  navigate.textContent = 'Driver Angular navigation';
  navigate.onclick = () => { void router.navigateByUrl(input.value).then(result => { log.textContent += `; result ${result}`; }); };
  const probe = document.createElement('button');
  probe.textContent = 'Driver target probe in 3 seconds';
  probe.onclick = () => { log.textContent = 'Probe scheduled'; setTimeout(() => { void target.probe().then(kind => { log.textContent = `Probe ${kind}: ${target.storage()}`; }); },3000); };
  // Route reuse is recorded through public router activation events, rather
  // than by invoking page methods or modifying page state.
  router.events.subscribe(event => {
    if (event instanceof NavigationEnd) { panel.dataset['lastNavigation'] = String(event.id); log.textContent = `Navigation ${event.id}: ${router.url}; reused Health ${document.documentElement.dataset['healthReuse'] || 'not visited'}`; }
  });
  panel.append(input,navigate,probe,log);
  document.body.append(panel);
});
