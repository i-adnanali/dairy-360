// The words for the five breeding event types, shared by the animal Timeline
// and the lifetime report so both read a breeding record the same way.

/** The breeding event types (server `BREEDING_EVENT_TYPES`). */
export const BREEDING_TYPES: ReadonlySet<string> = new Set([
  'insemination', 'heat_observed', 'pregnancy_check', 'null_observation', 'abortion',
]);

const CHECK_METHOD_WORDS: Record<string, string> = {
  palpation: 'By hand', ultrasound: 'Ultrasound', pag: 'PAG blood test', progesterone: 'Progesterone',
};

/** The title of a breeding event, or null for any other type. */
export function breedingTitle(type: string): string | null {
  switch (type) {
    case 'heat_observed':
      return 'Heat seen';
    case 'insemination':
      return 'Service';
    case 'pregnancy_check':
      return 'Pregnancy check';
    case 'abortion':
      return 'Loss seen';
    case 'null_observation':
      return 'Watched, none seen';
    default:
      return null;
  }
}

/** A one-line read of a breeding event's payload, or null when there is nothing to say. */
export function breedingDetail(type: string, payload: Record<string, unknown>): string | null {
  const s = (k: string): string | null => (typeof payload[k] === 'string' ? (payload[k] as string) : null);
  switch (type) {
    case 'insemination': {
      const t = s('service_type');
      if (t === 'ai') return 'AI';
      if (t === 'natural_observed') return 'Bull, seen';
      if (t === 'bull_exposure') {
        const d = payload['exposure_days'];
        return typeof d === 'number' ? `Bull running with her · ${d} days` : 'Bull running with her';
      }
      return null;
    }
    case 'pregnancy_check': {
      const m = s('method');
      const method = m ? CHECK_METHOD_WORDS[m] ?? m : null;
      const r = s('result');
      const result = r === 'positive' ? 'pregnant' : r === 'negative' ? 'not pregnant' : null;
      const bits = [method, result].filter((x): x is string => !!x);
      return bits.length ? bits.join(' · ') : null;
    }
    case 'heat_observed':
      return s('sign');
    case 'null_observation': {
      const w = s('watched_for');
      return w === 'heat' ? 'for heat' : w === 'pregnancy_check' ? 'for a pregnancy check' : null;
    }
    default:
      return null;
  }
}
