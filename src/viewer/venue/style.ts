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

    /* ツール列: 見出し (メニュー・タイトル・閉じる) は流れないよう固定し、メニューの包含ブロックにもする */
    .dc-venue-page .tool-column > .column-header { position:sticky;top:0;z-index:20;gap:6px;padding:0 8px; }
    .dc-venue-page .tool-column > .column-header h2 { flex:1;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .dc-venue-page .dc-workspace-close { display:flex;align-items:center;padding:5px;border-radius:5px;color:#eee; }
    .dc-venue-page .dc-workspace-close:hover { background:#444; }
    .dc-venue-lang { padding:6px 11px 3px;border-top:1px solid #444;margin-top:4px; }
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
    .dc-venue-page .tool-content .tool-button { width:100%; }
    .dc-venue-page #dc-practice-venue { margin:0;padding:0;border:0; }
    .dc-venue-page #dc-practice-venue > summary { display:none; }
    .dc-venue-page .dc-practice-object-actions .tool-button { width:auto; }
    .dc-venue-step { display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:6px 0;font-size:12px;color:#bbb; }
    .dc-venue-step span:first-child { margin-right:4px; }
    .dc-venue-page .dc-venue-step .tool-button { flex:1;width:auto;margin:0;padding:5px 6px;font-size:11px; }
    .dc-venue-page .dc-venue-step .tool-button[aria-pressed=true] { background:#2563eb;border-color:#60a5fa;color:white; }
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

    /* 狭い画面: ツール列の右で、像を上・3D を下に積む */
    @media(max-width:900px) {
      .dc-venue-page .control-container { display:grid;grid-template-columns:220px minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr); }
      .dc-venue-page .tool-column { grid-row:1 / span 2;width:auto!important;min-width:0;max-width:none; }
      .dc-venue-page .dc-column-resizer { display:none; }
      .dc-venue-page .dc-venue-pane { min-width:0;width:auto!important;flex:none!important;border-right:0; }
      .dc-venue-page #venue-image-pane { border-bottom:1px solid #333; }
    }
  `;
  document.head.append(shell,style);
}
