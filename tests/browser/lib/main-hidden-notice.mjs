// #185: メイン画面が隠れて映像が止まったことを、出力ウィンドウの操作 UI と同じ規則で知らせる。
// 出力 (会場の校正ウィンドウを含む) でマウスを動かしている間だけ案内が出て、操作が止まると
// dc-idle で消え、メイン画面が見える状態に戻ると出なくなることを確かめる。
import assert from 'node:assert/strict';

export const MAIN_HIDDEN_TEXT = {
  en: [/main window is hidden/, /own window/, /bring the main window to the front/],
  ja: [/メイン画面が隠れているため映像が止まっています/, /ウィンドウとして切り離す/, /メイン画面を前に出して/],
};

/**
 * メイン画面の visibilityState を切り替え、ブラウザと同じく document へ visibilitychange を送る。
 * Playwright の Chromium は自動化中のページを visible に保つため (focus emulation)、
 * 出力を同じウィンドウのタブとして前面に出しても、ウィンドウを最小化しても hidden にならない
 * (headless shell / new headless / headed のいずれでも確認)。観測できる変化だけを再現する。
 */
export async function setMainVisibility(main, state) {
  await main.evaluate(state => {
    if (state === 'visible') {
      delete document.visibilityState;
      delete document.hidden;
    } else {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

function readNotice(output) {
  return output.evaluate(() => {
    const stage = document.getElementById('dc-output-stage');
    const el = document.getElementById('dc-output-main-hidden');
    const style = el ? getComputedStyle(el) : null;
    return {
      exists: !!el,
      display: style?.display ?? 'none',
      opacity: style?.opacity ?? '0',
      text: el?.textContent.trim() ?? '',
      idle: !!stage?.classList.contains('dc-idle'),
    };
  });
}

/** 案内が「見えている (表示されて不透明)」/「見えていない」状態に落ち着くまで待ち、その状態を返す。 */
async function waitNotice(output, shown, label, timeout = 3000) {
  const until = Date.now() + timeout;
  let state;
  for (;;) {
    state = await readNotice(output);
    const visible = state.display !== 'none' && state.opacity === '1';
    const gone = state.display === 'none' || state.opacity === '0';
    if (shown ? visible : gone) return state;
    if (Date.now() > until) break;
    await output.waitForTimeout(50);
  }
  assert.fail(`${label}: notice ${shown ? 'shown' : 'not shown'} expected, got ${JSON.stringify(state)}`);
}

let step = 0;
/** 出力ウィンドウでマウスを動かす (毎回位置を変えて mousemove を確実に起こす)。 */
async function wiggle(output) {
  const size = output.viewportSize() ?? { width: 600, height: 400 };
  step = (step + 1) % 20;
  await output.mouse.move(size.width / 3 + step * 5, size.height / 3 + step * 3);
}

/**
 * main が開いた output について、#185 の表示条件を一通り確かめる。
 * 呼び出し時にメイン画面は visible、終了時も visible に戻す。
 */
export async function checkMainHiddenNotice(main, output, { lang, label }) {
  const text = MAIN_HIDDEN_TEXT[lang];
  // メイン画面が見えている間は、操作中でも案内は出ない。
  await wiggle(output);
  let state = await waitNotice(output, false, `${label}: main visible while operating`, 500);
  assert.equal(state.idle, false, `${label}: operator UI is active while the mouse moves`);

  // メイン画面が隠れたら、マウスを動かしている間だけ原因と対処が出る。
  await setMainVisibility(main, 'hidden');
  await wiggle(output);
  state = await waitNotice(output, true, `${label}: main hidden while operating`);
  for (const pattern of text) assert.match(state.text, pattern, `${label}: ${lang} notice text`);

  // 操作が止まると、ほかの操作 UI と一緒に消える。
  await output.waitForFunction(() => document.getElementById('dc-output-stage').classList.contains('dc-idle'), null, { timeout: 5000 });
  await waitNotice(output, false, `${label}: idle hides the notice`);
  await wiggle(output);
  await waitNotice(output, true, `${label}: moving again shows the notice`);

  // メイン画面が見える状態に戻ると、操作中でも消え、動かし続けても出ない。
  await setMainVisibility(main, 'visible');
  state = await waitNotice(output, false, `${label}: main visible again`, 1000);
  assert.equal(state.idle, false, `${label}: notice left while the operator UI is still active`);
  await wiggle(output);
  await waitNotice(output, false, `${label}: main visible again while operating`, 500);
}
