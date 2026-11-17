import * as THREE from 'three';
import type { Projector, Vec3 } from '../practice/project.ts';
import { projectToNdc } from './ProjectorNudge.ts';
import type { PixelPoint } from './venueReconstruct.ts';

/**
 * 「測った会場に合わせる」(#158) で選べる会場の頂点。壁に映る輪郭 (CalibrationProjection) と同じ
 * EdgesGeometry (稜線の角度 20°) の端点なので、輪郭の角として見えている点だけが候補になる。
 * 部材も GLB も同じに扱い、世界座標 (m) で返す。
 */
export const EDGE_THRESHOLD_DEGREES = 20;
/** これより近い端点は同じ頂点とみなす (m)。 */
const MERGE_DISTANCE = 1e-3;
/** 頂点を選ぶとき、十字から何 px 以内を探すか (出力の高さに対する比)。 */
export const VERTEX_PICK_RATIO = .04;

export function collectVertices(meshes: readonly THREE.Mesh[]): Vec3[] {
  const seen = new Map<string, Vec3>(), point = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const edges = new THREE.EdgesGeometry(mesh.geometry, EDGE_THRESHOLD_DEGREES);
    try {
      const positions = edges.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        const key = [point.x, point.y, point.z].map(v => Math.round(v / MERGE_DISTANCE)).join(',');
        if (!seen.has(key)) seen.set(key, [point.x, point.y, point.z]);
      }
    } finally { edges.dispose(); }
  }
  return [...seen.values()];
}

/** 世界座標の点が映る出力画素 (左上原点・y 下向き)。プロジェクタの背後なら null。 */
export function projectToPixel(projector: Projector, output: { width: number; height: number }, point: Vec3): PixelPoint | null {
  const ndc = projectToNdc(projector, point);
  return ndc ? [(ndc[0] + 1) / 2 * output.width, (1 - ndc[1]) / 2 * output.height] : null;
}

/**
 * プロジェクタから見て、頂点の手前に会場の面があるか (光が届かず実物で指せない)。
 * 壁の厚みの外側の角のように、輪郭の角のすぐ近くに映るが隠れている頂点を候補から外すのに使う。
 */
export function isVertexVisible(meshes: readonly THREE.Object3D[], projector: Pick<Projector, 'position'>, world: Vec3): boolean {
  const origin = new THREE.Vector3(...projector.position), direction = new THREE.Vector3(...world).sub(origin);
  const distance = direction.length();
  if (!(distance > 0)) return false;
  const raycaster = new THREE.Raycaster(origin, direction.divideScalar(distance), 0, distance - Math.max(1e-3, distance * 1e-4));
  meshes.forEach(mesh => mesh.updateWorldMatrix(true, false));
  return raycaster.intersectObjects(meshes as THREE.Object3D[], false).length === 0;
}

/**
 * 十字に最も近く映る頂点。出力の外とプロジェクタの背後の頂点は選ばない (光が当たらず実物で指せない)。
 * visible を渡すと、近い順に調べて隠れている頂点を飛ばす。radius (px) 以内に無ければ null。
 */
export function nearestProjectedVertex(vertices: readonly Vec3[], projector: Projector, output: { width: number; height: number },
  pixel: PixelPoint, { radius = VERTEX_PICK_RATIO * output.height, visible }: { radius?: number; visible?: (world: Vec3) => boolean } = {}): { world: Vec3; pixel: PixelPoint } | null {
  const candidates: { world: Vec3; pixel: PixelPoint; distance: number }[] = [];
  for (const world of vertices) {
    const p = projectToPixel(projector, output, world);
    if (!p || p[0] < 0 || p[0] > output.width || p[1] < 0 || p[1] > output.height) continue;
    const distance = Math.hypot(p[0] - pixel[0], p[1] - pixel[1]);
    if (distance <= radius) candidates.push({ world: [...world] as Vec3, pixel: p, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const found = visible ? candidates.find(c => visible(c.world)) : candidates[0];
  return found ? { world: found.world, pixel: found.pixel } : null;
}
