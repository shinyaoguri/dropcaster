export function installVenueStyles(): void {
  if(document.getElementById('dc-venue-page-style'))return;
  const style=document.createElement('style');style.id='dc-venue-page-style';
  style.textContent=`
    .dc-venue-page { position:fixed;inset:0;display:flex;flex-direction:column;background:#1a1a1a;color:#eee;font:13px system-ui;min-width:0; }
    .dc-venue-page * { box-sizing:border-box; }
    .dc-venue-page [hidden] { display:none!important; }
    .dc-venue-header { display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 16px;background:#242424;border-bottom:1px solid #444; }
    .dc-venue-header h1 { flex:1;margin:0;font-size:17px; }
    .dc-venue-page a { color:#93c5fd; }
    .dc-venue-intro { margin:0;padding:7px 16px;color:#bbb;font-size:12px;line-height:1.5; }
    .dc-venue-page .tool-button,.dc-venue-page select,.dc-venue-tabs button { border:1px solid #555;border-radius:4px;background:#333;color:#eee;padding:7px 10px;cursor:pointer;font:12px system-ui; }
    .dc-venue-page .tool-button:hover,.dc-venue-tabs button:hover { background:#444; }
    .dc-venue-page button:focus-visible,.dc-venue-page select:focus-visible,.dc-venue-page a:focus-visible { outline:2px solid #60a5fa;outline-offset:2px; }
    .dc-venue-page button:disabled { opacity:.45;cursor:not-allowed; }
    .dc-venue-page #venue-open-output { background:#2563eb;border-color:#3b82f6; }
    .dc-venue-layout { display:grid;grid-template-columns:280px minmax(0,1fr);flex:1;min-height:0; }
    .dc-venue-layout > aside { display:flex;flex-direction:column;border:0;border-right:1px solid #444;margin:0;padding:0;min-height:0; }
    .dc-venue-sidebar-scroll { flex:1;overflow:auto;padding:12px 15px; }
    .dc-venue-sidebar-scroll .tool-button { width:100%; }
    .dc-venue-sidebar-scroll .dc-practice-object-actions .tool-button { width:auto; }
    .dc-venue-page #dc-practice-venue > summary { display:none; }
    .dc-venue-page #dc-practice-venue { margin:0; }
    .dc-venue-main { display:flex;flex-direction:column;min-width:0;min-height:0;padding:0 10px 10px;overflow:auto; }
    .dc-venue-output-controls { display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0 0; }
    .dc-venue-output-controls label { display:flex;gap:6px;align-items:center;font-size:12px;color:#bbb; }
    .dc-venue-tabs { display:flex;gap:4px;padding:7px 8px;border-bottom:1px solid #444;background:#242424; }
    .dc-venue-tabs button { flex:1; }
    .dc-venue-layout > aside .dc-venue-tabs button { flex:1 1 auto;padding:7px 4px;font-size:11px;white-space:nowrap; }
    .dc-venue-tabs button[aria-selected=true] { background:#2563eb;border-color:#60a5fa; }
    .dc-venue-main .dc-venue-tabs button { flex:0 1 180px; }
    .dc-venue-main .dc-practice-panel { flex:1;min-height:350px; }
    .dc-venue-page .column-header { display:flex;align-items:center;background:#292929; }
    .dc-venue-page .dc-practice-check { margin:5px 0; }
    .dc-venue-page .dc-venue-editor { max-height:40%; }
    #venue-canvas { position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none; }
    #venue-output-stage { flex:1;min-height:240px;background:black;display:flex;align-items:center;justify-content:center;overflow:hidden; }
    #venue-projection-canvas { width:100%;height:100%;max-height:100%;object-fit:contain;display:block; }
    .dc-venue-page footer { display:flex;gap:10px;align-items:center;min-height:32px;border-top:1px solid #444;padding:6px 16px;background:#242424;font-size:12px;color:#bbb; }
    .dc-venue-page #venue-status { flex:1; }.dc-venue-page .is-error { color:#fbbf24; }
    @media(max-width:900px) { .dc-venue-layout { grid-template-columns:240px minmax(0,1fr); }.dc-venue-header { gap:8px;padding:8px; }.dc-venue-main { padding:0 6px 6px; } }
    @media(max-width:620px) { .dc-venue-layout { grid-template-columns:1fr;grid-template-rows:minmax(190px,.55fr) minmax(480px,1.45fr);overflow:auto; }.dc-venue-layout > aside { border-right:0;border-bottom:1px solid #444; }.dc-venue-intro { font-size:11px; }.dc-venue-header h1 { font-size:14px; }.dc-venue-main .dc-practice-panel { min-height:320px; } }
  `;
  document.head.append(style);
}
