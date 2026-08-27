// Unit tests for the pure payload-shape differ (Cycle 7 step 1; see
// docs/cycle-7-live-camera-validation.md). node:test via `tsx --test`, the same
// runner as ingest.test.ts -- no database, no MQTT broker, no camera, so these
// run in the plain `npm test -w server` CI step.
//
// These matter more than usual: this differ is the instrument that produces the
// slice's whole deliverable (the deltas list). An instrument that silently
// under-reports would let a real schema mismatch through as "zero deltas", so
// the cases below pin the failure modes that would do that -- an absent field
// reported as present, an empty container reported as absent, and a delta
// double-counted so the list reads as worse than it is.

import assert from 'node:assert';
import { test } from 'node:test';
import {
  aggregateShapes,
  ancestorPaths,
  diffShapes,
  formatDelta,
  groupByKind,
  shapeOf,
  shapePaths,
} from './payloadShape';
import type { NodeType, PathDelta } from './payloadShape';

function pathsOf(payload: unknown): Record<string, NodeType> {
  return Object.fromEntries([...shapePaths(payload)].sort());
}

function byPath(deltas: PathDelta[]): Record<string, string> {
  return Object.fromEntries(deltas.map((d) => [d.path, d.kind]));
}

// --- shapePaths -------------------------------------------------------------

test('shapePaths: scalars, nesting and null', () => {
  assert.deepEqual(
    pathsOf({ type: 'new', after: { id: 'x', score: 0.9, ok: true, sub_label: null } }),
    {
      type: 'string',
      after: 'object',
      'after.id': 'string',
      'after.score': 'number',
      'after.ok': 'boolean',
      'after.sub_label': 'null',
    },
  );
});

test('shapePaths: the root container is not recorded', () => {
  assert.equal(shapePaths({ a: 1 }).has(''), false);
  // A degenerate root must not throw -- the capture script hands over whatever
  // arrived on the topic.
  assert.deepEqual(pathsOf('just a string'), {});
  assert.deepEqual(pathsOf(null), {});
});

test('shapePaths: array indices collapse to one [] segment, no dot', () => {
  // A 4-element box and a 2-element box must produce the SAME element path, or
  // two payloads differing only in array length would diff as a shape change.
  assert.deepEqual(pathsOf({ box: [1, 2, 3, 4] }), { box: 'array', 'box[]': 'number' });
  assert.deepEqual(pathsOf({ box: [1, 2] }), { box: 'array', 'box[]': 'number' });
});

test('shapePaths: an EMPTY container is a type at its own path, not an absence', () => {
  // The load-bearing case. `entered_zones: []` is what a zone-less Frigate
  // camera sends; recording it at the same path a populated array occupies is
  // what makes the two diff as one readable type change.
  assert.deepEqual(pathsOf({ entered_zones: [] }), { entered_zones: 'empty-array' });
  assert.deepEqual(pathsOf({ attributes: {} }), { attributes: 'empty-object' });
});

test('shapePaths: within one payload a heterogeneous array keeps the last type', () => {
  // Documented limitation, not a bug: across payloads the aggregate keeps the
  // union, which is the level the report is actually read at.
  assert.ok(shapePaths({ mixed: [1, 'a'] }).has('mixed[]'));
  const agg = aggregateShapes([{ mixed: [1] }, { mixed: ['a'] }]);
  assert.deepEqual([...(agg.paths.get('mixed[]')?.types ?? [])].sort(), ['number', 'string']);
});

test('ancestorPaths: walks both separators, nearest first', () => {
  assert.deepEqual(ancestorPaths('after.entered_zones[]'), ['after.entered_zones', 'after']);
  assert.deepEqual(ancestorPaths('after.data.box[]'), ['after.data.box', 'after.data', 'after']);
  assert.deepEqual(ancestorPaths('type'), []);
});

// --- aggregateShapes --------------------------------------------------------

test('aggregateShapes: counts presence and unions types across payloads', () => {
  const agg = aggregateShapes([
    { type: 'new', after: { end_time: null } },
    { type: 'end', after: { end_time: 1756180099.5 } },
    { type: 'new', after: { id: 'x' } },
  ]);
  assert.equal(agg.sampleCount, 3);
  assert.deepEqual([...(agg.paths.get('after.end_time')?.types ?? [])].sort(), ['null', 'number']);
  assert.equal(agg.paths.get('after.end_time')?.count, 2, 'present in 2 of 3');
  assert.equal(agg.paths.get('type')?.count, 3);
});

// --- diffShapes -------------------------------------------------------------

test('diffShapes: a documented field the real payload omits is only_in_documented', () => {
  // THE case this slice exists to catch: Frigate reporting score under
  // after.data while FARM_EVENTS.md documents after.top_score. Ingestion
  // accepts this with a 201 and a NULL confidence, so this differ is the only
  // thing that will say so.
  const real = shapeOf({ after: { id: 'x', data: { top_score: 0.83 } } });
  const documented = shapeOf({ after: { id: 'x', top_score: 0.83 } });
  const deltas = diffShapes(real, documented, 'after');

  assert.deepEqual(byPath(deltas), {
    'after.top_score': 'only_in_documented',
    'after.data': 'only_in_real',
    'after.data.top_score': 'only_in_real',
  });
  // Severity ordering: the breaking delta must lead the report.
  assert.equal(deltas[0].kind, 'only_in_documented');
  assert.equal(deltas[0].path, 'after.top_score');
});

test('diffShapes: identical shapes produce zero deltas', () => {
  const payload = { type: 'new', after: { id: 'x', zones: [], score: 0.5 } };
  assert.deepEqual(diffShapes(shapeOf(payload), shapeOf(payload)), []);
});

test('diffShapes: an empty array vs a populated one is ONE type_changed', () => {
  // The child path `entered_zones[]: string` is missing from the real payloads
  // only because the array is empty -- reporting it separately would
  // double-count one fact. impliedByEmptyAncestor suppresses it.
  const real = shapeOf({ after: { entered_zones: [] } });
  const documented = shapeOf({ after: { entered_zones: ['yard'] } });
  const deltas = diffShapes(real, documented, 'after');

  assert.equal(deltas.length, 1, `expected one delta, got ${JSON.stringify(deltas)}`);
  assert.equal(deltas[0].kind, 'type_changed');
  assert.equal(deltas[0].path, 'after.entered_zones');
  assert.deepEqual(deltas[0].realTypes, ['empty-array']);
  assert.deepEqual(deltas[0].documentedTypes, ['array']);
});

test('diffShapes: a genuinely missing field under a POPULATED container is still reported', () => {
  // The suppression above must not swallow real findings: `attributes` is
  // populated here, so a documented child that is absent is a true delta.
  const real = shapeOf({ after: { attributes: { a: 1 } } });
  const documented = shapeOf({ after: { attributes: { a: 1, b: 2 } } });
  const deltas = diffShapes(real, documented, 'after');
  assert.deepEqual(byPath(deltas), { 'after.attributes.b': 'only_in_documented' });
});

test('diffShapes: a field in some but not all captured payloads is sometimes_present', () => {
  const real = aggregateShapes([
    { after: { id: 'a', sub_label: 'delivery_van' } },
    { after: { id: 'b' } },
    { after: { id: 'c' } },
  ]);
  const documented = shapeOf({ after: { id: 'x', sub_label: 'y' } });
  const deltas = diffShapes(real, documented, 'after');
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].kind, 'sometimes_present');
  assert.equal(deltas[0].path, 'after.sub_label');
  assert.equal(deltas[0].presence, '1/3');
});

test('diffShapes: `only` scopes the comparison to one subtree', () => {
  // FARM_EVENTS.md elides `before` as {"...": "previous state"}, so an
  // unscoped diff would bury the real findings under before.* noise.
  const real = shapeOf({ type: 'new', before: { id: 'x', score: 0.1 }, after: { id: 'x' } });
  const documented = shapeOf({ type: 'new', before: { '...': 'previous state' }, after: { id: 'x' } });

  assert.deepEqual(diffShapes(real, documented, 'after'), []);
  const unscoped = diffShapes(real, documented);
  assert.ok(unscoped.some((d) => d.path.startsWith('before')), 'unscoped sees the elided subtree');
});

test('diffShapes: `only` keeps array-indexed children of the scoped root', () => {
  const real = shapeOf({ after: [{ id: 'x' }] });
  const documented = shapeOf({ after: [{ id: 'x', gone: 1 }] });
  assert.deepEqual(byPath(diffShapes(real, documented, 'after')), {
    'after[].gone': 'only_in_documented',
  });
});

test('diffShapes: output is deterministic across runs', () => {
  const real = aggregateShapes([{ after: { b: 1, a: 'x', c: [] } }]);
  const documented = shapeOf({ after: { d: true, a: 'x' } });
  const run = (): string => JSON.stringify(diffShapes(real, documented, 'after'));
  assert.equal(run(), run());
});

// --- reporting --------------------------------------------------------------

test('groupByKind: preserves severity order and drops empty groups', () => {
  const real = shapeOf({ after: { extra: 1 } });
  const documented = shapeOf({ after: { missing: 'x' } });
  const groups = groupByKind(diffShapes(real, documented, 'after'));
  assert.deepEqual(groups.map((g) => g.kind), ['only_in_documented', 'only_in_real']);
});

test('formatDelta: names the absent side explicitly', () => {
  const [delta] = diffShapes(
    shapeOf({ after: { id: 'x' } }),
    shapeOf({ after: { id: 'x', top_score: 0.9 } }),
    'after',
  );
  const line = formatDelta(delta);
  assert.match(line, /after\.top_score/);
  assert.match(line, /NOT SENT/);
});
