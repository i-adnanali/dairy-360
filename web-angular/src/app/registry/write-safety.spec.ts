import { FormState } from './form-state';
import { ApiError } from './api';

describe('Frozen write attempt', () => {
  it('locks and replays exactly the original path/body/key after an accepted write loses its response', async () => {
    const state = new FormState<{ id: string }>();
    const draft = {
      path: 'feed/daily/a',
      body: { revision: 2, recorded_by: 'fixture', rows: [{ litres: 7.5 }] },
    };
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ error: 'network', message: 'Response lost' }, false))
      .mockResolvedValue({ id: 'same-record' });
    expect(await state.runRequest(() => draft, send)).toBeNull();
    expect(state.locked()).toBe(true);
    const original = structuredClone(send.mock.calls[0]);
    draft.path = 'feed/daily/b';
    draft.body.rows[0].litres = 9;
    await state.runRequest(() => draft, send);
    expect(send.mock.calls[1]).toEqual(original);
    expect(state.locked()).toBe(false);
    expect(state.result()).toEqual({ id: 'same-record' });
  });
  it('suppresses concurrent requests centrally and permits edits after a definite refusal', async () => {
    const state = new FormState<any>();
    let reject!: (error: unknown) => void;
    const send = vi.fn(() => new Promise((_, no) => (reject = no)));
    const first = state.runRequest(() => ({ quantity: 1 }), send);
    expect(await state.runRequest(() => ({ quantity: 2 }), send)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    reject(
      new ApiError({ error: 'bad_quantity', message: 'Original refusal', field: 'quantity' }, true),
    );
    await first;
    expect(state.locked()).toBe(false);
    const next = vi.fn().mockResolvedValue({ ok: true });
    await state.runRequest(() => ({ quantity: 2 }), next);
    expect(next.mock.calls[0][0]).toEqual({ quantity: 2 });
  });
});
