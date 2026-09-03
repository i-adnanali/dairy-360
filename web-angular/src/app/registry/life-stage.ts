// The local words for a female's life stage. Displayed, never stored.
//
// ---------------------------------------------------------------------------
// WHY DISPLAY ONE VOCABULARY AND STORE ANOTHER
// ---------------------------------------------------------------------------
// `majj` carries the calving-defined meaning precisely where "cow" is vague
// about it: a majj is a female that has calved, and that is the whole
// definition. English needs a sentence to say what one word says here, and the
// local word is what anyone else looking at the screen reads without thinking.
//
// The stored enum does not move. `RegistryAnimalStatus` is
// departed|calf|lactating|dry|heifer|male, it is what every projection and
// invariant is written against, and two of its values are baked into demo tool
// input_schemas. Renaming it would be a breaking change across the repo to
// achieve a UI improvement, which is the wrong trade -- so this is a display
// mapping and nothing else.
//
// ---------------------------------------------------------------------------
// THE STAGE AND THE MILKING STATE ARE DIFFERENT FACTS
// ---------------------------------------------------------------------------
// `lactating` and `dry` are both `majj`: she has calved either way, and drying
// off does not undo that. So the two are shown TOGETHER -- "majj · in milk" and
// "majj · dry" -- rather than one replacing the other. Collapsing them would
// throw away the milking state; showing only the English would throw away the
// fact that both mean the same life stage.
//
// ---------------------------------------------------------------------------
// THE MALE SIDE IS DELIBERATELY UNTOUCHED
// ---------------------------------------------------------------------------
// katta / jhota is unconfirmed, and on a dairy where bulls leave young it may
// not matter enough to have a boundary at all. A guessed local term is worse
// than the English one, because it reads as authoritative to the next person.
// So `male` stays `male` until someone confirms it. Open item.

import type { RegistryAnimalStatus } from './types';

export interface LifeStage {
  /** The local term, or the English word where no local term is confirmed. */
  term: string;
  /** The milking state, when there is one. Shown beside the term, not instead. */
  qualifier: string | null;
  /** What the enum actually holds, for a tooltip -- the screen should not lie. */
  stored: RegistryAnimalStatus;
}

export function lifeStage(
  status: RegistryAnimalStatus | null,
  sex: 'female' | 'male',
): LifeStage | null {
  if (status === null) return null;

  // Departure is not a life stage -- it is the end of the record. An animal
  // that has left was a majj or a katti when she went, and saying "departed"
  // is the honest answer to "what is she now".
  if (status === 'departed') return { term: 'departed', qualifier: null, stored: status };

  if (sex === 'male') return { term: status, qualifier: null, stored: status };

  switch (status) {
    case 'calf':
      return { term: 'katti', qualifier: null, stored: status };
    case 'heifer':
      return { term: 'choti', qualifier: null, stored: status };
    case 'lactating':
      return { term: 'majj', qualifier: 'in milk', stored: status };
    case 'dry':
      return { term: 'majj', qualifier: 'dry', stored: status };
    default:
      return { term: status, qualifier: null, stored: status };
  }
}

/** One string, for a table cell that has no room for two spans. */
export function lifeStageLabel(
  status: RegistryAnimalStatus | null,
  sex: 'female' | 'male',
): string {
  const s = lifeStage(status, sex);
  if (s === null) return '—';
  return s.qualifier === null ? s.term : `${s.term} · ${s.qualifier}`;
}
