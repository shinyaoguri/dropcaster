import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';

// ホスト版 (apps/web/index.html) のインライン __DROPCASTER_CONFIG__ は viewer の既定値を
// 上書きする。supportedOpModes: ['p5js'] が残っていたせいで、html モード作品が
// ホスト版でだけ「未対応のエンジン」になっていた回帰を固定する。

async function readHostedConfig() {
  const html = await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf-8');
  const match = html.match(/window\.__DROPCASTER_CONFIG__\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(match, 'apps/web/index.html に __DROPCASTER_CONFIG__ の代入が見つからない');
  return new Function(`return (${match[1]});`)();
}

test('hosted config does not restrict OpenProcessing modes below p5js + html', async () => {
  const config = await readHostedConfig();
  // 未指定なら viewer の既定 (p5js / html) が効く。指定するなら両方を含めること。
  if (config.supportedOpModes !== undefined) {
    assert.ok(config.supportedOpModes.includes('p5js'), 'p5js が含まれていない');
    assert.ok(config.supportedOpModes.includes('html'), 'html が含まれていない');
  }
});

test('hosted config routes OpenProcessing assets through the same-origin proxy', async () => {
  const config = await readHostedConfig();
  assert.equal(config.assetProxyBaseUrl, '/op-cdn');
});
