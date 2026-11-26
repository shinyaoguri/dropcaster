// #197: OP / Gist 作品のコードの固定。照合の hash・プロジェクトの形式・参照を作り直したときの固定の引き継ぎ。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sha256Hex } from '../src/viewer/utils/sha256.ts';
import { snapshotHash, createSnapshot } from '../src/viewer/practice/sketchSnapshot.ts';
import { createProject, parseProject, portableProject, keepPins, ProjectFormatError } from '../src/viewer/practice/project.ts';

test('sha256Hex matches the published test vectors', () => {
  // FIPS 180-2 / NIST の例。
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256Hex('a'.repeat(1_000_000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('sha256Hex agrees with node:crypto across block boundaries and multibyte text', () => {
  const samples = ['日本語のスケッチ 🎨', 'é'.repeat(40)];
  for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) samples.push(randomBytes(length).toString('latin1'));
  for (const text of samples) assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), JSON.stringify(text.slice(0, 20)));
});

/** @typedef {import('../src/viewer/practice/sketchSnapshot.ts').SnapshotPayload} SnapshotPayload */
/** @typedef {import('../src/viewer/practice/project.ts').ContentReference} ContentReference */
/** @returns {SnapshotPayload} */
const opPayload = (code = 'function setup(){createCanvas(400,400)}', meta = {}) => ({ kind: 'op', ref: '777',
  meta: { title: 'Rehearsal', mode: 'p5js', engineURL: 'https://cdn.example/p5.js', libraries: [], fileBase: 'https://deckard.example/u/', views: 10, ...meta },
  codeTabs: [{ orderID: 0, title: 'mySketch', code }] });

test('the pin hash follows the code, not volatile metadata', () => {
  const base = snapshotHash(opPayload());
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(snapshotHash(opPayload(undefined, { views: 9999, hearts: 3, updatedOn: '2026-12-01', description: 'new text' })), base,
    'views, hearts, dates and the description do not change what runs');
  assert.notEqual(snapshotHash(opPayload('function setup(){createCanvas(800,800)}')), base, 'a code change is a different version');
  assert.notEqual(snapshotHash(opPayload(undefined, { libraries: [{ url: 'https://cdn.example/sound.js' }] })), base, 'a library change is a different version');
  assert.notEqual(snapshotHash({ ...opPayload(), ref: '778' }), base, 'the same code under another sketch is a different entry');
  /** @param {[string, string][]} files @returns {SnapshotPayload} */
  const gist = files => ({ kind: 'gist', ref: 'a'.repeat(32), gist: { id: 'a'.repeat(32), description: '', ownerLogin: 'me', ownerUrl: '', htmlUrl: 'https://gist.github.com/x', updatedAt: '', files } });
  assert.equal(snapshotHash(gist([['index.html', '<p>'], ['sketch.js', 'x']])), snapshotHash(gist([['sketch.js', 'x'], ['index.html', '<p>']])),
    'Gist file order does not matter');
  assert.notEqual(snapshotHash(gist([['index.html', '<p>'], ['sketch.js', 'x']])), snapshotHash(gist([['index.html', '<p>'], ['sketch.js', 'y']])));
});

test('a snapshot keeps the author, sketch URL, licence and fetch time', () => {
  const snapshot = createSnapshot(opPayload(undefined, { fullname: 'An Artist', username: 'artist', license: 'CC BY-SA 3.0' }), '2026-11-20T10:00:00.000Z');
  assert.deepEqual(snapshot.source, { author: 'An Artist', url: 'https://openprocessing.org/sketch/777', license: 'CC BY-SA 3.0' });
  assert.equal(snapshot.fetchedAt, '2026-11-20T10:00:00.000Z');
  assert.equal(snapshot.hash, snapshotHash(snapshot.payload));
});

const HASH = 'ab'.repeat(32);
function projectWith(content) {
  const p = createProject(); p.content = content; p.show.contentIds = content.map(c => c.id); return p;
}
test('a pinned OP / Gist reference round-trips with its hash only', () => {
  const p = projectWith([
    { id: 'op-777', kind: 'op', ref: '777', title: 'Pinned', revision: '2026-11-20', revisionPinned: true, hash: HASH },
    { id: 'op-1', kind: 'op', ref: '1', title: 'Latest', revision: null, revisionPinned: false },
  ]);
  const exported = JSON.parse(JSON.stringify(portableProject(p)));
  assert.deepEqual(Object.keys(exported.content[0]).sort(), ['hash', 'id', 'kind', 'ref', 'revision', 'revisionPinned', 'title']);
  const copy = parseProject(exported);
  assert.deepEqual(JSON.parse(JSON.stringify(copy.content)), p.content);
  assert.equal('hash' in copy.content[1], false, 'an unpinned reference gains no hash');
});

test('pins are rejected where they cannot mean anything', () => {
  const code = fn => { try { fn(); } catch (error) { return error instanceof ProjectFormatError ? error.message : String(error); } return 'accepted'; };
  const pinned = { id: 'op-777', kind: 'op', ref: '777', title: 'Pinned', revision: null, revisionPinned: true, hash: HASH };
  assert.equal(code(() => parseProject(projectWith([{ ...pinned, kind: 'local', ref: 'a', id: 'a' }]))), 'reference', 'local sketches are pinned by the gallery files');
  assert.equal(code(() => parseProject(projectWith([{ ...pinned, kind: 'builtin', ref: 'checkerboard', id: 'b' }]))), 'reference');
  assert.equal(code(() => parseProject(projectWith([{ ...pinned, hash: 'not-a-hash' }]))), 'invalid');
  assert.equal(code(() => parseProject(projectWith([{ ...pinned, hash: undefined }]))), 'invalid');
  assert.equal(code(() => parseProject(projectWith([{ ...pinned, revisionPinned: false }]))), 'invalid', 'an unpinned reference cannot carry a hash');
  assert.equal(code(() => parseProject(projectWith([{ ...pinned, revisionPinned: 'yes' }]))), 'version', 'unknown pin forms are a version error');
  assert.equal(code(() => parseProject(projectWith([{ ...pinned, kind: 'gist', ref: 'f'.repeat(32), id: 'gist-x' }]))), 'accepted');
});

test('rebuilding references from the shown sketches keeps the same sketch pinned', () => {
  /** @type {ContentReference[]} */
  const previous = [{ id: 'op-777', kind: 'op', ref: '777', title: 'Old title', revision: null, revisionPinned: true, hash: HASH }];
  /** @type {ContentReference[]} */
  const next = [
    { id: 'op-777', kind: 'op', ref: '777', title: 'New title', revision: '2026-11-25', revisionPinned: false },
    { id: 'op-1', kind: 'op', ref: '1', title: 'Other', revision: null, revisionPinned: false },
  ];
  assert.deepEqual(keepPins(next, previous), [{ ...next[0], revisionPinned: true, hash: HASH }, next[1]]);
  assert.deepEqual(keepPins([{ ...next[0], ref: '778' }], previous), [{ ...next[0], ref: '778' }], 'a different sketch under the same id is not pinned');
});
