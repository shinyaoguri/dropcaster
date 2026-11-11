import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MappingCompositor } from './MappingCompositor';
import type { MappingsState } from '../../src/viewer/utils/mappingTransform';

const projection = `
  uniform sampler2D projectionTexture;
  uniform sampler2D projectorDepth;
  uniform mat4 projectorMatrix;
  uniform vec3 projectorPosition;
  uniform bool projectionEnabled;
  vec3 projectedLight(vec3 point, vec3 normal) {
    if (!projectionEnabled || dot(normal, projectorPosition-point) <= 0.0) return vec3(0.0);
    vec4 clip = projectorMatrix * vec4(point, 1.0);
    if (clip.w <= 0.0) return vec3(0.0);
    vec3 ndc = clip.xyz / clip.w;
    if (any(lessThan(ndc, vec3(-1.0))) || any(greaterThan(ndc, vec3(1.0)))) return vec3(0.0);
    vec2 uv = ndc.xy * 0.5 + 0.5;
    float depth = ndc.z * 0.5 + 0.5;
    if (depth > texture2D(projectorDepth, uv).r + 0.00015) return vec3(0.0);
    vec3 encoded = texture2D(projectionTexture, uv).rgb;
    return mix(encoded / 12.92, pow((encoded+0.055)/1.055, vec3(2.4)), step(vec3(0.04045), encoded));
  }
`;

/** Isolated geometric preview; no WindowController or project persistence. */
export class ProjectionPreview {
  readonly renderer: THREE.WebGLRenderer;
  readonly compositor: MappingCompositor;
  readonly projector = new THREE.PerspectiveCamera(43, 16/9, 0.1, 30);
  readonly observer = new THREE.PerspectiveCamera(48, 1, 0.1, 50);
  readonly scene = new THREE.Scene();
  readonly controls: OrbitControls;
  readonly box: THREE.Mesh;
  private readonly depthTarget = new THREE.WebGLRenderTarget(1024, 1024);
  private readonly depthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly projectionMatrix = new THREE.Matrix4();
  private depthDirty = true;
  private disposed = false;
  depthRenders = 0;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement, width = 640, height = 360) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    try {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x151b25);
      this.compositor = new MappingCompositor(this.renderer, video, width, height);
      this.depthTarget.depthTexture = new THREE.DepthTexture(1024, 1024, THREE.UnsignedIntType);
      this.depthTarget.depthTexture.minFilter = this.depthTarget.depthTexture.magFilter = THREE.NearestFilter;
      this.projector.position.set(0, 2.5, 4.5);
      this.projector.lookAt(0, 1.4, -3);
      this.updateProjector();

      const wall = this.addSurface(new THREE.PlaneGeometry(8, 4.5), 0xb5bac7);
      wall.position.set(0, 2.25, -3);
      const floor = this.addSurface(new THREE.PlaneGeometry(8, 8), 0x7c879c);
      floor.rotation.x = -Math.PI / 2;
      floor.position.z = -0.5;
      this.box = this.addSurface(new THREE.BoxGeometry(1.3, 1.6, 1), 0xc8c5b9);
      this.box.position.set(-0.2, 0.8, -0.5);
      this.controls = new OrbitControls(this.observer, canvas);
      this.controls.enableDamping = true;
      this.controls.minDistance = 1;
      this.controls.maxDistance = 25;
      this.resetView();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private uniforms() {
    return {
      projectionTexture: { value: this.compositor.target.texture },
      projectorDepth: { value: this.depthTarget.depthTexture },
      projectorMatrix: { value: this.projectionMatrix },
      projectorPosition: { value: this.projector.position },
      projectionEnabled: { value: true },
    };
  }

  private addSurface(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { ...this.uniforms(), baseColor: { value: new THREE.Color(color) } },
      vertexShader: `
        varying vec3 worldPoint;
        varying vec3 worldNormal;
        void main() {
          worldPoint = (modelMatrix * vec4(position, 1.0)).xyz;
          // Sample venue uses unscaled model transforms; dimensions live in geometry.
          worldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPoint, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 worldPoint;
        varying vec3 worldNormal;
        uniform vec3 baseColor;
        ${projection}
        void main() {
          vec3 n = normalize(worldNormal);
          // Double-sided sample planes have a distinct unlit back surface.
          // Without this, viewing a wall from behind shows its front projection.
          if (!gl_FrontFacing) n = -n;
          float ambient = 0.18 + 0.18 * max(0.0, dot(n, normalize(vec3(-0.5,1.0,0.7))));
          gl_FragColor = vec4(baseColor * ambient + projectedLight(worldPoint, n) * 0.9, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    this.materials.push(material); this.geometries.push(geometry); this.scene.add(mesh);
    return mesh;
  }

  updateProjector(): void {
    this.projector.updateProjectionMatrix(); this.projector.updateMatrixWorld(true);
    this.projectionMatrix.multiplyMatrices(this.projector.projectionMatrix, this.projector.matrixWorldInverse);
    this.depthDirty = true;
  }

  setState(state: MappingsState, outputId: string): void { this.compositor.setState(state, outputId); }
  setBoxVisible(visible: boolean): void { this.box.visible = visible; this.depthDirty = true; }
  setProjectionEnabled(enabled: boolean): void {
    for (const m of this.materials) m.uniforms.projectionEnabled.value = enabled;
  }
  setPreviewWidth(width: number): void {
    this.compositor.setSize(width, Math.round(width / this.projector.aspect));
  }
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.observer.aspect = width / height;
    this.observer.updateProjectionMatrix();
  }
  resetView(): void {
    this.observer.position.set(6, 4, 6);
    this.controls.target.set(0, 1.25, -1.5);
    this.controls.update();
  }
  projectorView(): void {
    this.observer.position.copy(this.projector.position);
    this.controls.target.copy(this.projector.position).add(this.projector.getWorldDirection(new THREE.Vector3()).multiplyScalar(7));
    this.controls.update();
  }

  render(): void {
    if (this.disposed) return;
    this.compositor.render();
    if (this.depthDirty) {
      const previous = this.renderer.getRenderTarget();
      this.scene.overrideMaterial = this.depthMaterial;
      this.renderer.setRenderTarget(this.depthTarget);
      this.renderer.clear(); this.renderer.render(this.scene, this.projector);
      this.scene.overrideMaterial = null; this.renderer.setRenderTarget(previous);
      this.depthDirty = false; this.depthRenders++;
    }
    this.controls.update();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.observer);
  }

  /** Test harness: evaluate the actual projector shader at a world-space surface point. */
  probe(point: [number, number, number], normal: [number, number, number]): number[] {
    const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms(), probePoint: { value: new THREE.Vector3(...point) }, probeNormal: { value: new THREE.Vector3(...normal) } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `${projection}
        uniform vec3 probePoint; uniform vec3 probeNormal;
        void main() { gl_FragColor = vec4(projectedLight(probePoint, probeNormal), 1.0); }
      `,
    });
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material));
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target); this.renderer.render(scene, new THREE.Camera());
    const pixel = new Uint8Array(4); this.renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
    this.renderer.setRenderTarget(previous);
    geometry.dispose(); material.dispose(); target.dispose();
    return Array.from(pixel.slice(0, 3));
  }

  diagnostics() {
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      preview: [this.compositor.target.width, this.compositor.target.height],
      viewport: [this.renderer.domElement.width, this.renderer.domElement.height],
      projectorMatrix: this.projectionMatrix.toArray(), depthRenders: this.depthRenders,
      venueTriangles: this.geometries.reduce((n, g) => n + (g.index?.count ?? 0)/3, 0),
      memory: { ...this.renderer.info.memory }, disposed: this.disposed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controls?.dispose(); this.compositor?.dispose(); this.depthTarget.dispose(); this.depthMaterial.dispose();
    this.materials.forEach(m => m.dispose()); this.geometries.forEach(g => g.dispose());
    this.scene.clear(); this.renderer.dispose();
    // The caller owns the MediaStream; disposing GPU resources never stops it.
  }
}
