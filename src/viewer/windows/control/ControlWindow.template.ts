/**
 * ControlWindow の DOM テンプレート。
 *
 * すべての要素を `.dc-control-shell` の subtree に閉じ込めるための wrapper を最外に置く。
 * 内部の selector は CONTROL_PANEL_CSS 側で `@scope (.dc-control-shell)` により main の
 * CSS と干渉しないよう囲ってある。
 *
 * 多言語化: 静的ラベルには `data-i18n` / `data-i18n-title` / `data-i18n-aria-label`
 * 属性を付与しておく。言語切替時に ControlWindow が applyControlTranslations()
 * を呼んで属性に書かれたキーから現在言語のテキストを書き戻す。
 */
import { t, type MessageKey } from '../../i18n/index.js';

export function controlPanelHtml(): string {
  return `
      <div class="dc-control-shell">
      <div id="dc-webgl-lost-banner" class="dc-banner dc-banner-warn" hidden role="status">
        <span class="dc-banner-icon">⚠</span>
        <span class="dc-banner-text" data-i18n-html="control.banner.webglLost">${t('control.banner.webglLost')}</span>
      </div>
      <div class="control-container">
        <!-- ツールカラム -->
        <div class="column tool-column" data-resize-target="tool">
          <div class="column-header">
            <h2 data-i18n="control.column.tool">${t('control.column.tool')}</h2>
          </div>
          <div class="tool-content">
            <div class="tool-section">
              <h3 data-i18n="control.outputs.title">${t('control.outputs.title')}</h3>
              <div id="outputs-list" class="outputs-list"></div>
              <button id="add-output-btn" class="tool-button" data-i18n="control.outputs.add">${t('control.outputs.add')}</button>
            </div>

            <div class="tool-section">
              <h3 data-i18n="control.mappings.title">${t('control.mappings.title')}</h3>
              <p class="section-hint" data-i18n="control.mappings.reorderHint">${t('control.mappings.reorderHint')}</p>
              <div id="mappings-list" class="mappings-list"></div>
              <div class="mappings-add-buttons">
                <button id="add-mapping-btn" class="tool-button" data-i18n="control.mappings.add">${t('control.mappings.add')}</button>
                <button id="add-mask-btn" class="tool-button" data-i18n="control.mappings.addMask">${t('control.mappings.addMask')}</button>
              </div>
            </div>

            <div class="tool-section">
              <h3 data-i18n="control.outputSettings.title">${t('control.outputSettings.title')}</h3>
              <p class="section-hint" data-i18n="control.outputSettings.hint">${t('control.outputSettings.hint')}</p>
              <div class="tool-item">
                <label id="output-settings-label"><span data-i18n="control.outputSettings.target">${t('control.outputSettings.target')}</span> <span id="output-settings-target">—</span></label>
                <div class="tool-values output-values">
                  <div class="tool-value">
                    <span class="label" data-i18n="control.label.x">${t('control.label.x')}</span>
                    <input id="output-x-input" class="num-input" type="number" step="1" min="0" inputmode="numeric" disabled />
                  </div>
                  <div class="tool-value">
                    <span class="label" data-i18n="control.label.y">${t('control.label.y')}</span>
                    <input id="output-y-input" class="num-input" type="number" step="1" min="0" inputmode="numeric" disabled />
                  </div>
                  <div class="tool-value">
                    <span class="label" data-i18n="control.label.w">${t('control.label.w')}</span>
                    <input id="output-w-input" class="num-input" type="number" step="1" min="1" inputmode="numeric" disabled />
                  </div>
                  <div class="tool-value">
                    <span class="label" data-i18n="control.label.h">${t('control.label.h')}</span>
                    <input id="output-h-input" class="num-input" type="number" step="1" min="1" inputmode="numeric" disabled />
                  </div>
                </div>
              </div>
            </div>

            <div class="tool-section">
              <h3 data-i18n="control.sourceSettings.title">${t('control.sourceSettings.title')}</h3>
              <p class="section-hint" data-i18n="control.sourceSettings.hint">${t('control.sourceSettings.hint')}</p>
              <div class="tool-item">
                <label data-i18n="control.sourceSettings.selection">${t('control.sourceSettings.selection')}</label>
                <div class="tool-values">
                  <div class="tool-value">
                    <span class="label" data-i18n="control.label.x">${t('control.label.x')}</span>
                    <span id="source-x-value">0</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label" data-i18n="control.label.y">${t('control.label.y')}</span>
                    <span id="source-y-value">0</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label" data-i18n="control.label.w">${t('control.label.w')}</span>
                    <span id="source-w-value">100</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label" data-i18n="control.label.h">${t('control.label.h')}</span>
                    <span id="source-h-value">100</span>%
                  </div>
                </div>
              </div>
              <button id="reset-source-btn" class="tool-button" data-i18n="control.reset">
                ${t('control.reset')}
              </button>
            </div>

            <div class="tool-section">
              <h3 data-i18n="control.testPattern.title">${t('control.testPattern.title')}</h3>
              <p class="section-hint" data-i18n="control.testPattern.hint">${t('control.testPattern.hint')}</p>
              <div class="test-pattern-buttons">
                <button class="tool-button test-pattern-btn active" data-pattern="off" data-i18n="control.testPattern.off">${t('control.testPattern.off')}</button>
                <button class="tool-button test-pattern-btn" data-pattern="white" data-i18n="control.testPattern.white">${t('control.testPattern.white')}</button>
                <button class="tool-button test-pattern-btn" data-pattern="grid" data-i18n="control.testPattern.grid">${t('control.testPattern.grid')}</button>
                <button class="tool-button test-pattern-btn" data-pattern="smpte" data-i18n="control.testPattern.smpte">${t('control.testPattern.smpte')}</button>
              </div>
            </div>

            <div class="tool-section">
              <h3 data-i18n="control.devMode.title">${t('control.devMode.title')}</h3>
              <p class="section-hint" data-i18n="control.devMode.hint">${t('control.devMode.hint')}</p>
              <button id="dev-mode-toggle" class="tool-button dev-mode-toggle" aria-pressed="false">
                <span class="dev-mode-dot" aria-hidden="true"></span>
                <span class="dev-mode-label" data-i18n="control.devMode.off">${t('control.devMode.off')}</span>
              </button>
            </div>

            <div class="tool-section">
              <h3 data-i18n="control.mappingSettings.title">${t('control.mappingSettings.title')}</h3>
              <p class="section-hint" data-i18n="control.mappingSettings.hint">${t('control.mappingSettings.hint')}</p>
              <div class="tool-item">
                <label data-i18n="control.mappingSettings.corners">${t('control.mappingSettings.corners')}</label>
                <div class="tool-values quad-values">
                  <div class="tool-value"><span class="label">TL:</span><span id="mapping-tl-value">25, 25</span></div>
                  <div class="tool-value"><span class="label">TR:</span><span id="mapping-tr-value">75, 25</span></div>
                  <div class="tool-value"><span class="label">BL:</span><span id="mapping-bl-value">25, 75</span></div>
                  <div class="tool-value"><span class="label">BR:</span><span id="mapping-br-value">75, 75</span></div>
                </div>
              </div>
              <button id="reset-mapping-btn" class="tool-button" data-i18n="control.reset">
                ${t('control.reset')}
              </button>
            </div>

            <div class="tool-section">
              <h3 data-i18n="control.io.title">${t('control.io.title')}</h3>
              <p class="section-hint" data-i18n="control.io.hint">${t('control.io.hint')}</p>
              <div class="io-buttons">
                <button id="export-settings-btn" class="tool-button" data-i18n="control.io.export">${t('control.io.export')}</button>
                <button id="import-settings-btn" class="tool-button" data-i18n="control.io.import">${t('control.io.import')}</button>
              </div>
            </div>

          </div>
        </div>

        <!-- tool ↔ source の区切りリサイザ -->
        <div class="dc-column-resizer" data-resize-edge="tool" data-i18n-title="control.resizer.tool" title="${t('control.resizer.tool')}" aria-hidden="true"></div>

        <!-- ソースカラム -->
        <div class="column source-column" data-resize-target="source">
          <div class="column-header">
            <h2 data-i18n="control.column.source">${t('control.column.source')}</h2>
          </div>
          <div class="video-container">
            <div class="source-preview-wrapper">
              <div class="canvas-frame">
                <video id="source-video" autoplay muted playsinline>
                  <p data-i18n="control.source.loading">${t('control.source.loading')}</p>
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
        <div class="dc-column-resizer" data-resize-edge="source" data-i18n-title="control.resizer.source" title="${t('control.resizer.source')}" aria-hidden="true"></div>

        <!-- マッピングカラム -->
        <div class="column mapping-column">
          <div class="column-header">
            <div class="dc-tab-strip" role="tablist" data-i18n-aria-label="control.tabstrip.label" aria-label="${t('control.tabstrip.label')}">
              <button class="dc-tab is-active" role="tab" aria-selected="true" data-tab="mapping" data-i18n="control.tab.mapping">${t('control.tab.mapping')}</button>
              <button class="dc-tab" role="tab" aria-selected="false" data-tab="layout" data-i18n="control.tab.layout">${t('control.tab.layout')}</button>
            </div>
          </div>
          <div class="mapping-container">
            <!-- 全出力で共有する hidden mapping-video（cropped-video への stream donor） -->
            <video id="mapping-video" autoplay muted playsinline style="display: none;">
              <p data-i18n="control.source.loading">${t('control.source.loading')}</p>
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
}

/** scope 内の data-i18n / data-i18n-title / data-i18n-aria-label / data-i18n-html 属性を再翻訳。 */
export function applyControlTranslations(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n') as MessageKey | null;
    if (key) el.textContent = t(key);
  });
  scope.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html') as MessageKey | null;
    if (key) el.innerHTML = t(key);
  });
  scope.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title') as MessageKey | null;
    if (key) el.title = t(key);
  });
  scope.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label') as MessageKey | null;
    if (key) el.setAttribute('aria-label', t(key));
  });
}

/**
 * 後方互換用: 文字列を要求している既存呼び出し側のため、現言語で生成した HTML を返す getter。
 * 言語切替対応の呼び出し側は controlPanelHtml() を直接使うこと。
 */
export const CONTROL_PANEL_HTML = controlPanelHtml();
