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

      /* 開発モードトグル — aria-pressed=true で active 表示に切替 */
      .dev-mode-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: center;
      }
      .dev-mode-toggle .dev-mode-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #555;
        box-shadow: inset 0 0 0 1px #777;
        transition: background 0.12s ease, box-shadow 0.12s ease;
      }
      .dev-mode-toggle[aria-pressed="true"] {
        background: #16a34a;
        border-color: #22c55e;
        color: #fff;
      }
      .dev-mode-toggle[aria-pressed="true"]:hover {
        background: #15803d;
        border-color: #16a34a;
      }
      .dev-mode-toggle[aria-pressed="true"] .dev-mode-dot {
        background: #d1fadf;
        box-shadow: 0 0 6px rgba(34, 197, 94, 0.85), inset 0 0 0 1px #fff;
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

      /* 出力グループヘッダ（MappingsListPanel — 出力ごとに mappings をぶら下げる） */
      .output-group {
        margin-bottom: 12px;
        border: 1px solid #333;
        border-radius: 4px;
        overflow: hidden;
      }
      .output-group.active {
        border-color: #3b82f6;
      }
      .output-group-header {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        background: #2a2a2a;
        font-size: 11px;
        color: #ccc;
      }
      .output-group-header .output-name {
        flex: 1;
        font-weight: 500;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: none;
      }
      .output-group-header .output-name-input {
        flex: 1;
        background: #222;
        border: 1px solid #3b82f6;
        color: #fff;
        font-size: 11px;
        padding: 1px 4px;
        border-radius: 3px;
        outline: none;
        min-width: 0;
      }
      .output-group-header .output-window-status {
        font-size: 10px;
        color: #888;
        margin-right: 2px;
      }
      .output-group-header .output-window-status.open {
        color: #27c93f;
      }
      .output-group-header button {
        background: transparent;
        border: 1px solid #555;
        color: #ccc;
        cursor: pointer;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        line-height: 1;
      }
      .output-group-header button:hover:not(:disabled) {
        background: #3a3a3a;
      }
      .output-group-header button:disabled {
        color: #555;
        cursor: not-allowed;
      }
      .output-group-header .open-btn.is-open {
        background: #27c93f33;
        border-color: #27c93f;
        color: #27c93f;
      }
      .output-group-header .remove-output-btn {
        color: #888;
      }
      .output-group-header .remove-output-btn:hover:not(:disabled) {
        color: #ff5555;
        border-color: #ff5555;
      }
      .output-group-mappings {
        padding: 4px;
        background: #1f1f1f;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .output-group-mappings .add-mapping-here-btn {
        margin-top: 4px;
        background: transparent;
        border: 1px dashed #555;
        color: #888;
        padding: 4px;
        font-size: 11px;
        border-radius: 3px;
        cursor: pointer;
      }
      .output-group-mappings .add-mapping-here-btn:hover {
        color: #ccc;
        border-color: #888;
      }
      #add-output-btn {
        margin-top: 4px;
      }

      /* 複数出力フレームを並べるステージ */
      .output-stage {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 10px;
        box-sizing: border-box;
        container-type: size;
      }

      .dc-output-frame {
        position: relative;
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 100%;
        cursor: pointer;
        container-type: size;
      }
      .dc-output-frame.is-active .dc-display-frame {
        outline: 2px solid #3b82f6;
        outline-offset: 2px;
      }

      /* 各出力枠のアスペクト固定領域。--output-aspect は OutputVizPanel が要素に設定する。 */
      .dc-display-frame {
        position: relative;
        aspect-ratio: var(--output-aspect, 16 / 9);
        width: min(100cqw, calc((100cqh - 30px) * var(--output-aspect-num, 1.7777)));
        height: auto;
        flex-shrink: 0;
        max-width: 100%;
        max-height: calc(100% - 30px);
        border: 2px solid #444;
        border-radius: 4px;
        background: #111;
        overflow: hidden;
      }

      /* mapping-area は per-output で生やす。class セレクタで CSS を当てる。 */
      .dc-mapping-area {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }

      .dc-output-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: #aaa;
        max-width: 100%;
        overflow: hidden;
      }
      .dc-output-header .dc-output-name {
        color: #ccc;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dc-output-header .dc-output-size {
        color: #888;
        font-size: 10px;
      }
      .dc-output-header .dc-output-mode {
        padding: 1px 6px;
        border-radius: 8px;
        font-size: 10px;
        background: #333;
      }
      .dc-output-header .dc-output-mode.open {
        background: #27c93f33;
        color: #27c93f;
      }
      .dc-output-header .dc-output-mode.fullscreen {
        background: #3b82f633;
        color: #3b82f6;
      }
      .dc-output-header .dc-output-mode.closed {
        color: #888;
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
        /* 中の .canvas-frame が cqh でこの content-box の高さを参照できるようにする */
        container-type: size;
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
        /* キャンバスのアスペクト比は --canvas-aspect（分数形式）と --canvas-aspect-num
           （数値形式）の 2 つで scope に注入される（JS から更新）。
           width を min(横方向の上限, 縦方向の上限から逆算した幅) で直接決めることで、
           ソースカラムの横幅と高さのどちらが制限要因でも常にアスペクトが保たれる。
           （width: 100%; height: auto 単独では width が固定されるため、
            高さが制限要因のとき aspect-ratio が崩れる。） */
        aspect-ratio: var(--canvas-aspect, 16 / 9);
        width: min(100%, calc(100cqh * var(--canvas-aspect-num, 1.7777)));
        height: auto;
        max-width: 100%;
        max-height: 100%;
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
        align-items: stretch;
        justify-content: center;
        padding: 10px;
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
        height: 18px;
        background: #2a2a2a;
        border-bottom: 1px solid #444;
        display: flex;
        align-items: center;
        padding: 0 8px;
        flex-shrink: 0;
      }

      .window-frame.fullscreen .window-titlebar {
        display: none;
      }

      .window-controls {
        display: flex;
        gap: 4px;
      }

      .window-control {
        width: 6px;
        height: 6px;
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

      .window-content {
        flex: 1;
        position: relative;
        background: #000;
        overflow: hidden;
        padding: 0;  /* paddingを明示的に0に */
      }

      /* dev mode: 出力ウィンドウから push されたマウス位置を window-content 全面にミラー。
         preserveAspectRatio=none + viewBox 0..100 で、コンテンツ領域へ正確にストレッチ。
         表示はシェル（@scope ルート）の .dc-dev-mode と data-visible=true の両方を満たした時だけ。
         @scope 内では scope root を :scope で参照する（.dc-control-shell.foo は scope の
         「中」を探す指定なので scope root 自身にはマッチしない）。 */
      .dc-dev-crosshair {
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        display: none;
        z-index: 5;
      }
      :scope.dc-dev-mode .dc-dev-crosshair[data-visible="true"] {
        display: block;
      }
      .dc-dev-crosshair line {
        stroke: #ffffff;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
        shape-rendering: crispEdges;
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
