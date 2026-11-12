import * as THREE from 'three';
import type { ProjectionPreview } from '../practice/ProjectionPreview';

export type CalibrationPattern = 'outline' | 'grid' | 'white' | 'black';

/** A dedicated, unwarped projector canvas. Observer motion and editing helpers cannot enter it. */
export class CalibrationProjection {
  readonly canvas = document.createElement('canvas');
  readonly renderer: THREE.WebGLRenderer;
  private readonly preview: ProjectionPreview;
  private readonly scene = new THREE.Scene();
  private readonly surface = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  private readonly edge = new THREE.LineBasicMaterial({ color: 0xffffff });
  private readonly patternScene = new THREE.Scene();
  private readonly patternCamera = new THREE.Camera();
  private readonly patternGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly patternMaterial = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { kind: { value: 1 }, resolution: { value: new THREE.Vector2(1920, 1080) } },
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `uniform float kind; uniform vec2 resolution;
      void main(){
        vec2 p=gl_FragCoord.xy, uv=p/resolution;
        vec2 d=abs(fract(uv*10.0+.5)-.5)*resolution/10.0;
        bool line=min(d.x,d.y)<1.2 || min(min(p.x,p.y),min(resolution.x-p.x,resolution.y-p.y))<3.0;
        bool center=min(abs(p.x-resolution.x/2.0),abs(p.y-resolution.y/2.0))<2.0;
        vec3 color=kind>2.5?vec3(0.0):kind>1.5?vec3(1.0):center?vec3(1.0,.25,.2):line?vec3(1.0):vec3(0.0);
        gl_FragColor=vec4(color,1.0);
      }`,
  });
  private entries: { source: THREE.Mesh; group: THREE.Group; edges: THREE.EdgesGeometry }[] = [];
  private pattern: CalibrationPattern = 'outline';
  private key = '';
  private stream: MediaStream | null = null;
  private disposed = false;
  constructor(preview: ProjectionPreview) {
    this.preview = preview;
    this.canvas.id = 'venue-projection-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1); this.renderer.setClearColor(0x000000); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.patternScene.add(new THREE.Mesh(this.patternGeometry, this.patternMaterial));
    this.setSize(1920, 1080);
  }
  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false); this.patternMaterial.uniforms.resolution.value.set(width, height); this.key = '';
  }
  setPattern(pattern: CalibrationPattern): void { this.pattern = pattern; this.key = ''; this.render(); }
  private rebuild(meshes: THREE.Mesh[]): void {
    this.entries.forEach(entry => entry.edges.dispose()); this.scene.clear();
    this.entries = meshes.map(source => {
      const edges = new THREE.EdgesGeometry(source.geometry, 20), group = new THREE.Group();
      group.matrixAutoUpdate = false;
      group.add(new THREE.Mesh(source.geometry, this.surface), new THREE.LineSegments(edges, this.edge));
      this.scene.add(group); return { source, group, edges };
    });
    this.key = '';
  }
  render(): void {
    if (this.disposed) return;
    const meshes = this.preview.venueMeshes();
    if (meshes.length !== this.entries.length || meshes.some((mesh, i) => mesh !== this.entries[i].source)) this.rebuild(meshes);
    const camera = this.preview.projector;
    camera.updateMatrixWorld(true);
    for (const { source, group } of this.entries) { source.updateWorldMatrix(true, false); group.matrix.copy(source.matrixWorld); }
    const key = JSON.stringify([this.pattern, camera.matrixWorld.elements, camera.projectionMatrix.elements, this.entries.map(e => e.group.matrix.elements)]);
    if (key === this.key) return;
    this.key = key;
    if (this.pattern === 'outline') this.renderer.render(this.scene, camera);
    else {
      this.patternMaterial.uniforms.kind.value = this.pattern === 'grid' ? 1 : this.pattern === 'white' ? 2 : 3;
      this.renderer.render(this.patternScene, this.patternCamera);
    }
    (this.stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined)?.requestFrame?.();
  }
  capture(): MediaStream {
    if (!this.stream) this.stream = this.canvas.captureStream(10);
    this.key = ''; this.render(); return this.stream;
  }
  stopCapture(): void { this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.stopCapture();
    this.entries.forEach(entry => entry.edges.dispose()); this.entries = []; this.scene.clear();
    this.surface.dispose(); this.edge.dispose(); this.patternGeometry.dispose(); this.patternMaterial.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
  }
}
