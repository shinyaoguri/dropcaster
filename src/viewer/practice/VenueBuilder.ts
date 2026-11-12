import { t } from '../i18n/index';
import { button, field, label, quaternion, rotation, vectorFields } from './controls';
import { defaultScene, MAX_VENUE_OBJECTS, type VenueObject, type VenueScene, type Vec3 } from './project';
import { roomScene, venueObject } from './venueObjects';

/** Edits metre-based geometry only. Projectors, 2D mappings and source streams stay with the caller. */
export class VenueBuilder {
  readonly element = document.createElement('details');
  private scene: VenueScene = defaultScene();
  private selected = '';
  private canUndo = false;
  private change: (scene: VenueScene, fit: boolean) => void;
  constructor(change: (scene: VenueScene, fit: boolean) => void, undo: () => void, share: () => void, receive: () => void) {
    this.change = change;
    this.element.id = 'dc-practice-venue'; this.element.className = 'tool-section';
    this.element.innerHTML = `<summary>${label('practice.buildVenue')}</summary>
      <p class="dc-practice-hint">${label('practice.buildHint')}</p>
      <a class="dc-practice-help" href="https://github.com/shinyaoguri/dropcaster/blob/main/docs/venue-authoring.md" target="_blank" rel="noopener noreferrer">${label('practice.authoringGuide')}</a>
      ${button('practice-undo-venue', 'practice.undoVenue')}
      ${button('practice-start-objects', 'practice.startObjects')}
      <details id="practice-room" open><summary>${label('practice.room')}</summary><form id="practice-room-form">
      ${field('practice-room-width', 'practice.roomWidth', 0.1, 500)}
      ${field('practice-room-height', 'practice.roomHeight', 0.1, 500)}
      ${field('practice-room-depth', 'practice.roomDepth', 0.1, 500)}
      ${button('practice-create-room', 'practice.createRoom')}</form>
      <p class="dc-practice-hint">${label('practice.replaceVenueHint')}</p></details>
      <div id="practice-object-editor" hidden>
      <div class="dc-practice-object-actions"><label class="dc-practice-field">${label('practice.addShape')}<select id="practice-object-kind">${['box','tetrahedron','prism','wall','floor'].map(kind => `<option value="${kind}" data-i18n="practice.${kind}">${t(`practice.${kind}` as Parameters<typeof t>[0])}</option>`).join('')}</select></label>${button('practice-add-object', 'practice.addObject')}</div>
      <label class="dc-practice-field">${label('practice.objects')}<select id="practice-object"></select></label>
      <p id="practice-object-count" class="dc-practice-hint"></p>
      <form id="practice-object-form">
      <label class="dc-practice-field">${label('practice.objectName')}<input id="practice-object-name" maxlength="200" required></label>
      ${vectorFields('practice-object-size', 'practice.objectSize', 0.001, 1000)}
      ${vectorFields('practice-object-position', 'practice.objectPosition')}
      ${vectorFields('practice-object-rotation', 'practice.rotation', -360, 360)}
      <label class="dc-practice-field">${label('practice.objectColor')}<input id="practice-object-color" type="color"></label>
      </form><div class="dc-practice-object-actions">${button('practice-copy-object', 'practice.copyObject')}${button('practice-delete-object', 'practice.deleteObject')}</div></div>
      <div class="dc-practice-sharing">${button('practice-share-venue', 'practice.exportVenue')}${button('practice-receive-venue', 'practice.receiveVenue')}<p class="dc-practice-hint">${label('practice.shareVenueHint')}</p></div>`;
    this.input('practice-room-width').value = '8'; this.input('practice-room-height').value = '3'; this.input('practice-room-depth').value = '6';
    this.element.querySelectorAll('form').forEach(form => form.addEventListener('submit', e => e.preventDefault()));
    this.click('practice-undo-venue', undo);
    this.click('practice-share-venue', share); this.click('practice-receive-venue', receive);
    this.click('practice-create-room', () => {
      if (!this.get<HTMLFormElement>('practice-room-form').reportValidity()) return;
      const scene = roomScene(this.number('practice-room-width'), this.number('practice-room-height'), this.number('practice-room-depth'),
        [t('practice.floor'), t('practice.backWall'), t('practice.leftWall'), t('practice.rightWall')]);
      this.selected = scene.objects![1].id; this.change(scene, true);
      this.get<HTMLDetailsElement>('practice-room').open = false;
    });
    this.click('practice-start-objects', () => {
      const object = venueObject('box', t('practice.box')); this.selected = object.id;
      this.change({ ...defaultScene(), kind: 'objects', objects: [object] }, true);
      this.get<HTMLDetailsElement>('practice-room').open = false;
    });
    this.click('practice-add-object', () => {
      const objects = this.objects(); if (!objects.length || objects.length >= MAX_VENUE_OBJECTS) return;
      const kind = this.get<HTMLSelectElement>('practice-object-kind').value as VenueObject['kind'];
      const object = venueObject(kind, `${t(`practice.${kind}`)} ${objects.length + 1}`);
      this.selected = object.id; this.change({ ...this.scene, objects: [...objects, object] }, false);
    });
    this.get('practice-object').addEventListener('change', () => { this.selected = this.get<HTMLSelectElement>('practice-object').value; this.update(this.scene); });
    this.get('practice-object-form').addEventListener('change', () => {
      if (!this.get<HTMLFormElement>('practice-object-form').reportValidity()) return;
      const name = this.input('practice-object-name').value.trim(); if (!name) return;
      this.change({ ...this.scene, objects: this.objects().map(object => object.id !== this.selected ? object : { ...object, name,
        size: this.vector('practice-object-size'), position: this.vector('practice-object-position'),
        quaternion: quaternion(this.vector('practice-object-rotation')), color: this.input('practice-object-color').value }) }, false);
    });
    this.click('practice-copy-object', () => {
      const objects = this.objects(), source = objects.find(o => o.id === this.selected);
      if (!source || objects.length >= MAX_VENUE_OBJECTS) return;
      const object = structuredClone(source); object.id = crypto.randomUUID();
      object.name = `${source.name.slice(0, 180)} ${t('practice.copySuffix')}`;
      object.position[0] = Math.min(10000, object.position[0] + 0.25); object.position[2] = Math.min(10000, object.position[2] + 0.25);
      this.selected = object.id; this.change({ ...this.scene, objects: [...objects, object] }, false);
    });
    this.click('practice-delete-object', () => {
      const objects = this.objects(); if (objects.length < 2) return;
      this.change({ ...this.scene, objects: objects.filter(o => o.id !== this.selected) }, false);
    });
  }
  private get<T extends HTMLElement>(id: string): T { return this.element.querySelector(`#${id}`)!; }
  private input(id: string): HTMLInputElement { return this.get<HTMLInputElement>(id); }
  private number(id: string): number { return this.input(id).valueAsNumber; }
  private vector(id: string): Vec3 { return [0, 1, 2].map(i => this.number(`${id}-${i}`)) as Vec3; }
  private click(id: string, action: () => void): void { this.get(id).addEventListener('click', action); }
  private objects(): VenueObject[] { return this.scene.kind === 'objects' ? this.scene.objects! : []; }
  private value(id: string, value: string | number): void {
    const input = this.input(id);
    if (document.activeElement !== input) input.value = typeof value === 'number' ? String(Number(value.toFixed(5))) : value;
  }
  update(scene: VenueScene, canUndo = this.canUndo): void {
    this.scene = scene;
    this.canUndo = canUndo; this.get<HTMLButtonElement>('practice-undo-venue').disabled = !canUndo;
    const objects = this.objects(); this.get('practice-object-editor').hidden = !objects.length;
    if (!objects.length) { this.get<HTMLDetailsElement>('practice-room').open = true; return; }
    if (!objects.some(o => o.id === this.selected)) this.selected = objects[0].id;
    const select = this.get<HTMLSelectElement>('practice-object');
    const options = JSON.stringify(objects.map(o => [o.id, o.name]));
    if (select.dataset.options !== options) {
      select.replaceChildren(...objects.map(o => new Option(o.name, o.id))); select.dataset.options = options;
    }
    select.value = this.selected;
    this.get('practice-object-count').textContent = t('practice.objectCount', { count: objects.length, max: MAX_VENUE_OBJECTS });
    const selected = objects.find(o => o.id === this.selected)!;
    this.value('practice-object-name', selected.name); this.value('practice-object-color', selected.color);
    for (const [id, values] of [['size', selected.size], ['position', selected.position], ['rotation', rotation(selected.quaternion)]] as const)
      values.forEach((value, index) => this.value(`practice-object-${id}-${index}`, value));
    for (const id of ['practice-add-object', 'practice-copy-object']) this.get<HTMLButtonElement>(id).disabled = objects.length >= MAX_VENUE_OBJECTS;
    this.get<HTMLButtonElement>('practice-delete-object').disabled = objects.length <= 1;
  }
}
