import {
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
/** Only overflowing regions add a keyboard stop. ResizeObserver also sees table growth. */
@Directive({
  selector: '[appScrollRegion]',
  host: {
    role: 'region',
    '[attr.aria-label]': 'label()',
    '[attr.tabindex]': 'overflowing() ? 0 : null',
    '[attr.data-overflow]': 'overflowing()',
    class:
      'overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus',
  },
})
export class ScrollRegion implements AfterViewInit {
  readonly label = input.required<string>({ alias: 'appScrollRegion' });
  readonly overflowing = signal(false);
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly destroy = inject(DestroyRef);
  ngAfterViewInit() {
    const measure = () => this.overflowing.set(this.el.scrollWidth > this.el.clientWidth + 1);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(this.el);
    for (const child of this.el.children) observer.observe(child);
    this.destroy.onDestroy(() => observer.disconnect());
    measure();
  }
}
