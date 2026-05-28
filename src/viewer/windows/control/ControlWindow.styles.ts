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

      /* 3 カラムの上部 header は flex 配置で固定高に揃える。h2 を持つカラム（tool/source）と
         tab-strip を持つカラム（mapping）で高さが微妙にズレないよう、内容物は中央寄せして
         column-header 自体に高さを持たせる。 */
      .column-header {
        flex: 0 0 auto;
        height: 44px;
        padding: 0 16px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        background: #2a2a2a;
        border-bottom: 1px solid #444;
      }

      .column-header h2 {
        margin: 0;
        font-size: 14px;
        color: #fff;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1;
      }

      /* タブストリップ — column-header の中で h2 と差し替えて使う。
         segmented control 風（角丸の枠の中にボタンが並ぶ）。h2 と同じ視覚的なウェイトで、
         他カラムの header 高さと完全に揃う（content の box-height は 28px ≒ h2 の line-height + 余白）。 */
      .dc-tab-strip {
        display: inline-flex;
        align-items: stretch;
        background: #1f1f1f;
        border: 1px solid #3a3a3a;
        border-radius: 6px;
        padding: 2px;
        gap: 2px;
      }
      .dc-tab {
        appearance: none;
        background: transparent;
        color: #888;
        border: 0;
        border-radius: 4px;
        padding: 4px 12px;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.02em;
        cursor: pointer;
        margin: 0;
        line-height: 1.4;
        transition: background 0.12s ease, color 0.12s ease;
      }
      .dc-tab:hover:not(.is-active) {
        color: #ddd;
        background: rgba(255, 255, 255, 0.04);
      }
      .dc-tab.is-active {
        background: #3b82f6;
        color: #fff;
      }
      .dc-tab:focus-visible {
        outline: 2px solid #60a5fa;
        outline-offset: 1px;
      }
      /* タブで切り替える本体ペイン。is-active のものだけ表示する */
      .dc-tab-pane { display: none; }
      .dc-tab-pane.is-active { display: flex; }
      /* output-stage は元から flex なので is-active 適用で自然にレイアウトされる。
         layout-stage は専用スタイルを後段に置く。 */

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
        min-width: 0; /* grid セル内で子（特に <input>）の intrinsic min-width で広がらないようにする */
      }

      .tool-value .label {
        color: #888;
        margin-right: 5px;
      }

      .tool-value span:last-child {
        color: #fff;
        font-weight: 500;
      }

      /* 出力設定の数値入力。tool-value のレイアウトに収まりつつ、span 表示と同じ右寄せ感を出す。
         spinner ボタンは UI ノイズなので消す。width: 0 + flex: 1 1 0 で <input> の intrinsic
         min-width を無視して、grid セル幅にぴったり収める（ソース設定の span と同じ見え方）。 */
      .tool-value .num-input {
        flex: 1 1 0;
        width: 0;
        min-width: 0;
        box-sizing: border-box;
        background: transparent;
        border: 0;
        outline: 0;
        color: #fff;
        font: inherit;
        font-weight: 500;
        text-align: right;
        padding: 0;
        margin: 0;
        -moz-appearance: textfield;
      }
      .tool-value .num-input::-webkit-outer-spin-button,
      .tool-value .num-input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      .tool-value .num-input:focus {
        background: rgba(59, 130, 246, 0.15);
        box-shadow: inset 0 0 0 1px #3b82f6;
        border-radius: 2px;
      }
      .tool-value .num-input:disabled {
        color: #666;
        cursor: not-allowed;
      }
      #output-settings-target {
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

      .mappings-add-buttons {
        display: flex;
        gap: 6px;
      }
      .mappings-add-buttons .tool-button {
        flex: 1;
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

      /* drag-reorder のハンドルと drop-target インジケータ */
      .mapping-list-item .drag-handle {
        color: #666;
        font-size: 11px;
        line-height: 1;
        letter-spacing: -2px;
        cursor: grab;
        flex-shrink: 0;
        user-select: none;
        padding: 0 2px;
      }
      .mapping-list-item.dragging {
        opacity: 0.4;
      }
      .mapping-list-item.drop-target {
        position: relative;
      }
      .mapping-list-item.drop-target.before::before,
      .mapping-list-item.drop-target.after::after {
        content: '';
        position: absolute;
        left: 4px;
        right: 4px;
        height: 2px;
        background: #3b82f6;
        border-radius: 2px;
        pointer-events: none;
      }
      .mapping-list-item.drop-target.before::before { top: -2px; }
      .mapping-list-item.drop-target.after::after { bottom: -2px; }
      .mappings-list.reordering .mapping-list-item { cursor: grabbing; }

      /* mask 行: 色チップを黒い◇に、kind バッジを薄く右に表示 */
      .mapping-list-item.is-mask .color-chip.mask {
        background: #000;
        border: 1px solid #888;
      }
      .mapping-list-item .kind-badge {
        font-size: 9px;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border: 1px solid #555;
        border-radius: 2px;
        padding: 0 4px;
        flex-shrink: 0;
      }
      .mapping-list-item.is-mask.active {
        border-color: #fff;
      }

      /* マッピング column 内の mask preview */
      .preview-mask {
        position: absolute;
        top: 0; left: 0;
        pointer-events: auto;
        transform-origin: top left;
      }
      .preview-mask > svg {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        overflow: visible;
      }
      /* commit 後（drafting 無し）: 黒で塗りつぶし、白い枠線。polyline の fill は implicit closing
         edge を埋めるので polygon と同じ視覚になる。 */
      .preview-mask > svg polyline {
        fill: rgba(0, 0, 0, 0.92);
        stroke: rgba(255, 255, 255, 0.5);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
        cursor: pointer;
      }
      .preview-mask.active > svg polyline {
        stroke: #fff;
        stroke-width: 2;
      }
      /* drafting 中: 塗りつぶしなしの開いた折れ線。polyline は stroke で closing edge を
         描かないので、最終頂点 → 最初の頂点は接続されず、ペンツール的に見える。 */
      .preview-mask.drafting > svg polyline {
        fill: none;
        stroke: #ffe082;
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
        cursor: default;
      }

      /* dev mode: mask の輪郭をリスト上の色で強調表示する（操作プレビュー側）。
         commit 済み（drafting でない）にだけ適用 — drafting は元の黄ステッチを優先。
         scope root（shell）に dc-dev-mode が付いているときだけ有効。 */
      :scope.dc-dev-mode .preview-mask:not(.drafting) > svg polyline {
        stroke: var(--mask-color, #fff);
        stroke-width: 3;
      }
      /* レイアウトタブ内 mask preview にも同様の枠を当てる */
      :scope.dc-dev-mode .dc-layout-mask polyline {
        stroke: var(--mask-color, #fff);
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
      }

      /* ペンツールモードの canvas-host: cursor を crosshair に */
      .dc-canvas-host.mask-pen-mode { cursor: crosshair; }

      /* ペン描画中（shell に .mask-drafting）はマスク以外の項目に触れないようにする。
         クリックが canvas-host へ通って頂点プロットになるよう pointer-events を落とす。
         drafting マスク自身は別途 .preview-mask.drafting に pointer-events: none を当てている。 */
      :scope.mask-drafting .preview-mapping {
        pointer-events: none;
      }
      :scope.mask-drafting .preview-mask:not(.drafting) {
        pointer-events: none;
      }
      :scope.mask-drafting #cropped-container {
        pointer-events: none;
      }
      /* 出力フレームのヘッダは active output 切替トリガなので、描画中は無効化 */
      :scope.mask-drafting .dc-output-header {
        pointer-events: none;
      }
      /* ツール列のマッピングリスト: drafting マスク以外の行は activate / drag をロック。
         × / 有効化トグル / 名前ダブルクリック編集は引き続き効くよう、行内のボタンは
         例外として pointer-events を残す。 */
      :scope.mask-drafting .mapping-list-item:not(.active) {
        opacity: 0.5;
        cursor: not-allowed;
      }
      :scope.mask-drafting .mapping-list-item:not(.active) .name,
      :scope.mask-drafting .mapping-list-item:not(.active) .color-chip,
      :scope.mask-drafting .mapping-list-item:not(.active) .kind-badge,
      :scope.mask-drafting .mapping-list-item:not(.active) .drag-handle {
        pointer-events: none;
      }
      /* 出力一覧の行（active 切替も含めて） */
      :scope.mask-drafting .output-item .output-name {
        pointer-events: none;
        opacity: 0.6;
      }
      /* 「+ マッピング追加」「+ 出力追加」はクリックすると new mapping が active になり
         ペン描画が中断される。「+ マスク」も新しい drafting に切り替わってしまうので、
         描画中は3つとも無効化する。 */
      :scope.mask-drafting #add-mapping-btn,
      :scope.mask-drafting #add-mask-btn,
      :scope.mask-drafting #add-output-btn,
      :scope.mask-drafting #import-settings-btn,
      :scope.mask-drafting #reset-mapping-btn,
      :scope.mask-drafting #reset-source-btn {
        opacity: 0.5;
        pointer-events: none;
      }

      /* 描画済み頂点のドット（pen-mode）。最初の頂点は close ターゲットとして強調する。 */
      .mask-pen-dot {
        position: absolute;
        width: 10px; height: 10px;
        margin-left: -5px; margin-top: -5px;
        background: #ffe082;
        border: 2px solid #000;
        border-radius: 50%;
        cursor: crosshair;
        transform: scale(var(--canvas-counter-scale, 1));
        transform-origin: center;
        z-index: 1010;
        pointer-events: auto;
      }
      .mask-pen-dot.first {
        width: 14px; height: 14px;
        margin-left: -7px; margin-top: -7px;
        background: #fff;
        cursor: pointer;
        box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.25);
      }
      .mask-pen-dot.first:hover {
        background: #4ade80;
        box-shadow: 0 0 0 6px rgba(74, 222, 128, 0.35);
      }

      /* rubber-band line（最後の頂点 → カーソル） */
      svg.mask-pen-rubber {
        position: absolute;
        top: 0; left: 0;
        overflow: visible;
        pointer-events: none;
        z-index: 1005;
      }
      svg.mask-pen-rubber line {
        stroke: #ffe082;
        stroke-width: 2;
        stroke-dasharray: 6 4;
        vector-effect: non-scaling-stroke;
      }

      /* ペンツールモードのヒントバッジ（canvas-host 内に重ねる） */
      .mask-pen-hint {
        position: absolute;
        top: 12px; left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.78);
        color: #ffe082;
        font-size: 12px;
        line-height: 1.4;
        padding: 6px 10px;
        border-radius: 4px;
        border: 1px solid rgba(255, 224, 130, 0.5);
        pointer-events: none;
        z-index: 1100;
        max-width: 90%;
        white-space: nowrap;
      }

      /* mask 頂点ハンドル / 辺中点（+）ハンドル — canvas-handles 内に配置。
         親 scale を打ち消すために --canvas-counter-scale を使って screen-px 一定にする。 */
      .mask-vertex-handle {
        position: absolute;
        width: 14px; height: 14px;
        margin-left: -7px; margin-top: -7px;
        background: #fff;
        border: 2px solid #000;
        border-radius: 50%;
        cursor: grab;
        transform: scale(var(--canvas-counter-scale, 1));
        transform-origin: center;
        z-index: 1000;
      }
      .mask-vertex-handle:hover { background: #ffe082; }
      .mask-vertex-handle.dragging { cursor: grabbing; background: #ffe082; }
      .mask-edge-handle {
        position: absolute;
        width: 14px; height: 14px;
        margin-left: -7px; margin-top: -7px;
        background: rgba(255, 255, 255, 0.4);
        border: 1px dashed rgba(255, 255, 255, 0.6);
        border-radius: 50%;
        color: #000;
        font-size: 11px;
        line-height: 10px;
        text-align: center;
        cursor: pointer;
        transform: scale(var(--canvas-counter-scale, 1));
        transform-origin: center;
        z-index: 999;
        user-select: none;
      }
      .mask-edge-handle:hover { background: #fff; }
      .mask-translate-handle {
        position: absolute;
        width: 22px; height: 22px;
        margin-left: -11px; margin-top: -11px;
        background: rgba(255, 255, 255, 0.92);
        border: 2px solid #000;
        border-radius: 50%;
        color: #000;
        font-size: 13px;
        line-height: 18px;
        text-align: center;
        cursor: grab;
        transform: scale(var(--canvas-counter-scale, 1));
        transform-origin: center;
        z-index: 1001;
        user-select: none;
      }
      .mask-translate-handle.dragging { cursor: grabbing; background: #ffe082; }

      /* layout タブ内の mask preview（出力フレーム内） */
      .dc-layout-mask {
        position: absolute;
        top: 0; left: 0;
        pointer-events: none;
        transform-origin: top left;
      }
      .dc-layout-mask > svg {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        overflow: visible;
      }

      /* 出力一覧（MappingsListPanel — 出力管理セクション） */
      .outputs-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 10px;
      }
      .output-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        background: #2a2a2a;
        border: 1px solid #333;
        border-radius: 4px;
        font-size: 11px;
        color: #ccc;
      }
      .output-item.active {
        border-color: #3b82f6;
      }
      .output-item .output-name {
        flex: 1;
        font-weight: 500;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: none;
      }
      .output-item .output-name-input {
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
      .output-item .output-window-status {
        font-size: 10px;
        color: #888;
        margin-right: 2px;
      }
      .output-item .output-window-status.open {
        color: #27c93f;
      }
      .output-item button {
        background: transparent;
        border: 1px solid #555;
        color: #ccc;
        cursor: pointer;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        line-height: 1;
      }
      .output-item button:hover:not(:disabled) {
        background: #3a3a3a;
      }
      .output-item button:disabled {
        color: #555;
        cursor: not-allowed;
      }
      .output-item .open-btn.is-open {
        background: #27c93f33;
        border-color: #27c93f;
        color: #27c93f;
      }
      .output-item .remove-output-btn {
        color: #888;
      }
      .output-item .remove-output-btn:hover:not(:disabled) {
        color: #ff5555;
        border-color: #ff5555;
      }
      #add-output-btn {
        margin-top: 4px;
      }

      /* マッピング編集タブのステージ: 仮想キャンバスを viewport 内にフィットして表示する。
         出力フレームは renderEachFrame() で position: absolute, left/top/width/height（screen px）に
         直接配置される。flex は使わない（仮想キャンバス上の位置関係を保つため）。 */
      .output-stage {
        width: 100%;
        height: 100%;
        position: relative;
        padding: 0;
        box-sizing: border-box;
        background: #0d0d0d;
        overflow: hidden;
      }

      /* 出力レイアウト編集ステージ — 仮想キャンバスを縮小表示する。
         内側に .dc-layout-canvas（仮想キャンバス全体）が乗り、その中で各出力矩形を 2D ドラッグ。 */
      .layout-stage {
        width: 100%;
        height: 100%;
        flex-direction: column;
        align-items: stretch;
        justify-content: stretch;
        padding: 16px;
        box-sizing: border-box;
        background: #161616;
        gap: 8px;
      }
      .layout-stage .dc-layout-hint {
        font-size: 11px;
        color: #888;
        line-height: 1.4;
        flex: 0 0 auto;
      }
      .layout-stage .dc-layout-viewport {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        background:
          linear-gradient(0deg, transparent calc(100% - 1px), #2a2a2a 100%) 0 0 / 40px 40px,
          linear-gradient(90deg, transparent calc(100% - 1px), #2a2a2a 100%) 0 0 / 40px 40px,
          #1c1c1c;
        border: 1px solid #333;
        border-radius: 4px;
        overflow: hidden;
      }
      /* 仮想キャンバスの矩形を表すレイヤ。
         transform-origin: top left + JS で left/top/transform: scale() を直接設定して中央寄せする。
         （top:50% + translate(-50%,-50%) + scale() は transform-origin の解釈で破綻するので使わない） */
      .dc-layout-canvas {
        position: absolute;
        transform-origin: top left;
        background: #111;
        border: 1px dashed #444;
        /* left/top/width/height/transform はランタイムで設定（仮想キャンバス px → viewport にフィット） */
      }
      .dc-layout-canvas .dc-layout-output {
        position: absolute;
        background: rgba(20, 20, 20, 0.65);
        border: 2px solid #3b82f6;
        box-sizing: border-box;
        color: #fff;
        cursor: grab;
        user-select: none;
        overflow: hidden;
        /* left/top/width/height はランタイムで設定（canvas px そのまま） */
      }
      /* レイアウトタブ内のマッピングプレビュー（canvas-window 直下） — マッピング編集タブの
         preview-mapping.inactive と同じ式で warp。視覚的にはやや半透明にして「ここはレイアウト
         編集ビュー」であることを示す。 */
      .dc-layout-canvas .dc-layout-preview {
        position: absolute;
        left: 0;
        top: 0;
        overflow: hidden;
        transform-origin: top left;
        backface-visibility: hidden;
        border: 1px solid var(--mapping-color, rgba(255, 0, 255, 0.5));
        background: transparent;
        pointer-events: none;
      }
      .dc-layout-canvas .dc-layout-preview > video {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: top left;
        object-fit: fill;
        width: 100%;
        height: 100%;
        opacity: 0.6;
        pointer-events: none;
      }
      .dc-layout-canvas .dc-layout-output.is-active {
        border-color: #f59e0b;
        background: rgba(245, 158, 11, 0.18);
        z-index: 2;
      }
      .dc-layout-canvas .dc-layout-output.dragging {
        cursor: grabbing;
      }
      .dc-layout-canvas .dc-layout-output .dc-layout-output-label {
        position: absolute;
        top: 4px;
        left: 6px;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        padding: 2px 6px;
        border-radius: 3px;
        pointer-events: none;
        white-space: nowrap;
      }
      /* 出力レイアウトの resize ハンドル — マッピング window の quad-handle と同じ視覚サイズ
         （14px）にして掴みやすくする。layout-canvas の transform: scale(fitScale) を
         打ち消すために --canvas-counter-scale で逆スケール。
         margin -7px で box の中心を right: 0 / bottom: 0（出力矩形の右下角）に置く。
         scale は transform-origin: center で中心固定なので、scale 後も中心は角に乗ったまま。
         box-shadow で背景に対して浮かせて見やすく。 */
      .dc-layout-canvas .dc-layout-output .dc-layout-resize {
        position: absolute;
        width: 14px;
        height: 14px;
        background: #fff;
        border: 2px solid #3b82f6;
        border-radius: 3px;
        box-sizing: border-box;
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
        z-index: 3;
        transform: scale(var(--canvas-counter-scale, 1));
        transform-origin: center;
      }
      .dc-layout-canvas .dc-layout-output.is-active .dc-layout-resize {
        border-color: #f59e0b;
      }
      .dc-layout-canvas .dc-layout-output .dc-layout-resize.se {
        right: 0;
        bottom: 0;
        margin: 0 -7px -7px 0;
        cursor: nwse-resize;
      }
      .dc-layout-canvas .dc-layout-output .dc-layout-resize:hover {
        background: #e0eaff;
      }
      .dc-layout-canvas .dc-layout-output.is-active .dc-layout-resize:hover {
        background: #fff3d6;
      }

      /* canvas-host: 仮想キャンバス全体を canvas px サイズで持ち、scale + offset で
         #output-stage の viewport にフィットさせる。renderEachFrame() がランタイムで書き込む。 */
      .dc-canvas-host {
        position: absolute;
        transform-origin: top left;
        will-change: transform;
        /* width / height / left / top / transform はランタイム */
      }
      /* mappings レイヤ: 全 mapping の DOM が乗る。出力境界を超えても見える（overflow なし）。 */
      .dc-canvas-mappings {
        position: absolute;
        top: 0;
        left: 0;
        /* width / height はランタイム（canvas px） */
      }
      /* handles レイヤ: quad 4 隅ハンドルが乗る（mapping より手前）。 */
      .dc-canvas-handles {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none; /* ハンドル本体のみ pointer 受ける */
        /* width / height はランタイム */
      }
      .dc-canvas-handles > * { pointer-events: auto; }

      /* マッピング編集タブの出力フレーム — canvas-host 内に絶対配置される「投影範囲オーバーレイ」。
         mapping は別レイヤ（canvas-mappings）に描かれるので、ここは透明な枠だけを持つ。
         renderEachFrame() が left/top/width/height（canvas px）を毎回書き込む。
         border-width などは canvas-host の scale で潰れないよう --canvas-counter-scale で逆補正。

         **pointer-events: none** — フレームはあくまで視覚オーバーレイ。マウスイベントは下の
         canvas-mappings（cropped-container / preview-mapping）へ通す。これによりフレーム内の
         どこをクリックしても mapping コンテンツを掴んでドラッグできる。
         アクティブ出力の選択は中の .dc-output-header（pointer-events: auto）クリックで行う。 */
      .dc-output-frame {
        position: absolute;
        background: transparent;
        border-style: solid;
        border-color: rgba(255, 255, 255, 0.35);
        border-width: calc(2px * var(--canvas-counter-scale, 1));
        box-sizing: border-box;
        pointer-events: none;
      }
      .dc-output-frame.is-active {
        border-color: #3b82f6;
        z-index: 2;
      }

      /* mapping-area は per-output で生やす。class セレクタで CSS を当てる。
         内側に .dc-canvas-window（仮想キャンバス全体の論理サイズ）を 1 枚置き、
         transform で「この出力の担当矩形」が mapping-area いっぱいに収まるようにする。
         mapping-area は overflow: hidden なので、canvas-window のうち output bounds の外は clip される。 */
      .dc-mapping-area {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }
      .dc-canvas-window {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: top left;
        will-change: transform;
        /* width/height/transform はランタイム（OutputVizPanel.applyCanvasWindow）で書き込む */
      }

      /* 出力フレーム左上のヘッダ（オーバーレイ） — canvas-host の scale で字が消えないよう
         位置・font-size・padding を canvas-counter-scale で逆補正する。
         pointer-events: auto でクリック可能（active output 切替用）。 */
      .dc-output-header {
        position: absolute;
        top: calc(4px * var(--canvas-counter-scale, 1));
        left: calc(4px * var(--canvas-counter-scale, 1));
        display: flex;
        align-items: center;
        gap: calc(6px * var(--canvas-counter-scale, 1));
        font-size: calc(10px * var(--canvas-counter-scale, 1));
        color: #ddd;
        background: rgba(0, 0, 0, 0.6);
        padding: calc(2px * var(--canvas-counter-scale, 1)) calc(6px * var(--canvas-counter-scale, 1));
        border-radius: calc(3px * var(--canvas-counter-scale, 1));
        max-width: calc(100% - 8px * var(--canvas-counter-scale, 1));
        overflow: hidden;
        pointer-events: auto;
        cursor: pointer;
        z-index: 4;
      }
      .dc-output-header:hover {
        background: rgba(0, 0, 0, 0.8);
      }
      .dc-output-header .dc-output-name {
        color: #fff;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dc-output-header .dc-output-size {
        color: #aaa;
        font-size: calc(9px * var(--canvas-counter-scale, 1));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dc-output-header .dc-output-mode {
        padding: calc(1px * var(--canvas-counter-scale, 1)) calc(5px * var(--canvas-counter-scale, 1));
        border-radius: calc(8px * var(--canvas-counter-scale, 1));
        font-size: calc(9px * var(--canvas-counter-scale, 1));
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
        /* width/height はランタイムで canvas px に設定し、matrix3d で quad（仮想 px）へ写像する。
           親（.dc-canvas-window）の scale が更に縮拡する。 */
        left: 0;
        top: 0;
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
        /* canvas-host の scale を打ち消して画面上のサイズを 14px に保つ。
           transform-origin: center で left/top の指定位置を中心とする。 */
        transform: scale(var(--canvas-counter-scale, 1));
        transform-origin: center;
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

      /* 全体スケール（uniform scale）ハンドル — 重心ぴったりに表示。
         角丸ありの白い四角で、4 隅ハンドル（丸）と視覚的に区別する。 */
      .quad-handle.quad-handle-scale {
        border-radius: 3px;
        background: #fff;
        border-color: var(--mapping-color, #ff00ff);
        cursor: nwse-resize;
      }
      .quad-handle.quad-handle-scale.dragging {
        background: var(--mapping-color, #ff00ff);
        border-color: #fff;
      }

      /* 全体回転ハンドル — quad の right 辺（TR ↔ BR）中点に配置されるので、
         位置オフセットは不要。base .quad-handle と同じ scale(counter-scale) で
         画面上 14px を保つ。 */
      .quad-handle.quad-handle-rotate {
        background: #fff;
        border-color: var(--mapping-color, #ff00ff);
        cursor: grab;
      }
      .quad-handle.quad-handle-rotate::before {
        /* 回転アイコン代わりの小さな弧 */
        content: '↻';
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        color: var(--mapping-color, #ff00ff);
        line-height: 1;
        pointer-events: none;
      }
      .quad-handle.quad-handle-rotate.dragging {
        cursor: grabbing;
        background: var(--mapping-color, #ff00ff);
        border-color: #fff;
      }
      .quad-handle.quad-handle-rotate.dragging::before {
        color: #fff;
      }

      /* 非アクティブ mapping のプレビュー — width/height はランタイムで canvas px に設定 */
      .preview-mapping.inactive {
        position: absolute;
        left: 0;
        top: 0;
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
