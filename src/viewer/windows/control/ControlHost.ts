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
  /**
   * 出力ウィンドウが現在載っているディスプレイのラベル（Window Management API ベース）。
   * 例: "Built-in Retina Display", "DELL U2718Q"。
   * - getScreenDetails 未対応／権限拒否、ヘッドレス等で取れない場合は undefined。
   */
  screenLabel?: string;
  /** 内蔵ディスプレイ判定（Window Management API ベース）。未取得時は undefined。 */
  screenIsInternal?: boolean;
}

/**
 * 出力 id ごとの bounds スナップショット。出力ウィンドウが開いている分だけエントリを持つ。
 * ControlWindow は state.outputs と組み合わせて「開いていない出力」をプレースホルダで描く。
 */
export type OutputBoundsMap = Record<string, OutputBoundsSnapshot>;

export interface VideoDimensions {
  width: number;
  height: number;
}

export type WebglContextStatus = 'lost' | 'ok';

/** Unsubscribe ハンドル。listener 登録系はすべて返り値で取り消せるようにする。 */
export type Unsubscribe = () => void;

/**
 * 出力ウィンドウから通知されるマウスカーソル位置。dev mode の時だけ発火する。
 * xFrac/yFrac は出力ウィンドウ innerWidth/innerHeight に対する 0..1 の比。
 * visible=false の時はマウスがウィンドウ外に出たことを意味し、xFrac/yFrac は読まない。
 */
export interface DevCursorEvent {
  outputId: string;
  xFrac: number;
  yFrac: number;
  visible: boolean;
}

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

  // --- 出力ウィンドウの寸法・全画面状態（出力 id ごと） ---

  getOutputBounds(): OutputBoundsMap;
  onOutputBoundsChange(handler: (bounds: OutputBoundsMap) => void): Unsubscribe;

  // --- 出力ウィンドウのライフサイクル ---

  /** 指定出力のポップアウトを開く（既に開いていれば focus）。 */
  openOutputWindow(outputId: string): void;
  /** 指定出力のポップアウトを閉じる。 */
  closeOutputWindow(outputId: string): void;

  // --- ソース canvas の描画バッファ寸法 ---

  getVideoDimensions(): VideoDimensions;
  onVideoDimensionsChange(handler: (dim: VideoDimensions) => void): Unsubscribe;

  // --- 開発モード（出力ウィンドウの mapping 枠線・マウス追従クロスヘア） ---

  getDevMode(): boolean;
  onDevModeChange(handler: (enabled: boolean) => void): Unsubscribe;
  /** UI から開発モードの on/off を要求。 */
  requestDevMode(enabled: boolean): void;

  /**
   * 出力ウィンドウ側のマウス位置（dev mode 中だけ通知される）。
   * 操作ウィンドウ側のマッピングプレビューに同じ位置のクロスヘアをミラーするのに使う。
   * 「逆向き」（preview → output）の場合もここに同じ event が echo される（ハンドラから見れば
   * 両方向の cursor 更新が単一ストリームに見える）。
   */
  onDevCursorChange(handler: (e: DevCursorEvent) => void): Unsubscribe;

  /**
   * 操作ウィンドウのマッピングプレビュー側でマウスが動いた事を親に通知。
   * 親は対応する出力ウィンドウに dev-cursor-set を送ってクロスヘアを描かせ、
   * 同時に inline panel 側にも echo する（双方向同期）。
   */
  requestDevCursor(outputId: string, xFrac: number, yFrac: number, visible: boolean): void;

  // --- 一時的な警告（WebGL context lost） ---

  onWebglContextChange(handler: (status: WebglContextStatus) => void): Unsubscribe;

  /**
   * host 自身が抱える window listener や保留中の rAF を片付ける。実装によっては no-op。
   * ControlWindow.disposeHost() から呼ばれる（route 切替時など）。
   */
  dispose?(): void;
}
