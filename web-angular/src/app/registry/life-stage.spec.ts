import { lifeStage, lifeStageLabel } from './life-stage';

describe('lifeStage — the farm words, displayed only', () => {
  it('maps the female stages onto katti / choti / majj', () => {
    expect(lifeStageLabel('calf', 'female')).toBe('katti');
    expect(lifeStageLabel('heifer', 'female')).toBe('choti');
    expect(lifeStageLabel('lactating', 'female')).toBe('majj · in milk');
    expect(lifeStageLabel('dry', 'female')).toBe('majj · dry');
  });

  it('LACTATING AND DRY ARE BOTH MAJJ — the stage and the milking state differ', () => {
    // She has calved either way, and drying off does not undo that. Showing one
    // instead of the other would throw away a fact; showing only the English
    // would throw away that both mean the same stage.
    expect(lifeStage('lactating', 'female')!.term).toBe('majj');
    expect(lifeStage('dry', 'female')!.term).toBe('majj');
    expect(lifeStage('lactating', 'female')!.qualifier).toBe('in milk');
    expect(lifeStage('dry', 'female')!.qualifier).toBe('dry');
  });

  it('LEAVES THE MALE SIDE ALONE, because katta / jhota is unconfirmed', () => {
    // A guessed local term is worse than the English one: it reads as
    // authoritative to the next person who sees the screen.
    expect(lifeStageLabel('male', 'male')).toBe('male');
    expect(lifeStageLabel('calf', 'male')).toBe('calf');
    expect(lifeStage('calf', 'male')!.term).toBe('calf');
  });

  it('reports departed as departed — it is the end of the record, not a stage', () => {
    expect(lifeStageLabel('departed', 'female')).toBe('departed');
    expect(lifeStageLabel('departed', 'male')).toBe('departed');
  });

  it('always carries the STORED value alongside, so the screen cannot lie', () => {
    // The enum does not move: it is what every projection and invariant is
    // written against, and two of its values are baked into demo tool schemas.
    expect(lifeStage('lactating', 'female')!.stored).toBe('lactating');
    expect(lifeStage('calf', 'female')!.stored).toBe('calf');
  });

  it('handles a missing projection without inventing a stage', () => {
    expect(lifeStage(null, 'female')).toBeNull();
    expect(lifeStageLabel(null, 'female')).toBe('—');
  });
});
