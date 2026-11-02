import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_ICON_SVG } from '../src/cli/utils/config.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// コミット済みの manifest.json（リポ自身の dev 用とホスト版）が参照するアイコンは、
// 同じ public ディレクトリに実在していなければならない（Vite テンプレートの残骸を指していた #73 の再発防止）
for (const publicDir of ['public', 'apps/web/public']) {
  test(`${publicDir}/manifest.json のアイコンが実在する`, async () => {
    const manifest = JSON.parse(await fs.readFile(join(rootDir, publicDir, 'manifest.json'), 'utf-8'));
    assert.ok(manifest.icons.length > 0);
    for (const icon of manifest.icons) {
      const iconPath = join(rootDir, publicDir, icon.src.replace(/^\//, ''));
      await assert.doesNotReject(fs.access(iconPath), `${icon.src} が ${publicDir} に無い`);
    }
  });
}

test('public/icon.svg は CLI が生成する既定アイコンと一致する', async () => {
  const icon = await fs.readFile(join(rootDir, 'public/icon.svg'), 'utf-8');
  assert.equal(icon, DEFAULT_ICON_SVG);
});
