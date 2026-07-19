import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { DEFAULT_DESCRIPTION_SUFFIX, DEFAULT_PATH_PREFIX, MANUAL_METADATA_FILE } from './constants.js';
import { t } from '../../cli/i18n/index.js';

/**
 * 個別のスケッチを分析
 */
/**
 * @typedef {object} SketchInfo
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} path
 * @property {string} type
 * @property {string[]} tags
 * @property {string[]} interactiveElements
 * @property {string} lastModified
 * @property {string} [sketchUrl]
 * @property {string} [previewGif]
 * @property {object} [userData]
 * @property {Set<string>} [__manualMetadataFields]  手動メタデータで明示指定された
 *   フィールド名 (defineProperty で付与される non-enumerable な内部フィールド。
 *   sketches.json には出力されない)
 */

/**
 * @param {string} dirName
 * @param {string} sketchPath
 * @returns {Promise<SketchInfo | null>}
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
    const manualMetadata = await loadManualMetadata(sketchPath, dirName);

    // インタラクティブ要素を検出
    const detectedInteractiveElements = await detectInteractiveElements(sketchPath, htmlContent);
    const interactiveElements = manualMetadata.interactiveElements || detectedInteractiveElements;

    const sketchInfo = {
      id: dirName,
      title: manualMetadata.title || metadata.title || dirName,
      description: manualMetadata.description || metadata.description || `${dirName}${DEFAULT_DESCRIPTION_SUFFIX}`,
      path: `${DEFAULT_PATH_PREFIX}${dirName}/`,
      type: manualMetadata.type || metadata.type || detectSketchType(htmlContent, sketchPath),
      tags: manualMetadata.tags || metadata.tags || [],
      interactiveElements,
      lastModified: stats.mtime.toISOString(),
      ...(manualMetadata.sketchUrl ? { sketchUrl: manualMetadata.sketchUrl } : {}),
      ...(manualMetadata.previewGif ? { previewGif: manualMetadata.previewGif } : {}),
      ...(manualMetadata.userData ? { userData: manualMetadata.userData } : {})
    };
    Object.defineProperty(sketchInfo, '__manualMetadataFields', {
      value: new Set(Object.keys(manualMetadata)),
      enumerable: false
    });
    return sketchInfo;
  } catch (error) {
    console.warn(`Warning: Error analyzing ${dirName}:`, error.message);
    return null;
  }
}

async function loadManualMetadata(sketchPath, dirName) {
  const metadataPath = join(sketchPath, MANUAL_METADATA_FILE);

  try {
    const rawMetadata = await readFile(metadataPath, 'utf-8');
    const parsedMetadata = JSON.parse(rawMetadata);
    const normalizedMetadata = normalizeManualMetadata(parsedMetadata);
    console.error(t('sketchAnalyzer.manualMetadataLoaded', { path: `${dirName}/${MANUAL_METADATA_FILE}` }));
    return normalizedMetadata;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Warning: Could not load ${dirName}/${MANUAL_METADATA_FILE}:`, error.message);
    }
    return {};
  }
}

function normalizeManualMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const normalized = {};

  for (const field of ['title', 'description', 'type', 'sketchUrl', 'previewGif']) {
    const value = normalizeString(metadata[field]);
    if (value) {
      normalized[field] = value;
    }
  }

  const tags = normalizeStringArray(metadata.tags);
  if (tags) {
    normalized.tags = tags;
  }

  const interactiveElements = normalizeStringArray(metadata.interactiveElements);
  if (interactiveElements) {
    normalized.interactiveElements = interactiveElements;
  }

  const userData = normalizeUserData(metadata.userData);
  if (userData) {
    normalized.userData = userData;
  }

  return normalized;
}

function normalizeUserData(userData) {
  if (!userData || typeof userData !== 'object' || Array.isArray(userData)) {
    return null;
  }

  const normalized = {};
  for (const field of ['userId', 'userName', 'userUrl']) {
    const value = normalizeString(userData[field]);
    if (value) {
      normalized[field] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value
    .map(item => normalizeString(item))
    .filter(Boolean);

  return normalized.length > 0 ? normalized : null;
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
    return 'p5.js';
  }

  if (htmlContent.includes('three.js') || htmlContent.includes('three.min.js')) {
    return 'Three.js';
  }

  if (htmlContent.toLowerCase().includes('webgpu')) {
    return 'WebGPU';
  }

  if (htmlContent.toLowerCase().includes('webgl')) {
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
          const jsPath = resolve(sketchPath, src);
          // `../` を含む src でスケッチディレクトリ外を読まないようにする
          if (!jsPath.startsWith(resolve(sketchPath) + sep)) continue;
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
