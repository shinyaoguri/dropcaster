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
import { buildInfoHtml } from '../../utils/buildInfo';

/**
 * アクティビティバーのアイコン (20px・線画)。マッピング画面と会場の作成・調整画面で同じ形を使う (ADR 0021)。
 */
const ACTIVITY_ICON_PATHS = {
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3Z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  projector: '<rect x="2" y="8" width="14" height="9" rx="2"/><circle cx="9" cy="12.5" r="2.5"/><path d="m16 11 6-3v9l-6-3"/>',
  home: '<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>',
  crosshair: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
} as const;
export type ActivityIcon = keyof typeof ACTIVITY_ICON_PATHS;
export function activityIcon(name: ActivityIcon): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ACTIVITY_ICON_PATHS[name]}</svg>`;
}

/**
 * アクティビティバーの 1 ボタン。`dc-activity-<panel>` が `dc-tool-panel-<panel>` を切り替える (ActivityBar)。
 * 最初は `active` のボタンだけが選択中・タブ移動の対象。
 */
export function activityButtonHtml(panel: string, labelKey: MessageKey, icon: ActivityIcon, active = false): string {
  return `<button type="button" class="dc-activity-btn${active ? ' is-active' : ''}" id="dc-activity-${panel}" role="tab" aria-selected="${active}"${active ? '' : ' tabindex="-1"'} aria-controls="dc-tool-panel-${panel}" data-tool-panel="${panel}" data-i18n-title="${labelKey}" title="${t(labelKey)}" data-i18n-aria-label="${labelKey}" aria-label="${t(labelKey)}">
            ${activityIcon(icon)}
          </button>`;
}

export function controlPanelHtml(): string {
  const buildInfoMarkup = buildInfoHtml();
  return `
      <div class="dc-control-shell">
      <div id="dc-webgl-lost-banner" class="dc-banner dc-banner-warn" hidden role="status">
        <span class="dc-banner-icon">⚠</span>
        <span class="dc-banner-text" data-i18n-html="control.banner.webglLost">${t('control.banner.webglLost')}</span>
      </div>
      <div class="control-container">
        <!-- アクティビティバー: ツールカラムの中身 (パネル) を切り替える。選択中を再度押すとツールカラムを畳む -->
        <div class="dc-activity-bar">
          <div class="dc-activity-tabs" role="tablist" aria-orientation="vertical" data-i18n-aria-label="control.activity.label" aria-label="${t('control.activity.label')}">
          ${activityButtonHtml('mappings', 'control.panel.mappings', 'layers', true)}
          ${activityButtonHtml('outputs', 'control.panel.outputs', 'monitor')}
          ${activityButtonHtml('check', 'control.panel.check', 'grid')}
          ${activityButtonHtml('preview3d', 'control.panel.preview3d', 'cube')}
          ${activityButtonHtml('project', 'control.panel.project', 'save')}
          </div>
          <!-- 下端の操作 (編集を閉じる など) の差し込み先。MappingWorkspace が使う -->
          <div class="dc-activity-bar-footer"></div>
        </div>
        <!-- ツールカラム -->
        <div class="column tool-column" data-resize-target="tool">
          <div class="column-header">
            <h2 id="dc-tool-panel-title" data-i18n="control.panel.mappings">${t('control.panel.mappings')}</h2>
            <!-- 編集履歴 (Undo / Redo)。どのパネルでも効く操作なので見出し行に置く -->
            <div class="dc-history" role="toolbar" data-i18n-aria-label="control.history.label" aria-label="${t('control.history.label')}">
              <button type="button" id="dc-undo-btn" class="dc-history-btn" disabled>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
              </button>
              <button type="button" id="dc-redo-btn" class="dc-history-btn" disabled>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
              </button>
            </div>
          </div>
          <div class="tool-content">
            <!-- マッピング: 一覧と、選択中のマッピングのソース範囲・四隅 -->
            <div class="dc-tool-panel is-active" id="dc-tool-panel-mappings" role="tabpanel" aria-labelledby="dc-activity-mappings" data-tool-panel="mappings">
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
            </div>

            <!-- 出力: 出力ウィンドウの一覧と、選択中の出力の位置・サイズ -->
            <div class="dc-tool-panel" id="dc-tool-panel-outputs" role="tabpanel" aria-labelledby="dc-activity-outputs" data-tool-panel="outputs">
              <div class="tool-section">
                <h3 data-i18n="control.outputs.title">${t('control.outputs.title')}</h3>
                <div id="outputs-list" class="outputs-list"></div>
                <button id="add-output-btn" class="tool-button" data-i18n="control.outputs.add">${t('control.outputs.add')}</button>
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
            </div>

            <!-- 確認: テストパターンと開発モード -->
            <div class="dc-tool-panel" id="dc-tool-panel-check" role="tabpanel" aria-labelledby="dc-activity-check" data-tool-panel="check">
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
            </div>

            <!-- 3D: 中身は PracticePanel が読み込み時に入れる -->
            <div class="dc-tool-panel" id="dc-tool-panel-preview3d" role="tabpanel" aria-labelledby="dc-activity-preview3d" data-tool-panel="preview3d">
            </div>

            <!-- プロジェクト: 保存・読込 (PracticePanel が先頭に入れる) と設定の入出力 -->
            <div class="dc-tool-panel" id="dc-tool-panel-project" role="tabpanel" aria-labelledby="dc-activity-project" data-tool-panel="project">
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
          <!-- 動いている版。tool-content の外に置き、スクロールしても下端に見えるようにする -->
          ${buildInfoMarkup ? `<footer class="dc-build-info">${buildInfoMarkup}</footer>` : ''}
        </div>

        <!-- tool ↔ source の区切りリサイザ -->
        <div class="dc-column-resizer" data-resize-edge="tool" data-i18n-title="control.resizer.tool" title="${t('control.resizer.tool')}" aria-hidden="true"></div>

        <!-- ソースカラム -->
        <div class="column source-column" data-resize-target="source">
          <div class="column-header">
            <h2 data-i18n="control.column.source">${t('control.column.source')}</h2>
          </div>
          <!-- 投影が映らないときの作品側の原因と対処 (#196)。文言は ProjectionDiagnosisPanel が入れる -->
          <div id="dc-source-status" class="dc-source-status" role="status" aria-live="polite" hidden>
            <span class="dc-source-status-text"></span>
            <span class="dc-source-status-hint" hidden></span>
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
              <button class="dc-tab is-active" id="mapping-tab" role="tab" aria-selected="true" aria-controls="output-stage" data-tab="mapping" data-i18n="control.tab.mapping">${t('control.tab.mapping')}</button>
              <button class="dc-tab" id="layout-tab" role="tab" aria-selected="false" tabindex="-1" aria-controls="layout-stage" data-tab="layout" data-i18n="control.tab.layout">${t('control.tab.layout')}</button>
              <button class="dc-tab" id="preview-tab" role="tab" aria-selected="false" tabindex="-1" aria-controls="preview-stage" data-tab="preview" data-i18n="control.tab.preview">${t('control.tab.preview')}</button>
            </div>
          </div>
          <div class="mapping-container">
            <!-- 全出力で共有する hidden mapping-video（cropped-video への stream donor） -->
            <video id="mapping-video" autoplay muted playsinline style="display: none;">
              <p data-i18n="control.source.loading">${t('control.source.loading')}</p>
            </video>
            <!-- マッピング編集ビュー: 出力ごとのフレームを横並びに並べたステージ。OutputVizPanel が組み立てる -->
            <div id="output-stage" class="output-stage dc-tab-pane is-active" role="tabpanel" aria-labelledby="mapping-tab" data-tab-pane="mapping"></div>
            <!-- 出力レイアウトビュー: 仮想キャンバス全体を縮小表示して、各出力を 2D ドラッグ・リサイズで配置する -->
            <div id="layout-stage" class="layout-stage dc-tab-pane" role="tabpanel" aria-labelledby="layout-tab" data-tab-pane="layout"></div>
            <div id="preview-stage" class="dc-tab-pane" role="tabpanel" aria-labelledby="preview-tab" data-tab-pane="preview"></div>
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
