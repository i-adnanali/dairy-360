import { TestBed } from '@angular/core/testing';
import { Pagination } from './pagination';
import { LocalPagination } from "../local-pagination/local-pagination";

describe('named sparse pagination', () => {
  for (const total of [0, 1, 25, 26, 51, 101]) {
    for (const size of [25, 50, 100]) {
      it(`renders ${total} records at size ${size} without losing size controls`, () => {
        const f = TestBed.createComponent(Pagination);
        f.componentRef.setInput('label', 'Health tasks');
        f.componentRef.setInput('total', total);
        f.componentRef.setInput('pageSize', size);
        f.detectChanges();
        const el: HTMLElement = f.nativeElement;
        expect(!!el.querySelector('nav')).toBe(total > 0);
        expect(!!el.querySelector('select')).toBe(total > 25);
        expect(el.querySelectorAll('button').length).toBe(total > size ? 2 : 0);
        expect(el.textContent).not.toContain('Page 0');
        if (total)
          expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe(
            'Health tasks pagination',
          );
      });
    }
  }
  it('disables the selector and navigation and emits no blocked move', () => {
    const f = TestBed.createComponent(Pagination);
    f.componentRef.setInput('label', 'Animals');
    f.componentRef.setInput('total', 101);
    f.componentRef.setInput('disabled', true);
    f.detectChanges();
    const changed = vi.fn();
    f.componentInstance.pageChange.subscribe(changed);
    expect(f.nativeElement.querySelector('select').disabled).toBe(true);
    f.nativeElement.querySelectorAll('button')[1].click();
    expect(changed).not.toHaveBeenCalled();
  });
  it('clamps a local collection after deletion without changing its records', () => {
    const f = TestBed.createComponent(LocalPagination);
    f.componentRef.setInput('label', 'Payments');
    f.componentRef.setInput('total', 101);
    f.componentInstance.page.set(5);
    f.detectChanges();
    const rows = Array.from({ length: 26 }, (_, id) => ({ id, draft: 'kept' }));
    f.componentRef.setInput('total', 26);
    f.detectChanges();
    expect(f.componentInstance.current()).toBe(2);
    expect(f.componentInstance.rows(rows)).toEqual([{ id: 25, draft: 'kept' }]);
    expect(rows).toHaveLength(26);
  });
});
