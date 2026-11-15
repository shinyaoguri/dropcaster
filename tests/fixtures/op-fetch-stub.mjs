// `dropcaster fetch` を子プロセスで実行するときに `--import` で読み込むスタブ。
// OpenProcessing API と deckard のアセット取得を、DC_OP_FIXTURE (JSON ファイルのパス) の内容で
// 返し、それ以外の URL への fetch は失敗させる (テストがネットワークに出ないことを保証する)。
//
// fixture の形:
//   {
//     "sketches": { "<id>": { "meta": {...} | null, "code": [...] | null, "status": 500 } },
//     "assets": { "<deckard の絶対 URL>": { "body": "...", "status": 200 } }
//   }
// meta / code が null、または status が 400 以上なら、その API はエラーを返す。
//
// DC_FAIL_WRITE_BASENAME を指定すると、そのファイル名への fs/promises.writeFile を ENOSPC で
// 失敗させる (書き込み途中の失敗を、作品の内容に依らず起こすため)。

import { readFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const fixturePath = process.env.DC_OP_FIXTURE;
if (!fixturePath) throw new Error('op-fetch-stub: DC_OP_FIXTURE is not set');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

const API_PREFIX = 'https://openprocessing.org/api/sketch/';

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(API_PREFIX)) {
    const [id, sub] = url.slice(API_PREFIX.length).split('/');
    const sketch = fixture.sketches?.[id];
    if (!sketch || (sketch.status ?? 200) >= 400) {
      return json({ success: false, message: `stub: sketch ${id} unavailable` }, sketch?.status ?? 404);
    }
    const body = sub === 'code' ? sketch.code : sketch.meta;
    if (body == null) return json({ success: false, message: `stub: ${sub || 'meta'} unavailable` }, 500);
    return json(body);
  }
  const asset = fixture.assets?.[url];
  if (asset) return new Response(asset.body ?? '', { status: asset.status ?? 200 });
  throw new TypeError(`op-fetch-stub: unexpected network request to ${url}`);
};

const failBasename = process.env.DC_FAIL_WRITE_BASENAME;
if (failBasename) {
  const originalWriteFile = fsPromises.writeFile;
  fsPromises.writeFile = async (path, ...rest) => {
    if (typeof path === 'string' && basename(path) === failBasename) {
      const error = new Error(`ENOSPC: no space left on device (stub), write '${path}'`);
      Object.assign(error, { code: 'ENOSPC' });
      throw error;
    }
    return originalWriteFile(path, ...rest);
  };
  syncBuiltinESMExports();
}
