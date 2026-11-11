import { defaultMappingsState, parseMappingsState, CORNER_KEYS, type MappingsState } from '../utils/mappingTransform.ts';

export type Vec3 = [number, number, number];
export type Quaternion = [number, number, number, number];
export interface Projector {
  id: string; outputId: string; position: Vec3; quaternion: Quaternion;
  verticalFovDegrees: number; aspect: number; lensShift: [number, number]; near: number; far: number;
}
export interface VenueScene {
  kind: 'sample' | 'glb'; assetId?: string; metersPerUnit: number;
  position: Vec3; quaternion: Quaternion; scale: Vec3; color: string;
}
export interface ContentReference {
  id: string; kind: 'local' | 'op' | 'gist'; ref: string; title: string;
  path?: string; revision: string | null; revisionPinned: false;
}
export interface Project {
  format: 'dropcaster-project'; schemaVersion: 1; id: string; name: string; createdAt: string; updatedAt: string;
  venue: { id: string; revision: number; layout: MappingsState; scene: VenueScene; projectors: Projector[] };
  content: ContentReference[];
  show: { contentIds: string[]; intervalSeconds: number; currentIndex: number };
  assets: { id: string; name: string; mimeType: 'model/gltf-binary'; data: string }[];
}
export const MAX_GLB_BYTES = 20 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 30 * 1024 * 1024;
export class ProjectFormatError extends Error {
  constructor(publicCode: string) { super(publicCode); this.name = 'ProjectFormatError'; }
}
const fail = (code = 'invalid'): never => { throw new ProjectFormatError(code); };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const str = (v: unknown, max = 200): string => typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : fail();
const num = (v: unknown, min: number, max: number): number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail();
const vector = (v: unknown, n: number, min = -10000, max = 10000): number[] => {
  if (!Array.isArray(v) || v.length !== n) fail();
  return (v as unknown[]).map(x => num(x, min, max));
};
const quat = (v: unknown): Quaternion => {
  const q = vector(v, 4, -1, 1) as Quaternion;
  if (Math.abs(Math.hypot(...q) - 1) > 0.001) fail();
  return q;
};
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) fail('reference'); };

/** Keep the v2 parser's compatibility defaults, but reject partial/unsafe imports. */
function parseLayout(value: unknown): MappingsState {
  const raw = record(value), outputs = list(raw.outputs, 4), mappings = list(raw.mappings, 256);
  const layout = parseMappingsState(value);
  if (!layout || !outputs.length || layout.outputs.length !== outputs.length || layout.mappings.length !== mappings.length) return fail();
  const point = (p: { x: number; y: number }) => { num(p.x, -1_000_000, 1_000_000); num(p.y, -1_000_000, 1_000_000); };
  const size = (s: { width: number; height: number }) => { num(s.width, 0.0001, 1_000_000); num(s.height, 0.0001, 1_000_000); };
  size(layout.canvas);
  for (const output of layout.outputs) {
    str(output.id); point(output.position); size(output.size);
    if (output.pixelSize) size(output.pixelSize);
    if (output.screen) { size(output.screen); num(output.screen.left, -1_000_000, 1_000_000); num(output.screen.top, -1_000_000, 1_000_000); }
  }
  for (const [index, item] of layout.mappings.entries()) {
    const original = record(mappings[index]);
    if (original.kind !== undefined && original.kind !== 'mask' && original.kind !== 'mapping') fail();
    str(item.id);
    if (item.kind === 'mask') {
      if (item.points.length > 4096) fail('size');
      item.points.forEach(point);
    } else {
      point(item.source); size(item.source);
      CORNER_KEYS.forEach(key => point(item.quad[key]));
    }
  }
  unique(layout.outputs.map(o => o.id)); unique(layout.mappings.map(m => m.id));
  return layout;
}

export function defaultProjector(outputId: string): Projector {
  const pitch = -Math.atan2(1.1, 7.5);
  return { id: `projector-${outputId}`, outputId, position: [0, 2.5, 4.5], quaternion: [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)],
    verticalFovDegrees: 43, aspect: 16 / 9, lensShift: [0, 0], near: 0.1, far: 30 };
}
export function defaultScene(): VenueScene {
  return { kind: 'sample', metersPerUnit: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], color: '#ffffff' };
}
export function createProject(layout = defaultMappingsState()): Project {
  const now = new Date().toISOString();
  return { format: 'dropcaster-project', schemaVersion: 1, id: crypto.randomUUID(), name: 'Untitled', createdAt: now, updatedAt: now,
    venue: { id: crypto.randomUUID(), revision: 1, layout, scene: defaultScene(), projectors: layout.outputs.map(o => defaultProjector(o.id)) },
    content: [], show: { contentIds: [], intervalSeconds: 30, currentIndex: 0 }, assets: [] };
}

/** 2D output compaction must never move the physical projector. */
export function reconcileProjectLayout(project: Project, layout: MappingsState): Project {
  return { ...project, updatedAt: new Date().toISOString(), venue: { ...project.venue, layout,
    projectors: layout.outputs.map(output => project.venue.projectors.find(p => p.outputId === output.id) ?? defaultProjector(output.id)) } };
}

/** Self-contained static GLB only: parsing must never fetch remote/local companion files. */
export function validateGlb(bytes: Uint8Array): void {
  if (bytes.length > MAX_GLB_BYTES) fail('size');
  if (bytes.length < 20) fail('asset');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) fail('asset');
  let offset = 12, json: Record<string, unknown> | undefined, binaryLength = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail('asset');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > bytes.length) fail('asset');
    if (type === 0x4e4f534a) {
      if (json || offset !== 12) fail('asset');
      try { json = record(JSON.parse(new TextDecoder().decode(bytes.subarray(offset + 8, offset + 8 + length)).trim())); }
      catch { fail('asset'); }
    } else if (type === 0x004e4942) { if (binaryLength) fail('asset'); binaryLength = length; }
    else fail('asset');
    offset += 8 + length;
  }
  if (!json || record(json.asset).version !== '2.0') fail('asset');
  const doc = json!;
  for (const value of [...list(doc.buffers ?? [], 1), ...list(doc.images ?? [], 64)]) {
    if ('uri' in record(value)) fail('externalAsset');
  }
  for (const buffer of list(doc.buffers ?? [], 1)) num(record(buffer).byteLength, 0, binaryLength);
  for (const value of list(doc.bufferViews ?? [], 10000)) {
    const v = record(value);
    if (v.buffer !== 0) fail('asset');
    const start = num(v.byteOffset ?? 0, 0, binaryLength), length = num(v.byteLength, 0, binaryLength);
    if (!Number.isInteger(start) || !Number.isInteger(length) || start + length > binaryLength) fail('asset');
  }
  const supported = new Set(['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_emissive_strength']);
  for (const ext of list(doc.extensionsRequired ?? [], 20)) if (!supported.has(str(ext))) fail('unsupportedAsset');
  if (list(doc.skins ?? [], 100).length || list(doc.animations ?? [], 100).length) fail('unsupportedAsset');
  const nodes = list(doc.nodes ?? [], 5000);
  // Reject recursive node graphs before handing them to the scene loader.
  const visiting = new Set<number>(), visited = new Set<number>();
  const visit = (index: number, depth = 0) => {
    if (visiting.has(index) || depth > 100) fail('asset');
    if (visited.has(index)) return;
    visiting.add(index);
    for (const child of list(record(nodes[index]).children ?? [], 5000)) {
      const i = num(child, 0, nodes.length - 1); if (!Number.isInteger(i)) fail('asset'); visit(i, depth + 1);
    }
    visiting.delete(index); visited.add(index);
  };
  nodes.forEach((_, index) => visit(index));
  let vertices = 0;
  for (const accessor of list(doc.accessors ?? [], 10000)) vertices += num(record(accessor).count, 0, 1_000_000);
  if (vertices > 4_000_000) fail('size');
}

export function decodeAsset(data: string): Uint8Array {
  // Avoid a repeated-group regexp: multi-megabyte GLBs can exhaust regexp stacks.
  if (!data.length || data.length > Math.ceil(MAX_GLB_BYTES / 3) * 4 || data.length % 4 || /[^A-Za-z0-9+/=]/.test(data)) fail('asset');
  const padding = data.indexOf('=');
  if (padding !== -1 && (padding < data.length - 2 || !/^={1,2}$/.test(data.slice(padding)))) fail('asset');
  let raw: string;
  try { raw = atob(data); } catch { return fail('asset'); }
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export function encodeAsset(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}

/** Validate everything before mutating the live controller; legacy v2 uses the existing parser. */
export function parseProject(value: unknown): Project {
  const root = record(value);
  if (root.version === 2 && root.format === undefined) {
    return createProject(parseLayout(root));
  }
  if (root.format !== 'dropcaster-project') fail();
  if (root.schemaVersion !== 1) fail('version');
  const venue = record(root.venue), scene = record(venue.scene), show = record(root.show);
  const layout = parseLayout(venue.layout);
  const projectors = list(venue.projectors, 4).map(value => {
    const p = record(value), near = num(p.near, 0.001, 1000), far = num(p.far, 0.002, 10000);
    if (far <= near) fail();
    const outputId = str(p.outputId);
    if (!layout.outputs.some(o => o.id === outputId)) fail('reference');
    return { id: str(p.id), outputId, position: vector(p.position, 3) as Vec3, quaternion: quat(p.quaternion),
      verticalFovDegrees: num(p.verticalFovDegrees, 1, 170), aspect: num(p.aspect, 0.2, 5),
      lensShift: vector(p.lensShift, 2, -2, 2) as [number, number], near, far };
  });
  unique(projectors.map(p => p.id)); unique(projectors.map(p => p.outputId));
  if (projectors.length !== layout.outputs.length) fail('reference');
  const assets = list(root.assets, 1).map(value => {
    const a = record(value);
    if (a.mimeType !== 'model/gltf-binary') fail('asset');
    const data = str(a.data, Math.ceil(MAX_GLB_BYTES / 3) * 4);
    validateGlb(decodeAsset(data));
    return { id: str(a.id), name: str(a.name), mimeType: 'model/gltf-binary' as const, data };
  });
  unique(assets.map(a => a.id));
  if (scene.kind !== 'sample' && scene.kind !== 'glb') fail();
  const assetId = scene.kind === 'glb' ? str(scene.assetId) : undefined;
  if (assetId && !assets.some(a => a.id === assetId)) fail('asset');
  const color = str(scene.color);
  if (!/^#[0-9a-f]{6}$/i.test(color)) fail();
  const content = list(root.content, 100).map(value => {
    const c = record(value), kind = c.kind;
    if (kind !== 'local' && kind !== 'op' && kind !== 'gist') fail();
    const ref = str(c.ref);
    if ((kind === 'op' && !/^\d+$/.test(ref)) || (kind === 'gist' && !/^[a-f0-9]{20,64}$/i.test(ref))) fail('reference');
    const path = c.path === undefined ? undefined : str(c.path, 2000);
    if (path && (/^[a-z]+:/i.test(path) || path.startsWith('//') || path.includes('..'))) fail('reference');
    if (c.revisionPinned !== false) fail('version');
    return { id: str(c.id), kind: kind as ContentReference['kind'], ref, title: str(c.title), path,
      revision: c.revision === null ? null : str(c.revision), revisionPinned: false as const };
  });
  unique(content.map(c => c.id));
  const contentIds = list(show.contentIds, 100).map(id => str(id));
  if (contentIds.some(id => !content.some(c => c.id === id))) fail('reference');
  const currentIndex = num(show.currentIndex, 0, Math.max(0, contentIds.length - 1));
  if (!Number.isInteger(currentIndex)) fail();
  const createdAt = str(root.createdAt), updatedAt = str(root.updatedAt);
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) fail();
  return { format: 'dropcaster-project', schemaVersion: 1, id: str(root.id), name: str(root.name), createdAt, updatedAt,
    venue: { id: str(venue.id), revision: num(venue.revision, 1, Number.MAX_SAFE_INTEGER), layout,
      scene: { kind: scene.kind as VenueScene['kind'], assetId, metersPerUnit: num(scene.metersPerUnit, 0.00001, 10000),
        position: vector(scene.position, 3) as Vec3, quaternion: quat(scene.quaternion), scale: vector(scene.scale, 3, 0.0001, 1000) as Vec3, color }, projectors },
    content, show: { contentIds, intervalSeconds: num(show.intervalSeconds, 5, 300), currentIndex }, assets };
}

/** Portable package: device screen placement and transient editor selection are not shared. */
export function portableProject(project: Project): Project {
  const copy = structuredClone(project);
  for (const output of copy.venue.layout.outputs) delete output.screen;
  copy.venue.layout.activeId = copy.venue.layout.mappings[0]?.id ?? '';
  copy.venue.layout.activeOutputId = copy.venue.layout.outputs[0]?.id;
  return copy;
}
