/**
 * ツール列の「出力設定」セクション — アクティブな出力（activeOutputId or outputs[0]）の
 * position / size を数値で表示・編集する panel。
 *
 * テンプレに既にある以下の DOM を wire するだけで自前 DOM は持たない:
 *   - #output-settings-target  — 対象出力名の <span>
 *   - #output-{x,y,w,h}-input  — 4 つの <input type="number">
 *
 * 入力欄の change / Enter / Escape:
 *   - change（blur 含む）: withOutputLayoutSet で state を更新（fireChange → 全体追従）
 *   - Enter: blur を発火させて change を経由
 *   - Escape: 確定済みの値に戻して blur（その blur の change は commit しない = 取消）
 *
 * 明るさ・色のゲイン (#199): #output-correction-{brightness,r,g,b}-{range,input} と
 * #output-correction-reset。スライダーは押してから離すまでを beginGesture / endGesture で囲み、
 * ドラッグ 1 回を Undo 1 件にする。数値欄は位置・サイズと同じく change で確定、Escape で取消。
 *
 * 値の表示更新は refresh() で行う。ControlWindow から、
 *  - refreshAllFromState (= replaceState) のフローで呼ばれる
 *  - LayoutPanel の drag/resize 中の onOutputLayoutMutated callback でも呼ばれる
 * 後者は fireChange を通さない経路（in-place mutation + commit のみ）でも live 追従させるため。
 *
 * focus 中の入力欄は上書きしない（ユーザがタイプ中の値を消さない）。
 */

import {
  identityOutputCorrection,
  OUTPUT_CORRECTION_KEYS,
  withOutputCorrectionSet,
  withOutputLayoutSet,
  type OutputCorrectionKey,
} from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';

type Field = 'x' | 'y' | 'w' | 'h';

export class OutputSettingsPanel {
  private scope: HTMLElement | null = null;
  private ctrl: MappingsController | null = null;
  /** Escape の取消で blur している間。その blur で飛ぶ change を commit させない。 */
  private cancelling = false;
  /** スライダーのドラッグ中 (beginGesture 済み)。離したときの後始末。 */
  private endCorrectionGesture: (() => void) | null = null;

  attach(scope: HTMLElement, ctrl: MappingsController): void {
    this.scope = scope;
    this.ctrl = ctrl;
    this.wireInputs();
    this.refresh();
  }

  /** 現在の state を入力欄に書き戻す。focus 中のフィールドはスキップ。 */
  refresh(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    if (!scope || !ctrl) return;
    const targetId = this.activeOutputId();
    const state = ctrl.getState();
    const out = targetId ? state.outputs.find(o => o.id === targetId) : undefined;
    const label = scope.querySelector('#output-settings-target');
    const xi = scope.querySelector<HTMLInputElement>('#output-x-input');
    const yi = scope.querySelector<HTMLInputElement>('#output-y-input');
    const wi = scope.querySelector<HTMLInputElement>('#output-w-input');
    const hi = scope.querySelector<HTMLInputElement>('#output-h-input');
    const activeEl = scope.ownerDocument?.activeElement;
    const setIfNotFocused = (el: HTMLInputElement | null, value: string) => {
      if (!el || el === activeEl) return;
      el.value = value;
    };
    if (!out) {
      if (label) label.textContent = '—';
      [xi, yi, wi, hi].forEach(el => { if (el) { el.disabled = true; el.value = ''; } });
      scope.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-correction], #output-correction-reset')
        .forEach(el => { el.disabled = true; });
      return;
    }
    if (label) label.textContent = out.name ?? out.id;
    [xi, yi, wi, hi].forEach(el => { if (el) el.disabled = false; });
    setIfNotFocused(xi, String(Math.round(out.position.x)));
    setIfNotFocused(yi, String(Math.round(out.position.y)));
    setIfNotFocused(wi, String(Math.round(out.size.width)));
    setIfNotFocused(hi, String(Math.round(out.size.height)));
    const correction = out.correction ?? identityOutputCorrection();
    for (const key of OUTPUT_CORRECTION_KEYS) {
      const range = scope.querySelector<HTMLInputElement>(`#output-correction-${key}-range`);
      const num = scope.querySelector<HTMLInputElement>(`#output-correction-${key}-input`);
      if (range) { range.disabled = false; range.value = String(correction[key]); }
      if (num) num.disabled = false;
      setIfNotFocused(num, formatGain(correction[key]));
    }
    const reset = scope.querySelector<HTMLButtonElement>('#output-correction-reset');
    if (reset) reset.disabled = !out.correction;
  }

  destroy(): void {
    this.endCorrectionGesture?.();
    // listener は <input> 要素に直接付いており、scope ごと outerHTML 置換で消えるため
    // 明示的な off は不要。参照だけ落とす。
    this.scope = null;
    this.ctrl = null;
  }

  // ── internals ───────────────────────────────────────────────

  private wireInputs(): void {
    const scope = this.scope;
    if (!scope) return;
    this.bind(scope.querySelector<HTMLInputElement>('#output-x-input'), 'x');
    this.bind(scope.querySelector<HTMLInputElement>('#output-y-input'), 'y');
    this.bind(scope.querySelector<HTMLInputElement>('#output-w-input'), 'w');
    this.bind(scope.querySelector<HTMLInputElement>('#output-h-input'), 'h');
    for (const key of OUTPUT_CORRECTION_KEYS) {
      this.bindCorrectionRange(scope.querySelector<HTMLInputElement>(`#output-correction-${key}-range`), key);
      this.bindCorrectionInput(scope.querySelector<HTMLInputElement>(`#output-correction-${key}-input`), key);
    }
    scope.querySelector<HTMLButtonElement>('#output-correction-reset')?.addEventListener('click', () => {
      const ctrl = this.ctrl;
      const target = this.activeOutputId();
      if (!ctrl || !target) return;
      ctrl.replaceState(withOutputCorrectionSet(ctrl.getState(), target, undefined));
    });
  }

  /**
   * スライダー。押してから離すまで (pointerup / pointercancel / change の早いほう) を 1 ジェスチャにし、
   * その間の input は出力へ即時に反映しつつ履歴は 1 件にまとめる。キーボードの操作は 1 段ごとに 1 件。
   */
  private bindCorrectionRange(input: HTMLInputElement | null, key: OutputCorrectionKey): void {
    if (!input) return;
    input.addEventListener('pointerdown', () => {
      const ctrl = this.ctrl;
      if (!ctrl || this.endCorrectionGesture) return;
      const view = input.ownerDocument.defaultView;
      ctrl.beginGesture();
      const end = () => {
        if (this.endCorrectionGesture !== end) return;
        this.endCorrectionGesture = null;
        view?.removeEventListener('pointerup', end, true);
        view?.removeEventListener('pointercancel', end, true);
        input.removeEventListener('change', end);
        ctrl.endGesture();
        this.refresh();
      };
      this.endCorrectionGesture = end;
      view?.addEventListener('pointerup', end, true);
      view?.addEventListener('pointercancel', end, true);
      input.addEventListener('change', end);
    });
    input.addEventListener('input', () => this.commitCorrection(key, parseFloat(input.value)));
  }

  private bindCorrectionInput(input: HTMLInputElement | null, key: OutputCorrectionKey): void {
    if (!input) return;
    input.addEventListener('change', () => {
      if (this.cancelling) return;
      const raw = parseFloat(input.value);
      if (!Number.isFinite(raw)) { this.refresh(); return; }
      this.commitCorrection(key, raw);
      // 範囲外を丸めたときも、確定した値を欄に出す (blur 済みなので refresh が書く)。
      this.refresh();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        const out = this.activeOutput();
        if (out) input.value = formatGain((out.correction ?? identityOutputCorrection())[key]);
        this.cancelling = true;
        try { input.blur(); } finally { this.cancelling = false; }
      }
    });
  }

  /** 対象出力の補正の 1 項目を変える。値が変わらなければ何もしない (履歴を積まない)。 */
  private commitCorrection(key: OutputCorrectionKey, value: number): void {
    const ctrl = this.ctrl;
    const target = this.activeOutputId();
    if (!ctrl || !target || !Number.isFinite(value)) return;
    const cur = ctrl.getState();
    const out = cur.outputs.find(o => o.id === target);
    if (!out) return;
    const base = out.correction ?? identityOutputCorrection();
    const next = withOutputCorrectionSet(cur, target, { ...base, [key]: value });
    const after = next.outputs.find(o => o.id === target)?.correction ?? identityOutputCorrection();
    if (OUTPUT_CORRECTION_KEYS.every(k => after[k] === base[k])) return;
    ctrl.replaceState(next);
  }

  private activeOutput() {
    const target = this.activeOutputId();
    return target ? this.ctrl?.getState().outputs.find(o => o.id === target) : undefined;
  }

  private bind(input: HTMLInputElement | null, field: Field): void {
    if (!input) return;
    input.addEventListener('change', () => this.commit(input, field));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancel(input, field); }
    });
  }

  /**
   * 編集を取り消す。refresh() は focus 中の欄を書き換えないので、確定済みの値をこの欄へ
   * 明示的に書き戻してから blur する。Chromium はスクリプトで書き戻した欄の blur で change を
   * 出さないが、出す実装でも commit させない (ドラッグ由来の小数値を丸めた表示値で上書きしたり、
   * 取消で履歴を積んだりしないため)。
   */
  private cancel(input: HTMLInputElement, field: Field): void {
    const value = this.committedValue(field);
    if (value !== undefined) input.value = value;
    this.cancelling = true;
    try { input.blur(); } finally { this.cancelling = false; }
  }

  /** 対象出力の確定済みの値 (入力欄の表示形式)。対象が無ければ undefined。 */
  private committedValue(field: Field): string | undefined {
    const ctrl = this.ctrl;
    const target = this.activeOutputId();
    const out = target ? ctrl?.getState().outputs.find(o => o.id === target) : undefined;
    if (!out) return undefined;
    const raw = field === 'x' ? out.position.x : field === 'y' ? out.position.y : field === 'w' ? out.size.width : out.size.height;
    return String(Math.round(raw));
  }

  private commit(input: HTMLInputElement, field: Field): void {
    if (this.cancelling) return;
    const ctrl = this.ctrl;
    if (!ctrl) return;
    const target = this.activeOutputId();
    if (!target) return;
    const raw = parseFloat(input.value);
    if (!Number.isFinite(raw)) {
      this.refresh();
      return;
    }
    const cur = ctrl.getState();
    const out = cur.outputs.find(o => o.id === target);
    if (!out) return;
    const patch = (() => {
      if (field === 'x') return { position: { x: raw, y: out.position.y } };
      if (field === 'y') return { position: { x: out.position.x, y: raw } };
      if (field === 'w') return { size: { width: raw, height: out.size.height } };
      return { size: { width: out.size.width, height: raw } };
    })();
    ctrl.replaceState(withOutputLayoutSet(cur, target, patch));
  }

  /** 対象出力 id: activeOutputId を優先、無効 / 未設定なら outputs[0]。 */
  private activeOutputId(): string | undefined {
    const ctrl = this.ctrl;
    if (!ctrl) return undefined;
    const state = ctrl.getState();
    if (state.activeOutputId && state.outputs.some(o => o.id === state.activeOutputId)) {
      return state.activeOutputId;
    }
    return state.outputs[0]?.id;
  }
}

/** ゲインの表示 (小数 2 桁まで、末尾の 0 は落とす)。 */
function formatGain(value: number): string {
  return String(Math.round(value * 100) / 100);
}
