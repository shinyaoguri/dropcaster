import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mappingDisplayNames } from '../src/viewer/utils/mappingTransform.ts';

// 一覧とソースカラムの枠ラベルは同じ表示名を出す (#187)。
// name が無い項目は kind ごとの通し番号で呼ぶ。

const quad = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } };
const source = { x: 0, y: 0, width: 100, height: 100 };
const mapping = (id, name) => ({ id, ...(name ? { name } : {}), source, quad });
const mask = (id, name) => ({ kind: /** @type {const} */ ('mask'), id, ...(name ? { name } : {}), points: [] });

test('mapping と mask はそれぞれ独立した通し番号になる', () => {
  assert.deepEqual(
    mappingDisplayNames([mapping('a'), mask('b'), mapping('c'), mask('d')]),
    ['Mapping 1', 'Mask 1', 'Mapping 2', 'Mask 2'],
  );
});

test('name があればそれを使い、通し番号は名前付きの項目も数える', () => {
  assert.deepEqual(
    mappingDisplayNames([mapping('a', '左壁'), mapping('b'), mask('c', '柱')]),
    ['左壁', 'Mapping 2', '柱'],
  );
});

test('空配列なら空', () => {
  assert.deepEqual(mappingDisplayNames([]), []);
});
