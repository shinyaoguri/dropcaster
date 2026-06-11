import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * スケッチのグラフィックスモードを検出
 * @param {string} sketchPath - スケッチのディレクトリパス
 * @returns {Promise<string>} 'webgpu', 'webgl', または 'standard'
 */
export async function detectGraphicsMode(sketchPath) {
  try {
    // index.htmlを読み込み
    const indexPath = join(sketchPath, 'index.html');
    const htmlContent = await readFile(indexPath, 'utf-8');
    
    // mySketch.jsがある場合は読み込み
    let jsContent = '';
    try {
      const jsPath = join(sketchPath, 'mySketch.js');
      jsContent = await readFile(jsPath, 'utf-8');
    } catch (e) {
      // mySketch.jsがない場合は無視
    }
    
    const combinedContent = htmlContent + '\n' + jsContent;
    
    // WebGPU関連のキーワードをチェック
    const webgpuKeywords = [
      'navigator.gpu',
      'GPUDevice',
      'GPUAdapter',
      'requestAdapter',
      'requestDevice',
      'createShaderModule',
      'createRenderPipeline',
      'createComputePipeline',
      'GPUBuffer',
      'GPURenderPassEncoder',
      'GPUComputePassEncoder',
      'wgsl',
      '@vertex',
      '@fragment',
      '@compute',
      'WebGPU'
    ];
    
    // WebGPUチェック
    for (const keyword of webgpuKeywords) {
      if (combinedContent.includes(keyword)) {
        console.error(`   🎮 WebGPU detected in sketch (found "${keyword}")`);
        return 'webgpu';
      }
    }
    
    // WebGL関連のキーワードをチェック
    // 注意: 全て単純な文字列検索。以前は `(` を含むキーワードを new RegExp() に
    // 渡していたが、未終端グループで必ず throw し、catch 経由で全スケッチが
    // webgl 判定になるバグがあった。`createCanvas(...WEBGL)` 系は 'WEBGL'
    // リテラルの検出に包含されるため個別パターンは不要。
    const webglKeywords = [
      'WEBGL',
      'setAttributes',
      'shader(',
      'loadShader',
      'createShader',
      'resetShader',
      'normalMaterial',
      'texture(',
      'ambientLight',
      'directionalLight',
      'pointLight',
      'lights()',
      'orbitControl',
      'debugMode',
      'noDebugMode'
    ];

    for (const keyword of webglKeywords) {
      if (combinedContent.includes(keyword)) {
        console.error(`   🎨 WebGL detected in sketch (found "${keyword}")`);
        return 'webgl';
      }
    }
    
    return 'standard';
  } catch (error) {
    console.warn(`Warning: Could not check graphics mode: ${error.message}`);
    // エラーの場合は安全のためWebGL対応として扱う
    return 'webgl';
  }
}

/**
 * グラフィックスモードに応じたブラウザ起動設定を取得
 * @param {string} graphicsMode - 'webgpu', 'webgl', または 'standard'
 * @returns {string[]} Chromiumの起動引数
 */
export function getBrowserArgs(graphicsMode) {
  const baseArgs = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // p5.sound などが load されている場合、AudioContext が user gesture を待って
    // suspended のままになり、p5 の preload カウンタが下がらず setup() が走らない。
    // headless では gesture を出せないので、policy を緩めて AudioContext を即 running に。
    '--autoplay-policy=no-user-gesture-required'
  ];
  
  switch (graphicsMode) {
    case 'webgpu':
      // WebGPUサポートが必要な場合
      return [
        ...baseArgs,
        '--disable-gpu-sandbox',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,WebGPU,UseSkiaRenderer',
        '--use-angle=swiftshader',
        '--disable-vulkan-fallback-to-gl-for-testing',
        '--enable-webgpu-developer-features'
      ];
    
    case 'webgl':
      // WebGLサポートが必要な場合
      return [
        ...baseArgs,
        '--use-gl=angle',  // ANGLEを使用（より安定）
        '--use-angle=gl',  // OpenGLバックエンド
        '--enable-webgl',
        '--enable-webgl2-compute-context'
      ];
    
    case 'standard':
    default:
      // 通常のスケッチの場合（高速化優先）
      return [
        ...baseArgs,
        '--disable-gpu',
        '--disable-software-rasterizer'
      ];
  }
}