// Biometric redaction for the Double Take capture (Cycle 7 FU-3; see
// docs/Cycle7-fu3-double-take-validation.md finding 6, layer (a)).
//
// Deliberately PURE: no fs, no network, no db -- same discipline as ingest.ts,
// classify.ts and payloadShape.ts, so redact.test.ts exercises every rule under
// plain `npm test -w server` with nothing running.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// FU-3 validates Double Take's payload shape against a STREET-FACING camera, so
// every face it processes belongs to a member of the public who has not
// consented to biometric processing. The slice's non-negotiable success
// condition is that no face crop from such a person survives the capture.
//
// Double Take can put a full base64-encoded face image inside the MQTT payload
// (`detect.match.base64` / `detect.unknown.base64`). Those keys default to
// false and the committed config pins them off -- but "the config says off" is
// exactly the kind of guarantee that a later edit, an env override or a
// per-camera block silently breaks. So the capture ALSO refuses to write image
// bytes, on its own, at the point of writing. Two independent layers, because
// the cost of the config layer failing is that a stranger's face lands in a
// file on disk.
//
// ---------------------------------------------------------------------------
// WHY IT REPLACES RATHER THAN DELETES -- this is the subtle part
// ---------------------------------------------------------------------------
// The capture's whole purpose is a SHAPE diff. Deleting a `base64` key, or
// nulling it, would change the shape and corrupt the deliverable: the differ
// would then report `base64` as absent (or as a type change to `null`), which
// is a finding about THIS module rather than about Double Take.
//
// So redaction is SHAPE-PRESERVING: a redacted string stays a `string`, and a
// `base64: null` (what an unconfigured instance actually sends) is left exactly
// as it is. payloadShape.ts records `string` either way, so the diff still
// answers "does the real payload carry base64 here, at what type" truthfully
// while the bytes never reach the disk.

/** What a redacted value is replaced with. A short, obviously-not-data string,
 * so it stays type `string` for the differ and is unmistakable in a capture
 * file. */
export const REDACTED = '[redacted]';

/**
 * Keys whose string values are ALWAYS redacted, at any depth.
 *
 * `base64` is the only field Double Take documents as carrying image bytes
 * ([recognize.util.js] sets it from `attempt.base64`), and it appears on every
 * per-face object in `matches` / `misses` / `unknowns`, plus on the singular
 * `match` / `unknown` objects.
 */
const REDACT_KEYS: ReadonlySet<string> = new Set(['base64']);

/**
 * Any string longer than this is redacted regardless of its key.
 *
 * Belt and braces against a field that carries image data under a name we have
 * not seen. The threshold is deliberately generous: FU-1 measured Frigate's
 * longest payload string at under 200 characters across 250 real messages, and
 * nothing in Double Take's documented envelope is remotely this long -- an id,
 * a camera name, a uuid filename, a detector name, a `checks` sentence. A
 * base64 JPEG is tens of thousands of characters, so there is no ambiguity in
 * practice.
 *
 * Redactions of this kind are COUNTED and reported rather than applied
 * silently: an unexpected long string is itself a finding about the payload,
 * and a capture that quietly rewrote a legitimate field would be worse than
 * one that says it did.
 */
export const MAX_STRING_LENGTH = 512;

export interface RedactionResult {
  /** A new value. The input is never mutated -- the caller keeps the original
   * in memory for the shape diff if it wants it. */
  value: unknown;
  /** How many values were replaced because of their KEY. */
  byKey: number;
  /** How many were replaced because of their LENGTH. Non-zero here means the
   * payload carried a long string somewhere unexpected, which the capture
   * prints rather than swallowing. */
  byLength: number;
  /** Shape paths that were redacted, for the capture's log. Uses the same
   * `a.b[].c` notation as payloadShape.ts so the two reports line up. */
  paths: string[];
}

/**
 * Redact biometric payload content, returning a new value.
 *
 * Structure, key order, array lengths and every non-redacted value are
 * preserved exactly, so `JSON.stringify` of the result differs from the input
 * only where a redaction happened.
 */
export function redactBiometrics(input: unknown): RedactionResult {
  let byKey = 0;
  let byLength = 0;
  const paths: string[] = [];

  const walk = (v: unknown, path: string, key: string | null): unknown => {
    if (typeof v === 'string') {
      if (key !== null && REDACT_KEYS.has(key)) {
        byKey += 1;
        paths.push(path);
        return REDACTED;
      }
      if (v.length > MAX_STRING_LENGTH) {
        byLength += 1;
        paths.push(path);
        return REDACTED;
      }
      return v;
    }
    // null, numbers and booleans cannot carry an image. Notably `base64: null`
    // is left as null: that is the real shape of an unconfigured instance and
    // rewriting it would fabricate a delta.
    if (v === null || typeof v !== 'object') return v;

    if (Array.isArray(v)) {
      return v.map((item) => walk(item, `${path}[]`, key));
    }
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      out[k] = walk(child, path ? `${path}.${k}` : k, k);
    }
    return out;
  };

  return { value: walk(input, '', null), byKey, byLength, paths };
}

/**
 * True when a value still contains something that looks like inline image data.
 *
 * Used as a POST-REDACTION assertion by the capture and by the tests: the
 * redactor is not trusted on the strength of having been called, its output is
 * checked. A guard that only runs the thing it guards is worth very little --
 * the same reason captureIsolation.test.ts asserts on the require cache rather
 * than on a comment.
 */
export function containsInlineImage(value: unknown): boolean {
  let found = false;
  const walk = (v: unknown, key: string | null): void => {
    if (found) return;
    if (typeof v === 'string') {
      if (v === REDACTED) return;
      if (key !== null && REDACT_KEYS.has(key)) found = true;
      else if (v.length > MAX_STRING_LENGTH) found = true;
      return;
    }
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, key);
      return;
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) walk(child, k);
  };
  walk(value, null);
  return found;
}
