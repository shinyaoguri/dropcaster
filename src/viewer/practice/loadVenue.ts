import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { decodeAsset, validateGlb, ProjectFormatError, type Project } from './project';

export interface PreparedVenue { group: THREE.Group | null; dispose: () => void }
export async function prepareVenue(project: Project): Promise<PreparedVenue> {
  if (project.venue.scene.kind === 'sample') return { group: null, dispose() {} };
  const asset = project.assets.find(a => a.id === project.venue.scene.assetId);
  if (!asset) throw new ProjectFormatError('asset');
  const bytes = decodeAsset(asset.data); validateGlb(bytes);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (!url.startsWith('blob:')) throw new ProjectFormatError('externalAsset');
    return url;
  });
  const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer as ArrayBuffer, '');
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  let triangles = 0;
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    textures.forEach(texture => { texture.dispose(); const image = texture.source.data; if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close(); });
  };
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  if (!triangles || triangles > 300000 || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
    dispose(); throw new ProjectFormatError('size');
  }
  return { group: gltf.scene, dispose };
}
