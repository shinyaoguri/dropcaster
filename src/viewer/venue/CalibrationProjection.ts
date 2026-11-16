import * as THREE from 'three';
import type { ProjectionPreview } from '../practice/ProjectionPreview';

export type CalibrationPattern = 'outline' | 'grid' | 'white' | 'black';

/** なぞる十字の腕の幅と、中心で抜く隙間の半分 (出力画素)。隙間から壁の角そのものが見える。 */
const CROSSHAIR_WIDTH = 3, CROSSHAIR_GAP = 12;

/**
 * A dedicated, unwarped projector canvas. Observer motion and editing helpers cannot enter it.
 * The tracing crosshair (#246, ADR 0023) is part of the alignment image itself: people aim it at real corners on the wall.
 */
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
  private readonly overlay = new THREE.Scene();
  private readonly crosshairGeometry = new THREE.BufferGeometry();
  private readonly crosshairMaterial = new THREE.MeshBasicMaterial({ color: 0xff2a2a, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  private crosshair: [number, number] | null = null;
  private pattern: CalibrationPattern = 'outline';
  private key = '';
  private stream: MediaStream | null = null;
  private disposed = false;
  /** 実際に描き直した回数。画面上の縮小表示はこれが変わったときだけ描き直す。 */
  revision = 0;
  constructor(preview: ProjectionPreview) {
    this.preview = preview;
    this.canvas.id = 'venue-projection-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1); this.renderer.setClearColor(0x000000); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.patternScene.add(new THREE.Mesh(this.patternGeometry, this.patternMaterial));
    this.crosshairGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 6 * 3), 3));
    // 頂点は描くたびに書き換えるので、最初の境界球で視錐台の外と判定されないようにする。
    const crosshair = new THREE.Mesh(this.crosshairGeometry, this.crosshairMaterial); crosshair.frustumCulled = false;
    this.overlay.add(crosshair);
    this.setSize(1920, 1080);
  }
  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false); this.patternMaterial.uniforms.resolution.value.set(width, height); this.key = '';
  }
  setPattern(pattern: CalibrationPattern): void { this.pattern = pattern; this.key = ''; this.render(); }
  /** なぞる十字を出力画素 (左上原点・y 下向き) に置く。null で消す。 */
  setCrosshair(pixel: [number, number] | null): void {
    if (pixel?.[0] === this.crosshair?.[0] && pixel?.[1] === this.crosshair?.[1]) return;
    this.crosshair = pixel ? [pixel[0], pixel[1]] : null;
    this.render();
  }
  /** 十字の 4 本の腕を、画像の端まで届く幅 CROSSHAIR_WIDTH の帯として NDC で作る。 */
  private buildCrosshair(): void {
    const [x, y] = this.crosshair!, { width, height } = this.canvas, w = CROSSHAIR_WIDTH / 2, g = CROSSHAIR_GAP;
    const rects: [number, number, number, number][] = [[0, y - w, x - g, y + w], [x + g, y - w, width, y + w], [x - w, 0, x + w, y - g], [x - w, y + g, x + w, height]];
    const ndc = (px: number, py: number) => [px / width * 2 - 1, 1 - py / height * 2, 0];
    const positions = rects.flatMap(([x0, y0, x1, y1]) => x1 <= x0 || y1 <= y0 ? new Array(18).fill(0)
      : [...ndc(x0, y0), ...ndc(x1, y0), ...ndc(x1, y1), ...ndc(x0, y0), ...ndc(x1, y1), ...ndc(x0, y1)]);
    const attribute = this.crosshairGeometry.getAttribute('position') as THREE.BufferAttribute;
    (attribute.array as Float32Array).set(positions); attribute.needsUpdate = true;
  }
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
    const key = JSON.stringify([this.pattern, this.crosshair, this.canvas.width, this.canvas.height, camera.matrixWorld.elements, camera.projectionMatrix.elements, this.entries.map(e => e.group.matrix.elements)]);
    if (key === this.key) return;
    this.key = key;
    if (this.pattern === 'outline') this.renderer.render(this.scene, camera);
    else {
      this.patternMaterial.uniforms.kind.value = this.pattern === 'grid' ? 1 : this.pattern === 'white' ? 2 : 3;
      this.renderer.render(this.patternScene, this.patternCamera);
    }
    if (this.crosshair) {
      this.buildCrosshair();
      this.renderer.autoClear = false; this.renderer.render(this.overlay, this.patternCamera); this.renderer.autoClear = true;
    }
    this.revision++;
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
    this.crosshairGeometry.dispose(); this.crosshairMaterial.dispose(); this.overlay.clear();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
  }
}
