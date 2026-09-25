import { groupWithdrawals, WithdrawalNotices, WithdrawalNotice } from './withdrawal-notices';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

describe('withdrawal presentation', () => {
  const base: WithdrawalNotice = {
    animal_id: 'BD-0001',
    administration_id: 'dose-1',
    revision: 2,
    target: 'milk',
    status: 'needs_clarification',
    instruction: 'Original instruction',
  };
  it('deduplicates only the same animal, medium, source record and revision', () => {
    const groups = groupWithdrawals([
      base,
      { ...base },
      { ...base, administration_id: 'dose-2' },
      { ...base, revision: 3 },
      { ...base, target: 'meat' },
      { ...base, animal_id: 'BD-0002' },
    ]);
    expect(groups.map((g) => g.records.length)).toEqual([3, 1, 1]);
    expect(
      groupWithdrawals([
        { ...base, revision: undefined },
        { ...base, revision: undefined },
      ])[0].records,
    ).toHaveLength(2);
  });
  it('keeps active notice and unknown end visible when source details are collapsed', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(WithdrawalNotices);
    f.componentRef.setInput('notices', [
      base,
      { ...base, target: 'meat', until: '2026-09-19T18:00:00+05:00' },
    ]);
    await f.whenStable();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelectorAll('[data-role="withdrawal-group"]')).toHaveLength(2);
    expect(el.querySelector('section > p')?.textContent).toContain('Milk withdrawal');
    expect(el.querySelector('section > p + p')?.textContent).toContain('Needs clarification');
    expect(el.querySelector('details')?.open).toBe(false);
    expect(el.querySelector('a')?.getAttribute('href')).toContain('record=dose-1');
    expect(el.textContent).toContain('Original instruction');
    expect(el.textContent).not.toContain('Safe');
  });
});
