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

// #232: マッピング画面と同じ左端のアクティビティバー (ADR 0021)。パネルの並び・所属・畳み・キーボード・狭い画面。
const VENUE_PANELS={
  objects:['#dc-practice-venue','#practice-start-objects'],
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
    for(const selector of ['#venue-pattern','#venue-open-output','#venue-image','#venue-canvas'])assert.equal(await page.locator(selector).isVisible(),true,`${selector} stays visible`);
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
      for(const [testName,run] of Object.entries({activityBar,workflow,interaction,adjust,recovery,isolation,reload})){
        if(process.env.VENUE_CASE&&process.env.VENUE_CASE!==testName)continue;
        const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),errors=[];
        context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
        try{const page=await setup(context,base);await run(page,base);assert.deepEqual(errors,[],`${name}/${testName} browser errors`);console.log(`${name}/${testName}: PASS`)}finally{await context.close()}
      }
    }finally{await server.close()}
  }
}finally{await browser.close()}
