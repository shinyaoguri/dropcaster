import test from 'node:test';
import assert from 'node:assert/strict';
import { HeldKeys, toSketchKey } from '../src/viewer/utils/sketchKeys.ts';

/** KeyboardEvent と同じ名前のプロパティだけを持つ入力。Node には KeyboardEvent が無いので形だけ真似る。 */
function keyEvent(type, key, code, which, extra = {}) {
  return {
    type, key, code, keyCode: which, which, charCode: 0, location: 0, repeat: false,
    ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, isComposing: false, ...extra,
  };
}

test('toSketchKey は作品へ渡すのに必要な値だけを写し取る', () => {
  const source = { ...keyEvent('keydown', 'A', 'KeyA', 65, { shiftKey: true, repeat: true, location: 1 }), target: {}, timeStamp: 12 };
  assert.deepEqual(toSketchKey(source), {
    type: 'keydown', key: 'A', code: 'KeyA', keyCode: 65, which: 65, charCode: 0, location: 1, repeat: true,
    ctrlKey: false, shiftKey: true, altKey: false, metaKey: false, isComposing: false,
  });
});

test('HeldKeys は押しているキーだけを code 単位で覚え、releaseAll で keyup を返して空になる', () => {
  const held = new HeldKeys();
  assert.equal(held.accept(toSketchKey(keyEvent('keydown', 'a', 'KeyA', 65))), true);
  assert.equal(held.accept(toSketchKey(keyEvent('keydown', 'a', 'KeyA', 65, { repeat: true }))), true, 'リピートも送る');
  held.accept(toSketchKey(keyEvent('keydown', ' ', 'Space', 32)));
  held.accept(toSketchKey(keyEvent('keydown', '2', 'Digit2', 50)));
  assert.equal(held.accept(toSketchKey(keyEvent('keyup', '2', 'Digit2', 50))), true);
  assert.equal(held.accept(toSketchKey(keyEvent('keypress', 'a', 'KeyA', 97))), true, 'keypress は送るが押下状態は変えない');

  const released = held.releaseAll();
  assert.deepEqual(released.map(k => [k.type, k.code, k.which, k.repeat]), [
    ['keyup', 'KeyA', 65, false],
    ['keyup', 'Space', 32, false],
  ]);
  assert.deepEqual(held.releaseAll(), [], '一度離したら空');
  assert.equal(held.accept(toSketchKey(keyEvent('keyup', 'a', 'KeyA', 65))), false, '離し済みのキーの keyup は送らない');
});

test('HeldKeys は keydown を送っていないキーの keyup を送らない', () => {
  const held = new HeldKeys();
  assert.equal(held.accept(toSketchKey(keyEvent('keyup', 'Enter', 'Enter', 13))), false);
});

test('HeldKeys は code が空のキーを key で区別する', () => {
  const held = new HeldKeys();
  held.accept(toSketchKey(keyEvent('keydown', 'x', '', 88)));
  held.accept(toSketchKey(keyEvent('keydown', 'y', '', 89)));
  assert.equal(held.accept(toSketchKey(keyEvent('keyup', 'x', '', 88))), true);
  assert.deepEqual(held.releaseAll().map(k => k.key), ['y']);
});
