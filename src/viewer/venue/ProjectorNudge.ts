import * as THREE from 'three';
import type { Projector, Quaternion, Vec3 } from '../practice/project.ts';

/**
 * 仮想プロジェクタを、壁に映る輪郭を見ながら直接動かすための純関数群。
 * 実機のプロジェクタは動かないので、壁の上で動いて見えるのは仮想会場の輪郭。
 * 符号は「輪郭が画像の上でどちらへ動くか」で決める
 * (pan + = 右、tilt + = 上、roll + = 反時計回り、right + = 右、up + = 上、zoom + = 大きく)。
 * forward だけは仮想プロジェクタ自体の前進 (+ で会場に近付き、輪郭は大きくなる)。
 * カメラは -Z を向き、+X が右、+Y が上 (three.js の PerspectiveCamera と同じ)。
 */
export type NudgeAction = 'pan' | 'tilt' | 'roll' | 'right' | 'up' | 'forward' | 'zoom';
export type NudgeStep = 'coarse' | 'fine';
export const NUDGE_STEPS: Record<NudgeStep, { degrees: number; meters: number }> = {
  coarse: { degrees: 1, meters: .1 },
  fine: { degrees: .1, meters: .01 },
};
export const MIN_FOV = 1;
export const MAX_FOV = 170;

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function halfHeight(projector: Projector): number {
  return Math.tan(THREE.MathUtils.degToRad(projector.verticalFovDegrees) / 2);
}

/**
 * 出力画像の NDC 座標 (x, y ∈ [-1, 1]、上が +y) を通る光線の、カメラ空間での単位方向。
 * ProjectionPreview.setProjector の makePerspective (レンズシフト付き) と同じ投影の逆。
 */
export function projectorRay(projector: Projector, x: number, y: number): THREE.Vector3 {
  const h = halfHeight(projector), w = h * projector.aspect;
  return new THREE.Vector3(w * (x + 2 * projector.lensShift[0]), h * (y + 2 * projector.lensShift[1]), -1).normalize();
}

/** ワールド座標の点が出力画像のどこに映るか (NDC)。プロジェクタの背後なら null。 */
export function projectToNdc(projector: Projector, point: Vec3): [number, number] | null {
  const local = new THREE.Vector3(...point).sub(new THREE.Vector3(...projector.position))
    .applyQuaternion(new THREE.Quaternion(...projector.quaternion).invert());
  if (local.z >= 0) return null;
  const h = halfHeight(projector), w = h * projector.aspect;
  return [local.x / -local.z / w - 2 * projector.lensShift[0], local.y / -local.z / h - 2 * projector.lensShift[1]];
}

function withQuaternion(projector: Projector, q: THREE.Quaternion): Projector {
  q.normalize();
  return { ...projector, quaternion: [q.x, q.y, q.z, q.w] as Quaternion };
}

/** 部材座標の軸まわりに回す (右から掛ける)。 */
function rotateLocal(projector: Projector, axis: THREE.Vector3, radians: number): Projector {
  const q = new THREE.Quaternion(...projector.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(axis, radians));
  return withQuaternion(projector, q);
}

/** 部材座標で平行移動する (right = +X、up = +Y、forward = -Z)。 */
export function translateLocal(projector: Projector, right: number, up: number, forward: number): Projector {
  const offset = new THREE.Vector3(right, up, -forward).applyQuaternion(new THREE.Quaternion(...projector.quaternion));
  const p = projector.position;
  return { ...projector, position: [p[0] + offset.x, p[1] + offset.y, p[2] + offset.z] };
}

export function withFov(projector: Projector, degrees: number): Projector {
  return { ...projector, verticalFovDegrees: THREE.MathUtils.clamp(degrees, MIN_FOV, MAX_FOV) };
}

/** 1 回分の微調整。amount は角度・画角なら度、移動ならメートル。 */
export function nudge(projector: Projector, action: NudgeAction, amount: number): Projector {
  const radians = THREE.MathUtils.degToRad(amount);
  switch (action) {
    // 仮想カメラを左へ振ると、正面にあった会場は画像の右へ動く。以下も同じく逆向きに動かす。
    case 'pan': return rotateLocal(projector, AXIS_Y, radians);
    case 'tilt': return rotateLocal(projector, AXIS_X, -radians);
    case 'roll': return rotateLocal(projector, AXIS_Z, -radians);
    case 'right': return translateLocal(projector, -amount, 0, 0);
    case 'up': return translateLocal(projector, 0, -amount, 0);
    case 'forward': return translateLocal(projector, 0, 0, amount);
    case 'zoom': return withFov(projector, projector.verticalFovDegrees - amount);
  }
}

/**
 * 出力画像上で from から to へドラッグしたとき、from に映っていたものが to に映るよう向きを変える。
 * q' = q · R(d1 → d0)。カメラ空間で d0 にあった方向が、回転後は d1 に見える。
 */
export function dragRotate(projector: Projector, from: [number, number], to: [number, number]): Projector {
  const d0 = projectorRay(projector, ...from), d1 = projectorRay(projector, ...to);
  const q = new THREE.Quaternion(...projector.quaternion).multiply(new THREE.Quaternion().setFromUnitVectors(d1, d0));
  return withQuaternion(projector, q);
}

/**
 * 光軸が画像に当たる点 (レンズシフトの分だけ中心からずれる) を中心にロールし、
 * from の方向に映っていたものを to の方向へ回す。半径は変えない。
 */
export function dragRoll(projector: Projector, from: [number, number], to: [number, number]): Projector {
  const cx = -2 * projector.lensShift[0], cy = -2 * projector.lensShift[1], a = projector.aspect;
  const angle = Math.atan2(to[1] - cy, (to[0] - cx) * a) - Math.atan2(from[1] - cy, (from[0] - cx) * a);
  return rotateLocal(projector, AXIS_Z, -angle);
}

/** 光軸方向の深さ depth の面の上で、from に映っていたものが to に映るよう平行移動する。 */
export function dragTranslate(projector: Projector, from: [number, number], to: [number, number], depth: number): Projector {
  const h = halfHeight(projector), w = h * projector.aspect;
  return translateLocal(projector, -(to[0] - from[0]) * w * depth, -(to[1] - from[1]) * h * depth, 0);
}
