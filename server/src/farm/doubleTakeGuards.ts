// Runtime preconditions for the Cycle 7 FU-3 Double Take capture.
// See docs/Cycle7-fu3-double-take-validation.md, finding 6 layers (b) and (c).
//
// PURE, so guards.test.ts exercises them with nothing running -- same
// discipline as ingest.ts, payloadShape.ts and redact.ts. The impure callers
// (fetch DeepStack, read config.yml) live in enrollSynthetic.ts and
// captureDoubleTake.ts.
//
// WHY A SECOND LAYER, WHEN doubleTakeStack.test.ts ALREADY GUARDS THE CONFIG
// -------------------------------------------------------------------------
// That test reads `double-take/config.example.yml`, because the file Double Take
// actually loads -- `double-take/config.yml` -- is gitignored and absent on a
// fresh clone. So it guards a TEMPLATE. The moment someone edits their local
// copy (which the whole point of the copy step is to allow), the test still
// passes while the running instance writes face crops.
//
// These functions close that gap by checking the real mounted file and the live
// detector, at the moment of capture, and refusing to proceed. Neither layer is
// sufficient alone.

/** The single subject the FU-3 gallery is permitted to contain. Anything else
 * means a real face was enrolled -- see § open decision 1. */
export const ALLOWED_SUBJECT = 'synthetic_1';

// ---------------------------------------------------------------------------
// Layer (b): the effective config really has retention off
// ---------------------------------------------------------------------------

/** Strip `#` comments so a setting *described in prose* cannot satisfy a check.
 * config.example.yml explains `save: false` at length directly above it, so a
 * comment-blind scan would pass on a config setting the opposite. */
function uncommented(yaml: string): string {
  return yaml
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

function scalarValues(yaml: string, key: string): string[] {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)\\s*$`, 'gm');
  return [...uncommented(yaml).matchAll(re)].map((m) => m[1]);
}

/**
 * Everything wrong with a Double Take config from a retention standpoint.
 *
 * Returns human-readable problems rather than throwing, so the caller can print
 * all of them at once -- finding out about the second problem only after fixing
 * the first is a bad way to spend a capture window.
 *
 * NOTE the two `save` keys DEFAULT TO TRUE upstream. So a config that simply
 * omits them is NOT safe, and "no problems found" must mean "explicitly off",
 * never "not mentioned". That is why an absent key is an error here.
 */
export function retentionProblems(yaml: string): string[] {
  const problems: string[] = [];
  const clean = uncommented(yaml);

  const saves = scalarValues(yaml, 'save');
  if (saves.length !== 2) {
    problems.push(
      `expected exactly 2 "save:" keys (detect.match, detect.unknown), found ${saves.length}. ` +
        'Both default to TRUE upstream, so an omitted key means face crops get written.',
    );
  }
  if (saves.some((v) => v !== 'false')) {
    problems.push(
      `detect.*.save must be false, found [${saves.join(', ')}] — Double Take would ` +
        "write a face crop per detection into its storage volume",
    );
  }

  const b64 = scalarValues(yaml, 'base64');
  if (b64.length !== 2) {
    problems.push(`expected exactly 2 "base64:" keys, found ${b64.length}`);
  }
  if (b64.some((v) => v !== 'false')) {
    problems.push(
      `detect.*.base64 must be false, found [${b64.join(', ')}] — image bytes would be ` +
        'embedded in every published payload',
    );
  }

  if (/^\s*rekognition\s*:/m.test(clean)) {
    problems.push(
      'detectors.rekognition is configured — that transmits faces of non-consenting ' +
        'members of the public to a cloud service. Excluded categorically.',
    );
  }
  if (!/^\s*deepstack\s*:/m.test(clean)) {
    problems.push(
      'no detectors.deepstack — Double Take returns 400 "no detectors configured" and ' +
        'publishes nothing',
    );
  }

  const subLabels = scalarValues(yaml, 'update_sub_labels');
  if (subLabels.some((v) => v !== 'false')) {
    problems.push(
      "update_sub_labels must be false — it writes a recognised name onto a stranger's " +
        "event record in Frigate's own database",
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Layer (c): the gallery holds nothing but the synthetic subject, AND
// recognition actually works
// ---------------------------------------------------------------------------

/** DeepStack `POST /v1/vision/face/list`. */
export interface FaceListResponse {
  success?: unknown;
  faces?: unknown;
}

/** DeepStack `POST /v1/vision/face/recognize`. */
export interface RecognizeResponse {
  success?: unknown;
  predictions?: unknown;
}

export interface GalleryVerdict {
  ok: boolean;
  subjects: string[];
  problems: string[];
}

/**
 * Is the enrolment gallery exactly `[ALLOWED_SUBJECT]`?
 *
 * An EMPTY gallery is a problem too, not a safe default. With nothing enrolled,
 * both detectors return a hardcoded `confidence: 0` and `name: 'unknown'` for
 * every face, `matches`/`misses` are always empty, and the capture silently
 * degenerates into a run that cannot validate the 0-100 confidence scale at all
 * -- the exact claim Cycle 4 got wrong by 100x. A green run over worthless data
 * is the failure mode this whole slice is trying to avoid.
 */
export function checkGallery(res: FaceListResponse): GalleryVerdict {
  const problems: string[] = [];

  if (res.success !== true) {
    return { ok: false, subjects: [], problems: ['DeepStack /face/list did not return success'] };
  }
  const subjects = Array.isArray(res.faces)
    ? res.faces.filter((f): f is string => typeof f === 'string')
    : [];

  const extra = subjects.filter((s) => s !== ALLOWED_SUBJECT);
  if (extra.length > 0) {
    problems.push(
      `the gallery contains ${extra.map((s) => `"${s}"`).join(', ')} besides ` +
        `"${ALLOWED_SUBJECT}". FU-3 permits exactly one synthetic subject; anything ` +
        'else may be a real person and must be removed before capturing.',
    );
  }
  if (!subjects.includes(ALLOWED_SUBJECT)) {
    problems.push(
      `"${ALLOWED_SUBJECT}" is not enrolled. An empty gallery is NOT a safe default: ` +
        'every face would come back name="unknown" confidence=0, and the capture ' +
        'could not validate the 0-100 confidence scale — run `npm run enroll:synthetic`.',
    );
  }

  return { ok: problems.length === 0, subjects, problems };
}

/**
 * Does recognition actually RESOLVE the synthetic subject?
 *
 * This exists because `checkGallery` alone is vacuous, and that was found the
 * hard way during the FU-3 smoke test: DeepStack's `/face/recognize` only sees
 * subjects that were present when the PROCESS STARTED. Enrol a face and query
 * without restarting, and `/face/list` cheerfully reports `["synthetic_1"]`
 * while `/face/recognize` returns `userid: "unknown", confidence: 0` on the very
 * image just enrolled.
 *
 * So a capture gated only on gallery contents would run happily and produce a
 * whole window of `confidence: 0` rows -- passing a "non-null confidence" check
 * and proving nothing.
 */
export function checkRecognition(res: RecognizeResponse): { ok: boolean; problems: string[] } {
  if (res.success !== true) {
    return { ok: false, problems: ['DeepStack /face/recognize did not return success'] };
  }
  const preds = Array.isArray(res.predictions) ? res.predictions : [];
  if (preds.length === 0) {
    return {
      ok: false,
      problems: [
        'no face detected in the enrolment image — the detector cannot see the face it ' +
          'is supposed to match against',
      ],
    };
  }

  const named = preds
    .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
    .filter((p) => p.userid === ALLOWED_SUBJECT);

  if (named.length === 0) {
    return {
      ok: false,
      problems: [
        `recognition returned ${preds.length} face(s) but none as "${ALLOWED_SUBJECT}". ` +
          'This is almost certainly the restart trap: DeepStack only loads the gallery at ' +
          'process start, so a face enrolled since then is invisible to /face/recognize. ' +
          'Restart the detector (`docker compose -f docker-compose.frigate.yml restart ' +
          'deepstack`) and re-check.',
      ],
    };
  }

  // A confidence of 0 against the very image that was enrolled would mean the
  // embedding model is not working, whatever the userid says.
  const conf = named
    .map((p) => p.confidence)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  if (conf.length === 0 || Math.max(...conf) <= 0) {
    return {
      ok: false,
      problems: [
        `"${ALLOWED_SUBJECT}" was matched at confidence ${conf.length ? Math.max(...conf) : 'n/a'} ` +
          'on its own enrolment image. The embedding model is not returning a similarity.',
      ],
    };
  }

  return { ok: true, problems: [] };
}
