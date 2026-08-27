// Payload-shape extraction and diffing -- the PURE core (Cycle 7 step 1; see
// docs/cycle-7-live-camera-validation.md).
//
// Deliberately DB-free, fs-free and network-free, exactly like ingest.ts and
// classify.ts: functions from a parsed payload to a set of shape paths, and from
// two sets of shape paths to a list of deltas. That is what lets
// payloadShape.test.ts exercise every rule under plain `npm test -w server`
// with no database, no MQTT broker, no camera and no API key.
//
// The impure shell -- subscribing to MQTT, reading the captured JSONL, parsing
// the documented shape out of FARM_EVENTS.md -- lives in captureMqtt.ts and
// verifyPayloadShape.ts.
//
// WHY SHAPE PATHS AND NOT A JSON DIFF: the question this slice asks is "does the
// real payload carry the fields we documented, at the same types" -- not "are the
// values equal". Values differ by construction (a real event id is not
// `evt-nw-1`). Reducing both sides to a path->type map answers exactly the
// question asked, and makes it aggregable across N captured payloads.

/**
 * The type recorded at a path.
 *
 * Containers get a type of their own, and the empty/non-empty split is
 * load-bearing. Frigate sends `entered_zones: []` on a camera with no zones
 * configured and `attributes: {}` routinely. Recording `empty-array` vs `array`
 * at the SAME path is what makes "the field is present but empty" diff as one
 * readable type change against a documented `["yard"]`, instead of as two
 * unrelated deltas on two different paths. Telling those cases apart is
 * precisely what this slice exists to do.
 */
export type NodeType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'array'
  | 'empty-array'
  | 'object'
  | 'empty-object';

/** Container types, for which a documented child is implied rather than missing
 * when the real container turned out to be empty. */
const EMPTY_CONTAINERS: ReadonlySet<NodeType> = new Set(['empty-array', 'empty-object']);

/** What one path looked like across a set of payloads. */
export interface PathFacts {
  /** Every type observed at this path. More than one means the field is
   * polymorphic -- `end_time` is `null` on a `new` event and a number on `end`. */
  types: Set<NodeType>;
  /** How many payloads carried this path at all. */
  count: number;
}

/** An aggregate over N payloads. `sampleCount` is what `count` is a fraction
 * of, so a path seen in 3 of 40 payloads is reportable as optional. */
export interface AggregateShape {
  paths: Map<string, PathFacts>;
  sampleCount: number;
}

/**
 * Array elements all fold onto one `[]` segment, appended WITHOUT a dot:
 * `box[0]`, `box[1]` and `box[2]` all report as `box[]`.
 *
 * Without the collapse, a 4-element `box` and a 4-element `region` would
 * contribute eight paths that say nothing, and two payloads whose arrays differ
 * in LENGTH would diff as a shape change when only the content differs.
 */
const ARRAY_SUFFIX = '[]';

/**
 * Reduce one payload to a map of shape path -> observed type.
 *
 * The ROOT container is deliberately not recorded: an empty path is not a
 * meaningful thing to report a delta on, and "there is an object at the top
 * level" is implied by every other path.
 */
export function shapePaths(value: unknown): Map<string, NodeType> {
  const out = new Map<string, NodeType>();

  const walk = (v: unknown, path: string): void => {
    if (v === null) {
      if (path) out.set(path, 'null');
      return;
    }
    if (Array.isArray(v)) {
      if (path) out.set(path, v.length === 0 ? 'empty-array' : 'array');
      // A heterogeneous array reports several types at one path. Within a
      // single payload Map.set means the last element wins; across payloads the
      // aggregate keeps the union, which is the level the report is read at.
      for (const item of v) walk(item, `${path}${ARRAY_SUFFIX}`);
      return;
    }
    if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      if (path) out.set(path, entries.length === 0 ? 'empty-object' : 'object');
      for (const [k, child] of entries) walk(child, path ? `${path}.${k}` : k);
      return;
    }
    // `undefined` cannot appear here: it does not survive JSON.
    if (!path) return;
    if (typeof v === 'string') out.set(path, 'string');
    else if (typeof v === 'number') out.set(path, 'number');
    else if (typeof v === 'boolean') out.set(path, 'boolean');
  };

  walk(value, '');
  return out;
}

/**
 * Every ancestor path of a path, nearest first.
 *
 * Handles both separators, so `after.entered_zones[]` yields
 * `['after.entered_zones', 'after']`.
 */
export function ancestorPaths(path: string): string[] {
  const out: string[] = [];
  let p = path;
  for (;;) {
    if (p.endsWith(ARRAY_SUFFIX)) {
      p = p.slice(0, -ARRAY_SUFFIX.length);
    } else {
      const i = p.lastIndexOf('.');
      if (i < 0) break;
      p = p.slice(0, i);
    }
    if (!p) break;
    out.push(p);
  }
  return out;
}

/**
 * Fold several payloads' shape paths into one aggregate.
 *
 * Aggregating rather than diffing payload-by-payload is deliberate: Frigate
 * emits `new`, `update` and `end` for one event, and fields like `end_time` are
 * null on `new` and a number on `end`. Only an aggregate can report that as
 * "one path, two types, present in all samples" instead of as a stream of
 * contradictory per-payload diffs.
 */
export function aggregateShapes(payloads: unknown[]): AggregateShape {
  const paths = new Map<string, PathFacts>();
  for (const payload of payloads) {
    for (const [path, type] of shapePaths(payload)) {
      const facts = paths.get(path);
      if (facts) {
        facts.types.add(type);
        facts.count += 1;
      } else {
        paths.set(path, { types: new Set([type]), count: 1 });
      }
    }
  }
  return { paths, sampleCount: payloads.length };
}

/** Convenience for a single payload -- a one-sample aggregate. */
export function shapeOf(payload: unknown): AggregateShape {
  return aggregateShapes([payload]);
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

/**
 * Delta kinds, ordered by how much they hurt.
 *
 * `only_in_documented` is the breaking one and leads the report: it means we
 * documented (and may read) a field the real payload does not send. Finding 2
 * of the handover doc is exactly this case -- an absent `after.top_score` is
 * accepted with a 201 and a NULL confidence, so nothing else in the pipeline
 * will tell us about it.
 *
 * `only_in_real` is nearly always benign, because ingestion is permissive about
 * unknown fields and preserves the whole body in raw_payload -- but it is still
 * recorded, because it is how the documented shape gets brought up to date.
 */
export type DeltaKind =
  | 'only_in_documented'
  | 'type_changed'
  | 'sometimes_present'
  | 'only_in_real';

/** Report order, most-breaking first. Exported so the formatter and the tests
 * agree on it rather than each hardcoding a list. */
export const DELTA_ORDER: readonly DeltaKind[] = [
  'only_in_documented',
  'type_changed',
  'sometimes_present',
  'only_in_real',
] as const;

export interface PathDelta {
  path: string;
  kind: DeltaKind;
  /** Types seen in the captured payloads, sorted. Empty when absent there. */
  realTypes: NodeType[];
  /** Types the baseline declares, sorted. Empty when absent there. */
  documentedTypes: NodeType[];
  /** `"12/40"` -- how many captured payloads carried this path. */
  presence: string;
}

function sortedTypes(facts: PathFacts | undefined): NodeType[] {
  return facts ? [...facts.types].sort() : [];
}

function sameTypes(a: NodeType[], b: NodeType[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * Diff captured payloads against a baseline.
 *
 * `only` restricts the comparison to one subtree (`'after'` for Frigate, since
 * that is the only branch the normalizer reads and the only one FARM_EVENTS.md
 * documents in full -- the doc elides `before` as `{"...": "previous state"}`,
 * which would otherwise produce a wall of meaningless deltas).
 */
export function diffShapes(
  real: AggregateShape,
  documented: AggregateShape,
  only?: string,
): PathDelta[] {
  const inScope = (path: string): boolean =>
    !only || path === only || path.startsWith(`${only}.`) || path.startsWith(`${only}[`);

  /**
   * True when a documented path is missing from the real payloads only because
   * an ancestor container came back EMPTY.
   *
   * Without this, a zone-less camera would report two deltas for one fact:
   * `entered_zones` changed from `array` to `empty-array`, AND
   * `entered_zones[]: string` went missing. The second is entirely implied by
   * the first, and double-counting it would inflate the deltas list with
   * findings that have no independent fix.
   */
  const impliedByEmptyAncestor = (path: string): boolean =>
    ancestorPaths(path).some((a) => {
      const facts = real.paths.get(a);
      return !!facts && [...facts.types].every((t) => EMPTY_CONTAINERS.has(t));
    });

  const allPaths = new Set<string>();
  for (const p of real.paths.keys()) if (inScope(p)) allPaths.add(p);
  for (const p of documented.paths.keys()) if (inScope(p)) allPaths.add(p);

  const deltas: PathDelta[] = [];
  for (const path of allPaths) {
    const r = real.paths.get(path);
    const d = documented.paths.get(path);
    const realTypes = sortedTypes(r);
    const documentedTypes = sortedTypes(d);
    const presence = `${r?.count ?? 0}/${real.sampleCount}`;
    const base = { path, realTypes, documentedTypes, presence };

    if (!r && d) {
      if (!impliedByEmptyAncestor(path)) {
        deltas.push({ ...base, kind: 'only_in_documented' });
      }
      continue;
    }
    if (r && !d) {
      deltas.push({ ...base, kind: 'only_in_real' });
      continue;
    }
    if (!r || !d) continue; // unreachable; keeps the narrowing honest

    if (!sameTypes(realTypes, documentedTypes)) {
      // A path whose real types are a SUPERSET of the documented ones is not a
      // contradiction -- `end_time` being `null | number` where the doc shows
      // only `null` is the doc being narrow, not the payload being wrong. It is
      // still reported, because a consumer written against the narrow type will
      // still be surprised.
      deltas.push({ ...base, kind: 'type_changed' });
      continue;
    }
    if (r.count < real.sampleCount) {
      deltas.push({ ...base, kind: 'sometimes_present' });
    }
  }

  // Stable, meaningful order: severity first, then path, so two runs over the
  // same capture produce byte-identical reports and can be diffed themselves.
  const rank = (k: DeltaKind): number => DELTA_ORDER.indexOf(k);
  return deltas.sort((a, b) => rank(a.kind) - rank(b.kind) || a.path.localeCompare(b.path));
}

/** Group deltas by kind, preserving DELTA_ORDER, for a sectioned report. */
export function groupByKind(deltas: PathDelta[]): { kind: DeltaKind; deltas: PathDelta[] }[] {
  return DELTA_ORDER.map((kind) => ({
    kind,
    deltas: deltas.filter((d) => d.kind === kind),
  })).filter((g) => g.deltas.length > 0);
}

/** One delta as a single report line. */
export function formatDelta(d: PathDelta): string {
  const real = d.realTypes.length > 0 ? d.realTypes.join('|') : '(absent)';
  const doc = d.documentedTypes.length > 0 ? d.documentedTypes.join('|') : '(absent)';
  switch (d.kind) {
    case 'only_in_documented':
      return `${d.path}: documented as ${doc}, NOT SENT by the real payload`;
    case 'only_in_real':
      return `${d.path}: real payload sends ${real}, not in the documented shape`;
    case 'type_changed':
      return `${d.path}: documented ${doc}, real ${real}`;
    case 'sometimes_present':
      return `${d.path}: ${real}, present in only ${d.presence} payloads`;
  }
}
