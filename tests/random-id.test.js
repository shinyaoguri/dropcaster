import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createProject } from '../src/viewer/practice/project.ts';
import { venueObject } from '../src/viewer/practice/venueObjects.ts';
import { randomId } from '../src/viewer/utils/randomId.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** LAN の http://<IP>:<port> と同じく、secure context 限定の crypto.randomUUID が無い状態で fn を走らせる。 */
function withoutRandomUUID(fn) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
  try { return fn(); } finally { delete globalThis.crypto.randomUUID; }
}

test('project and venue objects initialize without crypto.randomUUID (non-secure context)', () => {
  withoutRandomUUID(() => {
    assert.equal(typeof crypto.randomUUID, 'undefined', 'stub must hide randomUUID');
    const p = createProject();
    assert.match(p.id, UUID_V4); assert.match(p.venue.id, UUID_V4); assert.notEqual(p.id, p.venue.id);
    assert.match(venueObject('wall', 'Wall').id, UUID_V4);
  });
  assert.equal(typeof crypto.randomUUID, 'function', 'stub is removed after the test');
});

test('randomId yields RFC 4122 v4 UUIDs without collisions', () => {
  const ids = new Set();
  for (let i = 0; i < 10000; i++) { const id = randomId(); assert.match(id, UUID_V4); ids.add(id); }
  assert.equal(ids.size, 10000);
});

test('viewer code does not call crypto.randomUUID directly', () => {
  const offenders = [];
  const walk = dir => { for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.[cm]?[jt]s$/.test(name) && readFileSync(path, 'utf8').includes('crypto.randomUUID')) offenders.push(path);
  } };
  for (const root of ['src/viewer', 'apps/web/src']) walk(root);
  assert.deepEqual(offenders, [], 'use randomId() from src/viewer/utils/randomId.ts: randomUUID is missing outside secure contexts');
});
