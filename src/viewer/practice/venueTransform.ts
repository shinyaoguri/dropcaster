import { Quaternion } from 'three';
import type { VenueObject, Vec3, Quaternion as Quat } from './project.ts';

/** Keep interactive transforms in the same metre-based bounds as imported data. */
export function transformedObject(source: VenueObject, position: Vec3, quaternion: Quat, scale: Vec3): VenueObject {
  if (![...position, ...quaternion, ...scale].every(Number.isFinite)) return source;
  const q = new Quaternion(...quaternion);
  if (q.lengthSq() < 1e-12) return source;
  return { ...source,
    position: position.map(value => Math.max(-10000, Math.min(10000, value))) as Vec3,
    quaternion: q.normalize().toArray(),
    // Crossing the opposite handle must never mirror or collapse a solid.
    size: source.size.map((size, axis) => Math.max(.001, Math.min(1000, size * scale[axis]))) as Vec3,
  };
}
