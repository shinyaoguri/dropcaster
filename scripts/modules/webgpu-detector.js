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
    const webglKeywords = [
      'WEBGL',
      'createCanvas(.*WEBGL',
      'createGraphics(.*WEBGL',
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
    
    // WebGLチェック（正規表現も含む）
    for (const keyword of webglKeywords) {
      if (keyword.includes('(')) {
        // 正規表現パターン
        const regex = new RegExp(keyword);
        if (regex.test(combinedContent)) {
          console.error(`   🎨 WebGL detected in sketch (found pattern "${keyword}")`);
          return 'webgl';
        }
      } else {
        // 通常の文字列検索
        if (combinedContent.includes(keyword)) {
          console.error(`   🎨 WebGL detected in sketch (found "${keyword}")`);
          return 'webgl';
        }
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
 * スケッチがWebGPUを使用しているかチェック（後方互換性のため維持）
 * @param {string} sketchPath - スケッチのディレクトリパス
 * @returns {Promise<boolean>} WebGPUを使用している場合true
 */
export async function usesWebGPU(sketchPath) {
  const mode = await detectGraphicsMode(sketchPath);
  return mode === 'webgpu';
}

/**
 * グラフィックスモードに応じたブラウザ起動設定を取得
 * @param {string} graphicsMode - 'webgpu', 'webgl', または 'standard'
 * @returns {string[]} Chromiumの起動引数
 */
export function getBrowserArgs(graphicsMode) {
  const baseArgs = [
    '--no-sandbox',
    '--disable-dev-shm-usage'
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