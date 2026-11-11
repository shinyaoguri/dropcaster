import * as THREE from 'three';
import {
  quadHomography, invertHomography, isMaskEntry, isMappingEnabled,
  type MappingsState, type MappingItem, type OutputDef,
} from '../utils/mappingTransform';

const vertexShader = `
  varying vec2 outputUv;
  void main() {
    outputUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const mappingShader = `
  varying vec2 outputUv;
  uniform sampler2D videoSource;
  uniform mat3 inverseQuad;
  uniform vec4 outputRect;
  uniform vec4 crop;
  void main() {
    vec2 canvasPoint = outputRect.xy + vec2(outputUv.x, 1.0-outputUv.y) * outputRect.zw;
    vec3 q = inverseQuad * vec3(canvasPoint, 1.0);
    if (q.z == 0.0) discard;
    vec2 local = q.xy / q.z;
    if (any(lessThan(local, vec2(0.0))) || any(greaterThan(local, vec2(1.0)))) discard;
    vec2 sourceUv = crop.xy + local * crop.zw;
    if (any(lessThan(sourceUv, vec2(0.0))) || any(greaterThan(sourceUv, vec2(1.0)))) discard;
    // All public UVs are top-left. Uploaded video texture UVs are bottom-left.
    gl_FragColor = texture2D(videoSource, vec2(sourceUv.x, 1.0-sourceUv.y));
  }
`;

/** Preview-only compositor. Borrow the video/stream; never stop their tracks. */
export class MappingCompositor {
  readonly target: THREE.WebGLRenderTarget;
  texture: THREE.VideoTexture;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly renderer: THREE.WebGLRenderer;
  private items = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>();
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, video: HTMLVideoElement, width: number, height: number) {
    this.renderer = renderer;
    this.texture = this.createTexture(video);
    this.target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
    this.target.texture.colorSpace = THREE.NoColorSpace;
  }

  private createTexture(video: HTMLVideoElement): THREE.VideoTexture {
    const texture = new THREE.VideoTexture(video);
    // Preserve encoded video values and CSS's encoded-space alpha blending. The
    // venue shader explicitly decodes the final composite when adding light.
    texture.colorSpace = THREE.NoColorSpace;
    // Minified/oblique quads otherwise alias internal grids even when the four
    // corners match CSS. Mipmaps filter the source; its backing size is unchanged.
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  replaceVideo(video: HTMLVideoElement): void {
    this.texture.dispose();
    this.texture = this.createTexture(video);
    for (const child of this.scene.children) {
      const material = (child as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material;
      if (material.uniforms.videoSource) material.uniforms.videoSource.value = this.texture;
    }
  }

  setSize(width: number, height: number): void { this.target.setSize(width, height); }

  setState(state: MappingsState, outputId: string): void {
    const output = state.outputs.find(o => o.id === outputId);
    if (!output || output.size.width <= 0 || output.size.height <= 0) { this.clearItems(); return; }
    const next = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>();
    this.scene.clear();
    // All items use the transparent render list, including opaque black masks.
    // Otherwise Three groups opaque masks before transparent mapping videos.
    for (const item of [...state.mappings].reverse()) {
      if (!isMappingEnabled(item)) continue;
      const candidate = this.materialFor(item, output);
      if (!candidate) continue;
      let mesh = this.items.get(item.id);
      if (mesh && mesh.material.fragmentShader === candidate.fragmentShader) {
        // A drag changes uniforms, not shader code. Retain the compiled program
        // instead of disposing/recompiling the last material on every pointer move.
        Object.assign(mesh.material.uniforms, candidate.uniforms);
        candidate.dispose();
      } else {
        mesh?.material.dispose();
        mesh = new THREE.Mesh(this.geometry, candidate);
      }
      next.set(item.id, mesh);
      mesh.frustumCulled = false;
      mesh.renderOrder = this.scene.children.length;
      this.scene.add(mesh);
    }
    for (const [id, mesh] of this.items) if (!next.has(id)) mesh.material.dispose();
    this.items = next;
  }

  private materialFor(item: MappingItem, output: OutputDef): THREE.ShaderMaterial | null {
    const outputRect = new THREE.Vector4(output.position.x, output.position.y, output.size.width, output.size.height);
    const options = { vertexShader, depthTest: false, depthWrite: false, transparent: true, toneMapped: false };
    if (isMaskEntry(item)) {
      if (item.drafting || item.points.length < 3) return null;
      // SVG polygon's default nonzero winding rule, including concave and
      // self-intersecting paths. Do not substitute an even-odd triangulation.
      return new THREE.ShaderMaterial({
        ...options,
        uniforms: { outputRect: { value: outputRect }, points: { value: item.points.map(p => new THREE.Vector2(p.x, p.y)) } },
        fragmentShader: `
          varying vec2 outputUv;
          uniform vec4 outputRect;
          uniform vec2 points[${item.points.length}];
          void main() {
            vec2 p = outputRect.xy + vec2(outputUv.x, 1.0-outputUv.y) * outputRect.zw;
            int winding = 0;
            for (int i = 0; i < ${item.points.length}; i++) {
              vec2 a = points[i], b = points[(i+1) % ${item.points.length}];
              float cross = (b.x-a.x)*(p.y-a.y) - (p.x-a.x)*(b.y-a.y);
              if (a.y <= p.y && b.y > p.y && cross > 0.0) winding++;
              if (a.y > p.y && b.y <= p.y && cross < 0.0) winding--;
            }
            if (winding == 0) discard;
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          }
        `,
      });
    }
    const forward = quadHomography(item.quad);
    const inverse = forward && invertHomography(forward);
    if (!inverse) return null;
    const source = item.source;
    return new THREE.ShaderMaterial({
      ...options, fragmentShader: mappingShader,
      uniforms: {
        videoSource: { value: this.texture }, outputRect: { value: outputRect },
        // Matrix3.set takes row-major arguments and stores column-major uniforms.
        inverseQuad: { value: new THREE.Matrix3().set(...inverse) },
        crop: { value: new THREE.Vector4(source.x/100, source.y/100, Math.max(source.width, 0.0001)/100, Math.max(source.height, 0.0001)/100) },
      },
    });
  }

  render(): void {
    if (this.disposed) return;
    const previous = this.renderer.getRenderTarget();
    const color = this.renderer.getClearColor(new THREE.Color());
    const alpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    this.renderer.setClearColor(color, alpha);
  }

  /** Top-left RGBA bytes, for explicit comparisons only (not per-frame readback). */
  readPixels(): Uint8Array {
    const { width, height } = this.target;
    const bottomUp = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, width, height, bottomUp);
    const topDown = new Uint8Array(bottomUp.length);
    for (let y = 0; y < height; y++) {
      topDown.set(bottomUp.subarray(y*width*4, (y+1)*width*4), (height-y-1)*width*4);
    }
    return topDown;
  }

  private clearItems(): void {
    for (const mesh of this.items.values()) mesh.material.dispose();
    this.items.clear();
    this.scene.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearItems(); this.geometry.dispose(); this.texture.dispose(); this.target.dispose();
  }
}
