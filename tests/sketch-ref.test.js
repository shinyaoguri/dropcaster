import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpId, parseGistId, parseSketchRef } from '../src/core/modules/sketch-ref.js';

const GIST_ID = 'ea90ca3ba08ee4a229d5c616504afdf1';

test('parseOpId accepts a bare id, sketch<id>, and both OP URL shapes', () => {
  assert.equal(parseOpId('2257553'), '2257553');
  assert.equal(parseOpId('  2257553 '), '2257553');
  assert.equal(parseOpId('sketch2257553'), '2257553');
  assert.equal(parseOpId('https://openprocessing.org/sketch/2257553'), '2257553');
  assert.equal(parseOpId('https://openprocessing.org/@username/2257553'), '2257553');
});

test('parseOpId rejects non-OP input', () => {
  assert.equal(parseOpId(''), null);
  assert.equal(parseOpId('   '), null);
  assert.equal(parseOpId('not an id'), null);
  assert.equal(parseOpId(`https://gist.github.com/shinyaoguri/${GIST_ID}`), null);
});

test('parseGistId accepts a bare id and gist URLs with or without an owner', () => {
  assert.equal(parseGistId(GIST_ID), GIST_ID);
  assert.equal(parseGistId(GIST_ID.toUpperCase()), GIST_ID, 'normalized to lower case');
  assert.equal(parseGistId(`https://gist.github.com/shinyaoguri/${GIST_ID}`), GIST_ID);
  assert.equal(parseGistId(`https://gist.github.com/${GIST_ID}`), GIST_ID);
  // canvastage が出す共有 URL には revision が付くことがある
  assert.equal(parseGistId(`https://gist.github.com/shinyaoguri/${GIST_ID}/abc123`), GIST_ID);
});

test('parseGistId rejects short hex and non-gist input', () => {
  assert.equal(parseGistId('2257553'), null, 'OP ids are too short to be gist ids');
  assert.equal(parseGistId('deadbeef'), null);
  assert.equal(parseGistId('https://example.com/nope'), null);
  assert.equal(parseGistId(''), null);
});

test('parseSketchRef routes each input to the right source', () => {
  assert.deepEqual(parseSketchRef('2257553'), { source: 'op', id: '2257553' });
  assert.deepEqual(parseSketchRef('sketch2257553'), { source: 'op', id: '2257553' });
  assert.deepEqual(parseSketchRef('https://openprocessing.org/@username/2257553'), { source: 'op', id: '2257553' });
  assert.deepEqual(parseSketchRef(GIST_ID), { source: 'gist', id: GIST_ID });
  assert.deepEqual(parseSketchRef(`https://gist.github.com/shinyaoguri/${GIST_ID}`), { source: 'gist', id: GIST_ID });
  assert.equal(parseSketchRef('not an id'), null);
});

test('parseSketchRef treats an all-digit 32-char id as a gist, not an OP sketch', () => {
  // 桁数で見分ける: OP の作品 ID は 7〜8 桁で、20 桁以上にはならない
  const allDigitGist = '1'.repeat(32);
  assert.deepEqual(parseSketchRef(allDigitGist), { source: 'gist', id: allDigitGist });
});
