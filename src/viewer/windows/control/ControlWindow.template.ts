/**
 * ControlWindow の DOM テンプレート。
 *
 * すべての要素を `.dc-control-shell` の subtree に閉じ込めるための wrapper を最外に置く。
 * 内部の selector は CONTROL_PANEL_CSS 側で `@scope (.dc-control-shell)` により main の
 * CSS と干渉しないよう囲ってある。
 */
export const CONTROL_PANEL_HTML = `
      <div class="dc-control-shell">
      <div id="dc-webgl-lost-banner" class="dc-banner dc-banner-warn" hidden role="status">
        <span class="dc-banner-icon">⚠</span>
        <span class="dc-banner-text">
          WebGL コンテキストが失われました（GPU プロセスのクラッシュ等）。<br>
          2 秒以内に復帰しなければソースを自動リロードします。
        </span>
      </div>
      <div class="control-container">
        <!-- ツールカラム -->
        <div class="column tool-column" data-resize-target="tool">
          <div class="column-header">
            <h2>ツール</h2>
          </div>
          <div class="tool-content">
            <div class="tool-section">
              <h3>出力ウィンドウ</h3>
              <div id="outputs-list" class="outputs-list"></div>
              <button id="add-output-btn" class="tool-button">＋ 出力を追加</button>
            </div>

            <div class="tool-section">
              <h3>マッピング</h3>
              <div id="mappings-list" class="mappings-list"></div>
              <button id="add-mapping-btn" class="tool-button">＋ マッピングを追加</button>
              <div class="io-buttons">
                <button id="export-mappings-btn" class="tool-button">保存</button>
                <button id="import-mappings-btn" class="tool-button">読み込み</button>
              </div>
            </div>

            <div class="tool-section">
              <h3>出力設定</h3>
              <p class="section-hint">アクティブな出力の位置とサイズを数値で編集（仮想キャンバス px）</p>
              <div class="tool-item">
                <label id="output-settings-label">対象: <span id="output-settings-target">—</span></label>
                <div class="tool-values output-values">
                  <div class="tool-value">
                    <span class="label">X:</span>
                    <input id="output-x-input" class="num-input" type="number" step="1" min="0" inputmode="numeric" disabled />
                  </div>
                  <div class="tool-value">
                    <span class="label">Y:</span>
                    <input id="output-y-input" class="num-input" type="number" step="1" min="0" inputmode="numeric" disabled />
                  </div>
                  <div class="tool-value">
                    <span class="label">幅:</span>
                    <input id="output-w-input" class="num-input" type="number" step="1" min="1" inputmode="numeric" disabled />
                  </div>
                  <div class="tool-value">
                    <span class="label">高さ:</span>
                    <input id="output-h-input" class="num-input" type="number" step="1" min="1" inputmode="numeric" disabled />
                  </div>
                </div>
              </div>
            </div>

            <div class="tool-section">
              <h3>ソース設定</h3>
              <p class="section-hint">枠をクリックで選択 → 矢印キーで微調整（Shift+矢印で10px）</p>
              <div class="tool-item">
                <label>選択領域</label>
                <div class="tool-values">
                  <div class="tool-value">
                    <span class="label">X:</span>
                    <span id="source-x-value">0</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">Y:</span>
                    <span id="source-y-value">0</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">幅:</span>
                    <span id="source-w-value">100</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">高さ:</span>
                    <span id="source-h-value">100</span>%
                  </div>
                </div>
              </div>
              <button id="reset-source-btn" class="tool-button">
                リセット
              </button>
            </div>

            <div class="tool-section">
              <h3>テストパターン</h3>
              <p class="section-hint">プロジェクションの校正用にソース映像を一時的に差し替えます</p>
              <div class="test-pattern-buttons">
                <button class="tool-button test-pattern-btn active" data-pattern="off">通常</button>
                <button class="tool-button test-pattern-btn" data-pattern="white">白</button>
                <button class="tool-button test-pattern-btn" data-pattern="grid">グリッド</button>
                <button class="tool-button test-pattern-btn" data-pattern="smpte">カラーバー</button>
              </div>
            </div>

            <div class="tool-section">
              <h3>開発モード</h3>
              <p class="section-hint">出力ウィンドウに各 mapping の枠線とマウス追従クロスヘア（レーザー墨出し器風）を重ねます</p>
              <button id="dev-mode-toggle" class="tool-button dev-mode-toggle" aria-pressed="false">
                <span class="dev-mode-dot" aria-hidden="true"></span>
                <span class="dev-mode-label">OFF</span>
              </button>
            </div>

            <div class="tool-section">
              <h3>マッピング設定</h3>
              <p class="section-hint">隅のハンドルをクリックで選択 → 矢印キーで微調整（Shift+矢印で10px）</p>
              <div class="tool-item">
                <label>4隅 (% / ホモグラフィー)</label>
                <div class="tool-values quad-values">
                  <div class="tool-value"><span class="label">TL:</span><span id="mapping-tl-value">25, 25</span></div>
                  <div class="tool-value"><span class="label">TR:</span><span id="mapping-tr-value">75, 25</span></div>
                  <div class="tool-value"><span class="label">BL:</span><span id="mapping-bl-value">25, 75</span></div>
                  <div class="tool-value"><span class="label">BR:</span><span id="mapping-br-value">75, 75</span></div>
                </div>
              </div>
              <button id="reset-mapping-btn" class="tool-button">
                リセット
              </button>
            </div>

          </div>
        </div>

        <!-- tool ↔ source の区切りリサイザ -->
        <div class="dc-column-resizer" data-resize-edge="tool" title="ドラッグでツールカラムの幅を変更" aria-hidden="true"></div>

        <!-- ソースカラム -->
        <div class="column source-column" data-resize-target="source">
          <div class="column-header">
            <h2>ソース選択</h2>
          </div>
          <div class="video-container">
            <div class="source-preview-wrapper">
              <div class="canvas-frame">
                <video id="source-video" autoplay muted playsinline>
                  <p>MediaStreamの読み込み中...</p>
                </video>
                <div id="selection-overlay">
                  <div id="selection-box">
                    <div class="handle handle-nw" data-handle="nw"></div>
                    <div class="handle handle-ne" data-handle="ne"></div>
                    <div class="handle handle-sw" data-handle="sw"></div>
                    <div class="handle handle-se" data-handle="se"></div>
                    <div class="edge edge-n" data-edge="n"></div>
                    <div class="edge edge-e" data-edge="e"></div>
                    <div class="edge edge-s" data-edge="s"></div>
                    <div class="edge edge-w" data-edge="w"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- source ↔ mapping の区切りリサイザ -->
        <div class="dc-column-resizer" data-resize-edge="source" title="ドラッグでソース／マッピング欄の比率を変更" aria-hidden="true"></div>

        <!-- マッピングカラム -->
        <div class="column mapping-column">
          <div class="column-header">
            <div class="dc-tab-strip" role="tablist" aria-label="マッピングカラムのビュー切替">
              <button class="dc-tab is-active" role="tab" aria-selected="true" data-tab="mapping">マッピング</button>
              <button class="dc-tab" role="tab" aria-selected="false" data-tab="layout">出力レイアウト</button>
            </div>
          </div>
          <div class="mapping-container">
            <!-- 全出力で共有する hidden mapping-video（cropped-video への stream donor） -->
            <video id="mapping-video" autoplay muted playsinline style="display: none;">
              <p>MediaStreamの読み込み中...</p>
            </video>
            <!-- マッピング編集ビュー: 出力ごとのフレームを横並びに並べたステージ。OutputVizPanel が組み立てる -->
            <div id="output-stage" class="output-stage dc-tab-pane is-active" data-tab-pane="mapping"></div>
            <!-- 出力レイアウトビュー: 仮想キャンバス全体を縮小表示して、各出力を 2D ドラッグ・リサイズで配置する -->
            <div id="layout-stage" class="layout-stage dc-tab-pane" data-tab-pane="layout"></div>
          </div>
        </div>
      </div>
      </div>
    `;
