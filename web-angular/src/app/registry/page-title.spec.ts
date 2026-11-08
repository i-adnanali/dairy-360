import { routes } from '../app.routes';
import { fullTitle } from './page-title';

it('names every page in the browser tab', () => {
  const children = routes[0].children!;
  for (const r of children) expect(typeof r.title).toBe('string');
  const title = (path: string) => children.find((r) => r.path === path)!.title;
  expect(title('animals/health')).toBe('Animal health');
  expect(title('labour/payroll')).toBe('Payroll');
  expect(title('**')).toBe('Page not found');
  expect(fullTitle('Payroll')).toBe('Payroll · Dairy 360');
  expect(fullTitle(null)).toBe('Dairy 360');
});
