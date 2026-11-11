import './style.css';
import { OutputWindow } from '../../src/viewer/windows/output/OutputWindow';
import { CORNER_KEYS, constrainQuadCorner, isMappingEntry, type CornerKey, type MappingsState } from '../../src/viewer/utils/mappingTransform';
import { getLang, setLang, onLangChange, type Lang } from '../../src/viewer/i18n/index';
import { fixture, presetNames, drawPattern, type Pattern, type Preset } from './fixtures';
import type { ProjectionPreview } from './ProjectionPreview';

const copy = {
  ja: {
    title: '投影を、別の視点から。', intro: '壁・床・箱の小さな会場で、映像の歪みと遮蔽を確かめる描画実験。',
    preset: '配置サンプル', pattern: '映像', resolution: 'プレビュー幅', start: '3Dを開始', stop: '3Dを停止',
    css: '四隅を合わせる', gpu: 'GPU合成のスナップショット', venue: '会場を見渡す', reset: '視点をリセット',
    projectorView: '投影位置から見る', box: '箱を表示', projection: '投影光を表示',
    editHint: '緑の四隅をドラッグして配置を変更。映像・マスクは実出力と同じCSS経路です。',
    orbitHint: 'ドラッグで回転、右ドラッグでパン、ホイールでズーム。視点を動かしても投影条件は変わりません。',
    scope: '#124 段階1の独立PoC。既存ギャラリーや保存設定には接続していません。光学的な明るさ・反射を再現するものではありません。',
    loading: '3Dを準備しています…', ready: '3D表示中 · プロジェクタ1台 / 出力 output', stopped: '3Dは停止中です。CSS出力は継続しています。',
    failure: '3Dを開始できませんでした。WebGL2対応ブラウザで再試行してください。CSS操作は続けられます。',
    lost: 'WebGLコンテキストを失ったため3Dを停止しました。復帰後に再開始してください。',
  },
  en: {
    title: 'See your projection in space.', intro: 'A rendering experiment with a wall, floor and box. Explore distortion and occlusion.',
    preset: 'Layout sample', pattern: 'Source', resolution: 'Preview width', start: 'Start 3D', stop: 'Stop 3D',
    css: 'Align the corners', gpu: 'GPU composite snapshot', venue: 'Explore the venue', reset: 'Reset view',
    projectorView: 'View from projector', box: 'Show box', projection: 'Projection light',
    editHint: 'Drag the green corners. Video and masks use the existing CSS output renderer.',
    orbitHint: 'Drag to orbit, right-drag to pan, scroll to zoom. Viewing does not move the projector.',
    scope: '#124 stage 1, standalone PoC. Gallery runtime and saved settings are not connected. This is geometry, not a photometric simulation.',
    loading: 'Preparing 3D…', ready: '3D running · One projector / output: output', stopped: '3D stopped. CSS output continues.',
    failure: '3D could not start. Retry with a WebGL2-capable browser. CSS editing remains available.',
    lost: 'WebGL context lost. 3D stopped; restart after the context recovers.',
  },
};
const presetLabels: Record<Lang, Record<Preset, string>> = {
  ja: { full:'全面', perspective:'遠近', crop:'範囲外クロップ', mask:'手前のマスク', 'mask-behind':'背後のマスク', 'concave-mask':'凹形マスク', 'winding-mask':'二重巻きマスク', spanning:'出力をまたぐ配置', mirrored:'左右反転', degenerate:'退化した四角形' },
  en: { full:'Full frame', perspective:'Perspective', crop:'Out-of-range crop', mask:'Foreground mask', 'mask-behind':'Background mask', 'concave-mask':'Concave mask', 'winding-mask':'Twice-wound mask', spanning:'Across outputs', mirrored:'Mirror', degenerate:'Degenerate quad' },
};
const patternLabels: Record<Lang, Record<Pattern, string>> = {
  ja: { grid: 'グリッド', white: '白', black: '黒', alpha: '透明・半透明' },
  en: { grid: 'Grid', white: 'White', black: 'Black', alpha: 'Transparency' },
};
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cssFrame = element<HTMLIFrameElement>('css');
const gpuCanvas = element<HTMLCanvasElement>('gpu');
const venueCanvas = element<HTMLCanvasElement>('venue');
const handles = document.getElementById('handles') as unknown as SVGSVGElement;
const startButton = element<HTMLButtonElement>('start');
const stopButton = element<HTMLButtonElement>('stop');
const status = element<HTMLOutputElement>('status');
const presetSelect = element<HTMLSelectElement>('preset');
let statusKey: keyof typeof copy.en = 'stopped';
const message = (key: typeof statusKey) => { statusKey = key; status.textContent = copy[getLang()][key]; };
const translate = () => {
  document.querySelectorAll<HTMLElement>('[data-text]').forEach(el => { el.textContent = copy[getLang()][el.dataset.text as keyof typeof copy.en]; });
  element<HTMLSelectElement>('language').value = getLang(); message(statusKey);
  for (const option of presetSelect.options) option.text = presetLabels[getLang()][option.value as Preset];
  for (const option of element<HTMLSelectElement>('pattern').options) option.text = patternLabels[getLang()][option.value as Pattern];
};
element<HTMLSelectElement>('language').onchange = e => setLang((e.target as HTMLSelectElement).value as Lang);
const offLanguage = onLangChange(translate); translate();
for (const name of presetNames) presetSelect.add(new Option(name, name));
translate();

let state = fixture('full');
let outputId = 'output';
let pattern: Pattern = 'grid';
let preview: ProjectionPreview | null = null;
let animation = 0;
let generation = 0;
let resizeObserver: ResizeObserver | null = null;
let snapshotNeeded = false;
let snapshotFrame: number | null = null;
let lastFrame = 0;
let lastSnapshot = 0;
const frameTimes: number[] = [];
const source = document.createElement('canvas'); source.width = 640; source.height = 360;
drawPattern(source, pattern);
const stream = source.captureStream(0);
const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
const sourceTimer = window.setInterval(() => { drawPattern(source, pattern); track.requestFrame(); }, 33);
function snapshotAfterVideoFrame(): void {
  if (snapshotFrame !== null) video.cancelVideoFrameCallback(snapshotFrame);
  // VideoTexture also waits for a decoded frame. In particular, the initial
  // video-ready state can precede its first GPU upload.
  snapshotFrame = video.requestVideoFrameCallback(() => {
    snapshotFrame = video.requestVideoFrameCallback(() => { snapshotFrame = null; snapshotNeeded = true; });
  });
}

const output = new OutputWindow(outputId);
output.setWindow(cssFrame.contentWindow!);
const cssStyle = cssFrame.contentDocument!.createElement('style');
cssStyle.textContent = '.dc-output-ui { display: none !important; }';
cssFrame.contentDocument!.head.appendChild(cssStyle);

function updateHandles(): void {
  const out = state.outputs.find(o => o.id === outputId);
  const mapping = state.mappings.find(isMappingEntry);
  handles.replaceChildren();
  if (!out || !mapping) return;
  handles.setAttribute('viewBox', `${out.position.x} ${out.position.y} ${out.size.width} ${out.size.height}`);
  for (const corner of CORNER_KEYS) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', `${mapping.quad[corner].x}`); circle.setAttribute('cy', `${mapping.quad[corner].y}`);
    circle.setAttribute('r', '5'); circle.dataset.corner = corner;
    handles.appendChild(circle);
  }
}

function syncState(): void {
  output.setMappings(state);
  cssFrame.contentDocument!.querySelectorAll('video').forEach(v => {
    if (v.srcObject !== stream) { v.srcObject = stream; void v.play().catch(console.error); }
  });
  preview?.setState(state, outputId);
  snapshotNeeded = true;
  updateHandles();
}
syncState();
let dragging: CornerKey | null = null;
handles.onpointerdown = event => {
  const corner = (event.target as SVGElement).dataset.corner as CornerKey | undefined;
  if (!corner) return;
  dragging = corner; handles.setPointerCapture(event.pointerId); event.preventDefault();
};
handles.onpointermove = event => {
  if (!dragging) return;
  const out = state.outputs.find(o => o.id === outputId)!;
  const mapping = state.mappings.find(isMappingEntry)!;
  const rect = handles.getBoundingClientRect();
  const target = { x: out.position.x + (event.clientX-rect.left)/rect.width*out.size.width, y: out.position.y + (event.clientY-rect.top)/rect.height*out.size.height };
  mapping.quad = { ...mapping.quad, [dragging]: constrainQuadCorner(mapping.quad, dragging, target) };
  syncState();
};
handles.onpointerup = handles.onpointercancel = () => { dragging = null; };
presetSelect.onchange = () => { state = fixture(presetSelect.value as Preset); syncState(); };
element<HTMLSelectElement>('pattern').onchange = event => { pattern = (event.target as HTMLSelectElement).value as Pattern; snapshotAfterVideoFrame(); };

function snapshotGPU(includePixels = false): { width: number; height: number; pixels: number[] } | null {
  if (!preview) return null;
  preview.render();
  const { width, height } = preview.compositor.target;
  const pixels = preview.compositor.readPixels();
  gpuCanvas.width = width; gpuCanvas.height = height;
  gpuCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  // Only browser tests need a serializable array. Avoid large allocations while dragging.
  return { width, height, pixels: includePixels ? Array.from(pixels) : [] };
}

function tick(time: number): void {
  if (!preview) return;
  preview.render();
  if (snapshotNeeded && video.readyState >= 2 && time-lastSnapshot >= 100) {
    snapshotGPU(); snapshotNeeded = false; lastSnapshot = time;
  }
  if (lastFrame) { frameTimes.push(time-lastFrame); if (frameTimes.length > 600) frameTimes.shift(); }
  lastFrame = time;
  if (frameTimes.length % 30 === 0) {
    const ms = frameTimes.reduce((a, b) => a+b, 0) / frameTimes.length;
    const info = preview.diagnostics();
    element('stats').textContent = `${(1000/ms).toFixed(1)} fps · source 640×360 · preview ${info.preview.join('×')}\n${info.venueTriangles} triangles · depth passes ${info.depthRenders}`;
  }
  animation = requestAnimationFrame(tick);
}

function stopPreview(): void {
  generation++; cancelAnimationFrame(animation); animation = 0;
  if (snapshotFrame !== null) video.cancelVideoFrameCallback(snapshotFrame);
  snapshotFrame = null;
  resizeObserver?.disconnect(); resizeObserver = null;
  preview?.dispose(); preview = null;
  startButton.disabled = false; stopButton.disabled = true; message('stopped');
}

async function startPreview(): Promise<void> {
  if (preview) return;
  const current = ++generation; startButton.disabled = true; stopButton.disabled = false; message('loading');
  try {
    // Three.js is not requested until the experiment is explicitly started.
    const { ProjectionPreview } = await import('./ProjectionPreview');
    await video.play();
    if (current !== generation) return;
    preview = new ProjectionPreview(venueCanvas, video);
    preview.setState(state, outputId);
    preview.setPreviewWidth(Number(element<HTMLSelectElement>('resolution').value));
    preview.setBoxVisible(element<HTMLInputElement>('box').checked);
    preview.setProjectionEnabled(element<HTMLInputElement>('projection').checked);
    const resize = () => {
      const rect = venueCanvas.getBoundingClientRect();
      preview?.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(venueCanvas); resize();
    frameTimes.length = 0; lastFrame = 0; snapshotNeeded = true; snapshotAfterVideoFrame();
    animation = requestAnimationFrame(tick); message('ready');
  } catch (error) {
    if (current !== generation) return;
    console.error(error); stopPreview(); message('failure');
  }
}
startButton.onclick = () => { void startPreview(); }; stopButton.onclick = stopPreview;
element('reset').onclick = () => preview?.resetView();
element('projector-view').onclick = () => preview?.projectorView();
element<HTMLInputElement>('box').onchange = event => preview?.setBoxVisible((event.target as HTMLInputElement).checked);
element<HTMLInputElement>('projection').onchange = event => preview?.setProjectionEnabled((event.target as HTMLInputElement).checked);
element<HTMLSelectElement>('resolution').onchange = event => { preview?.setPreviewWidth(Number((event.target as HTMLSelectElement).value)); snapshotNeeded = true; };
venueCanvas.addEventListener('webglcontextlost', event => { event.preventDefault(); stopPreview(); message('lost'); });

// Explicit PoC diagnostics for reproducible browser validation, not a viewer API.
const api = {
  get preview() { return preview; }, get stream() { return stream; }, get video() { return video; },
  get frameTimes() { return [...frameTimes]; }, get state() { return state; },
  start: startPreview, stop: stopPreview, snapshot: () => snapshotGPU(true),
  setState(next: MappingsState) { state = structuredClone(next); syncState(); },
  setPattern(next: Pattern) { pattern = next; snapshotAfterVideoFrame(); },
};
Object.assign(window, { projectionPoc: api });
window.addEventListener('pagehide', () => {
  stopPreview(); window.clearInterval(sourceTimer); offLanguage();
  cssFrame.contentWindow?.dispatchEvent(new Event('beforeunload'));
  video.pause(); video.srcObject = null;
  stream.getTracks().forEach(t => t.stop());
}, { once: true });
