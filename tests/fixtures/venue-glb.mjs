import { deflateSync } from 'node:zlib';

// A 6 x 4 m wall, with an embedded 2 x 2 PNG. No network or exporter dependency.
function png() {
  const crc = bytes => {
    let n = 0xffffffff;
    for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (0xedb88320 & -(n & 1)); }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, sum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 80, 30, 30, 180, 255, 0, 30, 180, 255, 255, 80, 30]))), chunk('IEND', Buffer.alloc(0))]);
}
export function packGlb(doc, binary = Buffer.alloc(0)) {
  const raw = Buffer.from(JSON.stringify(doc)), json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const bin = Buffer.alloc(Math.ceil(binary.length / 4) * 4); binary.copy(bin);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + (bin.length ? 8 + bin.length : 0), 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat(bin.length ? [header, json, binHeader, bin] : [header, json]);
}
export function venueFixture(change = (_doc) => {}) {
  const positions = Buffer.from(new Float32Array([-3,0,-3, 3,0,-3, 3,4,-3, -3,4,-3]).buffer);
  const normals = Buffer.from(new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]).buffer);
  const uv = Buffer.from(new Float32Array([0,0,1,0,1,1,0,1]).buffer);
  const indices = Buffer.from(new Uint16Array([0,1,2,0,2,3]).buffer), image = png();
  const parts = [positions, normals, uv, indices, image];
  let offset = 0;
  const views = parts.map(part => { const view = { buffer: 0, byteOffset: offset, byteLength: part.length }; offset += part.length; return view; });
  const doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.7, 0.8, 0.9, 1], baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ bufferView: 4, mimeType: 'image/png' }],
    buffers: [{ byteLength: offset }], bufferViews: views, accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-3,0,-3], max: [3,4,-3] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' }] };
  change(doc);
  return packGlb(doc, Buffer.concat(parts));
}
