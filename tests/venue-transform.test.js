import test from 'node:test';
import assert from 'node:assert/strict';
import { transformedObject } from '../src/viewer/practice/venueTransform.ts';
/** @type {import('../src/viewer/practice/project.ts').VenueObject} */
const source = { id: 'box', name: 'Box', kind: 'box', size: [2,3,4], position: [1,2,3], quaternion: [0,0,0,1], color: '#ffffff' };

test('interactive transforms preserve measured local dimensions and normalize rotation', () => {
  const result = transformedObject(source, [3,4,5], [0,2,0,2], [2,.5,3]);
  assert.deepEqual(result.size, [4,1.5,12]); assert.deepEqual(result.position, [3,4,5]);
  assert.ok(Math.abs(Math.hypot(...result.quaternion)-1)<1e-12);
  assert.deepEqual(source.size, [2,3,4]); assert.deepEqual(source.position, [1,2,3]);
});
test('crossing resize handles and excessive drags never create invalid imported geometry', () => {
  const result = transformedObject(source, [1e9,-1e9,0], [0,0,0,1], [-2,0,1e8]);
  assert.deepEqual(result.size, [.001,.001,1000]); assert.deepEqual(result.position, [10000,-10000,0]);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(transformedObject(source, [value,0,0], [0,0,0,1], [1,1,1]), source);
  assert.equal(transformedObject(source, [0,0,0], [0,0,0,0], [1,1,1]), source);
});
