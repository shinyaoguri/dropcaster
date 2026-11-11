import { Euler, MathUtils, Quaternion } from 'three';
import { t, type MessageKey } from '../i18n/index';
import type { Vec3, Quaternion as Quat } from './project';

export const label = (key: MessageKey) => `<span data-i18n="${key}">${t(key)}</span>`;
export const button = (id: string, key: MessageKey) => `<button type="button" id="${id}" class="tool-button">${label(key)}</button>`;
export const field = (id: string, key: MessageKey, min: number, max: number, _step = 0.1) =>
  `<label class="dc-practice-field">${label(key)}<input id="${id}" type="number" min="${min}" max="${max}" step="any" required></label>`;
export const vectorFields = (id: string, key: MessageKey, min = -10000, max = 10000, _step = 0.1, axes = ['X', 'Y', 'Z']) =>
  `<fieldset><legend>${label(key)}</legend><div class="dc-practice-vector">${axes.map((axis, index) => `<label>${axis}<input id="${id}-${index}" type="number" min="${min}" max="${max}" step="any" required aria-label="${t(key)} ${axis}"></label>`).join('')}</div></fieldset>`;
export const rotation = (q: Quat): Vec3 => {
  const e = new Euler().setFromQuaternion(new Quaternion(...q), 'YXZ');
  return [e.x, e.y, e.z].map(MathUtils.radToDeg) as Vec3;
};
export const quaternion = (angles: Vec3): Quat => new Quaternion().setFromEuler(new Euler(...angles.map(MathUtils.degToRad) as Vec3, 'YXZ')).toArray();

