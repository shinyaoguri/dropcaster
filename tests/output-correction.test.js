import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  outputChannelGains,
  parseMappingsState,
  withAddedOutput,
  withOutputCorrectionSet,
} from '../src/viewer/utils/mappingTransform.ts';
import { createProject, parseProject, portableProject } from '../src/viewer/practice/project.ts';
import { mappingsHistoryKey } from '../src/viewer/utils/editHistory.ts';

// 出力ごとの明るさ・RGB のゲイン (#199)。OutputDef.correction は省略でき、
// 省略 = 補正なし。#199 より前のファイルは補正なしで読め、補正なしの出力は保存しても同じ形のまま。

// #199 より前の版が書き出していた v2 設定 JSON (correction を知らない)。
const legacy = {
  version: 2,
  canvas: { width: 3840, height: 1080 },
  outputs: [
    { id: 'left', name: 'Left', position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
    { id: 'right', name: 'Right', position: { x: 1920, y: 0 }, size: { width: 1920, height: 1080 } },
  ],
  mappings: [{
    id: 'm1', source: { x: 0, y: 0, width: 100, height: 100 },
    quad: { topLeft: { x: 0, y: 0 }, topRight: { x: 3840, y: 0 }, bottomRight: { x: 3840, y: 1080 }, bottomLeft: { x: 0, y: 1080 } },
  }],
  activeId: 'm1',
};

test('a v2 file without correction loads as no correction and saves back unchanged', () => {
  const parsed = parseMappingsState(structuredClone(legacy));
  assert.ok(parsed);
  for (const o of parsed.outputs) assert.equal('correction' in o, false, `${o.id}: no correction key`);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), legacy);
});

test('correction survives the v2 settings JSON roundtrip, per output', () => {
  let state = parseMappingsState(structuredClone(legacy));
  state = withOutputCorrectionSet(state, 'right', { brightness: 0.9, r: 1, g: 1, b: 0.95 });
  const reloaded = parseMappingsState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded.outputs.find(o => o.id === 'right').correction, { brightness: 0.9, r: 1, g: 1, b: 0.95 });
  assert.equal('correction' in reloaded.outputs.find(o => o.id === 'left'), false, 'the other output stays uncorrected');
});

test('the parser fills, clamps and drops correction values like a tolerant v2 field', () => {
  const withCorrection = correction => {
    const data = structuredClone(legacy);
    data.outputs[0].correction = correction;
    return parseMappingsState(data).outputs[0].correction;
  };
  assert.deepEqual(withCorrection({ b: 0.5 }), { brightness: 1, r: 1, g: 1, b: 0.5 }, 'missing keys default to 1');
  assert.deepEqual(withCorrection({ brightness: 5, r: -1, g: 'x', b: NaN }), { brightness: 2, r: 0, g: 1, b: 1 }, 'out of range is clamped, non-numbers become 1');
  assert.equal(withCorrection({ brightness: 1, r: 1, g: 1, b: 1 }), undefined, 'identity is not stored');
  assert.equal(withCorrection('bright'), undefined, 'non-object is ignored');
});

test('withOutputCorrectionSet changes one output, and reset removes the field', () => {
  const state = parseMappingsState(structuredClone(legacy));
  const set = withOutputCorrectionSet(state, 'left', { brightness: 0.8, r: 1.1, g: 1, b: 1 });
  assert.deepEqual(set.outputs[0].correction, { brightness: 0.8, r: 1.1, g: 1, b: 1 });
  assert.equal(set.outputs[1], state.outputs[1], 'other outputs are untouched');
  assert.equal(state.outputs[0].correction, undefined, 'input state is not mutated');
  const reset = withOutputCorrectionSet(set, 'left', undefined);
  assert.equal('correction' in reset.outputs[0], false);
  assert.deepEqual(JSON.parse(JSON.stringify(reset)), legacy, 'reset returns to the uncorrected file');
  assert.equal('correction' in withOutputCorrectionSet(set, 'left', { brightness: 1, r: 1, g: 1, b: 1 }).outputs[0], false);
  assert.equal(withOutputCorrectionSet(state, 'missing', { brightness: 0.5 }), state, 'unknown output is a no-op');
});

test('a new output starts without correction', () => {
  const added = withAddedOutput(parseMappingsState(structuredClone(legacy)));
  assert.equal(added.outputs.at(-1).correction, undefined);
});

test('channel gains multiply brightness into each channel, and identity draws nothing extra', () => {
  assert.deepEqual(outputChannelGains({ brightness: 0.5, r: 1, g: 0.5, b: 2 }), [0.5, 0.25, 1]);
  assert.equal(outputChannelGains(undefined), null);
  assert.equal(outputChannelGains({ brightness: 1, r: 1, g: 1, b: 1 }), null);
  // brightness 2 x r 0.5 = 1 for every channel: same pixels as no correction.
  assert.equal(outputChannelGains({ brightness: 2, r: 0.5, g: 0.5, b: 0.5 }), null);
});

test('correction is part of the undo history key (an edit, not a selection)', () => {
  const state = parseMappingsState(structuredClone(legacy));
  const set = withOutputCorrectionSet(state, 'right', { brightness: 0.9, r: 1, g: 1, b: 1 });
  assert.notEqual(mappingsHistoryKey(set), mappingsHistoryKey(state));
});

test('project v3 keeps correction through export / import, and old projects load uncorrected', () => {
  const p = createProject(parseMappingsState(structuredClone(legacy)));
  const old = parseProject(JSON.parse(JSON.stringify(portableProject(p))));
  assert.equal('correction' in old.venue.layout.outputs[1], false);
  p.venue.layout = withOutputCorrectionSet(p.venue.layout, 'right', { brightness: 0.9, r: 1, g: 1, b: 0.95 });
  const copy = parseProject(JSON.parse(JSON.stringify(portableProject(p))));
  assert.deepEqual(copy.venue.layout.outputs[1].correction, { brightness: 0.9, r: 1, g: 1, b: 0.95 });
  assert.equal('correction' in copy.venue.layout.outputs[0], false);
});

test('project import rejects malformed correction instead of silently dropping it', () => {
  const p = createProject(parseMappingsState(structuredClone(legacy)));
  for (const correction of [{ brightness: 3 }, { r: -0.1 }, { g: 'x' }, 'bright', [1, 1, 1, 1]]) {
    const bad = JSON.parse(JSON.stringify(portableProject(p)));
    bad.venue.layout.outputs[0].correction = correction;
    assert.throws(() => parseProject(bad), undefined, JSON.stringify(correction));
  }
});
