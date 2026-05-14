/**
 * ControlWindow の CSS 本体。
 *
 * `@scope (.dc-control-shell) { ... }` の中身に展開される。BaseWindow.getStyles() の
 * generic ルール（h1, button, .window-container 等）も同じ @scope 内に置かれるので
 * main 側の同名要素には影響しない。ラップは ControlWindow.getStyles() が担当する。
 */
export const CONTROL_PANEL_CSS = `
      /* ソースウィンドウが hidden になったときの警告バナー（B 対応） */
      .dc-banner {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: #b91c1c;
        color: #fff;
        font-size: 13px;
        line-height: 1.4;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      }
      .dc-banner[hidden] { display: none; }
      .dc-banner .dc-banner-icon { font-size: 18px; flex: 0 0 auto; }
      .dc-banner .dc-banner-text { flex: 1 1 auto; }
      #dc-webgl-lost-banner { background: #ca8a04; }

      .control-container {
        display: flex;
        width: 100%;
        height: 100vh;
        background: #1a1a1a;
        margin: 0;
        padding: 0;
      }

      .column {
        display: flex;
        flex-direction: column;
        border-right: 1px solid #333;
      }

      .column:last-child {
        border-right: none;
      }

      .tool-column {
        width: 280px;
        min-width: 240px;
        max-width: 340px;
        background: #222;
        overflow-y: auto;
      }

      /* ソース選択（左ペイン）と warp 後プレビュー（右ペイン）は均等 flex で広げる。
         全画面エディタになったので、3 列ともゆとりのある幅で表示される。 */
      .source-column {
        flex: 1 1 0;
        min-width: 360px;
      }

      .mapping-column {
        flex: 1 1 0;
        min-width: 360px;
      }

      /* カラム間のドラッグリサイザ。control-container の flex 行の中に薄く入る。 */
      .dc-column-resizer {
        flex: 0 0 auto;
        width: 6px;
        background: #2a2a2a;
        border-left: 1px solid #444;
        border-right: 1px solid #444;
        cursor: col-resize;
        transition: background 0.12s ease;
        user-select: none;
        touch-action: none;
      }
      .dc-column-resizer:hover { background: #3b82f6; }
      .dc-column-resizer.dragging { background: #2563eb; }
      /* ドラッグ中は cursor とテキスト選択を本体側で抑止する（CSS の @scope 外では
         body セレクタが使えないため、JS で body.style を直書きして対応） */

      .column-header {
        padding: 15px;
        background: #2a2a2a;
        border-bottom: 1px solid #444;
      }

      .column-header h2 {
        margin: 0;
        font-size: 16px;
        color: #fff;
        font-weight: 500;
      }

      /* ツールカラムのスタイル */
      .tool-content {
        flex: 1;
        overflow-y: auto;
        padding: 15px;
      }

      .tool-section {
        margin-bottom: 25px;
        padding-bottom: 20px;
        border-bottom: 1px solid #333;
      }

      .tool-section:last-child {
        border-bottom: none;
      }

      .tool-section h3 {
        margin: 0 0 15px 0;
        font-size: 14px;
        color: #aaa;
        text-transform: uppercase;
        font-weight: 500;
      }

      .tool-item {
        margin-bottom: 15px;
      }

      .tool-item label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        color: #888;
      }

      .tool-values {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .tool-value {
        display: flex;
        align-items: center;
        padding: 5px 8px;
        background: #333;
        border-radius: 4px;
        font-size: 12px;
      }

      .tool-value .label {
        color: #888;
        margin-right: 5px;
      }

      .tool-value span:last-child {
        color: #fff;
        font-weight: 500;
      }

      .tool-button {
        width: 100%;
        padding: 8px 12px;
        background: #444;
        border: 1px solid #555;
        color: #fff;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }

      .tool-button:hover {
        background: #555;
        border-color: #666;
      }

      .tool-button:active {
        background: #333;
      }

      .section-hint {
        margin: 0 0 8px 0;
        font-size: 11px;
        color: #aaa;
        line-height: 1.4;
      }

      .test-pattern-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      .test-pattern-btn.active {
        background: #2563eb;
        border-color: #3b82f6;
        color: #fff;
      }

      .test-pattern-btn.active:hover {
        background: #1d4ed8;
        border-color: #2563eb;
      }

      /* マッピング一覧 */
      .mappings-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 10px;
      }

      .io-buttons {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }

      .io-buttons .tool-button {
        flex: 1;
      }

      .mapping-list-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: #333;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        color: #ccc;
        transition: all 0.15s;
      }

      .mapping-list-item:hover {
        background: #3a3a3a;
      }

      .mapping-list-item.active {
        background: rgba(255, 255, 255, 0.06);
        border-color: var(--mapping-color, #ff00ff);
        color: #fff;
      }

      .mapping-list-item .color-chip {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--mapping-color, #ff00ff);
        flex-shrink: 0;
      }

      .mapping-list-item .toggle-btn {
        background: transparent;
        border: 1px solid #555;
        color: #999;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      .mapping-list-item .toggle-btn.enabled {
        background: var(--mapping-color, #ff00ff);
        border-color: var(--mapping-color, #ff00ff);
        color: #000;
      }

      .mapping-list-item.disabled {
        opacity: 0.5;
      }

      .mapping-list-item.disabled .name {
        text-decoration: line-through;
      }

      .mapping-list-item .name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: none;
      }

      .mapping-list-item .name-input {
        flex: 1;
        background: #222;
        border: 1px solid var(--mapping-color, #ff00ff);
        color: #fff;
        font-size: 12px;
        padding: 1px 4px;
        border-radius: 3px;
        outline: none;
        min-width: 0;
      }

      .mapping-list-item .remove-btn {
        background: transparent;
        border: none;
        color: #888;
        cursor: pointer;
        font-size: 14px;
        padding: 0 4px;
        line-height: 1;
      }

      .mapping-list-item .remove-btn:hover {
        color: #ff5555;
      }

      .mapping-list-item .remove-btn:disabled {
        color: #555;
        cursor: not-allowed;
      }

      .display-status {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 10;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        background: rgba(51, 51, 51, 0.9);
        backdrop-filter: blur(4px);
        border-radius: 12px;
        font-size: 11px;
      }

      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #888;
        transition: background 0.3s;
      }

      .display-status.fullscreen .status-indicator {
        background: #27c93f;
        box-shadow: 0 0 4px rgba(39, 201, 63, 0.5);
      }

      .display-status.window .status-indicator {
        background: #ffbd2e;
        box-shadow: 0 0 4px rgba(255, 189, 46, 0.5);
      }

      .status-text {
        color: #ccc;
        font-weight: 500;
      }

      /* ソースカラムのスタイル */
      .video-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        position: relative;
        overflow: hidden;
        padding: 20px;
      }

      .source-preview-wrapper {
        width: 100%;
        height: calc(100% - 40px); /* ヘッダー分を引く */
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
      }

      .canvas-frame {
        position: relative;
        border: 2px solid #444;
        border-radius: 4px;
        background: #000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        /* キャンバスのアスペクト比は --canvas-aspect として scope に注入される（JS から更新）。
           aspect-ratio + max-width/height で「コンテナに収まる最大サイズ・アスペクト固定」を実現。
           親 .source-preview-wrapper は flex 中央寄せなので、letterbox 部分は両端の余白になる。 */
        aspect-ratio: var(--canvas-aspect, 16 / 9);
        max-width: 100%;
        max-height: 100%;
        width: 100%;
        height: auto;
      }

      #source-video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: fill;  /* canvas-frameのサイズに完全にフィット */
        background: #000;
      }

      #selection-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      #selection-box {
        position: absolute;
        border: 2px solid #00ff00;
        background: rgba(0, 255, 0, 0.1);
        pointer-events: auto;
        cursor: move;
        min-width: 20px;
        min-height: 20px;
      }

      /* 矢印キーで微調整中の選択枠（白いリング） */
      #selection-box.kbd-selected {
        box-shadow: 0 0 0 2px #fff, 0 0 6px rgba(0, 0, 0, 0.8);
      }

      /* マッピングカラムのスタイル */
      .mapping-container {
        flex: 1;
        background: #1a1a1a;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }

      .display-frame-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        max-height: calc(100% - 40px); /* サイズ情報の高さを考慮 */
      }

      .display-frame {
        position: relative;
        width: 100%;
        max-width: 100%;
        /* aspect-ratioはJavaScriptで動的に設定される */
        border: 2px solid #444;
        border-radius: 4px;
        background: #111;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* ウィンドウ枠 */
      .window-frame {
        position: absolute;
        background: #1a1a1a;
        border: 1px solid #555;
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
        /* デフォルトで中央配置 */
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 85%;
        height: 85%;
      }

      .window-frame.fullscreen {
        width: 100%;
        height: 100%;
        border-radius: 0;
        border: none;
      }

      .window-titlebar {
        height: 28px;
        background: #2a2a2a;
        border-bottom: 1px solid #444;
        display: flex;
        align-items: center;
        padding: 0 10px;
        flex-shrink: 0;
      }

      .window-frame.fullscreen .window-titlebar {
        display: none;
      }

      .window-controls {
        display: flex;
        gap: 8px;
        margin-right: 10px;
      }

      .window-control {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        display: inline-block;
      }

      .window-control.close {
        background: #ff5f56;
      }

      .window-control.minimize {
        background: #ffbd2e;
      }

      .window-control.maximize {
        background: #27c93f;
      }

      .window-title {
        font-size: 11px;
        color: #999;
        flex: 1;
        text-align: center;
      }

      .window-content {
        flex: 1;
        position: relative;
        background: #000;
        overflow: hidden;
        padding: 0;  /* paddingを明示的に0に */
      }

      #mapping-area {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }

      .display-size-info {
        font-size: 12px;
        color: #888;
        text-align: center;
        padding: 5px 10px;
        background: #2a2a2a;
        border-radius: 4px;
        border: 1px solid #333;
      }

      .display-size-info .separator {
        margin: 0 8px;
        color: #555;
      }

      .display-size-info .size-label {
        color: #aaa;
        font-weight: 500;
        margin-right: 4px;
      }

      #mapping-video {
        display: none;  /* 非表示（ストリームのソースとして使用） */
      }

      #cropped-container {
        position: absolute;
        border: 2px solid var(--mapping-color, #ff00ff);
        background: transparent;
        cursor: move;
        overflow: hidden;
        /* 単位矩形を matrix3d で 4 隅に写像する */
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        transform-origin: top left;
        backface-visibility: hidden;
        will-change: transform;
        pointer-events: auto;
      }

      .quad-handle {
        position: absolute;
        width: 14px;
        height: 14px;
        background: var(--mapping-color, #ff00ff);
        border: 2px solid #fff;
        border-radius: 50%;
        z-index: 20;
        cursor: grab;
        /* 4 隅の % 位置に置いた中心が一致するよう中央合わせ */
        margin-left: -7px;
        margin-top: -7px;
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
      }

      .quad-handle.dragging {
        cursor: grabbing;
        background: #ffffff;
        border-color: var(--mapping-color, #ff00ff);
      }

      /* 矢印キーで微調整中の選択ハンドル（白いリング） */
      .quad-handle.kbd-selected {
        box-shadow: 0 0 0 3px #fff, 0 0 6px rgba(0, 0, 0, 0.8);
      }

      /* 非アクティブ mapping のプレビュー */
      .preview-mapping.inactive {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        transform-origin: top left;
        backface-visibility: hidden;
        border: 1px dashed var(--mapping-color, rgba(255, 0, 255, 0.5));
        background: transparent;
        cursor: pointer;
        pointer-events: auto;
      }

      .preview-mapping.inactive:hover {
        border-style: solid;
      }

      .preview-mapping.inactive > video {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: top left;
        object-fit: fill;
        width: 100%;
        height: 100%;
        opacity: 0.55;
        pointer-events: none;
      }

      #cropped-video {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: top left;
        object-fit: fill;  /* クロップされた映像は全体を表示 */
      }

      /* ハンドルの共通スタイル */
      .handle {
        position: absolute;
        width: 12px;
        height: 12px;
        border: 2px solid #fff;
        border-radius: 50%;
        pointer-events: auto;
        z-index: 10;
      }

      .source-column .handle {
        background: #00ff00;
      }

      .mapping-column .handle {
        background: #ff00ff;
      }

      .handle-nw {
        top: -6px;
        left: -6px;
        cursor: nw-resize;
      }

      .handle-ne {
        top: -6px;
        right: -6px;
        cursor: ne-resize;
      }

      .handle-sw {
        bottom: -6px;
        left: -6px;
        cursor: sw-resize;
      }

      .handle-se {
        bottom: -6px;
        right: -6px;
        cursor: se-resize;
      }

      /* エッジハンドル */
      .edge {
        position: absolute;
        background: transparent;
        pointer-events: auto;
      }

      .edge-n, .edge-s {
        height: 6px;
        left: 6px;
        right: 6px;
      }

      .edge-n {
        top: -3px;
        cursor: n-resize;
      }

      .edge-s {
        bottom: -3px;
        cursor: s-resize;
      }

      .edge-e, .edge-w {
        width: 6px;
        top: 6px;
        bottom: 6px;
      }

      .edge-e {
        right: -3px;
        cursor: e-resize;
      }

      .edge-w {
        left: -3px;
        cursor: w-resize;
      }

      /* レスポンシブ対応：横幅が足りないときは tool 列を絞る。それでも足りないときは
         スクロール（control-container は flex なので各列が min-width 維持） */
      @media (max-width: 1100px) {
        .tool-column {
          width: 220px;
          min-width: 200px;
        }
      }
      @media (max-width: 900px) {
        .tool-column {
          width: 200px;
          min-width: 180px;
          max-width: 220px;
        }
        .source-column, .mapping-column {
          min-width: 300px;
        }
      }
`;
