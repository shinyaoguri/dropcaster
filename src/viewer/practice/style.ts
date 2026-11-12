export function installPracticeStyles(): void {
  if (document.getElementById('dc-practice-styles')) return;
  const style = document.createElement('style'); style.id = 'dc-practice-styles';
  style.textContent = `
    .dc-control-shell.dc-mapping-workspace { display:flex; flex-direction:column; min-height:0; }
    .dc-inline-editor .dc-mapping-workspace > .control-container { flex:1; height:auto; min-height:0; }
    .dc-practice-toolbar { display:flex; align-items:center; gap:12px; padding:8px 14px; min-height:46px; box-sizing:border-box; background:#242424; border-bottom:1px solid #444; color:#eee; font:13px system-ui; }
    .dc-practice-toolbar strong { white-space:nowrap; font-size:14px; }
    #dc-practice-status { flex:1; color:#aaa; font-size:12px; }
    #dc-practice-status.is-error { color:#fbbf24; }
    .dc-practice-toolbar button { border:1px solid #555; border-radius:5px; color:#eee; background:#333; padding:7px 11px; cursor:pointer; white-space:nowrap; }
    .dc-practice-toolbar button:hover { background:#444; border-color:#888; }
    .dc-practice-toolbar button:focus-visible { outline:2px solid #3b82f6; outline-offset:2px; }
    .dc-workspace-menu { position:relative; flex-shrink:0; }
    .dc-workspace-menu > summary { display:flex; gap:7px; align-items:center; padding:7px 10px; border:1px solid #555; border-radius:5px; cursor:pointer; list-style:none; background:#333; }
    .dc-workspace-menu > summary::-webkit-details-marker { display:none; }
    .dc-workspace-menu > summary:hover { background:#444; }
    .dc-workspace-menu > summary:focus-visible { outline:2px solid #3b82f6; outline-offset:2px; }
    .dc-workspace-menu-items { position:absolute; right:0; top:calc(100% + 6px); z-index:100; width:210px; padding:5px; background:#292929; border:1px solid #555; border-radius:6px; box-shadow:0 8px 24px #0008; }
    .dc-workspace-menu-items button { display:block; width:100%; border:0; background:transparent; text-align:left; }
    .dc-practice-toolbar .dc-workspace-close { display:flex; align-items:center; padding:7px; background:transparent; border-color:transparent; }
    .dc-practice-guide-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:0 10px; }
    .dc-mapping-workspace .source-column, .dc-mapping-workspace .mapping-column { min-width:240px; min-height:0; }
    #preview-stage { flex:1; min-height:0; flex-direction:column; }
    .dc-practice-panel { flex:1; min-height:200px; display:flex; flex-direction:column; overflow:hidden;  }
    .dc-practice-panel .column-header { height:auto; min-height:44px; gap:8px; padding:8px 12px; flex-wrap:wrap; }
    .dc-practice-view-actions { display:flex; gap:4px; flex-wrap:wrap; }
    .dc-practice-view-actions .tool-button { padding:4px 7px; width:auto; font-size:11px; margin:0; }
    .dc-venue-editor { padding:7px 10px; border-top:1px solid #444; border-bottom:1px solid #444; background:#252525; color:#ddd; font:12px system-ui; max-height:45%; overflow:auto; }
    .dc-venue-editor[hidden], .dc-venue-editor [hidden] { display:none; }
    .dc-venue-actions { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin:3px 0; }
    .dc-venue-actions strong { flex:1; }
    .dc-venue-editor .tool-button { width:auto; padding:5px 8px; margin:0; font-size:12px; }
    .dc-venue-editor .tool-button[aria-pressed=true] { background:#2563eb; border-color:#60a5fa; color:white; }
    .dc-venue-editor button:disabled { opacity:.45; cursor:not-allowed; }
    .dc-venue-editor .dc-practice-check { margin:2px 0; }
    .dc-venue-shape { display:flex; align-items:center; gap:5px; }
    .dc-venue-shape select { border:1px solid #555; border-radius:4px; background:#191919; color:#eee; padding:5px; }
    .dc-practice-viewport { flex:1; min-height:120px; position:relative; background:#151b25; }
    #dc-practice-canvas { position:absolute; width:100%; height:100%; display:block; touch-action:none; }
    .dc-practice-hint { color:#aaa; font-size:11px; line-height:1.5; margin:7px 0; }
    .dc-practice-panel > .dc-practice-hint { margin:5px 10px; }
    .dc-practice-settings { border-top:1px solid #444; padding-top:12px; }
    .dc-practice-settings summary { cursor:pointer; font-size:13px; font-weight:600; color:#eee; padding:4px 0 10px; }
    .dc-practice-settings fieldset { padding:0; margin:10px 0; border:0; min-width:0; }
    .dc-practice-settings legend { font-size:12px; color:#bbb; margin-bottom:5px; }
    .dc-practice-field { display:flex; flex-direction:column; gap:5px; margin:9px 0; color:#bbb; font-size:12px; }
    .dc-practice-settings input:not([type=checkbox]):not([type=range]):not([type=file]), .dc-practice-settings select { width:100%; box-sizing:border-box; min-width:0; border:1px solid #555; border-radius:4px; background:#191919; color:#eee; padding:6px; font:12px system-ui; }
    .dc-practice-settings input:invalid { border-color:#f59e0b; }
    .dc-practice-settings input[type=color] { height:32px; }
    .dc-practice-vector { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
    .dc-practice-vector label { font-size:11px; color:#aaa; }
    .dc-practice-check { display:flex; align-items:center; gap:6px; font-size:12px; color:#ccc; line-height:1.4; margin:10px 0; }
    .dc-practice-settings ul { padding-left:18px; font-size:12px; color:#ccc; overflow-wrap:anywhere; }
    .dc-practice-settings .tool-button { margin:4px 0; }
    .dc-practice-object-actions { display:flex; gap:5px; flex-wrap:wrap; }
    .dc-practice-object-actions .dc-practice-field { flex:1; min-width:110px; margin:4px 0; }
    .dc-practice-object-actions #practice-add-object { flex:0; align-self:flex-end; }
    .dc-practice-object-actions .tool-button { width:auto; flex:1; min-width:65px; }
    .dc-practice-settings button:disabled { opacity:.45; cursor:not-allowed; }
    .dc-practice-help { display:block; color:#93c5fd; font-size:12px; margin:8px 0; }
    @media(max-width:1000px) {
      .dc-mapping-workspace .control-container { display:grid; grid-template-columns:230px minmax(0,1fr); grid-template-rows:minmax(160px,.7fr) minmax(300px,1.3fr); overflow:auto; }
      .dc-mapping-workspace .tool-column { grid-row:1/3; width:auto; min-width:0; max-width:none; }
      .dc-mapping-workspace .dc-column-resizer { display:none; }
      .dc-mapping-workspace .source-column { grid-column:2; grid-row:1; min-height:0; }
      .dc-mapping-workspace .mapping-column { grid-column:2; grid-row:2; }
      .dc-practice-toolbar { flex-wrap:wrap; gap:7px; }
      #dc-practice-status { flex-basis:50%; }
    }
  `;
  document.head.append(style);
}
