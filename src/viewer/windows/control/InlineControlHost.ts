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
  DevCursorEvent,
  OutputBoundsMap,
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
    // 親（state の真のオーナー）へ「ローカル変更があった」と伝える。
    // applyStateFromInline は inline 自身に echo back せず、出力ウィンドウにのみ反映する。
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

  getOutputBounds(): OutputBoundsMap { return this.wc.events.outputBounds.get(); }
  onOutputBoundsChange(handler: Listener<OutputBoundsMap>): Unsubscribe {
    return this.wc.events.outputBounds.subscribe(handler);
  }

  // --- output window lifecycle ---

  openOutputWindow(outputId: string): void {
    this.wc.openOutputWindowFor(outputId);
  }
  closeOutputWindow(outputId: string): void {
    this.wc.closeOutputWindowFor(outputId);
  }

  // --- video dimensions ---

  getVideoDimensions(): VideoDimensions { return this.wc.events.videoDimensions.get(); }
  onVideoDimensionsChange(handler: Listener<VideoDimensions>): Unsubscribe {
    return this.wc.events.videoDimensions.subscribe(handler);
  }

  // --- dev mode ---

  getDevMode(): boolean { return this.wc.events.devMode.get(); }
  onDevModeChange(handler: Listener<boolean>): Unsubscribe {
    return this.wc.events.devMode.subscribe(handler);
  }
  requestDevMode(enabled: boolean): void {
    this.wc.setDevMode(enabled);
  }
  onDevCursorChange(handler: Listener<DevCursorEvent>): Unsubscribe {
    return this.wc.events.devCursor.subscribe(handler);
  }
  requestDevCursor(canvasX: number, canvasY: number, visible: boolean): void {
    this.wc.setDevCursorFromPreview(canvasX, canvasY, visible);
  }

  // --- warnings (WebGL context lost) ---

  onWebglContextChange(handler: Listener<WebglContextStatus>): Unsubscribe {
    return this.wc.events.webglContext.subscribe(handler);
  }
}
