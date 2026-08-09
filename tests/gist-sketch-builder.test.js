import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleGistSketchHtml,
  sketchFiles,
  resolveGistTitle,
  isCanvastageGist,
} from '../src/core/modules/gist-sketch-builder.js';
import { GistFormatError } from '../src/core/modules/gist-api-client.js';

// canvastage が「Share to GitHub Gist」で書き出した Gist と同じファイル構成
// (実物: https://gist.github.com/shinyaoguri/ea90ca3ba08ee4a229d5c616504afdf1)
function canvastageGistFixture() {
  return {
    id: 'ea90ca3ba08ee4a229d5c616504afdf1',
    description: 'calm-wave-xuu — canvastage sketch',
    ownerLogin: 'shinyaoguri',
    ownerUrl: 'https://gist.github.com/shinyaoguri',
    htmlUrl: 'https://gist.github.com/shinyaoguri/ea90ca3ba08ee4a229d5c616504afdf1',
    updatedAt: '2026-08-09T00:00:00Z',
    files: new Map([
      ['_calm-wave-xuu.md', '# calm-wave-xuu\n\ncanvastage sketch\n'],
      [
        'index.html',
        [
          '<!DOCTYPE html>',
          '<html lang="en">',
          '<head>',
          '<script src="https://cdn.jsdelivr.net/npm/p5@1/lib/p5.min.js"></script>',
          '<link rel="stylesheet" href="style.css">',
          '</head>',
          '<body><script src="sketch.js"></script></body>',
          '</html>',
        ].join('\n'),
      ],
      ['sketch.js', 'function setup() { createCanvas(windowWidth, windowHeight); }'],
      ['style.css', 'html, body { margin: 0; background: #000; }'],
    ]),
  };
}

test('gist: relative file refs are inlined and CDN scripts are kept', () => {
  const html = assembleGistSketchHtml({ gist: canvastageGistFixture() });

  assert.ok(html.includes('createCanvas(windowWidth, windowHeight)'), 'sketch.js inlined');
  assert.ok(!/src\s*=\s*"sketch\.js"/.test(html), 'sketch.js src removed');
  assert.ok(html.includes('<style>') && html.includes('background: #000'), 'style.css inlined');
  assert.ok(!/href\s*=\s*"style\.css"/.test(html), 'style.css href removed');
  assert.ok(html.includes('cdn.jsdelivr.net/npm/p5@1/lib/p5.min.js'), 'CDN script kept as-is');
});

test('gist: no <base> is emitted (gists have no asset base URL)', () => {
  const html = assembleGistSketchHtml({ gist: canvastageGistFixture() });
  assert.ok(!/<base\b/i.test(html), 'no base href');
});

test('gist: the title dummy file is not embedded in the srcdoc', () => {
  const gist = canvastageGistFixture();
  assert.ok(!sketchFiles(gist).has('_calm-wave-xuu.md'), 'title file excluded from the file table');

  const html = assembleGistSketchHtml({ gist });
  assert.ok(!html.includes('_calm-wave-xuu.md'), 'title file not in the fetch shim table');
});

test('gist: a gist without index.html is rejected as a format error', () => {
  const gist = canvastageGistFixture();
  gist.files.delete('index.html');
  assert.throws(() => assembleGistSketchHtml({ gist }), GistFormatError);
});

test('gist: </script> inside an inlined file cannot break the document', () => {
  const gist = canvastageGistFixture();
  gist.files.set('sketch.js', 'const s = "</script><img src=x>";');
  const html = assembleGistSketchHtml({ gist });
  assert.ok(!/<\/script><img src=x>/.test(html), 'no raw close-tag sequence anywhere');
});

test('gist: a plain (non-canvastage) gist with an index.html is accepted', () => {
  const gist = {
    id: 'b'.repeat(32),
    description: 'just a sketch',
    ownerLogin: 'someone',
    ownerUrl: 'https://gist.github.com/someone',
    htmlUrl: `https://gist.github.com/someone/${'b'.repeat(32)}`,
    updatedAt: '',
    files: new Map([['index.html', '<html><head></head><body>hi</body></html>']]),
  };
  assert.ok(assembleGistSketchHtml({ gist }).includes('hi'));
  assert.equal(isCanvastageGist(gist), false);
  assert.equal(resolveGistTitle(gist), '', 'no title to recover — caller falls back');
});

test('resolveGistTitle prefers the title dummy file over the description', () => {
  const gist = canvastageGistFixture();
  assert.equal(resolveGistTitle(gist), 'calm-wave-xuu');
  assert.equal(isCanvastageGist(gist), true);

  gist.files.delete('_calm-wave-xuu.md');
  assert.equal(resolveGistTitle(gist), 'calm-wave-xuu', 'falls back to the description');
  assert.equal(isCanvastageGist(gist), true, 'description still marks it as canvastage');
});
