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
 *   - Escape: 現在値に戻して blur
 *
 * 値の表示更新は refresh() で行う。ControlWindow から、
 *  - refreshAllFromState (= replaceState) のフローで呼ばれる
 *  - LayoutPanel の drag/resize 中の onOutputLayoutMutated callback でも呼ばれる
 * 後者は fireChange を通さない経路（in-place mutation + commit のみ）でも live 追従させるため。
 *
 * focus 中の入力欄は上書きしない（ユーザがタイプ中の値を消さない）。
 */

import { withOutputLayoutSet } from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';

type Field = 'x' | 'y' | 'w' | 'h';

export class OutputSettingsPanel {
  private scope: HTMLElement | null = null;
  private ctrl: MappingsController | null = null;

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
      return;
    }
    if (label) label.textContent = out.name ?? out.id;
    [xi, yi, wi, hi].forEach(el => { if (el) el.disabled = false; });
    setIfNotFocused(xi, String(Math.round(out.position.x)));
    setIfNotFocused(yi, String(Math.round(out.position.y)));
    setIfNotFocused(wi, String(Math.round(out.size.width)));
    setIfNotFocused(hi, String(Math.round(out.size.height)));
  }

  destroy(): void {
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
  }

  private bind(input: HTMLInputElement | null, field: Field): void {
    if (!input) return;
    input.addEventListener('change', () => this.commit(input, field));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.refresh(); input.blur(); }
    });
  }

  private commit(input: HTMLInputElement, field: Field): void {
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
