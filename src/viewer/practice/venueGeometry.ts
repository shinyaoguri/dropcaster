import * as THREE from 'three';
import type { VenueObject } from './project';

/** Flat faces; size always describes the axis-aligned bounds before rotation. */
export function venueGeometry(object: Pick<VenueObject, 'kind' | 'size'>): THREE.BufferGeometry {
  if (object.kind !== 'tetrahedron' && object.kind !== 'prism') return new THREE.BoxGeometry(...object.size);
  const vertices = object.kind === 'tetrahedron'
    ? [[-.5,-.5,-.5],[.5,-.5,-.5],[0,-.5,.5],[0,.5,0]]
    : [[-.5,-.5,-.5],[.5,-.5,-.5],[0,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[0,.5,.5]];
  const faces = object.kind === 'tetrahedron'
    ? [[0,1,2],[0,3,1],[1,3,2],[2,3,0]]
    : [[0,2,1],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]];
  const points = vertices.map(v => new THREE.Vector3(...v).multiply(new THREE.Vector3(...object.size)));
  const positions: number[] = [];
  for (const face of faces) for (let i = 1; i < face.length - 1; i++) {
    const a = points[face[0]], b = points[face[i]], c = points[face[i+1]];
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    const ordered = normal.dot(a.clone().add(b).add(c)) < 0 ? [a,c,b] : [a,b,c];
    ordered.forEach(p => positions.push(...p.toArray()));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
