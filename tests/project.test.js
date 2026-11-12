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
  let p = createProject(); p = reconcileProjectLayout(p, withAddedOutput(p.venue.layout));
  const id = p.venue.layout.outputs[1].id; p.venue.projectors[1].position = [3,4,5];
  p = reconcileProjectLayout(p, withRemovedOutput(p.venue.layout, p.venue.layout.outputs[0].id));
  assert.equal(p.venue.layout.outputs[0].position.x, 0);
  assert.equal(p.venue.projectors[0].outputId, id); assert.deepEqual(p.venue.projectors[0].position, [3,4,5]);
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
