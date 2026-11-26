// #168: 確定した下書きは保存待ちのまま黙って失われない (ADR 0010)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftSaver, DRAFT_DEBOUNCE_MS } from '../src/viewer/practice/draftSaver.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function harness(beforeLeave) {
  const writes = [], states = [];
  const events = { window: new EventTarget(), document: Object.assign(new EventTarget(), { hidden: false }) };
  const saver = new DraftSaver(() => { const write = deferred(); writes.push(write); return write.promise; },
    state => states.push(state), beforeLeave, events);
  /** Dispatch beforeunload and report whether leaving was held for confirmation. */
  const leave = () => { const event = new Event('beforeunload', { cancelable: true }); events.window.dispatchEvent(event); return event.defaultPrevented; };
  return { saver, writes, states, events, leave };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a discrete commit starts writing in the same task and holds leaving until the write finishes', async () => {
  const { saver, writes, states, leave } = harness();
  const saved = saver.save();
  assert.equal(writes.length, 1, 'the write starts before the commit returns');
  assert.equal(saver.pending, true);
  assert.equal(leave(), true, 'leaving while writing asks first');
  writes[0].resolve(); await saved;
  assert.equal(saver.pending, false);
  assert.deepEqual(states, ['saving', 'saved']);
  assert.equal(leave(), false, 'nothing pending: leave without asking');
});

test('continuous changes write once, DRAFT_DEBOUNCE_MS after the last change', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { saver, writes, leave } = harness();
  for (let i = 0; i < 10; i++) { saver.schedule(); t.mock.timers.tick(DRAFT_DEBOUNCE_MS - 1); }
  assert.equal(writes.length, 0, 'no write while the changes keep coming');
  assert.equal(saver.pending, true);
  t.mock.timers.tick(1);
  assert.equal(writes.length, 1, 'one write when the changes stop');
  writes[0].resolve(); await settle();
  assert.equal(saver.pending, false);
  assert.equal(leave(), false);
});

test('leaving during the debounce starts the write at once and asks first', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { saver, writes, states, leave } = harness();
  saver.schedule();
  assert.equal(leave(), true);
  assert.equal(writes.length, 1, 'the waiting write starts when leaving is attempted');
  writes[0].resolve(); await settle();
  t.mock.timers.tick(DRAFT_DEBOUNCE_MS);
  assert.equal(writes.length, 1, 'the cancelled debounce does not write again');
  assert.equal(states.at(-1), 'saved', 'staying after cancelling ends saved');
});

test('the owner commits held edits before the pending check', async () => {
  let saver;
  const h = harness(() => { void saver.save(); });
  saver = h.saver;
  assert.equal(h.leave(), true, 'an edit committed by beforeLeave is pending when checked');
  assert.equal(h.writes.length, 1);
  h.writes[0].resolve(); await settle();
});

test('a failed write reports error and is no longer pending', async () => {
  const { saver, writes, states, leave } = harness();
  const saved = saver.save();
  writes[0].reject(new Error('quota'));
  await assert.rejects(saved, /quota/);
  assert.deepEqual(states, ['saving', 'error']);
  assert.equal(saver.pending, false);
  assert.equal(leave(), false, 'the error stays visible in the status; leaving is not held');
});

// #198: 連続変更の書き込みは呼び出し元が待たない。状態を error にするだけでなく、元の例外を残す。
test('a failed debounced write keeps the original error in the console', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const warn = t.mock.method(console, 'warn', () => {});
  const { saver, writes, states } = harness();
  saver.schedule(); t.mock.timers.tick(DRAFT_DEBOUNCE_MS);
  const cause = new Error('quota');
  writes[0].reject(cause); await settle();
  assert.equal(states.at(-1), 'error');
  assert.equal(warn.mock.calls.length, 1);
  const logged = /** @type {unknown[]} */ (warn.mock.calls[0].arguments);
  assert.ok(logged.includes(cause), 'the write error itself is logged');
});

test('an older write finishing late cannot report the newer commit as saved', async () => {
  const { saver, writes, states } = harness();
  const first = saver.save(), second = saver.save();
  writes[0].resolve(); await first;
  assert.equal(states.at(-1), 'saving', 'the newer commit is still being written');
  assert.equal(saver.pending, true);
  writes[1].resolve(); await second;
  assert.equal(states.at(-1), 'saved');
});

test('hiding the page or disposing starts a waiting write; dispose stops observing leaving', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { saver, writes, events, leave } = harness();
  saver.schedule(); events.document.hidden = true; events.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(writes.length, 1, 'hidden page writes now');
  writes[0].resolve(); await settle();
  saver.schedule(); saver.dispose();
  assert.equal(writes.length, 2, 'dispose writes the waiting change');
  assert.equal(leave(), false, 'a disposed saver no longer holds leaving');
  writes[1].resolve(); await settle();
});

// #286: 下書きを復元できなかった間に、持ち主が書かずに保留した変更。書かないが、離脱の前には確認する。
test('a held change writes nothing but asks before leaving until the next save', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { saver, writes, states, leave } = harness();
  saver.hold();
  assert.equal(saver.holding, true);
  assert.equal(leave(), true, 'leaving with a held change asks first');
  t.mock.timers.tick(DRAFT_DEBOUNCE_MS);
  assert.equal(writes.length, 0, 'neither holding nor leaving writes it');
  assert.deepEqual(states, [], 'the state the owner reported (the restore error) is kept');
  const saved = saver.save();
  assert.equal(saver.holding, false, 'a save takes the held change with it');
  writes[0].resolve(); await saved;
  assert.equal(leave(), false);
});
