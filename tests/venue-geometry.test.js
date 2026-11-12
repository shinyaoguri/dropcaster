import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Box3, PerspectiveCamera } from 'three';
import { venueGeometry } from '../src/viewer/practice/venueGeometry.ts';
import { ProjectorGuide } from '../src/viewer/practice/ProjectorGuide.ts';

/** @type {{kind:'tetrahedron'|'prism', triangles:number, volume:number}[]} */
const solids = [{kind:'tetrahedron',triangles:4,volume:1/6},{kind:'prism',triangles:8,volume:1/2}];
for (const {kind, triangles, volume} of solids) {
  test(`${kind} has exact measured bounds, outward flat faces and a closed surface`, () => {
    const geometry = venueGeometry({ kind, size:[2,3,4] });
    geometry.computeBoundingBox();
    assert.deepEqual(geometry.boundingBox.min.toArray(), [-1,-1.5,-2]);
    assert.deepEqual(geometry.boundingBox.max.toArray(), [1,1.5,2]);
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    assert.equal(p.count / 3, triangles);
    const edges = new Map(); let signedVolume = 0;
    for (let i=0; i<p.count; i+=3) {
      const points=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,i+j));
      const [a,b,c]=points, normal=b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(normal.dot(a.clone().add(b).add(c))>0, 'face points outward');
      signedVolume += a.dot(b.clone().cross(c))/6;
      for(let j=0;j<3;j++) {
        assert.ok(new Vector3().fromBufferAttribute(n,i+j).distanceTo(normal.clone().normalize())<1e-6);
        const edge=[points[j].toArray().join(','),points[(j+1)%3].toArray().join(',')].sort().join('|');
        edges.set(edge,(edges.get(edge)??0)+1);
      }
    }
    assert.ok(Math.abs(signedVolume-24*volume)<1e-6);
    assert.ok([...edges.values()].every(count=>count===2), 'every edge has exactly two adjacent triangles');
    geometry.dispose();
  });
}

test('guide follows shifted/rotated optics and is excluded from projector cameras', () => {
  const guide = new ProjectorGuide(), projector = new PerspectiveCamera(50, 1.6, .2, 20);
  projector.position.set(2,3,5); projector.rotation.set(-.3,.2,.1); projector.updateMatrixWorld(true);
  projector.projectionMatrix.makePerspective(-.15,.25,.18,-.08,.2,20);
  projector.projectionMatrixInverse.copy(projector.projectionMatrix).invert();
  guide.update(projector,new Box3(new Vector3(-4,0,-3),new Vector3(4,3,1)));
  assert.deepEqual(guide.group.position.toArray(),projector.position.toArray());
  assert.deepEqual(guide.group.quaternion.toArray(),projector.quaternion.toArray());
  guide.group.traverse(object=>assert.equal(projector.layers.test(object.layers),false));
  const p=guide.range.getAttribute('position');
  for (let i=0;i<4;i++) {
    const ndc=new Vector3().fromBufferAttribute(p,i*3+1).applyMatrix4(guide.group.matrixWorld).project(projector);
    const expected=[[-1,-1],[1,-1],[1,1],[-1,1]][i];
    assert.ok(Math.abs(ndc.x-expected[0])<1e-5 && Math.abs(ndc.y-expected[1])<1e-5);
  }
  let disposed=0;guide.range.addEventListener('dispose',()=>disposed++);guide.dispose();assert.equal(disposed,1);
});
