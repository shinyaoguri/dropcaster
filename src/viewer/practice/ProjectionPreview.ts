import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MappingCompositor } from './MappingCompositor';
import { ProjectorGuide } from './ProjectorGuide';
import type { MappingsState } from '../utils/mappingTransform';
import type { Projector, VenueScene } from './project';

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

/** Shared geometric renderer. Streams and project state belong to the caller. */
export class ProjectionPreview {
  readonly renderer: THREE.WebGLRenderer;
  readonly compositor: MappingCompositor;
  readonly projector = new THREE.PerspectiveCamera(43, 16/9, 0.1, 30);
  readonly observer = new THREE.PerspectiveCamera(48, 1, 0.1, 50);
  readonly scene = new THREE.Scene();
  readonly controls: OrbitControls;
  readonly box: THREE.Mesh;
  readonly sample = new THREE.Group();
  private venue: THREE.Group | null = null;
  private importedMaterials: THREE.ShaderMaterial[] = [];
  private venueCleanup: (() => void) | null = null;
  private projectionEnabled = true;
  private previewWidth = 640;
  private readonly depthTarget = new THREE.WebGLRenderTarget(1024, 1024);
  private readonly depthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly projectionMatrix = new THREE.Matrix4();
  private depthDirty = true;
  private disposed = false;
  private guide?: ProjectorGuide;
  depthRenders = 0;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement, width = 640, height = 360) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    try {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x151b25);
      this.compositor = new MappingCompositor(this.renderer, video, width, height);
      this.previewWidth = width;
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
      this.scene.add(this.sample);
      this.controls = new OrbitControls(this.observer, canvas);
      this.controls.enableDamping = true;
      this.controls.minDistance = 1;
      this.controls.maxDistance = 25;
      this.guide = new ProjectorGuide(); this.scene.add(this.guide.group);
      this.observer.layers.enable(1);
      this.updateGuide();
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
          worldNormal = normalize(vec3(vec4(normalMatrix * normal, 0.0) * viewMatrix));
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
    this.materials.push(material); this.geometries.push(geometry); this.sample.add(mesh);
    return mesh;
  }

  updateProjector(): void {
    this.projector.updateProjectionMatrix(); this.projector.updateMatrixWorld(true);
    this.projectionMatrix.multiplyMatrices(this.projector.projectionMatrix, this.projector.matrixWorldInverse);
    this.depthDirty = true;
    this.updateGuide();
  }

  private updateGuide(): void {
    this.guide?.update(this.projector, new THREE.Box3().setFromObject(this.venue ?? this.sample));
  }
  setGuidesVisible(visible: boolean): void { if (this.guide) this.guide.group.visible = visible; }

  setState(state: MappingsState, outputId: string): void { this.compositor.setState(state, outputId); }
  setBoxVisible(visible: boolean): void { this.box.visible = visible; this.depthDirty = true; }
  setProjectionEnabled(enabled: boolean): void {
    this.projectionEnabled = enabled;
    for (const m of [...this.materials, ...this.importedMaterials]) m.uniforms.projectionEnabled.value = enabled;
  }
  setPreviewWidth(width: number): void {
    this.previewWidth = width;
    this.compositor.setSize(width, Math.max(1, Math.round(width / this.projector.aspect)));
  }

  setProjector(config: Projector): void {
    this.projector.position.fromArray(config.position);
    this.projector.quaternion.fromArray(config.quaternion);
    this.projector.fov = config.verticalFovDegrees; this.projector.aspect = config.aspect;
    this.projector.near = config.near; this.projector.far = config.far;
    this.projector.updateMatrixWorld(true);
    const h = config.near * Math.tan(THREE.MathUtils.degToRad(config.verticalFovDegrees) / 2);
    const w = h * config.aspect;
    this.projector.projectionMatrix.makePerspective(-w + 2*w*config.lensShift[0], w + 2*w*config.lensShift[0],
      h + 2*h*config.lensShift[1], -h + 2*h*config.lensShift[1], config.near, config.far);
    this.projector.projectionMatrixInverse.copy(this.projector.projectionMatrix).invert();
    this.projectionMatrix.multiplyMatrices(this.projector.projectionMatrix, this.projector.matrixWorldInverse);
    this.setPreviewWidth(this.previewWidth);
    this.depthDirty = true;
    this.updateGuide();
  }

  setVenue(group: THREE.Group | null, cleanup: (() => void) | null = null): void {
    if (this.venue) this.scene.remove(this.venue);
    this.importedMaterials.forEach(material => material.dispose()); this.importedMaterials = [];
    this.venueCleanup?.(); this.venueCleanup = cleanup; this.venue = group;
    this.sample.visible = group === null;
    if (group) {
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const convert = (source: THREE.Material) => {
          const original = source as THREE.MeshStandardMaterial;
          const material = this.materials[0].clone();
          Object.assign(material.uniforms, this.uniforms());
          material.uniforms.baseColor.value = original.color?.clone() ?? new THREE.Color(0xb5bac7);
          material.userData.originalColor = material.uniforms.baseColor.value.clone();
          if (original.map && object.geometry.hasAttribute('uv')) {
            original.map.updateMatrix();
            material.uniforms.baseMap = { value: original.map };
            material.uniforms.baseMapTransform = { value: original.map.matrix };
            material.vertexShader = 'varying vec2 venueUv; uniform mat3 baseMapTransform;\n' + material.vertexShader.replace('worldPoint =', 'venueUv = (baseMapTransform * vec3(uv, 1.0)).xy; worldPoint =');
            material.fragmentShader = 'varying vec2 venueUv; uniform sampler2D baseMap;\n' + material.fragmentShader.replace('baseColor * ambient', 'baseColor * texture2D(baseMap, venueUv).rgb * ambient');
          }
          this.importedMaterials.push(material);
          return material;
        };
        object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
      });
      this.scene.add(group);
    }
    this.setProjectionEnabled(this.projectionEnabled);
    this.depthDirty = true;
    this.updateGuide();
  }

  setVenueTransform(config: VenueScene): void {
    const group = this.venue ?? this.sample;
    group.position.fromArray(config.position); group.quaternion.fromArray(config.quaternion);
    group.scale.fromArray(config.scale).multiplyScalar(config.metersPerUnit);
    // A neutral tint is applied to imported models; their embedded base colors/maps remain intact.
    for (const material of [...this.materials, ...this.importedMaterials]) {
      material.userData.originalColor ??= material.uniforms.baseColor.value.clone();
      material.uniforms.baseColor.value.copy(material.userData.originalColor).multiply(new THREE.Color(config.color));
    }
    group.updateMatrixWorld(true); this.depthDirty = true;
    this.updateGuide();
  }

  venueDimensions(): [number, number, number] {
    const size = new THREE.Box3().setFromObject(this.venue ?? this.sample).getSize(new THREE.Vector3());
    return size.toArray();
  }

  overview(): void {
    const bounds = new THREE.Box3().setFromObject(this.venue ?? this.sample);
    if (this.guide?.group.visible) bounds.expandByPoint(this.projector.position);
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()).length();
    this.observer.far = Math.max(50, size * 10); this.observer.updateProjectionMatrix();
    this.controls.maxDistance = Math.max(25, size * 5); this.controls.minDistance = Math.max(0.01, size / 1000);
    this.controls.target.copy(center); this.observer.position.copy(center).add(new THREE.Vector3(0.7, 0.45, 0.8).multiplyScalar(Math.max(size, 1)));
    this.controls.update();
  }
  audienceView(): void {
    const center = new THREE.Box3().setFromObject(this.venue ?? this.sample).getCenter(new THREE.Vector3());
    this.observer.position.set(center.x, 1.6, this.projector.position.z + 2);
    this.controls.target.copy(center); this.controls.update();
  }

  /** Fixed projector view, without projected video or guides; never enters the compositor. */
  backgroundImage(): string {
    const size = this.renderer.getSize(new THREE.Vector2()), enabled = this.projectionEnabled;
    this.setProjectionEnabled(false);
    try {
      this.renderer.setSize(this.compositor.target.width, this.compositor.target.height, false);
      this.renderer.setRenderTarget(null); this.renderer.render(this.scene, this.projector);
      return this.renderer.domElement.toDataURL('image/png');
    } finally {
      this.renderer.setSize(size.x, size.y, false); this.setProjectionEnabled(enabled);
    }
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
      venueTriangles: (() => {
        let count = 0;
        (this.venue ?? this.sample).traverse(object => {
          if (object instanceof THREE.Mesh) count += (object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3;
        });
        return count;
      })(),
      memory: { ...this.renderer.info.memory }, disposed: this.disposed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controls?.dispose(); this.compositor?.dispose(); this.depthTarget.dispose(); this.depthMaterial.dispose();
    this.guide?.dispose();
    this.importedMaterials.forEach(m => m.dispose()); this.venueCleanup?.();
    this.materials.forEach(m => m.dispose()); this.geometries.forEach(g => g.dispose());
    this.scene.clear(); this.renderer.dispose();
    // The caller owns the MediaStream; disposing GPU resources never stops it.
  }
}
