import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { button, label } from './controls';
import { t } from '../i18n/index';
import { MAX_VENUE_OBJECTS, type VenueObject, type VenueScene } from './project';
import type { ProjectionPreview } from './ProjectionPreview';
import type { VenueBuilder } from './VenueBuilder';
import { transformedObject } from './venueTransform';

/** One pointer gesture is one venue edit. Only the preview changes until pointerup. */
export class VenueEditor {
  readonly element = document.createElement('div');
  private readonly transform: TransformControls;
  private readonly proxy = new THREE.Object3D();
  private readonly outline = new THREE.Box3Helper(new THREE.Box3(), 0x93c5fd);
  private readonly ray = new THREE.Raycaster();
  private readonly canvas: HTMLCanvasElement;
  private readonly preview: ProjectionPreview;
  private readonly builder: VenueBuilder;
  private readonly commit: (object: VenueObject) => void;
  private objects: VenueObject[] = [];
  private selected = '';
  private sceneKey = '';
  private active = false;
  private source: VenueObject | null = null;
  private candidate: VenueObject | null = null;
  private down: { x: number; y: number; id: number } | null = null;

  constructor(preview: ProjectionPreview, builder: VenueBuilder, commit: (object: VenueObject) => void, undo: () => void) {
    this.preview = preview; this.builder = builder; this.commit = commit; this.canvas = preview.renderer.domElement;
    this.element.className = 'dc-venue-editor'; this.element.id = 'practice-venue-tools'; this.element.hidden = true;
    this.element.innerHTML = `<div class="dc-venue-actions"><strong>${label('practice.editingVenue')}</strong>${button('venue-edit-done', 'practice.finishVenue')}</div>
      <div id="venue-create">${button('venue-start', 'practice.startObjects')}<p class="dc-practice-hint">${label('practice.guiStartHint')}</p></div>
      <div id="venue-tools"><div class="dc-venue-actions">
      ${(['translate','rotate','scale'] as const).map(mode => button(`venue-${mode}`, mode === 'scale' ? 'practice.resizeObject' : `practice.${mode}`)).join('')}
      ${button('venue-focus', 'practice.focusObject')}<label class="dc-practice-check"><input id="venue-snap" type="checkbox">${label('practice.snap')}</label></div>
      <div class="dc-venue-actions"><label class="dc-venue-shape">${label('practice.addShape')}<select id="venue-kind">${['box','tetrahedron','prism','wall','floor'].map(kind => `<option value="${kind}" data-i18n="practice.${kind}">${t(`practice.${kind}` as Parameters<typeof t>[0])}</option>`).join('')}</select></label>
      ${button('venue-add', 'practice.addObject')}${button('venue-copy', 'practice.copyObject')}${button('venue-delete', 'practice.deleteObject')}${button('venue-undo', 'practice.undoVenue')}</div>
      <p id="venue-selection" class="dc-practice-hint"></p><p class="dc-practice-hint">${label('practice.guiHint')}</p></div>`;
    this.transform = new TransformControls(preview.observer, this.canvas);
    this.transform.setSize(.85); this.transform.enabled = false;
    const helper = this.transform.getHelper(); helper.name = 'venue-transform';
    helper.traverse(object => object.layers.set(1)); this.transform.getRaycaster().layers.set(1);
    this.outline.name = 'venue-selection'; this.outline.layers.set(1); this.outline.visible = false;
    (this.outline.material as THREE.LineBasicMaterial).depthTest = false; this.outline.renderOrder = 2;
    preview.scene.add(this.proxy, helper, this.outline);
    this.transform.addEventListener('mouseDown', () => {
      const object = this.objects.find(object => object.id === this.selected);
      if (object) { this.source = structuredClone(object); this.candidate = this.source; }
      preview.controls.enabled = false; this.canvas.focus({ preventScroll: true });
    });
    this.transform.addEventListener('objectChange', () => {
      if (!this.source) return;
      this.candidate = transformedObject(this.source, this.proxy.position.toArray(), this.proxy.quaternion.toArray(), this.proxy.scale.toArray());
      preview.previewObject(this.candidate); this.updateOutline();
    });
    this.transform.addEventListener('mouseUp', () => {
      const source = this.source, candidate = this.candidate;
      this.source = this.candidate = null; this.transform.dragging = false; preview.controls.enabled = true;
      if (source && candidate && JSON.stringify(source) !== JSON.stringify(candidate)) this.commit(candidate);
      this.attach();
    });
    // Before OrbitControls handles pointerdown, reserve only a hit on an editing handle.
    this.canvas.addEventListener('pointerdown', this.pointerDown, true);
    this.canvas.addEventListener('pointerup', this.pointerUp, true);
    this.canvas.addEventListener('pointercancel', this.cancel);
    this.canvas.addEventListener('lostpointercapture', this.captureLost);
    this.canvas.addEventListener('keydown', this.keyDown);
    window.addEventListener('blur', this.cancel);
    this.click('venue-edit-done', () => this.setActive(false));
    this.click('venue-start', () => builder.startObjects());
    this.click('venue-add', () => builder.add(this.get<HTMLSelectElement>('venue-kind').value as VenueObject['kind']));
    this.click('venue-copy', () => builder.duplicate()); this.click('venue-delete', () => builder.remove());
    this.click('venue-undo', undo); this.click('venue-focus', () => this.focus());
    for (const mode of ['translate', 'rotate', 'scale'] as const) this.click(`venue-${mode}`, () => {
      this.cancel(); this.transform.setMode(mode); this.transform.setSpace(mode === 'translate' ? 'world' : 'local'); this.updateButtons();
    });
    this.get('venue-snap').addEventListener('change', () => {
      const snap = this.get<HTMLInputElement>('venue-snap').checked;
      this.transform.setTranslationSnap(snap ? .1 : null); this.transform.setRotationSnap(snap ? Math.PI / 12 : null);
    });
    this.updateButtons();
  }
  private get<T extends HTMLElement = HTMLElement>(id: string): T { return this.element.querySelector(`#${id}`)!; }
  private click(id: string, run: () => void): void { this.get(id).addEventListener('click', run); }
  private updateButtons(): void {
    for (const mode of ['translate','rotate','scale']) this.get(`venue-${mode}`).setAttribute('aria-pressed', String(this.transform.mode === mode));
  }
  setActive(active: boolean): void {
    this.cancel(); this.active = active; this.element.hidden = !active; this.transform.enabled = active; this.attach();
  }
  update(scene: VenueScene, selected: string, canUndo: boolean): void {
    const key = JSON.stringify(scene);
    if (key !== this.sceneKey || selected !== this.selected) this.cancel();
    this.sceneKey = key; this.objects = scene.kind === 'objects' ? scene.objects! : []; this.selected = selected;
    this.get('venue-create').hidden = !!this.objects.length; this.get('venue-tools').hidden = !this.objects.length;
    this.get<HTMLButtonElement>('venue-delete').disabled = this.objects.length <= 1;
    for (const id of ['venue-copy','venue-add']) this.get<HTMLButtonElement>(id).disabled = this.objects.length >= MAX_VENUE_OBJECTS;
    this.get<HTMLButtonElement>('venue-undo').disabled = !canUndo;
    this.get('venue-selection').textContent = t('practice.selectedObject', { name: this.objects.find(o => o.id === selected)?.name ?? '' });
    if (!this.source) this.attach();
  }
  private attach(): void {
    const object = this.objects.find(object => object.id === this.selected);
    if (!this.active || !object) { this.transform.detach(); this.outline.visible = false; return; }
    this.proxy.position.fromArray(object.position); this.proxy.quaternion.fromArray(object.quaternion); this.proxy.scale.setScalar(1);
    this.proxy.updateMatrixWorld(true); this.transform.attach(this.proxy); this.updateOutline();
  }
  private updateOutline(): void {
    const mesh = this.preview.editableMeshes().find(mesh => mesh.userData.venueObjectId === this.selected);
    this.outline.visible = this.active && !!mesh;
    if (mesh) this.outline.box.setFromObject(mesh);
  }
  private focus(): void {
    this.cancel();
    if (this.outline.box.isEmpty()) return;
    const center = this.outline.box.getCenter(new THREE.Vector3()), size = this.outline.box.getSize(new THREE.Vector3()).length();
    const camera = this.preview.observer, orbit = this.preview.controls;
    const angle = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    const direction = camera.position.clone().sub(orbit.target).normalize();
    orbit.target.copy(center); camera.position.copy(center).addScaledVector(direction, Math.max(size, .1) / (2 * Math.sin(angle)) * 1.4);
    orbit.update();
  }
  private pointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0 || !event.isPrimary) return;
    this.down = { x: event.clientX, y: event.clientY, id: event.pointerId };
    const rect = this.canvas.getBoundingClientRect();
    this.transform.pointerHover({ x: (event.clientX - rect.left) / rect.width * 2 - 1, y: -(event.clientY - rect.top) / rect.height * 2 + 1, button: 0 } as PointerEvent);
    if (this.transform.axis) this.preview.controls.enabled = false;
  };
  private pointerUp = (event: PointerEvent): void => {
    const down = this.down; this.down = null;
    if (this.transform.dragging) return;
    this.preview.controls.enabled = true;
    if (!this.active || !down || event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 || this.transform.axis) return;
    const rect = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.preview.observer);
    const hit = this.ray.intersectObjects(this.preview.editableMeshes(), false)[0];
    if (hit) this.builder.select(hit.object.userData.venueObjectId);
  };
  private keyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.source) return;
    event.preventDefault(); event.stopPropagation(); this.cancel();
  };
  private captureLost = (): void => { if (this.source) this.cancel(); };
  cancel = (): void => {
    const source = this.source; this.source = this.candidate = null;
    if (source) this.preview.previewObject(source);
    const down = this.down; this.down = null;
    this.transform.dragging = false; this.transform.axis = null;
    if (down && this.canvas.hasPointerCapture(down.id)) this.canvas.releasePointerCapture(down.id);
    // Also remove TransformControls' temporary pointermove listener after cancellation.
    this.transform.disconnect(); this.transform.connect(this.canvas);
    this.preview.controls.enabled = true; this.attach();
  };
  dispose(): void {
    this.cancel();
    this.canvas.removeEventListener('pointerdown', this.pointerDown, true);
    this.canvas.removeEventListener('pointerup', this.pointerUp, true);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.captureLost);
    this.canvas.removeEventListener('keydown', this.keyDown); window.removeEventListener('blur', this.cancel);
    this.transform.getHelper().removeFromParent(); this.transform.dispose(); this.proxy.removeFromParent();
    this.outline.removeFromParent(); this.outline.geometry.dispose(); (this.outline.material as THREE.LineBasicMaterial).dispose(); this.element.remove();
  }
}
