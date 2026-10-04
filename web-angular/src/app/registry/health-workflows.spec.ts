import { attachmentBase64, vaccinationRows, revisionLines } from './health-workflows';

it('refuses partially started vaccination rows instead of silently omitting them', () => {
  expect(() => vaccinationRows({ A: { disposition: '', reason: 'unwell' } })).toThrow('Choose a disposition');
  expect(vaccinationRows({ A: { disposition: '' }, B: { disposition: 'deferred', reason: 'unwell', due_on: '2026-10-04' } }))
    .toEqual([{ animal_id: 'B', disposition: 'deferred', reason: 'unwell', due_on: '2026-10-04' }]);
});
it('keeps attachment limits before reading files', async () => {
  await expect(attachmentBase64(new File(['x'], 'test.pdf'), 10)).rejects.toThrow('Maximum ten');
  expect(await attachmentBase64(new File(['hello'], 'test.pdf'), 0)).toBe('aGVsbG8=');
});
it('narrows revision JSON before presenting its fields', () => {
  expect(revisionLines({ after_json: 'null' } as any)).toEqual([]);
  expect(revisionLines({ after_json: '{"id":"x","reason":"reviewed","nested":{}}' } as any)).toEqual(['reason: reviewed']);
});
