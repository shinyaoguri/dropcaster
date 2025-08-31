import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { DEFAULT_DESCRIPTION_SUFFIX, DEFAULT_PATH_PREFIX } from './config.js';

/**
 * 個別のスケッチを分析
 */
export async function analyzeSketch(dirName, sketchPath) {
  try {
    const indexPath = join(sketchPath, 'index.html');
    const stats = await stat(indexPath);
    
    if (!stats.isFile()) {
      console.warn(`Warning: ${dirName} has no index.html, skipping...`);
      return null;
    }
    
    // index.htmlを解析してメタデータを抽出
    const htmlContent = await readFile(indexPath, 'utf-8');
    const metadata = extractMetadata(htmlContent, dirName);
    
    // インタラクティブ要素を検出
    const interactiveElements = await detectInteractiveElements(sketchPath, htmlContent);
    
    return {
      id: dirName,
      title: metadata.title || dirName,
      description: metadata.description || `${dirName}${DEFAULT_DESCRIPTION_SUFFIX}`,
      path: `${DEFAULT_PATH_PREFIX}${dirName}/`,
      type: detectSketchType(htmlContent, sketchPath),
      tags: metadata.tags || [],
      interactiveElements: interactiveElements,
      lastModified: stats.mtime.toISOString(),
      ...metadata
    };
  } catch (error) {
    console.warn(`Warning: Error analyzing ${dirName}:`, error.message);
    return null;
  }
}

/**
 * HTMLからメタデータを抽出
 */
function extractMetadata(htmlContent, dirName) {
  const metadata = {};
  
  // タイトルを抽出
  const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
  if (titleMatch) {
    metadata.title = titleMatch[1].trim();
  }
  
  // メタタグからdescriptionを抽出
  const descMatch = htmlContent.match(/<meta\s+name=["\']description["\']\s+content=["\']([^"']*)["\'][^>]*>/i);
  if (descMatch) {
    metadata.description = descMatch[1].trim();
  }
  
  // メタタグからkeywordsを抽出
  const keywordsMatch = htmlContent.match(/<meta\s+name=["\']keywords["\']\s+content=["\']([^"']*)["\'][^>]*>/i);
  if (keywordsMatch) {
    metadata.tags = keywordsMatch[1].split(',').map(tag => tag.trim()).filter(Boolean);
  }
  
  // カスタムメタタグを抽出
  const sketchTypeMatch = htmlContent.match(/<meta\s+name=["\']sketch-type["\']\s+content=["\']([^"']*)["\'][^>]*>/i);
  if (sketchTypeMatch) {
    metadata.type = sketchTypeMatch[1].trim();
  }
  
  return metadata;
}

/**
 * スケッチのタイプを検出
 */
function detectSketchType(htmlContent, sketchPath) {
  // HTMLコンテンツからライブラリを検出
  if (htmlContent.includes('p5.js') || htmlContent.includes('p5.min.js')) {
    if (htmlContent.includes('WEBGL') || htmlContent.toLowerCase().includes('webgl')) {
      return 'p5.js';
    }
    return 'p5.js';
  }
  
  if (htmlContent.includes('three.js') || htmlContent.includes('three.min.js')) {
    return 'Three.js';
  }
  
  if (htmlContent.includes('webgpu') || htmlContent.toLowerCase().includes('webgpu')) {
    return 'WebGPU';
  }
  
  if (htmlContent.includes('webgl') || htmlContent.toLowerCase().includes('webgl')) {
    return 'WebGL';
  }
  
  return 'Unknown';
}

/**
 * インタラクティブ要素を検出
 */
export async function detectInteractiveElements(sketchPath, htmlContent) {
  const elements = new Set();
  
  try {
    // HTMLファイル内のインラインスクリプトから検出
    const scriptContent = extractInlineScripts(htmlContent);
    detectInteractivePatterns(scriptContent, elements);
    
    // 外部JavaScriptファイルを検索・解析
    const jsFiles = await findJavaScriptFiles(sketchPath);
    for (const jsFile of jsFiles) {
      try {
        const jsContent = await readFile(jsFile, 'utf-8');
        detectInteractivePatterns(jsContent, elements);
      } catch (error) {
        console.warn(`Warning: Could not read JS file ${jsFile}:`, error.message);
      }
    }
    
    // HTMLファイル内のスクリプトsrc属性から検出
    const scriptSrcs = extractScriptSrcs(htmlContent);
    for (const src of scriptSrcs) {
      if (!src.startsWith('http')) { // 外部CDNは除外
        try {
          const jsPath = join(sketchPath, src);
          const jsContent = await readFile(jsPath, 'utf-8');
          detectInteractivePatterns(jsContent, elements);
        } catch (error) {
          // ファイルが見つからない場合は無視
        }
      }
    }
    
  } catch (error) {
    console.warn(`Warning: Error detecting interactive elements:`, error.message);
  }
  
  return Array.from(elements);
}

/**
 * HTMLからインラインスクリプトを抽出
 */
function extractInlineScripts(htmlContent) {
  const scriptMatches = htmlContent.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (!scriptMatches) return '';
  
  return scriptMatches
    .map(script => script.replace(/<script[^>]*>|<\/script>/gi, ''))
    .join('\n');
}

/**
 * HTMLからscript srcを抽出
 */
function extractScriptSrcs(htmlContent) {
  const srcMatches = htmlContent.match(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi);
  if (!srcMatches) return [];
  
  return srcMatches.map(script => {
    const srcMatch = script.match(/src=["']([^"']+)["']/);
    return srcMatch ? srcMatch[1] : null;
  }).filter(Boolean);
}

/**
 * スケッチディレクトリ内のJavaScriptファイルを検索
 */
async function findJavaScriptFiles(sketchPath) {
  const jsFiles = [];
  
  try {
    const files = await readdir(sketchPath);
    for (const file of files) {
      if (file.endsWith('.js')) {
        jsFiles.push(join(sketchPath, file));
      }
    }
  } catch (error) {
    // ディレクトリが読めない場合は空配列を返す
  }
  
  return jsFiles;
}

/**
 * JavaScriptコードからインタラクティブパターンを検出
 */
function detectInteractivePatterns(code, elements) {
  // コメントを除外した一時的なコードを作成
  const cleanCode = removeComments(code);
  
  // マウス操作の検出（より厳密に）
  const mousePatterns = [
    /\bmousePressed\b|\bmouseDragged\b|\bmouseReleased\b|\bmouseClicked\b|\bmouseMoved\b/i,
    /\bmouseWheel\b|\bmouseScrolled\b/i,
    /\bhandleMouseClick\b/i,
    /\bonmousedown\b|\bonmouseup\b|\bonmousemove\b|\bonclick\b/i,
    /addEventListener\s*\(\s*['"`](mousedown|mouseup|mousemove|click|mousewheel|wheel)['"`]/i,
    /\borbitControl\b/i,  // p5.jsの3Dカメラコントロール
    /\bmouseX\b|\bmouseY\b/i  // マウス座標の参照
  ];
  
  if (mousePatterns.some(pattern => pattern.test(cleanCode))) {
    elements.add('マウス');
  }
  
  // キーボード操作の検出（より厳密に）
  const keyboardPatterns = [
    /\bkeyPressed\b|\bkeyReleased\b|\bkeyTyped\b/i,
    /\bonkeydown\b|\bonkeyup\b|\bonkeypress\b/i,
    /addEventListener\s*\(\s*['"`](keydown|keyup|keypress)['"`]/i,
    /\bkeyCode\b.*[!=]==|\bkey\s*[!=]==.*['"`][a-zA-Z0-9]['"`]/i
  ];
  
  if (keyboardPatterns.some(pattern => pattern.test(cleanCode))) {
    elements.add('キーボード');
  }
  
  // タッチ操作の検出
  const touchPatterns = [
    /\btouchStarted\b|\btouchMoved\b|\btouchEnded\b/i,
    /addEventListener\s*\(\s*['"`](touchstart|touchmove|touchend|touchcancel)['"`]/i,
    /\bontouchstart\b|\bontouchmove\b|\bontouchend\b/i
  ];
  
  if (touchPatterns.some(pattern => pattern.test(cleanCode))) {
    elements.add('タッチ');
  }
  
  // Webカメラの検出（明確なAPI呼び出しのみ）
  const cameraPatterns = [
    /\bcreateCapture\b/i,
    /navigator\.mediaDevices\.getUserMedia/i,
    /getUserMedia\s*\(/i,
    /video\s*=.*createCapture/i
  ];
  
  if (cameraPatterns.some(pattern => pattern.test(cleanCode))) {
    elements.add('Webカメラ');
  }
  
  // 音声の検出（明確なAPI呼び出しのみ）
  const audioPatterns = [
    /\bcreateAudio\b|\bloadSound\b/i,
    /\bgetAudioContext\b|\bnew\s+AudioContext/i,
    /Web\s*Audio\s*API/i,
    /\bmicrophone\b|\bmic\b.*capture/i,
    /navigator\.mediaDevices.*audio/i
  ];
  
  if (audioPatterns.some(pattern => pattern.test(cleanCode))) {
    elements.add('音声');
  }
  
  // センサー系の検出
  const sensorPatterns = [
    /\bdeviceOrientation\b|\baccelerometer\b|\bgyroscope\b/i,
    /addEventListener\s*\(\s*['"`](deviceorientation)['"`]/i,
    /addEventListener\s*\(\s*['"`](devicemotion)['"`]/i
  ];
  
  if (sensorPatterns.some(pattern => pattern.test(cleanCode))) {
    elements.add('センサー');
  }
}

/**
 * JavaScriptコードからコメントを除去
 */
function removeComments(code) {
  // 単行コメント(//)を除去
  let cleanCode = code.replace(/\/\/.*$/gm, '');
  
  // 複数行コメント(/* */)を除去
  cleanCode = cleanCode.replace(/\/\*[\s\S]*?\*\//g, '');
  
  return cleanCode;
}
