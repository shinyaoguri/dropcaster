import { defaultScene, type VenueObject, type VenueScene, type Vec3 } from './project.ts';

export function venueObject(kind: VenueObject['kind'], name: string): VenueObject {
  const size: Vec3 = kind === 'wall' ? [6, 3, 0.15] : kind === 'floor' ? [6, 0.1, 6] : [1, 1, 1];
  const position: Vec3 = kind === 'wall' ? [0, 1.5, -3] : kind === 'floor' ? [0, -0.05, 0] : [0, 0.5, 0];
  return { id: crypto.randomUUID(), name, kind, size, position, quaternion: [0, 0, 0, 1], color: kind === 'floor' ? '#8b93a0' : '#dddddd' };
}

/** Clear inner dimensions; floor top at Y=0, open front at +Z. Wall thickness extends outwards. */
export function roomScene(width: number, height: number, depth: number, names: [string, string, string, string]): VenueScene {
  const floor = venueObject('floor', names[0]); floor.size = [width + 0.3, 0.1, depth + 0.15]; floor.position[2] = -0.075;
  const back = venueObject('wall', names[1]); back.size = [width + 0.3, height, 0.15]; back.position = [0, height / 2, -depth / 2 - 0.075];
  const left = venueObject('wall', names[2]); left.size = [0.15, height, depth]; left.position = [-width / 2 - 0.075, height / 2, 0];
  const right = venueObject('wall', names[3]); right.size = [0.15, height, depth]; right.position = [width / 2 + 0.075, height / 2, 0];
  return { ...defaultScene(), kind: 'objects', objects: [floor, back, left, right] };
}
