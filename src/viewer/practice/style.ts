export function installPracticeStyles(): void {
  if (document.getElementById('dc-practice-styles')) return;
  const style = document.createElement('style'); style.id = 'dc-practice-styles';
  style.textContent = `
    .dc-control-shell.dc-mapping-workspace { display:flex; flex-direction:column; min-height:0; }
    .dc-inline-editor .dc-mapping-workspace > .control-container { flex:1; height:auto; min-height:0; }
    /* 上部バーは持たない。ホームへ戻る・閉じるはアクティビティバーの下端に置く (ADR 0021)。
       ツールカラムの見出し (パネル名) は狭い画面で全体が縦スクロールしても流れないよう固定する。 */
    .dc-mapping-workspace .tool-column > .column-header { position:sticky; top:0; z-index:20; gap:6px; padding:0 8px; }
    .dc-workspace-actions { display:flex; align-items:center; gap:2px; margin-left:auto; color:#eee; font:12px system-ui; }
    .dc-workspace-actions button { border:1px solid transparent; border-radius:5px; color:#eee; background:transparent; cursor:pointer; white-space:nowrap; }
    .dc-workspace-actions button:focus-visible { outline:2px solid #3b82f6; outline-offset:2px; }
    .dc-activity-bar-footer .dc-workspace-actions { flex-direction:column; gap:4px; margin:0; }
    /* プロジェクトパネル末尾の会場の入口。<a> を他の .tool-button と同じ幅・見た目のボタンにする。 */
    .dc-venue-entry-link { display:block; box-sizing:border-box; text-align:center; text-decoration:none; }
    .dc-workspace-actions .dc-workspace-close { box-sizing:border-box; border-radius:5px; text-decoration:none; display:flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0; color:#8a8a8a; }
    .dc-workspace-actions .dc-workspace-close:hover { color:#eee; }
    .dc-workspace-actions .dc-workspace-close:hover { background:#444; }
    /* × の確認ダイアログ。背景クリックの判定のため dialog 自身は余白を持たず、中身の body が余白を持つ。 */
    .dc-workspace-confirm { margin:auto; padding:0; border:1px solid #555; border-radius:8px; background:#292929; color:#eee; box-shadow:0 12px 32px #000a; max-width:min(360px, calc(100vw - 32px)); }
    .dc-workspace-confirm::backdrop { background:#0008; }
    .dc-workspace-confirm-body { padding:16px 18px 14px; font:13px/1.5 system-ui; }
    .dc-workspace-confirm-title { margin:0 0 4px; font-size:14px; font-weight:600; }
    .dc-workspace-confirm-hint { margin:0 0 14px; color:#bbb; white-space:normal; }
    .dc-workspace-confirm-actions { display:flex; justify-content:flex-end; gap:8px; }
    /* 確定がページ遷移のもの (ホームへ戻る) は <a> なので、button と同じ見た目にする。 */
    .dc-workspace-actions .dc-workspace-confirm-actions :is(button, a) { padding:6px 14px; border:1px solid #555; border-radius:5px; background:#333; color:#eee; text-decoration:none; font:13px system-ui; }
    .dc-workspace-actions .dc-workspace-confirm-actions :is(button, a):hover { background:#444; }
    .dc-workspace-actions .dc-workspace-confirm-actions .is-danger { border-color:#dc2626; background:#b91c1c; color:white; }
    .dc-workspace-actions .dc-workspace-confirm-actions .is-danger:hover { background:#dc2626; }
    /* 平常時の状態文は読み上げ用に残し、見た目からは外す。エラーと再試行があるときだけ出す。 */
    .dc-workspace-notice:not(.is-visible) { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    .dc-workspace-notice.is-visible { display:flex; flex-direction:column; gap:6px; padding:8px 12px; border-bottom:1px solid #444; background:#2a2a2a; font:12px system-ui; color:#aaa; }
    #dc-practice-status.is-error { color:#fbbf24; }
    .dc-workspace-notice .tool-button { width:auto; align-self:flex-start; margin:0; }
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
    .dc-practice-panel:has(.dc-venue-editor:not([hidden])) .dc-practice-viewport { min-height:200px; }
    #dc-practice-canvas { position:absolute; width:100%; height:100%; display:block; touch-action:none; }
    .dc-practice-hint { color:#aaa; font-size:11px; line-height:1.5; margin:7px 0; }
    .dc-practice-panel > .dc-practice-hint { margin:5px 10px; }
    .dc-practice-settings { border-top:1px solid #444; padding-top:12px; }
    .dc-tool-panel > .dc-practice-settings:first-child { border-top:0; padding-top:0; }
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
    /* 作品の一覧。OP / Gist は固定の状態と操作を作品ごとに並べる (#197)。 */
    #practice-content-list > li { margin:0 0 8px; }
    #practice-content-list .dc-content-pin { margin:3px 0; }
    .dc-content-actions { display:flex; gap:5px; flex-wrap:wrap; }
    .dc-practice-settings .dc-content-actions .tool-button { width:auto; flex:1; min-width:90px; margin:2px 0; padding:5px 8px; font-size:12px; }
    .dc-practice-settings .tool-button { margin:4px 0; }
    .dc-practice-object-actions { display:flex; gap:5px; flex-wrap:wrap; }
    .dc-practice-object-actions .dc-practice-field { flex:1; min-width:110px; margin:4px 0; }
    .dc-practice-object-actions #practice-add-object { flex:0; align-self:flex-end; }
    .dc-practice-object-actions .tool-button { width:auto; flex:1; min-width:65px; }
    .dc-practice-settings button:disabled { opacity:.45; cursor:not-allowed; }
    .dc-practice-help { display:block; color:#93c5fd; font-size:12px; margin:8px 0; }
    @media(max-width:1000px) {
      .dc-mapping-workspace .control-container { display:grid; grid-template-columns:44px 230px minmax(0,1fr); grid-template-rows:minmax(160px,.7fr) minmax(300px,1.3fr); overflow:auto; }
      .dc-mapping-workspace .control-container.is-tool-collapsed { grid-template-columns:44px minmax(0,1fr); }
      .dc-mapping-workspace .dc-activity-bar { grid-column:1; grid-row:1/3; }
      .dc-mapping-workspace:has(.dc-venue-editor:not([hidden])) .control-container { grid-template-rows:minmax(200px,.6fr) minmax(480px,1.4fr); }
      .dc-mapping-workspace .tool-column { grid-column:2; grid-row:1/3; width:auto; min-width:0; max-width:none; }
      .dc-mapping-workspace .dc-column-resizer { display:none; }
      .dc-mapping-workspace .source-column { grid-column:3; grid-row:1; min-height:0; }
      .dc-mapping-workspace .mapping-column { grid-column:3; grid-row:2; }
      .dc-mapping-workspace .is-tool-collapsed .source-column, .dc-mapping-workspace .is-tool-collapsed .mapping-column { grid-column:2; }
    }
  `;
  document.head.append(style);
}
