import { CONTROL_PANEL_CSS } from '../windows/control/ControlWindow.styles';

/**
 * 会場ページはマッピング画面と同じ骨格 (ツール列 + 2 ペイン) を使う。骨格の CSS は
 * マッピングと同じく @scope (.dc-control-shell) に閉じ、会場ページ固有の差分だけを下に足す。
 */
export function installVenueStyles(): void {
  if(document.getElementById('dc-venue-page-style'))return;
  const shell=document.createElement('style');shell.id='dc-venue-shell-style';
  shell.textContent=`@scope (.dc-control-shell) {\n${CONTROL_PANEL_CSS}\n}`;
  const style=document.createElement('style');style.id='dc-venue-page-style';
  style.textContent=`
    .dc-venue-page { position:fixed;inset:0;background:#1a1a1a;color:#eee;font:13px system-ui;min-width:0; }
    .dc-venue-page * { box-sizing:border-box; }
    .dc-venue-page [hidden] { display:none!important; }
    .dc-venue-page a { color:#93c5fd; }
    .dc-venue-page .control-container { height:100%; }
    .dc-venue-page button:focus-visible,.dc-venue-page select:focus-visible,.dc-venue-page a:focus-visible,.dc-venue-page summary:focus-visible { outline:2px solid #60a5fa;outline-offset:2px; }
    .dc-venue-page button:disabled { opacity:.45;cursor:not-allowed; }
    .dc-venue-page select { border:1px solid #555;border-radius:4px;background:#191919;color:#eee;padding:5px;font:12px system-ui; }

    /* 左端のアクティビティバー・ツール列の見出し (パネル名) はマッピング画面と同じ (CONTROL_PANEL_CSS / practice/style.ts)。
       見出しは狭い画面で全体が縦スクロールしても流れないよう固定する。 */
    .dc-venue-page .tool-column > .column-header { position:sticky;top:0;z-index:20; }
    /* マッピングを開く ↗ は <a> だが、ほかの .tool-button と同じ見た目にする (リンク色を当てない) */
    .dc-venue-page a.tool-button { color:#fff;margin:4px 0; }
    .dc-venue-page .dc-venue-lang .dc-lang-toggle { background:#1a1a1a;height:28px; }
    .dc-venue-page .dc-venue-lang .dc-lang-toggle-opt { display:inline-flex;width:auto;padding:0 12px;color:#999;font:600 11px system-ui;letter-spacing:.1em; }
    .dc-venue-page .dc-venue-lang .dc-lang-toggle-opt.is-active { background:#444;color:#fff;box-shadow:none; }
    .dc-venue-status { display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid #333;font-size:12px;color:#aaa;line-height:1.4; }
    .dc-venue-status #venue-status { flex:1;min-width:0; }
    .dc-venue-page .is-error { color:#fbbf24; }
    .dc-venue-status .tool-button { width:auto;margin:0;padding:4px 10px; }
    .dc-venue-page .tool-content { padding:10px 14px; }
    .dc-venue-page .tool-section > summary { margin:0 0 8px;font-size:13px;font-weight:600;color:#ddd;cursor:pointer; }
    .dc-venue-page .tool-section { margin-bottom:14px;padding-bottom:12px; }
    .dc-venue-page .tool-section h3 { margin:0 0 8px;font-size:13px;font-weight:600;color:#ddd; }
    .dc-venue-page .tool-section:last-child { border-bottom:0; }
    .dc-venue-page .tool-content .tool-button { width:100%; }
    .dc-venue-page #dc-practice-venue { margin:0;padding:0;border:0; }
    .dc-venue-page #dc-practice-venue > summary { display:none; }
    .dc-venue-page .dc-practice-object-actions .tool-button { width:auto; }
    .dc-venue-step { display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:6px 0;font-size:12px;color:#bbb; }
    .dc-venue-step span:first-child { margin-right:4px; }
    .dc-venue-page .dc-venue-step .tool-button { flex:1;width:auto;margin:0;padding:5px 6px;font-size:11px; }
    .dc-venue-page .dc-venue-step .tool-button[aria-pressed=true] { background:#2563eb;border-color:#60a5fa;color:white; }
    .dc-venue-trace-tools { display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:8px 0;font-size:12px;color:#bbb; }
    .dc-venue-trace-tools span { grid-column:1 / -1; }
    .dc-venue-page .dc-venue-trace-tools .tool-button { width:auto;margin:0;padding:6px;font-size:12px; }
    .dc-venue-page .dc-venue-trace-tools .tool-button[aria-pressed=true] { background:#dc2626;border-color:#f87171;color:white; }
    .dc-venue-trace-locks { margin:8px 0;padding:6px 8px;border:1px solid #333;border-radius:4px;font-size:12px;color:#ddd; }
    .dc-venue-trace-locks legend { padding:0 4px;color:#bbb; }
    .dc-venue-trace-locks label { display:flex;align-items:center;gap:6px;padding:2px 0; }
    .dc-venue-trace-locks[hidden], #venue-trace-build[hidden] { display:none; }
    .dc-venue-trace-step { margin:6px 0;padding:6px 8px;border-left:3px solid #ef4444;background:#1f1f1f;font-size:12px;color:#eee;line-height:1.4; }
    .dc-venue-trace-confirm { display:flex;align-items:center;gap:8px;font-size:12px;color:#bbb; }
    .dc-venue-trace-confirm span { flex:1;font-variant-numeric:tabular-nums; }
    .dc-venue-page .dc-venue-trace-confirm .tool-button { width:auto;margin:0;padding:5px 10px; }
    .dc-venue-trace-points { margin:0;padding:0;list-style:none;font-size:12px;max-height:220px;overflow:auto; }
    .dc-venue-trace-points li { display:flex;align-items:center;gap:6px;padding:2px 0;color:#ddd; }
    .dc-venue-trace-points li > span:first-child { width:3em;font-weight:600;color:#38bdf8; }
    .dc-venue-trace-points li.is-pending > span:first-child { color:#fde047; }
    .dc-venue-trace-points li.is-outlier > span { color:#f87171; }
    .dc-venue-trace-points li.is-moving { background:#262626; }
    .dc-venue-trace-residual { flex:1;font-variant-numeric:tabular-nums;color:#aaa; }
    .dc-venue-page .dc-venue-trace-points .tool-button { width:auto;margin:0;padding:2px 6px;font-size:11px; }
    .dc-venue-trace-status { font-size:12px;color:#ccc;line-height:1.5;margin:8px 0; }
    .dc-venue-trace-status p { margin:0 0 4px; }
    .dc-venue-page.is-tracing #venue-output-stage { cursor:crosshair; }
    .dc-venue-page #practice-aspect[readonly] { opacity:.7; }

    /* 2 ペイン: 投影される像 (= 出力窓と同じ canvas) と 3D 会場を同時に見る */
    .dc-venue-page .dc-venue-pane { min-width:240px;min-height:0;overflow:hidden; }
    .dc-venue-page .dc-venue-pane > .column-header { height:auto;min-height:44px;gap:8px;padding:6px 12px;flex-wrap:wrap; }
    .dc-venue-page .dc-venue-pane > .column-header h2 { margin:0 auto 0 0;font-size:14px; }
    .dc-venue-page .dc-venue-pane > .column-header .tool-button { width:auto;margin:0;padding:4px 8px;font-size:11px; }
    .dc-venue-page #venue-open-output { background:#2563eb;border-color:#3b82f6;color:white; }
    .dc-venue-header-field { display:flex;align-items:center;gap:6px;font-size:12px;color:#bbb; }
    #venue-output-stage { flex:1;min-height:200px;background:black;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab;touch-action:none; }
    #venue-output-stage:active { cursor:grabbing; }
    #venue-output-stage:focus-visible { outline:2px solid #60a5fa;outline-offset:-2px; }
    #venue-image { display:block;max-width:100%;max-height:100%; }
    .dc-venue-page .mapping-column .dc-practice-viewport { flex:1;min-height:200px; }
    .dc-venue-page .dc-venue-editor { max-height:40%; }
    #venue-canvas { position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none; }

    /* 狭い画面: バーとツール列の右で、像を上・3D を下に積む。ツール列を畳むと像と 3D がその幅を使う */
    @media(max-width:900px) {
      .dc-venue-page .control-container { display:grid;grid-template-columns:44px 220px minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr); }
      .dc-venue-page .control-container.is-tool-collapsed { grid-template-columns:44px minmax(0,1fr); }
      .dc-venue-page .dc-activity-bar { grid-column:1;grid-row:1 / span 2; }
      .dc-venue-page .tool-column { grid-column:2;grid-row:1 / span 2;width:auto!important;min-width:0;max-width:none; }
      .dc-venue-page .dc-column-resizer { display:none; }
      .dc-venue-page .dc-venue-pane { grid-column:3;min-width:0;width:auto!important;flex:none!important;border-right:0; }
      .dc-venue-page .is-tool-collapsed .dc-venue-pane { grid-column:2; }
      .dc-venue-page #venue-image-pane { grid-row:1;border-bottom:1px solid #333; }
      .dc-venue-page #venue-model-pane { grid-row:2; }
    }
  `;
  document.head.append(shell,style);
}
