import * as THREE from 'three';

/**
 * 選んだ台は水色、他の出力の台は橙で淡く描き、同時に表示しても見分けられるようにする (#129)。
 * 色だけに頼らないよう、他の台は本体も暗く、範囲面も薄くする。
 */
const STYLES = {
  selected: { body: 0x566577, accent: 0x67d5ff, line: .75, beam: .045 },
  other: { body: 0x3b4350, accent: 0xffb454, line: .5, beam: .02 },
} as const;
export type ProjectorGuideRole = keyof typeof STYLES;

/** Observer-only layer. Never rendered by the projector camera (background or depth pass). */
export class ProjectorGuide {
  readonly group = new THREE.Group();
  readonly range = new THREE.BufferGeometry();
  private rays = new THREE.BufferGeometry();
  private geometries: THREE.BufferGeometry[] = [this.range, this.rays];
  private materials: THREE.Material[] = [];
  readonly role: ProjectorGuideRole;
  constructor(role: ProjectorGuideRole = 'selected') {
    this.role = role; const style = STYLES[role];
    this.group.name = 'projector-guide'; this.group.visible = false; this.group.userData.role = role;
    this.rays.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(48), 3));
    this.range.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(36), 3));
    const body = new THREE.BoxGeometry(.38, .18, .28);
    const lens = new THREE.CylinderGeometry(.06, .06, .08, 16);
    lens.rotateX(Math.PI / 2); lens.translate(0, 0, -.04);
    body.translate(0, 0, .16);
    this.geometries.push(body, lens);
    const bodyMaterial = new THREE.MeshBasicMaterial({ color:style.body });
    const lensMaterial = new THREE.MeshBasicMaterial({ color:style.accent });
    const lineMaterial = new THREE.LineBasicMaterial({ color:style.accent, transparent:true, opacity:style.line, depthWrite:false });
    const beamMaterial = new THREE.MeshBasicMaterial({ color:style.accent, transparent:true, opacity:style.beam, side:THREE.DoubleSide, depthWrite:false });
    this.materials.push(bodyMaterial, lensMaterial, lineMaterial, beamMaterial);
    this.group.add(new THREE.Mesh(body, bodyMaterial), new THREE.Mesh(lens, lensMaterial),
      new THREE.LineSegments(this.rays, lineMaterial), new THREE.Mesh(this.range, beamMaterial));
    this.group.traverse(object => object.layers.set(1));
  }
  update(projector: THREE.PerspectiveCamera, bounds: THREE.Box3): void {
    this.group.position.copy(projector.position); this.group.quaternion.copy(projector.quaternion);
    let depth = projector.near;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z])
      depth = Math.max(depth, -new THREE.Vector3(x,y,z).applyMatrix4(projector.matrixWorldInverse).z);
    const length = Math.min(depth, projector.far);
    const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => {
      const ray = new THREE.Vector3(x,y,-1).applyMatrix4(projector.projectionMatrixInverse);
      return ray.multiplyScalar(length / -ray.z);
    });
    const lines: number[] = [], faces: number[] = [];
    corners.forEach((corner, index) => {
      const next = corners[(index+1)%4];
      lines.push(0,0,0,...corner.toArray(),...corner.toArray(),...next.toArray());
      faces.push(0,0,0,...corner.toArray(),...next.toArray());
    });
    const rayPositions = this.rays.getAttribute('position') as THREE.BufferAttribute;
    const facePositions = this.range.getAttribute('position') as THREE.BufferAttribute;
    rayPositions.copyArray(lines); rayPositions.needsUpdate = true; this.rays.computeBoundingSphere(); this.rays.computeBoundingBox();
    facePositions.copyArray(faces); facePositions.needsUpdate = true; this.range.computeBoundingSphere(); this.range.computeBoundingBox();
    this.group.updateMatrixWorld(true);
  }
  dispose(): void { this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.group.clear(); }
}
