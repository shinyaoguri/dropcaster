/**
 * panel から state を読み書きするための薄い seam。
 *
 * Step 5 時点では実装は ControlWindow の参照を「ぐるっとラップ」しているだけで、
 * state の真のオーナーは依然 ControlWindow（および親 = WindowController）。
 * 段階的に panel が増えるたびに API を増やし、Step 9（オプション）でこのクラスが
 * state を本当に所有するように昇格する想定。
 *
 * 設計方針:
 *   - active mapping の source / quad は同一参照（alias）を保持する。panel は
 *     `mutateActiveSource(fn => { fn.x = ... })` のように in-place で書き換える。
 *   - active 切替・差し替え（replace）が起きると参照は無効になるが、ControlWindow
 *     側で rebindActiveAliases() が走るので、panel 側は次の get〜 で最新値が取れる。
 *   - commit() は親（WindowController）へ「ローカル変更があった」と broadcast する。
 */

import type { Quad, SourceRect, MappingsState } from '../../utils/mappingTransform';

export interface MappingsControllerOps {
  getState: () => MappingsState;
  getActiveSource: () => SourceRect;
  getActiveQuad: () => Quad;
  setActiveQuad: (quad: Quad) => void;
  replaceState: (next: MappingsState) => void;
  commit: () => void;
}

export class MappingsController {
  private ops: MappingsControllerOps;

  constructor(ops: MappingsControllerOps) {
    this.ops = ops;
  }

  getState(): MappingsState { return this.ops.getState(); }
  getActiveSource(): SourceRect { return this.ops.getActiveSource(); }
  getActiveQuad(): Quad { return this.ops.getActiveQuad(); }

  /** active quad をまるごと差し替える（alias も貼り直される）。 */
  setActiveQuad(quad: Quad): void { this.ops.setActiveQuad(quad); }

  /** active source を in-place で mutate する（同一参照のまま中身を書き換える）。 */
  mutateActiveSource(fn: (source: SourceRect) => void): void {
    fn(this.ops.getActiveSource());
  }

  /** state を programmatic に置き換える（active 切替・追加・削除・rename・import など）。 */
  replaceState(next: MappingsState): void { this.ops.replaceState(next); }

  /** ローカル mutation を親へ broadcast。 */
  commit(): void { this.ops.commit(); }
}
