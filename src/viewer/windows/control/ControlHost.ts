/**
 * ControlWindow（マッピング操作 UI）が、自分の置かれている環境から状態を読み取り
 * 変更を通知するための seam。実装は InlineControlHost のみ（main 内ペインとして
 * mount された ControlWindow が、同一プロセスの WindowController.events を購読／呼び出す）。
 */

import type { TestPatternKind } from '../../runtime/TestPatternSource';
import type { MappingsState } from '../../utils/mappingTransform';
// MediaStream の bind は WindowController がホスト要素配下の <video> を id で見つけて
// 直接 srcObject に差すので、ControlHost には stream API を持たせない（ホスト側の責務外）。

export type TestPatternKindOrOff = TestPatternKind | 'off';

export interface OutputBoundsSnapshot {
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  isFullscreen: boolean;
}

export interface VideoDimensions {
  width: number;
  height: number;
}

export type WebglContextStatus = 'lost' | 'ok';

/** Unsubscribe ハンドル。listener 登録系はすべて返り値で取り消せるようにする。 */
export type Unsubscribe = () => void;

/**
 * ControlHost: マッピング操作 UI（mapping list, source crop, quad handles, test pattern, ...）が
 * 依存する「外の世界」をまとめた口。すべてのインタラクションはこのインターフェース経由で行うこと。
 *
 * いまの唯一の実装は InlineControlHost — main 内ペインの ControlWindow が、同一プロセスの
 * WindowController を直接呼ぶ／events.* を購読する。
 */
export interface ControlHost {
  /** パネルが DOM を生やすホスト要素（メインの dc-editor 領域）。 */
  readonly host: HTMLElement;
  /** host が属する Window（rAF・タイマー登録のスコープ）。 */
  readonly window: Window;

  // --- canonical state（mappings + activeId）の購読・変更 ---

  /** 現在の canonical state のスナップショット（ControlHost の実装が最新値を保持する）。 */
  getState(): MappingsState;
  /** 親側で正規化された state が push されたときに発火（state-update 相当）。 */
  onStateChange(handler: (state: MappingsState) => void): Unsubscribe;
  /** UI 上のローカル mutation を親へ通知（state-mutation 相当。連続発火は実装側で間引かれる）。 */
  emitStateMutation(state: MappingsState): void;

  // --- テストパターン ---

  getTestPatternKind(): TestPatternKindOrOff;
  onTestPatternChange(handler: (kind: TestPatternKindOrOff) => void): Unsubscribe;
  /** ユーザ操作で別パターンへ切替を要求（test-pattern-set 相当）。 */
  requestTestPattern(kind: TestPatternKindOrOff): void;

  // --- 出力ウィンドウの寸法・全画面状態 ---

  getOutputBounds(): OutputBoundsSnapshot;
  onOutputBoundsChange(handler: (bounds: OutputBoundsSnapshot) => void): Unsubscribe;

  // --- ソース canvas の描画バッファ寸法 ---

  getVideoDimensions(): VideoDimensions;
  onVideoDimensionsChange(handler: (dim: VideoDimensions) => void): Unsubscribe;

  // --- 一時的な警告（WebGL context lost） ---

  onWebglContextChange(handler: (status: WebglContextStatus) => void): Unsubscribe;

  /**
   * host 自身が抱える window listener や保留中の rAF を片付ける。実装によっては no-op。
   * ControlWindow.disposeHost() から呼ばれる（route 切替時など）。
   */
  dispose?(): void;
}
