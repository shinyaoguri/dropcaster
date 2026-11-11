import type { MappingEntry, MappingsState, Quad } from '../../src/viewer/utils/mappingTransform';

export const presetNames = ['full', 'perspective', 'crop', 'mask', 'mask-behind', 'concave-mask', 'winding-mask', 'spanning', 'mirrored', 'degenerate'] as const;
export type Preset = typeof presetNames[number];
const rectangle = (x = 0, y = 0, w = 320, h = 180): Quad => ({
  topLeft: { x, y }, topRight: { x: x+w, y }, bottomRight: { x: x+w, y: y+h }, bottomLeft: { x, y: y+h },
});

export function fixture(preset: Preset): MappingsState {
  const mapping: MappingEntry = { id: 'mapping', source: { x: 0, y: 0, width: 100, height: 100 }, quad: rectangle() };
  const state: MappingsState = {
    version: 2, canvas: { width: 320, height: 180 }, activeId: 'mapping',
    outputs: [{ id: 'output', position: { x: 0, y: 0 }, size: { width: 320, height: 180 } }], mappings: [mapping],
  };
  if (preset === 'perspective' || preset === 'crop') {
    mapping.quad = { topLeft: { x: 18, y: 8 }, topRight: { x: 305, y: 24 }, bottomRight: { x: 274, y: 169 }, bottomLeft: { x: 54, y: 145 } };
    if (preset === 'crop') mapping.source = { x: -12, y: 23, width: 125, height: 64 };
  }
  if (preset.includes('mask')) {
    let points = [{ x: 90, y: 35 }, { x: 230, y: 50 }, { x: 190, y: 140 }, { x: 70, y: 120 }];
    if (preset === 'concave-mask') points = [{ x: 70, y: 20 }, { x: 230, y: 20 }, { x: 140, y: 90 }, { x: 230, y: 160 }, { x: 70, y: 160 }];
    if (preset === 'winding-mask') points = [...points, ...points]; // twice wound: nonzero still fills
    state.mappings.unshift({ id: 'mask', kind: 'mask', points });
    if (preset === 'mask-behind') state.mappings.reverse();
    state.mappings.unshift({ id: 'disabled', kind: 'mask', enabled: false, points }, { id: 'draft', kind: 'mask', drafting: true, points });
  }
  if (preset === 'spanning') {
    state.canvas.width = 640; state.outputs[0].position.x = 320;
    state.outputs.unshift({ id: 'left', position: { x: 0, y: 0 }, size: { width: 320, height: 180 } });
    mapping.quad = rectangle(210, 20, 320, 140);
  }
  if (preset === 'mirrored') mapping.quad = rectangle(300, 10, -280, 160);
  if (preset === 'degenerate') mapping.quad.bottomLeft = { x: 160, y: 90 };
  return state;
}

export type Pattern = 'grid' | 'white' | 'black' | 'alpha';
export function drawPattern(canvas: HTMLCanvasElement, pattern: Pattern): void {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  if (pattern === 'white' || pattern === 'black') {
    ctx.fillStyle = pattern; ctx.fillRect(0, 0, w, h); return;
  }
  ctx.fillStyle = '#d52e59'; ctx.fillRect(0, 0, w/2, h/2);
  ctx.fillStyle = '#20b886'; ctx.fillRect(w/2, 0, w/2, h/2);
  ctx.fillStyle = '#325ed4'; ctx.fillRect(0, h/2, w/2, h/2);
  ctx.fillStyle = '#e5bf36'; ctx.fillRect(w/2, h/2, w/2, h/2);
  if (pattern === 'alpha') {
    ctx.clearRect(w*0.2, h*0.2, w*0.6, h*0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(w*0.3, h*0.3, w*0.4, h*0.4);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += w/16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += h/9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = '#111'; ctx.font = 'bold 28px sans-serif'; ctx.fillText('TOP LEFT', 16, 36); ctx.fillText('R', w-44, h-16);
}
