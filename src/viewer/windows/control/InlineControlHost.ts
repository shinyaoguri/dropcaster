/**
 * main 内ペインへインライン配置された ControlWindow が依存する ControlHost 実装（唯一の実装）。
 *
 * 同一プロセスで動く WindowController を直接呼ぶ／購読する。state の真の保持者は
 * WindowController なので、このクラスは「pass-through なルータ」に近い:
 *
 *   - state-mutation 系（emitStateMutation / requestTestPattern）→ WindowController のメソッド呼び出し
 *   - state-update 系（onStateChange / onTestPatternChange / …）→ WindowController.events.* を購読
 */

import { type MappingsState } from '../../utils/mappingTransform';
import type {
  ControlHost,
  OutputBoundsSnapshot,
  TestPatternKindOrOff,
  Unsubscribe,
  VideoDimensions,
  WebglContextStatus,
} from './ControlHost';
import type { Listener } from '../../utils/emitter';
import type { WindowController } from '../../components/WindowController';

export class InlineControlHost implements ControlHost {
  readonly host: HTMLElement;
  readonly window: Window;
  private wc: WindowController;

  constructor(win: Window, host: HTMLElement, wc: WindowController) {
    this.window = win;
    this.host = host;
    this.wc = wc;
  }

  // --- state ---

  getState(): MappingsState { return this.wc.events.state.get(); }
  onStateChange(handler: Listener<MappingsState>): Unsubscribe {
    return this.wc.events.state.subscribe(handler);
  }
  emitStateMutation(state: MappingsState): void {
    // popout 版と同じく親（state の真のオーナー）へ「ローカル変更があった」と伝える。
    // WindowController.applyStateFromInline は broadcast の方向を制御する（自身が起点なので
    // inline 自身に echo back せず、popout と output にのみ反映する）。
    this.wc.applyStateFromInline(state);
  }

  // --- test pattern ---

  getTestPatternKind(): TestPatternKindOrOff { return this.wc.events.testPattern.get(); }
  onTestPatternChange(handler: Listener<TestPatternKindOrOff>): Unsubscribe {
    return this.wc.events.testPattern.subscribe(handler);
  }
  requestTestPattern(kind: TestPatternKindOrOff): void {
    this.wc.setTestPattern(kind);
  }

  // --- output bounds ---

  getOutputBounds(): OutputBoundsSnapshot { return this.wc.events.outputBounds.get(); }
  onOutputBoundsChange(handler: Listener<OutputBoundsSnapshot>): Unsubscribe {
    return this.wc.events.outputBounds.subscribe(handler);
  }

  // --- video dimensions ---

  getVideoDimensions(): VideoDimensions { return this.wc.events.videoDimensions.get(); }
  onVideoDimensionsChange(handler: Listener<VideoDimensions>): Unsubscribe {
    return this.wc.events.videoDimensions.subscribe(handler);
  }

  // --- warnings (B / E) ---

  onSourceVisibilityChange(handler: Listener<boolean>): Unsubscribe {
    return this.wc.events.sourceVisibility.subscribe(handler);
  }
  onWebglContextChange(handler: Listener<WebglContextStatus>): Unsubscribe {
    return this.wc.events.webglContext.subscribe(handler);
  }
}
