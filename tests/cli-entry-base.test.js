import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { build } from '../src/cli/commands/build.js';
import { preview } from '../src/cli/commands/preview.js';
import { normalizeBase } from '../src/cli/utils/base.js';

// build 以外の入口も同じ設置先 base の規則に従う (#175)。
// - build() を command 無しで呼んでも、options.base を明示すればそれが効く
// - preview は dropcaster.config.js の base で配信する (--base オプションは無い)

const originalCwd = process.cwd();
/** @type {string} */
let gallery;

before(async () => {
  gallery = await mkdtemp(join(tmpdir(), 'dropcaster-entry-base-'));
  await mkdir(join(gallery, 'public'));
  await writeFile(join(gallery, 'dropcaster.config.js'), "export default { base: '/exhibit/' };\n");
  process.chdir(gallery);
});

after(async () => {
  process.chdir(originalCwd);
  await rm(gallery, { recursive: true, force: true });
});

async function readManifest(dir) {
  return JSON.parse(await readFile(join(gallery, dir, 'manifest.json'), 'utf-8'));
}

test('build() called without a commander command honors an explicit options.base', async () => {
  await build({ output: 'dist', base: '/other/' });
  const manifest = await readManifest('dist');
  assert.equal(manifest.start_url, '/other/');
  assert.equal(manifest.scope, '/other/');
});

test('preview serves the build under the base from dropcaster.config.js', async () => {
  await build({ output: 'dist' });
  const server = await preview({ port: '0', host: 'localhost', output: 'dist' });
  try {
    const address = server.httpServer.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://localhost:${address.port}`;
    const html = await (await fetch(`${origin}/exhibit/`)).text();
    const script = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    assert.ok(script?.startsWith('/exhibit/assets/'), `script under /exhibit/: ${script}`);
    const res = await fetch(`${origin}${script}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /javascript/, 'asset must not fall back to the SPA HTML');
  } finally {
    await server.close();
  }
});

test('normalizeBase boundaries match the viewer and reject relative / URL bases', () => {
  assert.equal(normalizeBase(undefined), '/');
  assert.equal(normalizeBase(''), '/');
  assert.equal(normalizeBase('/'), '/');
  assert.equal(normalizeBase('exhibit'), '/exhibit/');
  assert.equal(normalizeBase('/a/b'), '/a/b/');
  for (const bad of ['./', '.', '../x/', '//cdn.example/', 'https://cdn.example/', 42]) {
    assert.throws(() => normalizeBase(bad), /base/, String(bad));
  }
});
