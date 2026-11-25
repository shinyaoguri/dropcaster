import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { venueFixture } from '../fixtures/venue-glb.mjs';
import { checkMainHiddenNotice, setMainVisibility } from './lib/main-hidden-notice.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const artifactDir=process.env.VENUE_ARTIFACT_DIR;if(artifactDir)await mkdir(artifactDir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--enable-unsafe-swiftshader']});
async function setup(context,base){
  await context.route('**/sketches.json',route=>route.fulfill({json:[]}));
  const page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(base.url);
  await page.evaluate(async modules=>{
    const {VenueCalibrationPage}=await import(`${modules}/venue/VenueCalibrationPage.ts`),initialize=VenueCalibrationPage.prototype.initialize;
    VenueCalibrationPage.prototype.initialize=function(){window.calibrationPage=this;return initialize.call(this)};
  },base.modules);
  await page.locator('a[href="/venue"]').click();await ready(page);
  return page;
}
async function ready(page){
  await page.waitForSelector('#venue-canvas');await page.waitForFunction(()=>window.calibrationPage?.editor && !document.querySelector('#venue-model-pane').inert);
  await page.evaluate(()=>{window.practicePreview=window.calibrationPage.preview;window.venueEditor=window.calibrationPage.editor});
}
async function current(page){return page.evaluate(()=>structuredClone(window.calibrationPage.session.changes.get()))}
// ツール列は左端のアクティビティバーで切り替えるパネル (ADR 0021)。要素が別のパネルにあれば、そのパネルを開く。
async function reveal(page,selector){
  const panel=await page.locator(selector).first().evaluate(element=>element.closest('.dc-tool-panel')?.dataset.toolPanel??null);
  if(!panel)return;
  const shown=await page.locator(`#dc-tool-panel-${panel}`).evaluate(element=>element.classList.contains('is-active')&&!element.closest('.is-tool-collapsed'));
  if(!shown)await page.locator(`#dc-activity-${panel}`).click();
}
async function change(page,id,value){await reveal(page,id);await page.locator(id).fill(String(value));await page.locator(id).press('Tab')}
async function download(page,id='#venue-export'){
  await reveal(page,id);const wait=page.waitForEvent('download');await page.locator(id).click();const chunks=[];for await(const chunk of await(await wait).createReadStream())chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function load(page,value){
  await page.locator('#venue-file').setInputFiles({name:'venue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await page.waitForFunction(()=>!document.querySelector('#venue-status').textContent.includes('Loading venue'));
}
async function snapshot(page,name){if(artifactDir)await page.screenshot({path:resolve(artifactDir,name+'.png')})}
async function pixels(page){return page.evaluate(()=>{const p=window.calibrationPage.projection;p.render();const gl=p.renderer.getContext(),bytes=new Uint8Array(p.canvas.width*p.canvas.height*4);gl.readPixels(0,0,p.canvas.width,p.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);let hash=2166136261,sum=0,white=0;for(let i=0;i<bytes.length;i+=4){sum+=bytes[i]+bytes[i+1]+bytes[i+2];if(bytes[i]>220&&bytes[i+1]>220&&bytes[i+2]>220)white++;hash=Math.imul(hash^bytes[i],16777619);hash=Math.imul(hash^bytes[i+1],16777619);hash=Math.imul(hash^bytes[i+2],16777619)}return {hash,sum,white,width:p.canvas.width,height:p.canvas.height}})}
async function workflow(page,base){
  assert.equal(await page.locator('iframe,#source-video').count(),0,'venue creation has no sketch source');
  assert.equal(page.context().pages().length,1,'entry does not open physical output');
  const initial=await current(page);assert.equal(initial.content.length,0);assert.equal(initial.venue.scene.objects.length,4);
  const before=await pixels(page);assert.ok(before.white>100,'visible model edges are rendered');
  await page.locator('#practice-audience').click();await page.locator('#practice-guides').uncheck();await page.locator('#venue-edit-done').click();
  assert.deepEqual(await pixels(page),before,'observer, frustum guides and handles never change physical output');
  await change(page,'#practice-p-position-0',1.25);await change(page,'#practice-shift-0',12);
  assert.notEqual((await pixels(page)).hash,before.hash,'projector pose changes actual alignment image');
  const popupWait=page.waitForEvent('popup');await page.locator('#venue-open-output').click();const output=await popupWait;
  await output.waitForFunction(()=>document.querySelector('video')?.videoWidth===1920);
  // #185: 会場の画面が隠れて校正画像が止まったことを、校正ウィンドウで操作している間だけ知らせる。
  await checkMainHiddenNotice(page,output,{lang:'en',kind:'calibration',label:`${base.name} calibration`});
  if(artifactDir){
    await setMainVisibility(page,'hidden');await output.mouse.move(300,300);
    await output.waitForFunction(()=>getComputedStyle(document.getElementById('dc-output-main-hidden')).opacity==='1');
    await output.screenshot({path:resolve(artifactDir,base.name+'-calibration-main-hidden-en.png')});await setMainVisibility(page,'visible');
  }
  await page.evaluate(()=>{window.outputTrack=window.calibrationPage.projection.stream.getVideoTracks()[0]});
  await page.locator('#venue-pattern').selectOption('white');let image=await pixels(page);assert.equal(image.white,image.width*image.height);
  await output.waitForFunction(()=>{const v=document.querySelector('video');const c=document.createElement('canvas');c.width=4;c.height=4;const x=c.getContext('2d');x.drawImage(v,0,0,4,4);return x.getImageData(0,0,1,1).data[0]>240});
  await page.locator('#venue-pattern').selectOption('black');assert.equal((await pixels(page)).sum,0);
  await page.locator('#venue-pattern').selectOption('grid');image=await pixels(page);assert.ok(image.white>100&&image.white<image.width*image.height/2);
  // The full grid, not a crop, reaches the projector through the existing output UI.
  await output.waitForFunction(()=>{const v=document.querySelector('video'),c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');x.drawImage(v,0,0);const center=x.getImageData(960,540,1,1).data,cell=x.getImageData(1056,594,1,1).data;return center[0]>200&&center[1]<150&&cell[0]<10});
  await output.setViewportSize({width:700,height:500});assert.equal((await pixels(page)).width,1920);
  await reveal(page,'#venue-resolution');await page.locator('#venue-resolution').selectOption('1280x800');await output.waitForFunction(()=>document.querySelector('video')?.videoWidth===1280);
  assert.equal((await current(page)).venue.projectors[0].aspect,1.6,'choosing output pixels sets the projector aspect ratio');
  await output.close();await page.waitForFunction(()=>window.outputTrack.readyState==='ended');
  await page.locator('#venue-pattern').selectOption('outline');await page.locator('#venue-edit').click();
  await reveal(page,'#practice-start-objects');await page.locator('#practice-start-objects').click();await page.locator('#venue-kind').selectOption('tetrahedron');await page.locator('#venue-add').click();
  await change(page,'#practice-object-position-0',2);await page.locator('#venue-kind').selectOption('prism');await page.locator('#venue-add').click();await change(page,'#practice-object-position-0',-2);
  const shared=await download(page);assert.equal(shared.format,'dropcaster-venue');assert.equal(shared.schemaVersion,2);assert.deepEqual(shared.venue.scene.objects.map(o=>o.kind),['box','tetrahedron','prism']);assert.equal('content' in shared,false);
  await change(page,'#venue-name','Measured stage');await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('saved'));
  const saved=await current(page);
  await page.locator('#venue-close').click();assert.equal(await page.locator('#venue-canvas').count(),0);
  assert.equal(await page.evaluate(()=>window.practicePreview.diagnostics().disposed),true);
  await page.locator('a[href="/venue"]').click();await ready(page);assert.deepEqual((await current(page)).venue,saved.venue);assert.equal((await current(page)).name,'Measured stage');
  await reveal(page,'[data-lang-set=ja]');await page.locator('[data-lang-set=ja]').click();assert.equal(await page.locator('[data-lang-set=ja]').getAttribute('aria-pressed'),'true');
  {
    // #185: 日本語で開いた校正ウィンドウは、会場の窓向けの日本語の案内を出す。
    const popupWait=page.waitForEvent('popup');await page.locator('#venue-open-output').click();const ja=await popupWait;
    await ja.waitForFunction(()=>document.querySelector('video')?.videoWidth>0);
    await checkMainHiddenNotice(page,ja,{lang:'ja',kind:'calibration',label:`${base.name} calibration ja`});
    await ja.close({runBeforeUnload:true});await page.waitForFunction(()=>!window.calibrationPage.output?.isOpen);
  }
  await snapshot(page,base.name+'-venue-desktop-ja');await page.setViewportSize({width:900,height:800});await snapshot(page,base.name+'-venue-narrow-ja');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.ok((await page.locator('#venue-canvas').boundingBox()).height>=200);
}

async function venueHandle(page, axis) {
  await page.waitForTimeout(150);
  return page.evaluate(axis => {
    const editor = window.venueEditor, control = editor.transform, canvas = window.practicePreview.renderer.domElement;
    const rect = canvas.getBoundingClientRect(), center = control.object.position.clone().project(window.practicePreview.observer);
    const cx=(center.x+1)*rect.width/2, cy=(1-center.y)*rect.height/2;
    const matches=[];
    for(let y=Math.max(4,cy-110);y<Math.min(rect.height-4,cy+110);y+=4) for(let x=Math.max(4,cx-110);x<Math.min(rect.width-4,cx+110);x+=4) {
      control.pointerHover({x:x/rect.width*2-1,y:1-y/rect.height*2,button:0});
      if(control.axis===axis) matches.push({x:rect.x+x,y:rect.y+y,d:Math.hypot(x-cx,y-cy)});
    }
    matches.sort((a,b)=>b.d-a.d);
    if(!matches.length) throw Error(`No ${control.mode}/${axis} handle in viewport ${rect.width}x${rect.height}`);
    return matches[Math.floor(matches.length/4)];
  },axis);
}
async function venueDrag(page, mode, axis='X', finish=true) {
  await page.locator(`#venue-${mode}`).click();
  const point=await venueHandle(page,axis);
  await page.mouse.move(point.x,point.y); await page.mouse.down();
  assert.equal(await page.evaluate(()=>window.venueEditor.transform.dragging),true,'real pointer hits transform handle');
  await page.mouse.move(point.x+45,point.y-30,{steps:10});
  if(finish) await page.mouse.up();
}

async function interaction(page,base){
  await reveal(page,'#practice-start-objects');await page.locator('#practice-start-objects').click();await page.locator('#venue-focus').click();
  const original=(await current(page)).venue.scene.objects;
  await venueDrag(page,'translate','X',false);
  assert.deepEqual((await current(page)).venue.scene.objects,original,'drag only previews until release');
  const changed=await pixels(page);await page.keyboard.press('Escape');await page.mouse.up();
  assert.deepEqual((await current(page)).venue.scene.objects,original);assert.notEqual((await pixels(page)).hash,changed.hash,'cancel restores the real projector image');
  await venueDrag(page,'translate','X');const moved=(await current(page)).venue.scene.objects;assert.notDeepEqual(moved[0].position,original[0].position);
  await page.locator('#venue-undo').click();await page.waitForFunction(o=>JSON.stringify(window.venueEditor.objects)===JSON.stringify(o),original);
  await page.locator('#venue-focus').click();await venueDrag(page,'rotate','Y');const rotated=(await current(page)).venue.scene.objects;
  assert.notDeepEqual(rotated[0].quaternion,original[0].quaternion);await venueDrag(page,'scale','X');const sized=(await current(page)).venue.scene.objects;
  assert.notDeepEqual(sized[0].size,rotated[0].size);
  await page.locator('#venue-snap').check();await venueDrag(page,'translate','X');
  const x=(await current(page)).venue.scene.objects[0].position[0];assert.ok(Math.abs(x*10-Math.round(x*10))<1e-8);
  await page.locator('#venue-snap').uncheck();await page.locator('#venue-copy').click();assert.equal((await current(page)).venue.scene.objects.length,2);
  await page.locator('#venue-delete').click();assert.equal((await current(page)).venue.scene.objects.length,1);
  await load(page,await download(page));assert.equal((await current(page)).venue.scene.objects.length,1);
  await snapshot(page,base.name+'-venue-editing');
}
/** 投影される像 (#venue-image) の上に見えている会場の頂点 (ワールド座標)。 */
async function visibleVertex(page){
  return page.evaluate(()=>{
    const preview=window.calibrationPage.preview,camera=preview.projector,V=camera.position.constructor;
    for(const mesh of preview.venueMeshes()){mesh.updateWorldMatrix(true,false);const attr=mesh.geometry.attributes.position;
      for(let i=0;i<attr.count;i++){const w=new V().fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld),v=w.clone().project(camera);if(Math.abs(v.x)<.9&&Math.abs(v.y)<.9&&v.z<1)return w.toArray()}}
    throw Error('no visible venue vertex');
  });
}
/** その頂点が、いまの仮想プロジェクタで #venue-image のどこに映るか (CSS px)。 */
async function onImage(page,world){
  return page.evaluate(world=>{
    const camera=window.calibrationPage.preview.projector,image=document.querySelector('#venue-image').getBoundingClientRect();
    const v=new camera.position.constructor(...world).project(camera);
    return {x:image.left+(v.x+1)/2*image.width,y:image.top+(1-v.y)/2*image.height};
  },world);
}
async function projector(page){return (await current(page)).venue.projectors[0]}
async function adjust(page,base){
  // 2D (投影される像) と 3D が同時に、重ならずに見えている
  const image=await page.locator('#venue-image').boundingBox(),model=await page.locator('#venue-canvas').boundingBox();
  assert.ok(image.width>200&&image.height>100&&model.width>200&&model.height>200,'both panes are visible together');
  assert.ok(image.x+image.width<=model.x+1,'projected image sits left of the 3D venue');
  const original=await projector(page),revision=(await current(page)).venue.revision,before=await pixels(page);
  // キー: 連打の途中は表示だけが動き、止まってから 1 回だけ確定する
  await page.locator('#venue-output-stage').focus();
  for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.evaluate(()=>window.calibrationPage.adjuster.pending),null,'keys preview before committing');
  assert.deepEqual(await projector(page),original,'nothing is saved while keys are still coming');
  assert.notEqual((await pixels(page)).hash,before.hash,'the real projector image follows the keys immediately');
  await page.waitForFunction(r=>window.calibrationPage.session.changes.get().venue.revision===r+1,revision);
  const turned=await projector(page);assert.notDeepEqual(turned.quaternion,original.quaternion);assert.deepEqual(turned.position,original.position);
  await page.waitForTimeout(700);assert.equal((await current(page)).venue.revision,revision+1,'five presses are one change');
  await reveal(page,'#venue-undo-projector');await page.locator('#venue-undo-projector').click();
  await page.waitForFunction(q=>JSON.stringify(window.calibrationPage.session.changes.get().venue.projectors[0].quaternion)===JSON.stringify(q),original.quaternion);
  assert.equal((await pixels(page)).hash,before.hash,'one undo restores the whole adjustment');
  // 入力欄では矢印キーを横取りしない
  await reveal(page,'#venue-name');await page.locator('#venue-name').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>window.calibrationPage.adjuster.pending),null,'typing keys stay in the field');
  // 刻みの切替: G で細かくなり、矢印 1 回が 0.1°
  await page.locator('#venue-output-stage').focus();await page.keyboard.press('g');
  assert.equal(await page.locator('#venue-step-fine').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('=');await page.waitForTimeout(650);
  assert.ok(Math.abs((await projector(page)).verticalFovDegrees-(original.verticalFovDegrees-.1))<1e-9,'fine zoom step is 0.1°');
  await page.keyboard.press('g');assert.equal(await page.locator('#venue-step-coarse').getAttribute('aria-pressed'),'true');
  // ドラッグ: 押した頂点が、ドラッグした先にちょうど映る
  const vertex=await visibleVertex(page),start=await onImage(page,vertex),centre=await page.locator('#venue-image').boundingBox();
  const dx=start.x>centre.x+centre.width/2?-40:40,dy=start.y>centre.y+centre.height/2?-25:25;
  const dragging=(await current(page)).venue.revision;
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+dx,start.y+dy,{steps:8});
  assert.equal((await current(page)).venue.revision,dragging,'a drag only previews until release');
  await page.mouse.up();
  await page.waitForFunction(r=>window.calibrationPage.session.changes.get().venue.revision===r+1,dragging);
  const landed=await onImage(page,vertex);
  assert.ok(Math.hypot(landed.x-(start.x+dx),landed.y-(start.y+dy))<2,`the grabbed outline follows the pointer (${JSON.stringify({start,landed})})`);
  // 出力窓でのキーも効く
  const outputWait=page.waitForEvent('popup');await page.locator('#venue-open-output').click();const output=await outputWait;
  await output.waitForFunction(()=>document.querySelector('video')?.videoWidth===1920);
  const beforeKey=await projector(page);await output.keyboard.press('ArrowUp');
  await page.waitForFunction(q=>JSON.stringify(window.calibrationPage.session.changes.get().venue.projectors[0].quaternion)!==JSON.stringify(q),beforeKey.quaternion);
  // Ctrl/Cmd+F (ブラウザの検索) は全画面を切り替えない
  await output.evaluate(()=>{window.fullscreenCalls=0;const request=Element.prototype.requestFullscreen;Element.prototype.requestFullscreen=function(){window.fullscreenCalls++;return request.call(this)}});
  for(const key of ['Control+f','Meta+f'])await output.keyboard.press(key);
  assert.equal(await output.evaluate(()=>window.fullscreenCalls),0,'Ctrl/Cmd+F does not toggle output fullscreen');
  // 全画面: その画面の実ピクセル数が出力解像度とアスペクト比になる
  await output.keyboard.press('f');
  const screen=await output.waitForFunction(()=>document.fullscreenElement&&{w:Math.round(innerWidth*devicePixelRatio),h:Math.round(innerHeight*devicePixelRatio)}).then(h=>h.jsonValue());
  await page.waitForFunction(s=>{const c=window.calibrationPage.projection.canvas;return c.width===s.w&&c.height===s.h},screen);
  assert.ok(Math.abs((await projector(page)).aspect-screen.w/screen.h)<1e-9,'fullscreen pixels set the projector aspect ratio');
  await output.waitForFunction(s=>document.querySelector('video')?.videoWidth===s.w,screen);
  assert.match(await page.locator('#venue-resolution option:checked').textContent(),new RegExp(`${screen.w} × ${screen.h}`));
  await snapshot(page,base.name+'-venue-adjust');
  await output.close();
}
async function recovery(page){
  const baseline=await download(page);
  for(const bad of [{...baseline,schemaVersion:99},{...baseline,venue:{...baseline.venue,scene:{...baseline.venue.scene,objects:[]}}}]){
    await load(page,bad);assert.equal(await page.locator('#venue-status').evaluate(e=>e.classList.contains('is-error')),true);assert.deepEqual(await download(page),baseline);
  }
  await page.evaluate(()=>{const text=File.prototype.text;File.prototype.text=function(){File.prototype.text=text;const result=text.call(this);return new Promise(resolve=>{window.finishVenueRead=async()=>resolve(await result)})}});
  await page.locator('#venue-file').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(baseline))});
  await reveal(page,'#practice-start-objects');await page.locator('#practice-start-objects').click();await page.evaluate(()=>window.finishVenueRead());assert.equal((await current(page)).venue.scene.objects.length,1,'stale import cannot overwrite a newer edit');
  await page.locator('#venue-glb-file').setInputFiles({name:'wall.glb',mimeType:'model/gltf-binary',buffer:venueFixture()});
  await page.waitForFunction(()=>window.calibrationPage.session.changes.get().venue.scene.kind==='glb');assert.equal((await current(page)).assets.length,1);
  const glb=await download(page);await page.locator('#venue-glb-file').setInputFiles({name:'bad.glb',mimeType:'model/gltf-binary',buffer:venueFixture(d=>{d.scenes[0].nodes=[]})});
  await page.waitForFunction(()=>document.querySelector('#venue-status').classList.contains('is-error'));assert.deepEqual(await download(page),glb);
  await page.evaluate(()=>{window.realTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('quota','QuotaExceededError');return window.realTransaction.apply(this,args)}});
  await change(page,'#venue-name','Exportable venue');await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('Could not save'));
  assert.equal((await download(page)).name,'Exportable venue');await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.realTransaction});
  await change(page,'#venue-name','Recovered venue');await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('saved'));
  const outputPromise=page.waitForEvent('popup');await page.locator('#venue-open-output').click();const output=await outputPromise;await output.waitForFunction(()=>document.querySelector('video')?.videoWidth===1920);
  await page.evaluate(()=>{window.track=window.calibrationPage.projection.stream.getVideoTracks()[0];window.calibrationPage.projection.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()});
  await page.waitForFunction(()=>document.querySelector('#venue-reload')?.hidden===false);assert.equal(output.isClosed(),true);assert.equal(await page.evaluate(()=>window.track.readyState),'ended');assert.equal(await page.locator('#venue-open-output').isDisabled(),true);
  assert.equal((await download(page)).name,'Recovered venue','graphics loss preserves exportable document');
  await page.locator('#venue-close').click();
  await page.evaluate(()=>{window.getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(/webgl/.test(type))return null;return window.getContext.call(this,type,...args)}});
  await page.locator('a[href="/venue"]').click();await page.waitForSelector('#venue-reload');
  assert.equal(await page.locator('#venue-open-output').isDisabled(),true);assert.equal((await download(page)).name,'Recovered venue','initial WebGL failure preserves saved document and export');
  await page.locator('#venue-close').click();assert.equal(await page.locator('#venue-canvas').count(),0);
  await page.evaluate(()=>{HTMLCanvasElement.prototype.getContext=window.getContext});
}

/** run の間に GLB (base64 の先頭が glTF のマジック) を復号した回数。復号は atob の呼び出しとして数える。 */
async function glbDecodes(page,run){
  await page.evaluate(()=>{
    if(!window.realAtob){window.realAtob=window.atob;window.atob=data=>{if(String(data).startsWith('Z2xURg'))window.glbDecodes++;return window.realAtob(data)}}
    window.glbDecodes=0;
  });
  await run();
  return page.evaluate(()=>window.glbDecodes);
}
// #171: 取り込んだ GLB は、校正値を確定したり戻したりするたびに復号し直さない。ファイルから入るものは毎回検証する。
async function assets(page,base){
  const revised=run=>async()=>{const r=(await current(page)).venue.revision;await run();await page.waitForFunction(r=>window.calibrationPage.session.changes.get().venue.revision===r+1,r)};
  const importGlb=(name,buffer)=>async()=>{
    await page.locator('#venue-glb-file').setInputFiles({name,mimeType:'model/gltf-binary',buffer});
    await page.waitForFunction(name=>window.calibrationPage.session.changes.get().assets[0]?.name===name,name);
  };
  const undo=expected=>async()=>{
    await reveal(page,'#venue-undo-projector');await page.locator('#venue-undo-projector').click();
    await page.waitForFunction(p=>JSON.stringify(window.calibrationPage.session.changes.get().venue.projectors)===p,JSON.stringify(expected.venue.projectors));
  };
  const remember=()=>page.evaluate(()=>{window.shownMesh=window.calibrationPage.preview.venueMeshes()[0]});
  const shown=()=>page.evaluate(()=>{const meshes=window.calibrationPage.preview.venueMeshes();return {kept:meshes[0]===window.shownMesh,authored:meshes.filter(m=>m.userData.venueObjectId).length,imported:meshes.filter(m=>!m.userData.venueObjectId).length}});
  const failed=()=>page.locator('#venue-status').evaluate(e=>e.classList.contains('is-error'));
  const other=venueFixture(d=>{d.nodes[0].scale=[.5,.5,.5]});

  assert.equal(await glbDecodes(page,importGlb('wall.glb',venueFixture())),2,'a new GLB is validated once and decoded once more to build its model');
  const wall=(await current(page)).assets[0];await remember();assert.deepEqual(await shown(),{kept:true,authored:0,imported:1});
  // 校正値の確定: プロジェクタの数値・会場の位置・名前・キーでの微調整・リセット
  assert.equal(await glbDecodes(page,revised(()=>change(page,'#practice-p-position-0',1.25))),0,'committing a projector field does not decode the GLB');
  await reveal(page,'#venue-model-transform');await page.locator('#venue-model-transform').evaluate(details=>{details.open=true});
  assert.equal(await glbDecodes(page,revised(()=>change(page,'#practice-v-position-0',.5))),0,'committing the venue placement does not decode the GLB');
  assert.equal(await glbDecodes(page,revised(()=>change(page,'#venue-name','Hall'))),0,'renaming does not decode the GLB');
  assert.equal(await glbDecodes(page,revised(async()=>{await page.locator('#venue-output-stage').focus();await page.keyboard.press('ArrowRight')})),0,'a keyboard nudge does not decode the GLB');
  const nudged=await current(page),image=await pixels(page);
  assert.equal(await glbDecodes(page,revised(async()=>{await reveal(page,'#practice-reset-projector');await page.locator('#practice-reset-projector').click()})),0,'resetting the projector does not decode the GLB');
  assert.notEqual((await pixels(page)).hash,image.hash);
  // 戻す: 同じ GLB を表示しているので、復号もモデルの作り直しもしない
  assert.equal(await glbDecodes(page,undo(nudged)),0,'undoing a calibration change does not decode the GLB');
  assert.deepEqual(await shown(),{kept:true,authored:0,imported:1},'undo keeps the model that is on screen');
  assert.equal((await pixels(page)).hash,image.hash,'undo restores the projected image');
  assert.deepEqual((await current(page)).assets,[wall]);assert.deepEqual((await current(page)).venue.scene,nudged.venue.scene);
  // 別の GLB を取り込んで戻す: 表示するモデルが変わるので、作り直しの 1 回だけ復号する
  assert.equal(await glbDecodes(page,importGlb('other.glb',other)),2);
  assert.equal((await shown()).kept,false);assert.notEqual((await pixels(page)).hash,image.hash);
  assert.equal(await glbDecodes(page,async()=>{await undo(nudged)();await page.waitForFunction(id=>window.calibrationPage.session.changes.get().assets[0].id===id,wall.id)}),1,'undoing an import decodes the restored GLB once, to build its model');
  assert.equal((await pixels(page)).hash,image.hash,'the restored GLB is the one projected');
  // なぞった推定を一時表示している間は、表示中のモデルが GLB ではない。戻すときに GLB を作り直す
  const estimate=()=>page.evaluate(async modules=>{
    const {venueObject}=await import(`${modules}/practice/venueObjects.ts`),page=window.calibrationPage;
    page.showTraceEstimate({objects:[venueObject('box','Traced')],projector:page.session.changes.get().venue.projectors[0]});
  },base.modules);
  await revised(()=>change(page,'#practice-p-position-0',1.5))();const before=await current(page);
  await revised(()=>change(page,'#practice-p-position-0',1.75))();
  await estimate();assert.deepEqual(await shown(),{kept:false,authored:1,imported:0});
  assert.equal(await glbDecodes(page,async()=>{await undo(before)();await page.waitForFunction(()=>window.calibrationPage.preview.venueMeshes().every(m=>!m.userData.venueObjectId))}),1,'undo rebuilds the GLB model that the estimate replaced');
  assert.deepEqual(await shown(),{kept:false,authored:0,imported:1});
  // 一時表示をやめると確定済みの GLB に戻る (表示のための 1 回)。その後の戻すは復号しない
  await estimate();
  assert.equal(await glbDecodes(page,async()=>{await page.evaluate(()=>window.calibrationPage.showTraceEstimate(null));await page.waitForFunction(()=>window.calibrationPage.preview.venueMeshes().every(m=>!m.userData.venueObjectId))}),1);
  await remember();const latest=await current(page);
  await revised(()=>change(page,'#practice-p-position-0',2))();
  assert.equal(await glbDecodes(page,undo(latest)),0);assert.deepEqual(await shown(),{kept:true,authored:0,imported:1});
  // 会場ファイルは毎回検証する。確定済みのアセットと同じ id でも、中身が違えば拒否する
  const shared=await download(page);assert.deepEqual(shared.assets,[wall]);
  const withData=buffer=>({...shared,assets:[{...wall,data:buffer.toString('base64')}]});
  for(const bad of [venueFixture(d=>{d.images[0].uri='https://example.com/image.png'}),venueFixture(d=>{d.bufferViews[0].byteOffset=1e9})]){
    assert.equal(await glbDecodes(page,()=>load(page,withData(bad))),1,'a venue file is decoded and validated even under a verified asset id');
    assert.equal(await failed(),true);assert.deepEqual(await download(page),shared,'a rejected venue file changes nothing');
  }
  assert.equal(await glbDecodes(page,()=>load(page,shared)),1,'a venue file with the GLB on screen is validated once; its model is kept');
  assert.equal(await failed(),false);assert.deepEqual(await shown(),{kept:true,authored:0,imported:1});
  assert.equal(await glbDecodes(page,()=>load(page,withData(other))),2,'a venue file with another GLB is validated once and decoded once more to build its model');
  assert.equal(await failed(),false);assert.equal((await shown()).kept,false);assert.equal((await current(page)).assets[0].data,other.toString('base64'));
  // マッピングの下書きから写す: 保存されていたものなので検証する。壊れていれば写さない
  const mapping=await current(page);
  const copyMapping=(asset,done)=>async()=>{
    await page.evaluate(async([modules,project])=>(await import(`${modules}/practice/projectStore.ts`)).writeProject(project),[base.modules,{...mapping,assets:[asset]}]);
    await reveal(page,'#venue-copy-mapping');await page.locator('#venue-copy-mapping').click();await page.waitForFunction(done,asset.data);
  };
  assert.equal(await glbDecodes(page,copyMapping(wall,data=>window.calibrationPage.session.changes.get().assets[0].data===data)),2,'a GLB copied from the mapping draft is validated once and decoded once more to build its model');
  assert.equal(await failed(),false);
  assert.equal(await glbDecodes(page,copyMapping({...wall,data:venueFixture(d=>{d.buffers[0].uri='../secret.bin'}).toString('base64')},()=>document.querySelector('#venue-status').classList.contains('is-error'))),1,'a mapping draft is decoded and validated even under a verified asset id');
  assert.deepEqual((await current(page)).assets,[wall],'a rejected mapping draft changes nothing');
  // 保存済みの下書きを開き直す: 検証と表示で 1 回ずつ
  await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('saved'));
  const saved=await current(page);
  assert.equal(await glbDecodes(page,async()=>{await page.locator('#venue-close').click();await page.locator('a[href="/venue"]').click();await ready(page)}),2,'reopening the saved draft validates the GLB and builds its model');
  assert.deepEqual((await current(page)).assets,saved.assets);assert.equal((await shown()).imported,1);
}

async function isolation(page,base){
  const context=page.context();
  const html=`<!doctype html><canvas width="640" height="360"></canvas><script>const c=document.querySelector('canvas'),x=c.getContext('2d');function draw(){x.fillStyle='#e06b20';x.fillRect(0,0,640,360);requestAnimationFrame(draw)}draw()</script>`;
  await context.route('**/sketches.json',r=>r.fulfill({json:[{id:'a',title:'Running artwork',path:'sketches/a/index.html',type:'html',description:'',tags:[],interactiveElements:[],lastModified:'2026-11-12'}]}));
  await context.route('**/sketches/a/index.html',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.goto(base.url+'/a');await page.waitForSelector('#open-windows-btn');
  await page.evaluate(async modules=>{
    const {WindowController}=await import(`${modules}/components/WindowController.ts`),acquire=WindowController.prototype.acquireStreamConsumer;
    WindowController.prototype.acquireStreamConsumer=function(...args){window.mappingWC=this;return acquire.apply(this,args)};
  },base.modules);
  await page.locator('#open-windows-btn').click();await page.waitForFunction(()=>document.querySelector('#source-video')?.videoWidth===640);
  await page.locator('#add-mapping-btn').click();
  await page.waitForTimeout(900);
  const baseline=await page.evaluate(async modules=>({layout:structuredClone(window.mappingWC.events.state.get()),draft:await(await import(`${modules}/practice/projectStore.ts`)).readProject(),storage:{...localStorage}}),base.modules);
  assert.equal(baseline.draft.content[0].id,'a');
  await page.evaluate(()=>{window.originalTrack=document.querySelector('#source-video').srcObject.getVideoTracks()[0]});
  await page.locator('#dc-activity-outputs').click();
  const livePromise=page.waitForEvent('popup');await page.locator('#outputs-list .open-btn').first().click();const live=await livePromise;
  await live.waitForFunction(()=>document.querySelector('video')?.videoWidth===640);
  // 会場の入口はプロジェクトパネルの末尾にある。パネルを開くと 3D を読み込むのは受け入れた代償 (#225 / ADR 0021) なので、
  // 入口を押すこと自体がマッピング側に何も増やさないことを確かめる。
  await page.locator('#dc-activity-project').click();await page.locator('#practice-project-name').waitFor();
  const previews=await page.locator('#dc-practice-canvas').count();
  const venuePromise=page.waitForEvent('popup');await page.locator('#practice-venue').click();const venue=await venuePromise;
  await venue.waitForSelector('#venue-canvas');await venue.waitForFunction(()=>!document.querySelector('#venue-model-pane').inert);
  assert.equal(await page.locator('#dc-practice-canvas').count(),previews,'opening venue setup adds nothing to the mapping preview');
  assert.equal(await venue.locator('iframe,#source-video').count(),0);
  await reveal(venue,'#venue-copy-mapping');await venue.locator('#venue-copy-mapping').click();
  await venue.waitForFunction(()=>document.querySelector('#venue-status').textContent==='Venue loaded');
  await reveal(venue,'#practice-start-objects');await venue.locator('#practice-start-objects').click();
  await change(venue,'#venue-name','Independent room');
  await venue.waitForFunction(()=>document.querySelector('#venue-storage').textContent==='Venue draft saved in this browser');
  const shared=await download(venue);assert.equal('content' in shared,false);assert.deepEqual(shared.venue.layout,{...baseline.draft.venue.layout,activeOutputId:baseline.draft.venue.layout.activeOutputId??baseline.layout.outputs[0].id});
  const check=await page.evaluate(async modules=>({layout:structuredClone(window.mappingWC.events.state.get()),draft:await(await import(`${modules}/practice/projectStore.ts`)).readProject(),storage:{...localStorage},track:window.originalTrack.readyState}),base.modules);
  assert.deepEqual(check.layout,baseline.layout);assert.deepEqual(check.draft,baseline.draft);assert.deepEqual(check.storage,baseline.storage);assert.equal(check.track,'live');
  const calibrationPromise=venue.waitForEvent('popup');await venue.locator('#venue-open-output').click();const calibration=await calibrationPromise;
  await calibration.waitForFunction(()=>document.querySelector('video')?.videoWidth===1920);assert.equal(live.isClosed(),false);
  // #185: 案内は各出力を開いた画面 (opener) が隠れたときだけ。校正ウィンドウは会場の窓、実出力は作品の画面を見る。
  await checkMainHiddenNotice(venue,calibration,{lang:'en',kind:'calibration',label:`${base.name} calibration from venue popup`});
  await setMainVisibility(page,'hidden');
  await live.mouse.move(120,120);await calibration.mouse.move(120,120);
  await live.waitForFunction(()=>getComputedStyle(document.getElementById('dc-output-main-hidden')).opacity==='1');
  assert.equal(await calibration.evaluate(()=>getComputedStyle(document.getElementById('dc-output-main-hidden')).display),'none','hiding the artwork page does not affect the calibration window');
  await setMainVisibility(page,'visible');
  const closed=calibration.waitForEvent('close');await venue.locator('#venue-close').click();
  assert.equal(await venue.locator('#venue-close-confirm').evaluate(d=>d.open),true,'leaving with the projector output open asks first');
  assert.equal(calibration.isClosed(),false);await venue.locator('#venue-close-confirm-btn').click();await closed;
  assert.equal(live.isClosed(),false);assert.equal(await page.evaluate(()=>window.originalTrack.readyState),'live');await venue.close();
  await page.locator('#preview-tab').click();await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(()=>!document.querySelector('#dc-practice-status').textContent.includes('Preparing'));
  assert.equal(await page.locator('#dc-practice-venue,#practice-projector-form,#practice-load-glb').count(),0,'preview has no authoring controls');
  await page.locator('#dc-activity-preview3d').click();
  const choose=page.waitForEvent('filechooser');await page.locator('#practice-load-venue').click();await choose;
  await page.locator('#practice-project-file').setInputFiles({name:'shared.venue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(shared))});
  await page.waitForFunction(()=>document.querySelector('#dc-practice-status').textContent.includes('Venue loaded'));
  await page.waitForTimeout(800);
  const received=await page.evaluate(async modules=>(await import(`${modules}/practice/projectStore.ts`)).readProject(),base.modules);
  assert.deepEqual(JSON.parse(JSON.stringify(received.venue)),shared.venue);assert.deepEqual(received.content,baseline.draft.content);assert.deepEqual(received.show,baseline.draft.show);
  assert.equal(await page.evaluate(()=>window.originalTrack.readyState),'live');assert.equal(live.isClosed(),false);
  // #262: なぞって作った会場のファイル (trace で書き出したもの) も、マッピング側で同じように読み込める。
  const traced=tracedVenues.get(base.name);
  if(!traced)console.log(`${base.name}/isolation: the traced venue is not loaded (run the trace case first)`);
  else{
    const choose=page.waitForEvent('filechooser');await page.locator('#practice-load-venue').click();await choose;
    await page.locator('#practice-project-file').setInputFiles({name:'traced.venue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(traced))});
    const deadline=Date.now()+10000;let loaded;
    do{loaded=await page.evaluate(async modules=>(await import(`${modules}/practice/projectStore.ts`)).readProject(),base.modules);if(JSON.stringify(loaded.venue)===JSON.stringify(traced.venue))break;await page.waitForTimeout(100)}while(Date.now()<deadline);
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.venue)),traced.venue,'the traced venue replaces the mapping venue');
    assert.deepEqual(loaded.content,baseline.draft.content);assert.deepEqual(loaded.show,baseline.draft.show);
    await page.waitForFunction(()=>document.querySelector('#dc-practice-status').textContent.includes('Venue loaded'));
    await snapshot(page,base.name+'-venue-trace-mapping');
  }
  assert.deepEqual(await page.evaluate(async modules=>(await import(`${modules}/practice/projectStore.ts`)).listProjects(),base.modules),[],'venue draft is absent from named mapping projects');
  await live.close();
}

// #168: 確定した変更は保存待ちのまま再読み込みで失われない。
async function draft(page,base){return page.evaluate(async modules=>(await import(`${modules}/practice/projectStore.ts`)).readProject('venue-draft'),base.modules)}
async function reloaded(page){await page.waitForSelector('#venue-canvas');await page.waitForFunction(()=>!document.querySelector('#venue-model-pane').inert)}
async function leaving(page){try{await page.evaluate(()=>location.reload())}catch{/* the page navigated away */}}
async function reload(page,base){
  let answer='accept';const dialogs=[];
  page.on('dialog',dialog=>{dialogs.push(dialog.type());void(answer==='accept'?dialog.accept():dialog.dismiss())});
  await change(page,'#venue-name','First');await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('saved'));
  await change(page,'#venue-name','Second');await page.waitForTimeout(100);
  await page.reload();await reloaded(page);
  assert.equal(await page.inputValue('#venue-name'),'Second','a committed name survives a reload 100 ms later');
  assert.deepEqual(dialogs,[],'a finished save does not ask before leaving');
  // 確定と同じタスクで離脱すると保存中なので確認を出す。キャンセルすれば変更は残り、待てば保存済みになる。
  answer='dismiss';await reveal(page,'#venue-name');await page.locator('#venue-name').click();
  try{await page.evaluate(()=>{const name=document.querySelector('#venue-name');name.value='Third';name.dispatchEvent(new Event('change',{bubbles:true}));location.reload()})}catch{/* the page navigated away */}
  assert.deepEqual(dialogs,['beforeunload'],'leaving in the same task as the commit asks first');
  assert.equal(await page.inputValue('#venue-name'),'Third','cancelling keeps the edit');
  await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('saved'));
  assert.equal((await draft(page,base)).name,'Third','staying finishes the save');
  // 微調整の確定待ち (SETTLE_MS) のまま離脱しても、確定して保存してから知らせる。
  const before=(await draft(page,base)).venue.projectors[0];
  await page.locator('#venue-output-stage').focus();await page.keyboard.press('ArrowRight');await leaving(page);
  assert.deepEqual(dialogs,['beforeunload','beforeunload'],'a pending nudge asks before leaving');
  await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('saved'));
  assert.notDeepEqual((await draft(page,base)).venue.projectors[0].quaternion,before.quaternion,'the pending nudge is committed and saved');
  // 保存済みなら新たな確認を出さない。
  answer='accept';await reveal(page,'#venue-name');await page.locator('#venue-name').click();
  await page.reload();await reloaded(page);
  assert.deepEqual(dialogs,['beforeunload','beforeunload'],'a saved draft reloads without asking');
  assert.equal(await page.inputValue('#venue-name'),'Third');
}

// #246: 壁に映した十字で実物の角をなぞり、会場とプロジェクタを推定して適用する (ADR 0023)。
/** trace で書き出した「なぞって作った会場」のファイル (gallery / hosted ごと)。isolation がマッピング側で読み込む (#262)。 */
const tracedVenues=new Map();
/** 実出力 canvas の 1 画素 (出力画素、左上原点)。 */
async function outputPixel(page,[x,y]){
  return page.evaluate(([x,y])=>{const p=window.calibrationPage.projection;p.render();const gl=p.renderer.getContext(),bytes=new Uint8Array(4);gl.readPixels(Math.round(x),p.canvas.height-1-Math.round(y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return [...bytes.slice(0,3)]},[x,y]);
}
async function traceState(page){return page.evaluate(()=>{const t=window.calibrationPage.trace,c=t.controller;return {crosshair:[...c.crosshair],points:c.doc.points.map(p=>[p.id,[...p.pixel]]),shapes:c.doc.shapes.length,pending:[...c.pending],venue:t.state.venue?.status??null,objects:t.state.venue?.objects?.length??0,elapsed:t.state.elapsed,status:document.querySelector('#venue-trace-status').textContent}})}
/** 確定済みのプロジェクタで、会場の点 (m) が出力のどこに映るか (出力画素)。three.js 経由の既存の投影を使う。 */
async function projectToOutput(page,base,points){
  return page.evaluate(async ([modules,points])=>{
    const {projectToNdc}=await import(`${modules}/venue/ProjectorNudge.ts`),projector=window.calibrationPage.session.changes.get().venue.projectors[0],{width,height}=window.calibrationPage.projection.canvas;
    return points.map(point=>{const n=projectToNdc(projector,point);return [(n[0]+1)/2*width,(1-n[1])/2*height]});
  },[base.modules,points]);
}
async function onTraceImage(page,[x,y]){const box=await page.locator('#venue-image').boundingBox(),{width,height}=await page.evaluate(()=>{const c=window.calibrationPage.projection.canvas;return {width:c.width,height:c.height}});return {x:box.x+x/width*box.width,y:box.y+y/height*box.height}}
/** 今の Step (手順の一覧で選ばれている項目) と、案内・次へ進めない理由。リロード後も画面の表示だけで読める。 */
async function stepState(page){return page.evaluate(()=>({step:document.querySelector('#venue-trace-steps li.is-current')?.textContent??null,entry:!document.querySelector('#venue-trace-entry').hidden,
  guide:document.querySelector('#venue-trace-step').textContent,tip:document.querySelector('#venue-trace-tip').textContent,where:document.querySelector('#venue-trace-where').textContent,
  diagram:!document.querySelector('#venue-trace-diagram').hidden&&!!document.querySelector('#venue-trace-diagram svg'),
  next:document.querySelector('#venue-trace-next').disabled?null:document.querySelector('#venue-trace-next').textContent,blocked:document.querySelector('#venue-trace-blocked').textContent}))}
/** 像に重ねる点の番号 (fillText) の数。確認の Step でだけ描く。 */
async function overlayLabels(page){return page.evaluate(()=>{const labels=[];const context=new Proxy({},{get:(_,key)=>key==='fillText'?text=>labels.push(text):()=>{},set:()=>true});window.calibrationPage.trace.drawOverlay(context,1,1);return labels.length})}
/** 準備: 台形補正のチェック → プロジェクタ出力を開く → (投射比)。出力窓を返す。 */
async function prepareTrace(page,throwRatio){
  let state=await stepState(page);
  assert.equal(state.step,'Prepare');assert.equal(state.next,null);assert.match(state.blocked,/Turn off keystone/);
  assert.match(state.where,/On the projector/);
  await page.locator('#venue-trace-keystone').check();
  assert.match((await stepState(page)).blocked,/Open the projector output first/);
  assert.equal(await page.locator('#venue-trace-output-state').textContent(),'Not open yet');
  const outputWait=page.waitForEvent('popup');await page.locator('#venue-trace-open-output').click();const output=await outputWait;
  await output.waitForFunction(()=>document.querySelector('video')?.videoWidth===1920);
  await page.waitForFunction(()=>document.querySelector('#venue-trace-output-state').textContent==='Open');
  if(throwRatio!==null){
    assert.match((await stepState(page)).blocked,/Enter the throw ratio/);
    await change(page,'#venue-trace-throw',throwRatio);
  }
  // 入力を変えると 1 回だけ再推定し、その間は進めない。
  await page.waitForFunction(()=>!document.querySelector('#venue-trace-next').disabled);
  state=await stepState(page);assert.equal(state.next,'Next');assert.equal(state.blocked,'');
  await page.locator('#venue-trace-next').click();
  return output;
}
async function trace(page,base){
  const original=await current(page);
  await page.locator('#dc-activity-trace').click();
  assert.equal(await page.locator('.dc-venue-page.is-tracing').count(),1);
  // 入口: 作る / 合わせるの問いだけが出て、道具は並ばない。
  let state=await stepState(page);
  assert.equal(state.entry,true);assert.equal(state.step,null);assert.match(state.guide,/Choose how to start/);
  assert.equal(await page.locator('#venue-trace-tool-boxCorner').isVisible(),false,'no tools before choosing');
  assert.equal(await page.locator('#venue-trace-guide').isVisible(),true,'the guide sits above the projected image');
  assert.equal(await page.locator('#venue-pattern').isVisible(),false,'the alignment image moves into the prepare step');
  // 十字は実出力 (壁) に映る: 中心の隙間は暗く、腕は赤い。
  const start=(await traceState(page)).crosshair;
  const arm=await outputPixel(page,[start[0]+40,start[1]]),gap=await outputPixel(page,[start[0]+4,start[1]]);
  assert.ok(arm[0]>200&&arm[1]<80&&arm[2]<80,`crosshair arm is red ${arm}`);assert.ok(!(gap[0]>200&&gap[1]<80),`the centre is open ${gap}`);
  await page.locator('#venue-trace-mode-build').click();
  // 準備: 調整用の像は準備の Step で選べ、見出しの選択と同じものを指す。
  await page.locator('#venue-trace-pattern').selectOption('white');
  assert.equal(await page.inputValue('#venue-pattern'),'white');
  await page.locator('#venue-trace-pattern').selectOption('outline');
  await snapshot(page,base.name+'-venue-trace-prepare');
  // 投射比が分からないときは、明示すれば進める。
  await page.locator('#venue-trace-throw-unknown').check();assert.equal((await stepState(page)).next,null,'the output is not open yet');
  await page.locator('#venue-trace-throw-unknown').uncheck();
  // 既定の部屋 (8 × 3 × 6 m) を、既定のプロジェクタ (縦画角 43°) から正面でなぞる。投射比を仕様値として入れる。
  const output=await prepareTrace(page,(1/(2*(16/9)*Math.tan(21.5*Math.PI/180))).toFixed(4));
  state=await stepState(page);
  assert.equal(state.step,'Room corner');assert.match(state.guide,/Room corner 1\/4/);assert.match(state.where,/Watching the wall/);assert.equal(state.diagram,true);
  assert.match(await page.locator('#venue-trace-decides').textContent(),/floor and two walls/);
  assert.match(await page.locator('#venue-trace-progress').textContent(),/0 \/ 4 points/);
  await snapshot(page,base.name+'-venue-trace-room');
  const [backLeft,leftUp,backRight,leftSide,rightUp,rightSide]=await projectToOutput(page,base,[[-4,0,-3],[-4,2,-3],[4,0,-3],[-4,0,-1],[4,2,-3],[4,0,-1]]);
  // なぞる間は、像を押してドラッグしてもプロジェクタは動かない (十字だけが付いてくる)。
  const dragFrom=await onTraceImage(page,[600,400]),revision=original.venue.revision;
  await page.mouse.move(dragFrom.x,dragFrom.y);await page.mouse.down();await page.mouse.move(dragFrom.x+60,dragFrom.y+30,{steps:5});await page.mouse.up();
  await page.waitForTimeout(650);
  assert.equal((await current(page)).venue.revision,revision,'dragging the image does not adjust the projector while tracing');
  assert.equal(await page.evaluate(()=>window.calibrationPage.adjuster.pending),null);
  // 十字は押した点から、像の上で動かした分 (CSS px を出力画素へ換算) だけ動く。
  const box=await page.locator('#venue-image').boundingBox(),dragged=(await traceState(page)).crosshair;
  const expected=[600+60*1920/box.width,400+30*1080/box.height];
  assert.ok(Math.hypot(dragged[0]-expected[0],dragged[1]-expected[1])<2,`the crosshair follows the drag ${dragged} ≠ ${expected}`);
  // 矢印キー: 10 px、Shift で 1 px。
  await page.locator('#venue-output-stage').focus();
  const before=(await traceState(page)).crosshair;
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowDown');
  assert.deepEqual((await traceState(page)).crosshair,[before[0]+10,before[1]+1],'arrows move 10 px, Shift+arrows 1 px');
  // 部屋の左の隅を、像のダブルクリックでなぞる。なぞり終えると反対側の隅の Step へ進む。
  for(const point of [backLeft,leftUp,backRight,leftSide]){const at=await onTraceImage(page,point);await page.mouse.dblclick(at.x,at.y)}
  assert.equal((await traceState(page)).shapes,1);
  state=await stepState(page);
  assert.equal(state.step,'Opposite room corner');assert.equal(state.next,null);assert.match(state.blocked,/Trace the opposite corner too/);
  assert.equal(await overlayLabels(page),0,'point numbers stay off the image until the check step');
  // 右の隅の奥の辺は、左の隅の点に吸着して共有する。その手順では共有の案内が出る。
  for(const [i,point] of [backRight,rightUp,backLeft,rightSide].entries()){
    if(i===2)assert.match((await stepState(page)).tip,/first corner you traced/);
    const at=await onTraceImage(page,point);await page.mouse.dblclick(at.x,at.y);
  }
  await page.waitForFunction(()=>window.calibrationPage.trace.state.venue?.status==='ok');
  const solved=await traceState(page);
  assert.equal(solved.points.length,6,'the shared corners are one point each');
  assert.equal(solved.shapes,2);assert.equal(solved.objects,4,`floor, back, left and right walls: ${solved.status}`);
  assert.ok(solved.elapsed<1000,`re-estimating takes ${solved.elapsed} ms`);
  assert.match(solved.status,/Estimated 4 parts/);assert.match(solved.status,/Scale is not set/);
  state=await stepState(page);
  assert.match(state.guide,/Both corners are traced/);assert.equal(state.next,'Next');
  assert.match(await page.locator('#venue-trace-guide-status').textContent(),/Estimated 4 parts/);
  // 推定は一時表示で、まだ保存しない。
  assert.equal((await current(page)).venue.revision,revision,'estimating does not save');
  await snapshot(page,base.name+'-venue-trace-estimated');
  // 箱と実寸は任意なのでスキップでき、確認の Step へ着く。先の Step へは一覧から飛べない。
  await page.locator('#venue-trace-next').click();
  assert.equal((await stepState(page)).step,'Boxes (optional)');assert.equal((await stepState(page)).next,'Skip');
  assert.equal(await page.locator('#venue-trace-steps [data-trace-step=review]').isDisabled(),true);
  await page.locator('#venue-trace-next').click();
  assert.equal((await stepState(page)).step,'Real size (optional)');
  await page.locator('#venue-trace-next').click();
  state=await stepState(page);assert.equal(state.step,'Check and apply');assert.match(state.guide,/Check the outline on the wall/);
  assert.equal(await overlayLabels(page),6,'the check step numbers the points');
  assert.equal((await page.locator('#venue-trace-points li').count()),6);
  // 置き直し: 十字が点へ移り、Esc で取り消すと点も十字も元のまま。
  const [firstId,firstPixel]=solved.points[0];
  await page.locator(`#venue-trace-points [data-trace-action=move][data-point=${firstId}]`).click();
  assert.deepEqual((await traceState(page)).crosshair,firstPixel);
  await page.locator('#venue-output-stage').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Escape');
  const cancelled=await traceState(page);assert.deepEqual(cancelled.crosshair,firstPixel);assert.deepEqual(cancelled.points[0][1],firstPixel);
  // 適用: 部材とプロジェクタが 1 回の変更 (1 revision) で書き込まれ、「直前の変更を戻す」1 回で戻る。
  await page.locator('#venue-trace-apply').click();
  await page.waitForFunction(r=>window.calibrationPage.session.changes.get().venue.revision===r+1,revision);
  const applied=await current(page);
  assert.deepEqual(applied.venue.scene.objects.map(o=>o.kind),['floor','wall','wall','wall']);
  assert.notDeepEqual(applied.venue.projectors[0],original.venue.projectors[0],'the projector is estimated too');
  await page.waitForTimeout(700);assert.equal((await current(page)).venue.revision,revision+1,'apply is one change');
  // #262: 縮尺が未設定のまま適用した会場も、そのまま会場ファイル (v2) で書き出せる。なぞった点は含まない。
  assert.match((await traceState(page)).status,/Scale is not set/,'the applied venue is still unscaled');
  const unscaled=await download(page);
  assert.deepEqual([unscaled.format,unscaled.schemaVersion],['dropcaster-venue',2]);
  assert.deepEqual(unscaled.venue.scene.objects,applied.venue.scene.objects);assert.deepEqual(unscaled.venue.projectors,applied.venue.projectors);
  assert.equal(JSON.stringify(unscaled).includes('"shapes"'),false,'traced points stay out of the venue file');
  await page.locator('#dc-activity-trace').click();assert.equal((await stepState(page)).step,'Check and apply');
  await page.locator('#venue-trace-undo').click();
  await page.waitForFunction(objects=>JSON.stringify(window.calibrationPage.session.changes.get().venue.scene.objects)===objects,JSON.stringify(original.venue.scene.objects));
  const undone=await current(page);
  assert.deepEqual(undone.venue.scene.objects,original.venue.scene.objects);assert.deepEqual(undone.venue.projectors,original.venue.projectors);
  // 出力窓: 窓いっぱいに引き伸ばした出力の上で、マウスの位置が出力画素へ換算される。クリックで確定。
  for(const [w,h] of [[960,540],[700,500]]){
    await output.setViewportSize({width:w,height:h});
    await output.mouse.move(w*.25,h*.75);
    await page.waitForFunction(([x,y])=>{const c=window.calibrationPage.trace.controller.crosshair;return Math.abs(c[0]-x)<1e-6&&Math.abs(c[1]-y)<1e-6},[1920*.25,1080*.75]);
  }
  // 追加でなぞる: 箱の Step へ戻り、長方形を選べる。
  await page.locator('#venue-trace-more').click();
  assert.equal((await stepState(page)).step,'Boxes (optional)');
  await page.locator('#venue-trace-tool-rectangle').click();
  await output.mouse.click(700*.25,500*.75);
  const clicked=await traceState(page);assert.equal(clicked.pending.length,1,'a click in the output window confirms the point');
  await output.keyboard.press('ArrowUp');assert.deepEqual((await traceState(page)).crosshair,[1920*.25,1080*.75-10],'keys work in the output window');
  await output.keyboard.press('Escape');assert.equal((await traceState(page)).pending.length,0,'Esc drops the half-traced shape');
  // #262: 実寸の Step で、奥の左右の隅 (既定の部屋では 8 m 離れている) を長さ 8 m として入れると、メートル単位に確定する。
  await page.locator('#venue-trace-next').click();
  assert.equal((await stepState(page)).step,'Real size (optional)');
  await change(page,'#venue-trace-meters',8);
  for(const point of [backLeft,backRight]){const at=await onTraceImage(page,point);await page.mouse.dblclick(at.x,at.y)}
  await page.waitForFunction(()=>window.calibrationPage.trace.state.venue?.status==='ok'&&window.calibrationPage.trace.state.venue.scaleKnown);
  const scaled=await traceState(page);
  assert.equal(scaled.points.length,6,'the length snaps to the traced corners');assert.equal(scaled.shapes,3);
  assert.doesNotMatch(scaled.status,/Scale is not set/);assert.match(scaled.status,/Estimated 4 parts/);
  await page.locator('#venue-trace-next').click();assert.equal((await stepState(page)).step,'Check and apply');
  const beforeScale=(await current(page)).venue.revision;
  await page.locator('#venue-trace-apply').click();
  await page.waitForFunction(r=>window.calibrationPage.session.changes.get().venue.revision===r+1,beforeScale);
  // 奥の壁は、内側の面どうしの幅が隅の間の長さになり、両端に壁の厚み (0.15 m) が付く。
  const backWidth=objects=>Math.max(...objects.filter(o=>o.kind==='wall').map(o=>o.size[0]))-.3;
  const metres=(await current(page)).venue.scene.objects;
  assert.ok(Math.abs(backWidth(metres)-8)<.05,`the back wall is 8 m wide after the length: ${backWidth(metres)}`);
  assert.ok(Math.abs(backWidth(applied.venue.scene.objects)-8)>.1,`the unscaled width differs from metres: ${backWidth(applied.venue.scene.objects)}`);
  await output.close();
  // パネルを離れると十字は消え、確定済みの会場の表示に戻る。
  const last=(await traceState(page)).crosshair;
  await page.locator('#dc-activity-objects').click();
  assert.equal(await page.locator('.dc-venue-page.is-tracing').count(),0);
  assert.equal(await page.locator('#venue-trace-guide').isVisible(),false);assert.equal(await page.locator('#venue-pattern').isVisible(),true);
  const away=await outputPixel(page,[last[0]+40,last[1]]);assert.ok(!(away[0]>200&&away[1]<80),'the crosshair leaves the wall');
  await page.waitForFunction(()=>window.calibrationPage.preview.venueMeshes().length===4);
  // なぞった点は会場の下書きと別に保存され、リロード後も残る。書き出す会場ファイルには含まれない。
  assert.ok(await page.evaluate(()=>!!localStorage.getItem('dropcaster.venue.trace.v1')));
  const shared=await download(page);assert.equal(JSON.stringify(shared).includes('dropcaster.venue.trace'),false);
  assert.deepEqual(Object.keys(shared).sort(),['assets','format','name','schemaVersion','venue']);
  assert.equal(JSON.stringify(shared).includes('"shapes"'),false,'traced points stay out of the venue file');
  // 書き出したのは、実寸で確定して適用した (なぞって作った) 会場。マッピング側での読み込みは isolation で確かめる。
  const exported=await current(page);
  assert.deepEqual(shared.venue.scene.objects,exported.venue.scene.objects);assert.deepEqual(shared.venue.projectors,exported.venue.projectors);
  assert.deepEqual(shared.venue.scene.objects,metres);
  tracedVenues.set(base.name,shared);
  await page.reload();await reloaded(page);
  await page.locator('#dc-activity-trace').click();
  // リロード後はテスト用のページ参照が無いので、画面の表示で確かめる。部屋の隅が 2 つあれば確認の Step から再開する。
  await page.waitForFunction(()=>/Estimated 4 parts/.test(document.querySelector('#venue-trace-status').textContent));
  assert.equal((await stepState(page)).step,'Check and apply');
  assert.deepEqual(await page.locator('#venue-trace-points li > span:first-child').allTextContents(),cancelled.points.map(([id])=>`P${id.slice(1)}`));
  await snapshot(page,base.name+'-venue-trace-reloaded');
}

// #158: 測った会場の頂点に合わせて、プロジェクタ条件だけを求める。会場の部材は変えない。
async function matchState(page){return page.evaluate(()=>{const t=window.calibrationPage.trace,c=t.controller,r=t.state.result;return {mode:c.mode,crosshair:[...c.crosshair],anchors:c.doc.anchors.map(a=>({id:a.id,pixel:[...a.pixel],world:[...a.world]})),pending:c.pendingVertex?[...c.pendingVertex.world]:null,result:r?{status:r.status,rms:r.rmsPixels,projector:r.projector}:null,status:document.querySelector('#venue-trace-status').textContent,apply:document.querySelector('#venue-trace-apply').disabled}})}
/**
 * 現場のプロジェクタ (正解) を、確定済みから位置・向き・画角をずらして作り、両方の像に映って見える会場の頂点を、
 * 像の上で互いに離れた順に count 個選ぶ。各頂点の、確定済みでの投影 (輪郭の角) と正解での投影 (実物の角) を返す。
 */
async function matchTargets(page,base,count){
  return page.evaluate(async ([modules,count])=>{
    const {nudge,projectToNdc}=await import(`${modules}/venue/ProjectorNudge.ts`),{isVertexVisible}=await import(`${modules}/venue/venueVertices.ts`);
    const page=window.calibrationPage,committed=page.session.changes.get().venue.projectors[0],{width,height}=page.projection.canvas;
    let truth=nudge(nudge(nudge(nudge(committed,'pan',1.5),'tilt',-1),'right',.25),'up',-.15);truth=nudge(nudge(truth,'forward',.3),'zoom',-2.5);
    const pixel=(projector,world)=>{const n=projectToNdc(projector,world);return n&&Math.abs(n[0])<.95&&Math.abs(n[1])<.95?[(n[0]+1)/2*width,(1-n[1])/2*height]:null};
    const meshes=page.preview.venueMeshes();
    const candidates=page.venueVertices().map(world=>({world,outline:pixel(committed,world),real:pixel(truth,world)}))
      .filter(v=>v.outline&&v.real&&isVertexVisible(meshes,committed,v.world)&&isVertexVisible(meshes,truth,v.world));
    const chosen=[candidates.reduce((a,b)=>a.outline[1]>b.outline[1]?a:b)];
    while(chosen.length<count&&chosen.length<candidates.length){
      const far=c=>Math.min(...chosen.map(s=>Math.hypot(s.outline[0]-c.outline[0],s.outline[1]-c.outline[1])));
      chosen.push(candidates.filter(c=>!chosen.includes(c)).reduce((a,b)=>far(a)>=far(b)?a:b));
    }
    return {truth,targets:chosen};
  },[base.modules,count]);
}
/** いま壁に映っている輪郭 (推定の一時表示中なら推定したプロジェクタ) で、会場の点が映る出力画素。 */
async function displayedPixel(page,base,world){
  return page.evaluate(async ([modules,world])=>{
    const {projectToPixel}=await import(`${modules}/venue/venueVertices.ts`),page=window.calibrationPage;
    return projectToPixel(page.trace.hooks.displayedProjector(),page.projection.canvas,world);
  },[base.modules,world]);
}
async function match(page,base){
  // 実測で組んだ会場: 既定の部屋に、奥行きの違う箱を 2 つ置く (奥の壁の隅だけでは同一平面で決まらない)。
  await page.evaluate(async modules=>{
    const {venueObject}=await import(`${modules}/practice/venueObjects.ts`),page=window.calibrationPage,project=page.session.changes.get();
    const low=venueObject('box','Low'),tall=venueObject('box','Tall');low.position=[1.4,.5,-.8];tall.size=[.8,1.8,.8];tall.position=[-1.6,.9,.6];
    await page.apply({...project,venue:{...project.venue,scene:{...project.venue.scene,objects:[...project.venue.scene.objects,low,tall]}}});
  },base.modules);
  await page.waitForFunction(()=>window.calibrationPage.preview.venueMeshes().length===6);
  const original=await current(page),revision=original.venue.revision,committed=original.venue.projectors[0];
  await page.locator('#dc-activity-trace').click();
  await page.locator('#venue-trace-mode-match').click();
  assert.equal((await matchState(page)).mode,'match');
  assert.equal(await page.locator('#venue-trace-throw-unknown').isVisible(),false,'the throw ratio is optional when matching');
  // 合わせるモードの準備は、台形補正のチェックと出力窓だけ (投射比は任意)。
  const output=await prepareTrace(page,null);
  const step=await stepState(page);
  assert.equal(step.step,'Match corners');assert.match(step.guide,/Vertex 1\/2/);assert.equal(step.diagram,true);
  assert.equal(await page.locator('#venue-trace-tool-boxCorner').isVisible(),false,'the shape tools are for building');
  // 固定する量は「詳細」に畳んである。
  assert.equal(await page.locator('#venue-trace-lock-position').isVisible(),false);
  await page.locator('#venue-trace-match > summary').click();
  assert.equal(await page.locator('#venue-trace-lock-lensShiftX').isChecked(),true,'the horizontal shift is fixed by default');
  assert.equal(await page.locator('#venue-trace-lock-position').isChecked(),false);
  assert.equal(await page.locator('#venue-trace-apply').textContent(),'Apply to projector');
  const {truth,targets}=await matchTargets(page,base,8);
  assert.equal(targets.length,8,'eight lit vertices of the default room');
  // 輪郭から遠いところで確定しても、頂点は選ばれない。
  const empty=await onTraceImage(page,[960,40]);await page.mouse.dblclick(empty.x,empty.y);
  assert.match(await page.locator('#venue-trace-message').textContent(),/No venue vertex near the crosshair/);
  for(const [i,target] of targets.entries()){
    // 輪郭の角の近くで確定 → その頂点が選ばれ、十字が頂点の投影位置へ跳ぶ。4 点目からは推定した輪郭が映っている。
    const outline=await displayedPixel(page,base,target.world);
    const near=await onTraceImage(page,[outline[0]+4,outline[1]-3]);await page.mouse.dblclick(near.x,near.y);
    const picked=await matchState(page);
    assert.deepEqual(picked.pending,target.world,`vertex ${i} is picked`);
    assert.ok(Math.hypot(picked.crosshair[0]-outline[0],picked.crosshair[1]-outline[1])<1e-6,'the crosshair jumps to the vertex');
    // 十字を実物の角へ運んで確定する。
    const real=await onTraceImage(page,target.real);await page.mouse.dblclick(real.x,real.y);
    if(i===2){
      const waiting=await matchState(page);
      assert.match(waiting.status,/Confirm 1 more vertices/);assert.equal(waiting.apply,true,'cannot apply before estimating');assert.equal(waiting.result,null);
      // 位置を固定すると必要な点が減り、3 点で推定する。外すとまた待つ。
      await page.locator('#venue-trace-lock-position').check();
      await page.waitForFunction(()=>window.calibrationPage.trace.state.result!==null);
      await page.locator('#venue-trace-lock-position').uncheck();
      await page.waitForFunction(()=>window.calibrationPage.trace.state.result===null);
    }
  }
  await page.waitForFunction(()=>{const r=window.calibrationPage.trace.state.result;return r?.status==='ok'&&Object.keys(r.residualPixels).length===8});
  const solved=await matchState(page);
  assert.equal(solved.anchors.length,8);
  assert.match(solved.status,/Matched the projector to 8 vertices/);
  assert.ok(solved.result.rms<2,`rms ${solved.result.rms}`);
  const error=Math.hypot(...solved.result.projector.position.map((v,i)=>v-truth.position[i]));
  assert.ok(error<.1,`position error ${error} m`);
  assert.ok(Math.abs(solved.result.projector.verticalFovDegrees-truth.verticalFovDegrees)<.5,`fov ${solved.result.projector.verticalFovDegrees} vs ${truth.verticalFovDegrees}`);
  assert.equal((await stepState(page)).next,'Next');
  assert.equal(await overlayLabels(page),0,'numbers and residual lines wait for the check step');
  await page.locator('#venue-trace-next').click();
  assert.equal((await stepState(page)).step,'Check and apply');
  assert.equal(await overlayLabels(page),8);
  assert.equal((await page.locator('#venue-trace-points li').count()),8);
  // 一時表示: 壁の輪郭は推定したプロジェクタで描くが、まだ保存しない。
  assert.equal((await current(page)).venue.revision,revision,'estimating does not save');
  await snapshot(page,base.name+'-venue-match-estimated');
  // 適用: プロジェクタだけが 1 revision で書き込まれ、会場の部材は変わらない。「直前の変更を戻す」1 回で戻る。
  await page.locator('#venue-trace-apply').click();
  await page.waitForFunction(r=>window.calibrationPage.session.changes.get().venue.revision===r+1,revision);
  const applied=await current(page);
  assert.deepEqual(applied.venue.scene,original.venue.scene,'the venue is kept as measured');
  const p=applied.venue.projectors[0];
  assert.deepEqual([p.id,p.outputId,p.near,p.far,p.aspect],[committed.id,committed.outputId,committed.near,committed.far,committed.aspect]);
  assert.deepEqual(p.position,solved.result.projector.position);assert.equal(p.verticalFovDegrees,solved.result.projector.verticalFovDegrees);
  assert.equal(p.lensShift[0],committed.lensShift[0],'the fixed horizontal shift is kept');
  assert.match(await page.locator('#venue-status').textContent(),/Applied the matched projector/);
  await page.waitForTimeout(700);assert.equal((await current(page)).venue.revision,revision+1,'apply is one change');
  await page.locator('#venue-trace-undo').click();
  await page.waitForFunction(projector=>JSON.stringify(window.calibrationPage.session.changes.get().venue.projectors[0])===projector,JSON.stringify(committed));
  // 頂点の選択は、壁に映っている輪郭 (戻した後は確定済み) で行う。追加で合わせるときは点の Step へ戻る。
  await page.locator('#venue-trace-more').click();assert.equal((await stepState(page)).step,'Match corners');
  const again=await onTraceImage(page,await displayedPixel(page,base,targets[0].world));await page.mouse.dblclick(again.x,again.y);
  assert.equal((await matchState(page)).crosshair.join(),solved.anchors[0].pixel.join(),'picking a matched vertex re-places that point');
  await page.locator('#venue-output-stage').focus();await page.keyboard.press('Escape');
  await output.close();
  // 始め方を選び直して「なぞって作る」に移っても対応点は残り、対応点は下書きにだけ保存されて会場ファイルには入らない。
  await page.locator('#venue-trace-change-mode').click();assert.equal((await stepState(page)).entry,true);
  await page.locator('#venue-trace-mode-build').click();
  assert.equal((await stepState(page)).step,'Prepare','building starts from the prepare step');
  assert.equal((await matchState(page)).anchors.length,8);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dropcaster.venue.trace.v1')));
  assert.equal(saved.anchors.length,8);assert.equal(saved.mode,'build');
  const shared=await download(page);assert.equal(JSON.stringify(shared).includes('"anchors"'),false,'matched vertices stay out of the venue file');
  await page.locator('#dc-activity-trace').click();await page.locator('#venue-trace-change-mode').click();await page.locator('#venue-trace-mode-match').click();
  assert.equal((await stepState(page)).step,'Check and apply','matching resumes from its points');
  await page.reload();await reloaded(page);
  await page.locator('#dc-activity-trace').click();
  await page.waitForFunction(()=>/Matched the projector to 8 vertices/.test(document.querySelector('#venue-trace-status').textContent));
  assert.equal((await stepState(page)).step,'Check and apply');
  await snapshot(page,base.name+'-venue-match-reloaded');
}

// #232: マッピング画面と同じ左端のアクティビティバー (ADR 0021)。パネルの並び・所属・畳み・キーボード・狭い画面。
const VENUE_PANELS={
  objects:['#dc-practice-venue','#practice-start-objects'],
  trace:['#venue-trace-mode-build','#venue-trace-mode-match','#venue-trace-guide'],
  projector:['#practice-output','#venue-step-coarse','#venue-undo-projector','#practice-projector-form'],
  output:['#venue-resolution'],
  files:['#venue-name','#venue-export','#venue-load','#venue-copy-mapping','#practice-load-glb','#practice-sample','#venue-mapping','[data-lang-set=ja]'],
};
async function selectedPanel(page){return page.locator('.dc-activity-btn[aria-selected=true]').getAttribute('data-tool-panel')}
async function activityBar(page,base){
  assert.deepEqual(await page.locator('.dc-activity-btn').evaluateAll(buttons=>buttons.map(b=>b.dataset.toolPanel)),Object.keys(VENUE_PANELS));
  assert.equal(await selectedPanel(page),'objects','opens on the solids panel');
  assert.equal(await page.locator('.tool-column > .column-header h2').textContent(),'Solids');
  assert.equal(await page.locator('#venue-menu').count(),0,'the header menu is gone');
  assert.equal(await page.locator('.dc-activity-bar-footer #venue-close').count(),1,'home sits at the bottom of the bar');
  for(const panel of Object.keys(VENUE_PANELS)){
    // 選択中のアイコンを押すと畳むので、選ばれていないときだけ押す。
    if(await selectedPanel(page)!==panel)await page.locator(`#dc-activity-${panel}`).click();
    assert.equal(await selectedPanel(page),panel);
    for(const [owner,selectors] of Object.entries(VENUE_PANELS))for(const selector of selectors)
      assert.equal(await page.locator(selector).first().isVisible(),owner===panel,`${selector} belongs to the ${owner} panel (showing ${panel})`);
    for(const selector of ['#venue-open-output','#venue-image','#venue-canvas'])assert.equal(await page.locator(selector).isVisible(),true,`${selector} stays visible`);
    // なぞる間は、調整用の像の選択は準備の Step に移る。
    assert.equal(await page.locator('#venue-pattern').isVisible(),panel!=='trace','#venue-pattern is visible outside tracing');
  }
  await page.locator('#dc-activity-projector').click();
  // 選択中の再押下で畳み、像と 3D が幅を使う。開き直すと元の列幅に戻る。
  const width=(await page.locator('.tool-column').boundingBox()).width,image=(await page.locator('#venue-image-pane').boundingBox()).width;
  await page.locator('#dc-activity-projector').click();
  assert.equal(await page.locator('#dc-activity-projector').getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('.tool-column').isVisible(),false);
  assert.ok((await page.locator('#venue-image-pane').boundingBox()).width>image,'collapsing gives the width to the panes');
  await page.locator('#dc-activity-output').click();
  assert.equal(await selectedPanel(page),'output');assert.equal(await page.locator('#dc-activity-output').getAttribute('aria-expanded'),'true');
  assert.equal((await page.locator('.tool-column').boundingBox()).width,width,'reopening restores the column width');
  // キーボード: 上下・Home・End で巡回し、プロジェクタの微調整には届かない。
  const before=await current(page);
  await page.locator('#dc-activity-output').focus();
  for(const [key,panel] of [['ArrowDown','files'],['ArrowDown','objects'],['ArrowUp','files'],['Home','objects'],['End','files']]){
    await page.keyboard.press(key);assert.equal(await selectedPanel(page),panel,`${key} selects ${panel}`);
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.toolPanel),panel,`${key} moves focus`);
  }
  assert.equal(await page.evaluate(()=>window.calibrationPage.adjuster.pending),null,'activity keys do not nudge the projector');
  await page.waitForTimeout(700);assert.deepEqual((await current(page)).venue.projectors,before.venue.projectors);
  await page.keyboard.press('Enter');assert.equal(await page.locator('.tool-column').isVisible(),false,'Enter on the selected icon collapses');
  await page.keyboard.press('Space');assert.equal(await page.locator('.tool-column').isVisible(),true,'Space reopens');
  // 言語を切り替えると見出しも切り替わる。
  await page.locator('[data-lang-set=ja]').click();
  assert.equal(await page.locator('.tool-column > .column-header h2').textContent(),'ファイル・設定');
  assert.equal(await page.locator('#venue-close').getAttribute('aria-label'),'ホームに戻る');
  for(const panel of Object.keys(VENUE_PANELS)){if(await selectedPanel(page)!==panel)await page.locator(`#dc-activity-${panel}`).click();await snapshot(page,`${base.name}-venue-panel-${panel}-ja`)}
  // 狭い画面: バー・ツール列・ペインが横にはみ出さず、畳むとペインが広がる。
  await page.setViewportSize({width:900,height:800});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('.dc-activity-bar').isVisible(),true);await snapshot(page,`${base.name}-venue-narrow-panel-ja`);
  const narrow=(await page.locator('#venue-model-pane').boundingBox()).width;
  await page.locator('#dc-activity-files').click();
  assert.ok((await page.locator('#venue-model-pane').boundingBox()).width>narrow,'collapsing widens the panes on a narrow screen');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await snapshot(page,`${base.name}-venue-narrow-collapsed-ja`);
  await page.locator('[data-lang-set=en]').evaluate(button=>button.click());
}

try{
  for(const config of ['vite.config.ts','apps/web/vite.config.ts']){
    const hosted=config.startsWith('apps/'),name=hosted?'hosted':'gallery';if(process.env.VENUE_ENTRY&&process.env.VENUE_ENTRY!==name)continue;
    const server=await createServer({configFile:resolve(root,config),root:hosted?resolve(root,'apps/web'):root,server:{host:'127.0.0.1',port:0,open:false,watch:null,hmr:false},logLevel:'error'});
    try{
      await server.listen();const base={name,url:`http://127.0.0.1:${server.httpServer.address().port}`,modules:hosted?`/@fs${root.slice(0,-1)}/src/viewer`:'/src/viewer'};
      for(const [testName,run] of Object.entries({activityBar,workflow,interaction,adjust,trace,match,recovery,assets,isolation,reload})){
        if(process.env.VENUE_CASE&&process.env.VENUE_CASE!==testName)continue;
        const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',locale:'en-US'}),errors=[];
        context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
        try{const page=await setup(context,base);await run(page,base);assert.deepEqual(errors,[],`${name}/${testName} browser errors`);console.log(`${name}/${testName}: PASS`)}finally{await context.close()}
      }
    }finally{await server.close()}
  }
}finally{await browser.close()}
