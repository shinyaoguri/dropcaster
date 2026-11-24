import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, portableProject, portableVenue, importVenue, reconcileProjectLayout, encodeAsset, decodeAsset, validateGlb } from '../src/viewer/practice/project.ts';
import { roomScene, venueObject } from '../src/viewer/practice/venueObjects.ts';
import { withAddedOutput, withRemovedOutput } from '../src/viewer/utils/mappingTransform.ts';
import { venueFixture } from './fixtures/venue-glb.mjs';

test('portable project roundtrip preserves venue, optics, content and embedded images', () => {
  const p = createProject();
  p.assets = [{ id: 'wall', name: 'wall.glb', mimeType: 'model/gltf-binary', data: encodeAsset(venueFixture()) }];
  p.venue.scene.kind = 'glb'; p.venue.scene.assetId = 'wall';
  p.venue.scene.scale = [2, 1, 0.5]; p.venue.projectors[0].lensShift = [0.2, -0.1];
  p.venue.layout.outputs[0].screen = { left: 1920, top: 0, width: 1920, height: 1080 };
  p.content = [{ id: 'op-1', kind: 'op', ref: '1', title: 'Test', revision: '2026-11-11', revisionPinned: false }]; p.show.contentIds = ['op-1'];
  const copy = parseProject(JSON.parse(JSON.stringify(portableProject(p))));
  assert.equal(copy.venue.layout.outputs[0].screen, undefined);
  assert.deepEqual(copy.assets, p.assets); assert.deepEqual(JSON.parse(JSON.stringify(copy.content)), p.content);
  assert.deepEqual(copy.venue.projectors, p.venue.projectors); assert.deepEqual(copy.venue.scene, p.venue.scene);
  assert.ok(p.venue.layout.outputs[0].screen, 'export does not mutate working state');
});
test('legacy v2 remains accepted, while malformed or partial layouts are rejected atomically', () => {
  const p = createProject(); assert.deepEqual(parseProject(p.venue.layout).venue.layout, parseProject(p).venue.layout);
  const zeroCrop = structuredClone(p.venue.layout), originalCrop = zeroCrop.mappings[0];
  assert.ok('source' in originalCrop); originalCrop.source.width = 0;
  const restoredCrop = parseProject(zeroCrop).venue.layout.mappings[0];
  assert.ok('source' in restoredCrop); assert.equal(restoredCrop.source.width, 0);
  for (const mutate of [
    p => p.schemaVersion = 99, p => p.venue.layout.outputs.push({}), p => p.venue.layout.outputs[0].size.width = 0,
    p => p.venue.layout.canvas.width = NaN, p => p.venue.layout.mappings[0].quad.topLeft.x = Infinity,
    p => p.venue.projectors[0].outputId = 'missing', p => p.venue.projectors[0].quaternion = [0,0,0,0],
    p => p.venue.projectors[0].near = p.venue.projectors[0].far, p => p.show.contentIds = ['missing'],
    p => p.venue.scene = { ...p.venue.scene, kind: 'glb', assetId: 'missing' },
  ]) {
    const bad = structuredClone(p); mutate(bad); assert.throws(() => parseProject(bad));
  }
  assert.equal(p.venue.layout.outputs.length, 1);
});
test('removing a 2D output does not compact physical projector coordinates', () => {
  let p = createProject(); const removed = new Map(); p = reconcileProjectLayout(p, withAddedOutput(p.venue.layout), removed);
  const id = p.venue.layout.outputs[1].id; p.venue.projectors[1].position = [3,4,5];
  p = reconcileProjectLayout(p, withRemovedOutput(p.venue.layout, p.venue.layout.outputs[0].id), removed);
  assert.equal(p.venue.layout.outputs[0].position.x, 0);
  assert.equal(p.venue.projectors[0].outputId, id); assert.deepEqual(p.venue.projectors[0].position, [3,4,5]);
});
test('an output that returns to the layout (Undo of a delete) gets its projector calibration back (#165)', () => {
  const removed = new Map();
  let p = createProject(); p = reconcileProjectLayout(p, withAddedOutput(p.venue.layout), removed);
  const [keptId, id] = p.venue.layout.outputs.map(o => o.id);
  const calibrate = (project, outputId, values) => ({ ...project, venue: { ...project.venue,
    projectors: project.venue.projectors.map(q => q.outputId === outputId ? { ...q, ...values } : q) } });
  const first = { position: [7.5, 1.25, -3], quaternion: [0, 0.6, 0, 0.8], verticalFovDegrees: 31, aspect: 1.6, lensShift: [0.2, -0.4], near: 0.5, far: 80 };
  p = calibrate(calibrate(p, id, first), keptId, { position: [-2, 3, 6], lensShift: [0, 0.3] });
  const both = structuredClone(p.venue.layout), onlyKept = withRemovedOutput(both, id);
  const projector = (project, outputId) => project.venue.projectors.find(q => q.outputId === outputId);
  const expectKept = project => {
    assert.deepEqual(projector(project, keptId).position, [-2, 3, 6]); assert.deepEqual(projector(project, keptId).lensShift, [0, 0.3]);
  };

  p = reconcileProjectLayout(p, onlyKept, removed);
  assert.deepEqual(p.venue.projectors.map(q => q.outputId), [keptId]); expectKept(p);
  p = reconcileProjectLayout(p, structuredClone(both), removed); // Undo
  assert.deepEqual(p.venue.projectors.map(q => q.outputId), [keptId, id]);
  assert.deepEqual(projector(p, id), { id: `projector-${id}`, outputId: id, ...first }); expectKept(p);

  // Redo → Undo: 戻した後に校正し直した値が、最初に消したときの値より優先される。
  const second = { ...first, position: [1, 2, 3], verticalFovDegrees: 55 };
  p = calibrate(p, id, second);
  p = reconcileProjectLayout(p, structuredClone(onlyKept), removed);
  p = reconcileProjectLayout(p, structuredClone(both), removed);
  assert.deepEqual(projector(p, id), { id: `projector-${id}`, outputId: id, ...second }); expectKept(p);

  // 一度も消していない新しい出力は既定値から始まる。今のプロジェクトにある値は覚えた値で上書きしない。
  const added = reconcileProjectLayout(p, withAddedOutput(p.venue.layout), removed);
  assert.deepEqual(added.venue.projectors[2].position, [0, 2.5, 4.5]);
  removed.set(id, { ...projector(p, id), position: [9, 9, 9] });
  assert.deepEqual(projector(reconcileProjectLayout(p, structuredClone(both), removed), id).position, [1, 2, 3]);
});
test('GLB rejects external images/buffers, cycles, unsupported extensions and out-of-bounds data', () => {
  validateGlb(venueFixture());
  for (const mutate of [
    d => d.images[0].uri = 'https://example.com/image.png', d => d.buffers[0].uri = '../secret.bin',
    d => d.nodes[0].children = [0], d => d.nodes[0].children = [0.5],
    d => d.extensionsRequired = ['KHR_draco_mesh_compression'], d => d.animations = [{}],
    d => d.bufferViews[0].byteOffset = 1e9, d => d.accessors[0].count = 1e9,
  ]) assert.throws(() => validateGlb(venueFixture(mutate)));
  const broken = venueFixture(); broken[8] = 0; assert.throws(() => validateGlb(broken));
});
test('large embedded assets decode without regexp stack overflow; invalid padding is rejected', () => {
  const bytes = new Uint8Array(8 * 1024 * 1024).fill(123);
  assert.deepEqual(decodeAsset(encodeAsset(bytes)), bytes);
  for (const bad of ['a', 'AAAA===A', 'AA=A', '====', 'AA$=']) assert.throws(() => decodeAsset(bad));
});
test('an asset already verified under the same id and data is not decoded again; any other asset still is (#171)', () => {
  // The base64 decode is the observable cost: count the atob calls a parse makes.
  const decodes = run => {
    const real = globalThis.atob; let calls = 0;
    globalThis.atob = data => { calls++; return real(data); };
    try { run(); } finally { globalThis.atob = real; }
    return calls;
  };
  const p = createProject();
  p.assets = [{ id: 'wall', name: 'wall.glb', mimeType: 'model/gltf-binary', data: venueFixture().toString('base64') }];
  p.venue.scene.kind = 'glb'; p.venue.scene.assetId = 'wall';
  let stored;
  assert.equal(decodes(() => { stored = parseProject(p); }), 1, 'the first parse decodes and validates the GLB');
  // A calibration commit: the projector moves, the asset is the one that was just verified.
  const moved = { ...stored, venue: { ...stored.venue, revision: stored.venue.revision + 1,
    projectors: [{ ...stored.venue.projectors[0], position: [1, 2, 3] }] } };
  let committed;
  assert.equal(decodes(() => { committed = parseProject(moved, stored.assets); }), 0, 'an unchanged asset is not decoded again');
  assert.deepEqual(committed, moved);
  assert.equal(decodes(() => parseProject(moved)), 1, 'without verified assets every parse decodes');
  // The calibration values themselves are still validated.
  assert.throws(() => parseProject({ ...moved, venue: { ...moved.venue, projectors: [{ ...moved.venue.projectors[0], near: 5, far: 1 }] } }, stored.assets));
  // The same id does not vouch for different data.
  const truncated = venueFixture(); truncated[8] = 0;
  for (const bad of [venueFixture(d => d.images[0].uri = 'https://example.com/image.png'), venueFixture(d => d.buffers[0].uri = '../secret.bin'),
    venueFixture(d => d.bufferViews[0].byteOffset = 1e9), truncated]) {
    const replaced = { ...moved, assets: [{ ...stored.assets[0], data: bad.toString('base64') }] };
    assert.equal(decodes(() => assert.throws(() => parseProject(replaced, stored.assets))), 1);
  }
  // Nor does the same data under another id.
  const renamed = { ...moved, assets: [{ ...stored.assets[0], id: 'other' }], venue: { ...moved.venue, scene: { ...moved.venue.scene, assetId: 'other' } } };
  assert.equal(decodes(() => parseProject(renamed, stored.assets)), 1);
  // A verified asset skips only the GLB decode, not the checks on its other fields.
  assert.throws(() => parseProject({ ...moved, assets: [{ ...stored.assets[0], mimeType: 'model/gltf+json' }] }, stored.assets));
  assert.throws(() => parseProject({ ...moved, assets: [{ ...stored.assets[0], name: '' }] }, stored.assets));
  assert.throws(() => parseProject({ ...moved, assets: [stored.assets[0], stored.assets[0]] }, stored.assets));
});

test('v1 projects migrate without changing calibrated geometry or embedded assets', () => {
  const p = createProject();
  p.assets = [{ id:'wall', name:'wall.glb', mimeType:'model/gltf-binary', data:encodeAsset(venueFixture()) }];
  p.venue.scene.kind = 'glb'; p.venue.scene.assetId = 'wall';
  p.venue.projectors[0].position = [3, 2, 1];
  const restored = parseProject({ ...p, schemaVersion: 1 });
  assert.equal(restored.schemaVersion, 3);
  assert.deepEqual(restored.venue.projectors, p.venue.projectors);
  assert.deepEqual(restored.venue.layout, parseProject(p).venue.layout);
  assert.deepEqual(restored.assets, p.assets);
});

test('measured rooms use clear inner dimensions and preserve object edits on roundtrip', () => {
  const p = createProject(); p.venue.scene = roomScene(8, 3, 6, ['Floor', 'Back', 'Left', 'Right']);
  const objects = p.venue.scene.objects; assert.ok(objects);
  const [floor, back, left, right] = objects;
  assert.equal(floor.position[1] + floor.size[1] / 2, 0);
  assert.equal(back.position[2] + back.size[2] / 2, -3);
  assert.equal(right.position[0] - right.size[0] / 2 - (left.position[0] + left.size[0] / 2), 8);
  back.position[0] = 1.5; back.color = '#804020'; back.quaternion = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))).venue.scene.objects, objects);
  for (const mutate of [
    p => { p.venue.scene.objects[0].size[1] = 0; },
    p => { p.venue.scene.objects[0].position[0] = Infinity; },
    p => { p.venue.scene.objects[0].color = 'not a colour'; },
    p => { p.venue.scene.objects[0].quaternion = [0, 0, 0, 0]; },
    p => { p.venue.scene.objects.push(p.venue.scene.objects[0]); },
    p => { p.venue.scene.objects = []; },
    p => { p.venue.scene.scale = [2, 2, 2]; },
    p => { p.venue.scene.objects = Array.from({length:129}, (_,i) => ({ ...objects[0], id: String(i) })); },
  ]) { const bad = structuredClone(p); mutate(bad); assert.throws(() => parseProject(bad)); }
  assert.throws(() => parseProject({ ...p, schemaVersion: 1 }), 'old readers must not silently lose editable geometry');
});

test('venue sharing strips screen and source details while retaining the receiving project and show', () => {
  const author = createProject(); author.name = 'Hall'; author.venue.scene = roomScene(8, 3, 6, ['F', 'B', 'L', 'R']);
  author.content = [{ id: 'local-secret', kind:'local', ref:'local-secret', title:'Private rehearsal', revision:null, revisionPinned:false }];
  author.show.contentIds = ['local-secret'];
  author.venue.layout.outputs[0].screen = { left:1920, top:0, width:1920, height:1080 };
  const shared = portableVenue(author);
  assert.equal(JSON.stringify(shared).includes('local-secret'), false); assert.equal('show' in shared, false);
  assert.equal(shared.venue.layout.outputs[0].screen, undefined);
  const recipient = createProject(); recipient.name = 'My show'; recipient.show.intervalSeconds = 45;
  const imported = importVenue(shared, recipient);
  assert.equal(imported.name, recipient.name); assert.equal(imported.id, recipient.id);
  assert.deepEqual(imported.show, recipient.show); assert.deepEqual(imported.content, recipient.content);
  assert.deepEqual(imported.venue.scene.objects, author.venue.scene.objects);
  assert.throws(() => importVenue({ ...shared, schemaVersion:99 }, recipient));
  assert.throws(() => importVenue({ ...shared, venue: { ...shared.venue, projectors:[] } }, recipient));
  assert.equal(recipient.venue.scene.kind, 'sample');
});

test('v2 projects and v1 venues migrate while new solid types roundtrip in versioned packages', () => {
  const p = createProject(); p.venue.scene = roomScene(8, 3, 6, ['F','B','L','R']);
  const old = { ...p, schemaVersion: 2 };
  assert.deepEqual(parseProject(old).venue.scene.objects, p.venue.scene.objects);
  assert.deepEqual(importVenue({ ...portableVenue(p), schemaVersion: 1 }, createProject()).venue.scene.objects, p.venue.scene.objects);
  p.venue.scene.objects.push(venueObject('tetrahedron', 'Tetra'), venueObject('prism', 'Prism'));
  const shared = portableVenue(p);
  assert.equal(shared.schemaVersion, 2); assert.equal(p.schemaVersion, 3);
  const restored = importVenue(JSON.parse(JSON.stringify(shared)), createProject());
  assert.deepEqual(restored.venue.scene.objects, p.venue.scene.objects);
  assert.throws(() => parseProject({ ...p, schemaVersion: 2 }), /version/);
  assert.throws(() => importVenue({ ...shared, schemaVersion: 1 }, createProject()), /version/);
  const bad = JSON.parse(JSON.stringify(shared)); bad.venue.scene.objects[0].kind = 'sphere';
  assert.throws(() => importVenue(bad, createProject()));
});
