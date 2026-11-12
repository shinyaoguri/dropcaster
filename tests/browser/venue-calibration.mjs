import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { venueFixture } from '../fixtures/venue-glb.mjs';

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
  await page.waitForSelector('#venue-canvas');await page.waitForFunction(()=>window.calibrationPage?.editor && !document.querySelector('.dc-venue-main').inert);
  await page.evaluate(()=>{window.practicePreview=window.calibrationPage.preview;window.venueEditor=window.calibrationPage.editor});
}
async function current(page){return page.evaluate(()=>structuredClone(window.calibrationPage.session.changes.get()))}
async function change(page,id,value){await page.locator(id).fill(String(value));await page.locator(id).press('Tab')}
async function download(page,id='#venue-export'){
  const wait=page.waitForEvent('download');await page.locator(id).click();const chunks=[];for await(const chunk of await(await wait).createReadStream())chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function load(page,value){
  await page.locator('#venue-file').setInputFiles({name:'venue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await page.waitForFunction(()=>!document.querySelector('#venue-status').textContent.includes('Loading venue'));
}
async function snapshot(page,name){if(artifactDir)await page.screenshot({path:resolve(artifactDir,name+'.png')})}
async function pixels(page){return page.evaluate(()=>{const p=window.calibrationPage.projection;p.render();const gl=p.renderer.getContext(),bytes=new Uint8Array(p.canvas.width*p.canvas.height*4);gl.readPixels(0,0,p.canvas.width,p.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);let hash=2166136261,sum=0,white=0;for(let i=0;i<bytes.length;i+=4){sum+=bytes[i]+bytes[i+1]+bytes[i+2];if(bytes[i]>220&&bytes[i+1]>220&&bytes[i+2]>220)white++;hash=Math.imul(hash^bytes[i],16777619);hash=Math.imul(hash^bytes[i+1],16777619);hash=Math.imul(hash^bytes[i+2],16777619)}return {hash,sum,white,width:p.canvas.width,height:p.canvas.height}})}
async function workflow(page,base){
  assert.equal(await page.locator('iframe,#source-video,.source-column').count(),0,'venue creation has no sketch source');
  assert.equal(page.context().pages().length,1,'entry does not open physical output');
  const initial=await current(page);assert.equal(initial.content.length,0);assert.equal(initial.venue.scene.objects.length,4);
  const before=await pixels(page);assert.ok(before.white>100,'visible model edges are rendered');
  await page.locator('#practice-audience').click();await page.locator('#practice-guides').uncheck();await page.locator('#venue-edit-done').click();
  assert.deepEqual(await pixels(page),before,'observer, frustum guides and handles never change physical output');
  await page.locator('#venue-projector-tab').click();await change(page,'#practice-p-position-0',1.25);await change(page,'#practice-shift-0',12);
  assert.notEqual((await pixels(page)).hash,before.hash,'projector pose changes actual alignment image');
  const popupWait=page.waitForEvent('popup');await page.locator('#venue-open-output').click();const output=await popupWait;
  await output.waitForFunction(()=>document.querySelector('video')?.videoWidth===1920);
  await page.evaluate(()=>{window.outputTrack=window.calibrationPage.projection.stream.getVideoTracks()[0]});
  await page.locator('#venue-pattern').selectOption('white');let image=await pixels(page);assert.equal(image.white,image.width*image.height);
  await output.waitForFunction(()=>{const v=document.querySelector('video');const c=document.createElement('canvas');c.width=4;c.height=4;const x=c.getContext('2d');x.drawImage(v,0,0,4,4);return x.getImageData(0,0,1,1).data[0]>240});
  await page.locator('#venue-pattern').selectOption('black');assert.equal((await pixels(page)).sum,0);
  await page.locator('#venue-pattern').selectOption('grid');image=await pixels(page);assert.ok(image.white>100&&image.white<image.width*image.height/2);
  // The full grid, not a crop, reaches the projector through the existing output UI.
  await output.waitForFunction(()=>{const v=document.querySelector('video'),c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');x.drawImage(v,0,0);const center=x.getImageData(960,540,1,1).data,cell=x.getImageData(1056,594,1,1).data;return center[0]>200&&center[1]<150&&cell[0]<10});
  await output.setViewportSize({width:700,height:500});assert.equal((await pixels(page)).width,1920);
  await page.locator('#venue-resolution').selectOption('1280x800');await output.waitForFunction(()=>document.querySelector('video')?.videoWidth===1280);
  await output.close();await page.waitForFunction(()=>window.outputTrack.readyState==='ended');
  await page.locator('#venue-pattern').selectOption('outline');await page.locator('#venue-objects-tab').click();await page.locator('#venue-edit').click();
  await page.locator('#practice-start-objects').click();await page.locator('#venue-kind').selectOption('tetrahedron');await page.locator('#venue-add').click();
  await change(page,'#practice-object-position-0',2);await page.locator('#venue-kind').selectOption('prism');await page.locator('#venue-add').click();await change(page,'#practice-object-position-0',-2);
  const shared=await download(page);assert.equal(shared.format,'dropcaster-venue');assert.equal(shared.schemaVersion,2);assert.deepEqual(shared.venue.scene.objects.map(o=>o.kind),['box','tetrahedron','prism']);assert.equal('content' in shared,false);
  await page.locator('#venue-files-tab').click();await change(page,'#venue-name','Measured stage');await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('saved'));
  const saved=await current(page);
  await page.locator('.dc-venue-header a').click();assert.equal(await page.locator('#venue-canvas').count(),0);
  assert.equal(await page.evaluate(()=>window.practicePreview.diagnostics().disposed),true);
  await page.locator('a[href="/venue"]').click();await ready(page);assert.deepEqual((await current(page)).venue,saved.venue);assert.equal((await current(page)).name,'Measured stage');
  await page.evaluate(async modules=>(await import(`${modules}/i18n/index.ts`)).setLang('ja'),base.modules);
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
  await page.locator('#practice-start-objects').click();await page.locator('#venue-focus').click();
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
  await venueDrag(page,'translate','X',false);await page.locator('#venue-output-tab').dispatchEvent('click');await page.mouse.up();
  assert.deepEqual((await current(page)).venue.scene.objects,sized,'projected-image tab cancels pending drag');
  await page.locator('#venue-model-tab').click();await page.locator('#venue-snap').check();await venueDrag(page,'translate','X');
  const x=(await current(page)).venue.scene.objects[0].position[0];assert.ok(Math.abs(x*10-Math.round(x*10))<1e-8);
  await page.locator('#venue-snap').uncheck();await page.locator('#venue-copy').click();assert.equal((await current(page)).venue.scene.objects.length,2);
  await page.locator('#venue-delete').click();assert.equal((await current(page)).venue.scene.objects.length,1);
  await load(page,await download(page));assert.equal((await current(page)).venue.scene.objects.length,1);
  await snapshot(page,base.name+'-venue-editing');
}
async function recovery(page){
  const baseline=await download(page);
  for(const bad of [{...baseline,schemaVersion:99},{...baseline,venue:{...baseline.venue,scene:{...baseline.venue.scene,objects:[]}}}]){
    await load(page,bad);assert.equal(await page.locator('#venue-status').evaluate(e=>e.classList.contains('is-error')),true);assert.deepEqual(await download(page),baseline);
  }
  await page.evaluate(()=>{const text=File.prototype.text;File.prototype.text=function(){File.prototype.text=text;const result=text.call(this);return new Promise(resolve=>{window.finishVenueRead=async()=>resolve(await result)})}});
  await page.locator('#venue-file').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(baseline))});
  await page.locator('#practice-start-objects').click();await page.evaluate(()=>window.finishVenueRead());assert.equal((await current(page)).venue.scene.objects.length,1,'stale import cannot overwrite a newer edit');
  await page.locator('#venue-files-tab').click();await page.locator('#venue-glb-file').setInputFiles({name:'wall.glb',mimeType:'model/gltf-binary',buffer:venueFixture()});
  await page.waitForFunction(()=>window.calibrationPage.session.changes.get().venue.scene.kind==='glb');assert.equal((await current(page)).assets.length,1);
  const glb=await download(page);await page.locator('#venue-glb-file').setInputFiles({name:'bad.glb',mimeType:'model/gltf-binary',buffer:venueFixture(d=>{d.scenes[0].nodes=[]})});
  await page.waitForFunction(()=>document.querySelector('#venue-status').classList.contains('is-error'));assert.deepEqual(await download(page),glb);
  await page.evaluate(()=>{window.realTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('quota','QuotaExceededError');return window.realTransaction.apply(this,args)}});
  await change(page,'#venue-name','Exportable venue');await page.waitForFunction(()=>document.querySelector('#venue-storage').textContent.includes('Could not save'));
  assert.equal((await download(page)).name,'Exportable venue');await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.realTransaction});
  const outputPromise=page.waitForEvent('popup');await page.locator('#venue-open-output').click();const output=await outputPromise;await output.waitForFunction(()=>document.querySelector('video')?.videoWidth===1920);
  await page.evaluate(()=>{window.track=window.calibrationPage.projection.stream.getVideoTracks()[0];window.calibrationPage.projection.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()});
  await page.waitForFunction(()=>document.querySelector('#venue-reload')?.hidden===false);assert.equal(output.isClosed(),true);assert.equal(await page.evaluate(()=>window.track.readyState),'ended');assert.equal(await page.locator('#venue-open-output').isDisabled(),true);
  assert.equal((await download(page)).name,'Exportable venue','graphics loss preserves exportable document');
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
  const livePromise=page.waitForEvent('popup');await page.locator('#outputs-list .open-btn').first().click();const live=await livePromise;
  await live.waitForFunction(()=>document.querySelector('video')?.videoWidth===640);
  await page.locator('#practice-menu > summary').click();const venuePromise=page.waitForEvent('popup');await page.locator('#practice-venue').click();const venue=await venuePromise;
  await venue.waitForSelector('#venue-canvas');await venue.waitForFunction(()=>!document.querySelector('.dc-venue-main').inert);
  assert.equal(await page.locator('#dc-practice-canvas').count(),0,'opening venue setup never initializes the mapping preview');
  assert.equal(await venue.locator('iframe,#source-video').count(),0);
  await venue.locator('#venue-files-tab').click();await venue.locator('#venue-copy-mapping').click();
  await venue.waitForFunction(()=>document.querySelector('#venue-status').textContent==='Venue loaded');
  await venue.locator('#venue-objects-tab').click();await venue.locator('#practice-start-objects').click();
  await venue.locator('#venue-files-tab').click();await change(venue,'#venue-name','Independent room');
  await venue.waitForFunction(()=>document.querySelector('#venue-storage').textContent==='Venue draft saved in this browser');
  const shared=await download(venue);assert.equal('content' in shared,false);assert.deepEqual(shared.venue.layout,baseline.layout);
  const check=await page.evaluate(async modules=>({layout:structuredClone(window.mappingWC.events.state.get()),draft:await(await import(`${modules}/practice/projectStore.ts`)).readProject(),storage:{...localStorage},track:window.originalTrack.readyState}),base.modules);
  assert.deepEqual(check.layout,baseline.layout);assert.deepEqual(check.draft,baseline.draft);assert.deepEqual(check.storage,baseline.storage);assert.equal(check.track,'live');
  const calibrationPromise=venue.waitForEvent('popup');await venue.locator('#venue-open-output').click();const calibration=await calibrationPromise;
  await calibration.waitForFunction(()=>document.querySelector('video')?.videoWidth===1920);assert.equal(live.isClosed(),false);
  const closed=calibration.waitForEvent('close');await venue.locator('.dc-venue-header a').click();await closed;
  assert.equal(live.isClosed(),false);assert.equal(await page.evaluate(()=>window.originalTrack.readyState),'live');await venue.close();
  await page.locator('#preview-tab').click();await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(()=>!document.querySelector('#dc-practice-status').textContent.includes('Preparing'));
  assert.equal(await page.locator('#dc-practice-venue,#practice-projector-form,#practice-load-glb').count(),0,'preview has no authoring controls');
  await page.locator('#practice-menu > summary').click();await page.locator('#practice-settings').click();
  const choose=page.waitForEvent('filechooser');await page.locator('#practice-load-venue').click();await choose;
  await page.locator('#practice-project-file').setInputFiles({name:'shared.venue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(shared))});
  await page.waitForFunction(()=>document.querySelector('#dc-practice-status').textContent.includes('Venue loaded'));
  await page.waitForTimeout(800);
  const received=await page.evaluate(async modules=>(await import(`${modules}/practice/projectStore.ts`)).readProject(),base.modules);
  assert.deepEqual(received.venue,shared.venue);assert.deepEqual(received.content,baseline.draft.content);assert.deepEqual(received.show,baseline.draft.show);
  assert.equal(await page.evaluate(()=>window.originalTrack.readyState),'live');assert.equal(live.isClosed(),false);
  assert.deepEqual(await page.evaluate(async modules=>(await import(`${modules}/practice/projectStore.ts`)).listProjects(),base.modules),[],'venue draft is absent from named mapping projects');
  await live.close();
}

try{
  for(const config of ['vite.config.ts','apps/web/vite.config.ts']){
    const hosted=config.startsWith('apps/'),name=hosted?'hosted':'gallery';if(process.env.VENUE_ENTRY&&process.env.VENUE_ENTRY!==name)continue;
    const server=await createServer({configFile:resolve(root,config),root:hosted?resolve(root,'apps/web'):root,server:{host:'127.0.0.1',port:0,open:false,watch:null,hmr:false},logLevel:'error'});
    try{
      await server.listen();const base={name,url:`http://127.0.0.1:${server.httpServer.address().port}`,modules:hosted?`/@fs${root.slice(0,-1)}/src/viewer`:'/src/viewer'};
      for(const [testName,run] of Object.entries({workflow,interaction,recovery,isolation})){
        if(process.env.VENUE_CASE&&process.env.VENUE_CASE!==testName)continue;
        const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),errors=[];
        context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
        try{const page=await setup(context,base);await run(page,base);assert.deepEqual(errors,[],`${name}/${testName} browser errors`);console.log(`${name}/${testName}: PASS`)}finally{await context.close()}
      }
    }finally{await server.close()}
  }
}finally{await browser.close()}
