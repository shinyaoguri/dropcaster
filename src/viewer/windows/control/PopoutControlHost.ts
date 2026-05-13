/**
 * popout 環境向けの ControlHost 実装。
 *
 * 元 ControlWindow が直接やっていた:
 *   - `this.window.addEventListener('message', ...)` での親からの state-update 受信
 *   - `getParentWindow().postMessage({ type: 'state-mutation', ... })` での親への通知
 *   - rAF コアレスでの state-mutation 連打抑制
 *   - 各種状態（mappings / test pattern kind / output bounds / video dimensions）の mirror 保持
 * をここに閉じ込める。ControlWindow 側は ControlHost のメソッドだけを呼ぶ。
 *
 * このクラスが「popout であることに依存している部分」の唯一の置き場所。
 * main 内ペインへの移植時は同じインターフェース（ControlHost）を満たす InlineControlHost を
 * 別に用意するだけで、UI 側のコードを変えずに置き換えられる。
 */

import {
  defaultMappingsState,
  type MappingsState,
} from '../../utils/mappingTransform';
import type {
  ControlHost,
  OutputBoundsSnapshot,
  TestPatternKindOrOff,
  Unsubscribe,
  VideoDimensions,
  WebglContextStatus,
} from './ControlHost';
import { Emitter, type Listener } from '../../utils/emitter';

const DEFAULT_BOUNDS: OutputBoundsSnapshot = {
  innerWidth: 0,
  innerHeight: 0,
  screenWidth: 0,
  screenHeight: 0,
  isFullscreen: false,
};

const DEFAULT_DIMENSIONS: VideoDimensions = { width: 1, height: 1 };

export class PopoutControlHost implements ControlHost {
  readonly host: HTMLElement;
  readonly window: Window;

  private parent: Window | null;
  private readonly state = new Emitter<MappingsState>(defaultMappingsState());
  private readonly testPattern = new Emitter<TestPatternKindOrOff>('off');
  private readonly bounds = new Emitter<OutputBoundsSnapshot>(DEFAULT_BOUNDS);
  private readonly dimensions = new Emitter<VideoDimensions>(DEFAULT_DIMENSIONS);
  private readonly sourceHidden = new Emitter<boolean>(false);
  private readonly webgl = new Emitter<WebglContextStatus>('ok');

  /** state-mutation 連打を 1 frame に 1 回へ間引くための rAF id。 */
  private mutationRafId: number | null = null;

  private readonly onMessage = (event: MessageEvent) => this.handleMessage(event);
  private readonly onPageHide = () => this.flushPendingMutation();

  /**
   * @param popoutWindow popout の Window
   * @param host 旧 ControlWindow の content（control-container）を生やす要素。
   *             多くの場合 popout の body そのもの。
   * @param parent state-mutation / test-pattern-set を投げる先の親 Window
   *               （`opener` または明示渡し）。null のときは送信は no-op。
   */
  constructor(popoutWindow: Window, host: HTMLElement, parent: Window | null) {
    this.window = popoutWindow;
    this.host = host;
    this.parent = parent;
    this.window.addEventListener('message', this.onMessage);
    this.window.addEventListener('pagehide', this.onPageHide);
  }

  /** 親 Window の参照を後から差し替える（popout が再オープンされたケース等）。 */
  setParent(parent: Window | null): void {
    this.parent = parent;
  }

  /** 後片付け。リスナを外し、保留中の mutation があれば確定して送る。 */
  dispose(): void {
    this.window.removeEventListener('message', this.onMessage);
    this.window.removeEventListener('pagehide', this.onPageHide);
    this.flushPendingMutation();
    if (this.mutationRafId !== null) {
      this.window.cancelAnimationFrame(this.mutationRafId);
      this.mutationRafId = null;
    }
  }

  // --- ControlHost: state ---

  getState(): MappingsState { return this.state.get(); }
  onStateChange(handler: Listener<MappingsState>): Unsubscribe { return this.state.subscribe(handler); }
  emitStateMutation(state: MappingsState): void {
    // 連続呼び出しを 1 frame に 1 回に集約。送信は次フレームに最新値を 1 回だけ。
    this.state.set(state); // 内部 mirror は即時更新（次の getState は新値を返す）
    if (this.mutationRafId !== null) return;
    this.mutationRafId = this.window.requestAnimationFrame(() => {
      this.mutationRafId = null;
      this.postToParent({ type: 'state-mutation', data: this.state.get() });
    });
  }

  // --- ControlHost: test pattern ---

  getTestPatternKind(): TestPatternKindOrOff { return this.testPattern.get(); }
  onTestPatternChange(handler: Listener<TestPatternKindOrOff>): Unsubscribe {
    return this.testPattern.subscribe(handler);
  }
  requestTestPattern(kind: TestPatternKindOrOff): void {
    // optimistic: ローカルにも即時反映（親からの test-pattern-update で確定）
    this.testPattern.set(kind);
    this.postToParent({ type: 'test-pattern-set', data: { kind } });
  }

  // --- ControlHost: output bounds ---

  getOutputBounds(): OutputBoundsSnapshot { return this.bounds.get(); }
  onOutputBoundsChange(handler: Listener<OutputBoundsSnapshot>): Unsubscribe {
    return this.bounds.subscribe(handler);
  }

  // --- ControlHost: video dimensions ---

  getVideoDimensions(): VideoDimensions { return this.dimensions.get(); }
  onVideoDimensionsChange(handler: Listener<VideoDimensions>): Unsubscribe {
    return this.dimensions.subscribe(handler);
  }

  // --- ControlHost: warnings (B / E) ---

  onSourceVisibilityChange(handler: Listener<boolean>): Unsubscribe {
    return this.sourceHidden.subscribe(handler);
  }
  onWebglContextChange(handler: Listener<WebglContextStatus>): Unsubscribe {
    return this.webgl.subscribe(handler);
  }

  // --- 内部 ---

  private flushPendingMutation(): void {
    if (this.mutationRafId === null) return;
    this.window.cancelAnimationFrame(this.mutationRafId);
    this.mutationRafId = null;
    this.postToParent({ type: 'state-mutation', data: this.state.get() });
  }

  private postToParent(payload: { type: string; data?: unknown }): void {
    if (!this.parent || this.parent.closed) return;
    try {
      // targetOrigin '*' は意図的：popout は about:blank で origin が 'null' になり得る。
      // 受信側（WindowController.messageHandler）が event.origin を検証している。
      this.parent.postMessage(payload, '*');
    } catch (error) {
      console.error('PopoutControlHost: postMessage 失敗', error);
    }
  }

  private handleMessage(event: MessageEvent): void {
    // 親（opener）から以外は無視。origin 比較は about:blank で壊れることがあるので source で。
    if (this.parent && event.source !== this.parent) return;
    if (this.parent && event.origin !== this.parent.location.origin) return;

    const data = event.data as { type?: string; data?: unknown } | undefined;
    if (!data || typeof data.type !== 'string') return;
    switch (data.type) {
      case 'state-update': {
        const next = data.data as MappingsState | undefined;
        if (next && Array.isArray(next.mappings) && next.mappings.length > 0) {
          this.state.set(next);
        }
        break;
      }
      case 'video-dimensions-update':
        this.dimensions.set(data.data as VideoDimensions);
        break;
      case 'output-dimensions-update': {
        const d = data.data as Partial<OutputBoundsSnapshot> | undefined;
        if (!d) return;
        this.bounds.set({
          innerWidth: Number(d.innerWidth) || 0,
          innerHeight: Number(d.innerHeight) || 0,
          screenWidth: Number(d.screenWidth) || 0,
          screenHeight: Number(d.screenHeight) || 0,
          isFullscreen: !!d.isFullscreen,
        });
        break;
      }
      case 'test-pattern-update': {
        const kind = (data.data as { kind?: TestPatternKindOrOff } | undefined)?.kind;
        if (kind) this.testPattern.set(kind);
        break;
      }
      case 'source-visibility-update':
        this.sourceHidden.set(!!(data.data as { hidden?: boolean } | undefined)?.hidden);
        break;
      case 'webgl-context-update': {
        const status = (data.data as { status?: WebglContextStatus } | undefined)?.status;
        if (status === 'lost' || status === 'ok') this.webgl.set(status);
        break;
      }
    }
  }
}
