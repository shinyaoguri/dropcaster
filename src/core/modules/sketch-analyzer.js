import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, resolve, sep } from 'path';
import { DEFAULT_DESCRIPTION_SUFFIX, DEFAULT_PATH_PREFIX, MANUAL_METADATA_FILE, OP_METADATA_FILE } from './constants.js';
import { brokenSymlinkError, readOptionalTextFile } from './file-manager.js';
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
 * @property {Set<string>} [__explicitMetadataFields]  title / description のうち、作品の
 *   ディレクトリにある情報源 (手動メタデータ・_op-meta.json・HTML) が値を持っていたもの。
 *   scan はこれらに既存カタログの値を戻さない (同じく non-enumerable な内部フィールド)
 */

/**
 * 作品のディレクトリを解析する。
 * index.html が無い (ファイルでない) ディレクトリは作品ではないので、警告して null を返す。
 * index.html があるのに読めない・解析できないとき (リンク先の無い symlink を含む)、メタデータ
 * (dropcaster.meta.json / _op-meta.json) があるのに読めない・壊れているときは例外を投げる。
 * 呼び出し側 (scan) が作品ごとの失敗として集計し、終了コードに反映する (#213, #275)。
 * @param {string} dirName
 * @param {string} sketchPath
 * @returns {Promise<SketchInfo | null>} index.html が無ければ null
 */
export async function analyzeSketch(dirName, sketchPath) {
  const indexPath = join(sketchPath, 'index.html');
  const stats = await statSketchEntry(indexPath);

  if (!stats) {
    console.warn(`Warning: ${dirName} has no index.html, skipping...`);
    return null;
  }

  // index.htmlを解析してメタデータを抽出
  const htmlContent = await readFile(indexPath, 'utf-8');
  const metadata = extractMetadata(htmlContent, dirName);
  const manualMetadata = await loadManualMetadata(sketchPath, dirName);
  const opMetadata = await loadOpMetadata(sketchPath);

  // インタラクティブ要素を検出
  const detectedInteractiveElements = await detectInteractiveElements(sketchPath, htmlContent);
  const interactiveElements = manualMetadata.interactiveElements || detectedInteractiveElements;

  // タイトル・説明の優先順位: 手動メタデータ > _op-meta.json > HTML の明示値 > 既定値。
  // 既存カタログの値はこれらのどれにも値が無いときだけ scan-sketches.js が戻す (#115)
  const sketchInfo = {
    id: dirName,
    title: manualMetadata.title || opMetadata.title || metadata.title || dirName,
    description: manualMetadata.description || opMetadata.description || metadata.description || `${dirName}${DEFAULT_DESCRIPTION_SUFFIX}`,
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
  Object.defineProperty(sketchInfo, '__explicitMetadataFields', {
    value: new Set(
      /** @type {const} */ (['title', 'description'])
        .filter(field => manualMetadata[field] || opMetadata[field] || metadata[field])
    ),
    enumerable: false
  });
  return sketchInfo;
}

/**
 * 作品の入口 (index.html) の stat。無い (ENOENT)・ファイルでないときは null。
 * それ以外の失敗 (権限が無くて確かめられない・リンク先の無い symlink など) は「無い」と区別できるよう
 * 例外のまま返す。
 * @param {string} indexPath
 * @returns {Promise<import('fs').Stats | null>}
 */
async function statSketchEntry(indexPath) {
  try {
    const stats = await stat(indexPath);
    return stats.isFile() ? stats : null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const brokenLink = await brokenSymlinkError(indexPath);
    if (brokenLink) throw brokenLink;
    return null;
  }
}

/**
 * 作品のディレクトリにあるメタデータの JSON を読む。ファイルが無いときは null。
 * 読めない・JSON として壊れている・オブジェクトでないときは、ファイル名を添えて例外を投げる
 * (黙って空として扱うと、カタログの title / tags などが前触れなく別の値に変わるため。#275)。
 * @param {string} sketchPath
 * @param {string} fileName
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function loadMetadataFile(sketchPath, fileName) {
  let raw;
  try {
    raw = await readOptionalTextFile(join(sketchPath, fileName));
  } catch (error) {
    throw new Error(`Could not read ${fileName}: ${error.message}`, { cause: error });
  }
  if (raw === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${fileName} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fileName} must contain a JSON object`);
  }
  return parsed;
}

/**
 * 手動メタデータ (dropcaster.meta.json) を読む。ファイルが無いときは空。
 * 読めない・壊れているときは例外 (loadMetadataFile)。
 * @param {string} sketchPath
 * @param {string} dirName
 */
async function loadManualMetadata(sketchPath, dirName) {
  const parsedMetadata = await loadMetadataFile(sketchPath, MANUAL_METADATA_FILE);
  if (!parsedMetadata) return {};
  const normalizedMetadata = normalizeManualMetadata(parsedMetadata);
  console.error(t('sketchAnalyzer.manualMetadataLoaded', { path: `${dirName}/${MANUAL_METADATA_FILE}` }));
  return normalizedMetadata;
}

/**
 * dropcaster fetch が書いた _op-meta.json からタイトル・説明を読む。空の値は「値なし」として返さない。
 * ファイルが無いときは空。読めない・壊れているときは例外 (loadMetadataFile)。
 * @param {string} sketchPath
 * @returns {Promise<{ title?: string, description?: string }>}
 */
async function loadOpMetadata(sketchPath) {
  const parsed = await loadMetadataFile(sketchPath, OP_METADATA_FILE);
  /** @type {{ title?: string, description?: string }} */
  const result = {};
  if (!parsed) return result;
  for (const field of /** @type {const} */ (['title', 'description'])) {
    const value = normalizeString(parsed[field]);
    if (value) result[field] = value;
  }
  return result;
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

  // タイトルを抽出 (属性付きの <title lang="..."> も読む。document.title と同じく空白を詰める)
  const titleMatch = htmlContent.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (titleMatch) {
    metadata.title = decodeHtmlEntities(titleMatch[1]).replace(/[\t\n\f\r ]+/g, ' ').trim();
  }

  const metaContents = extractMetaContents(htmlContent);

  // メタタグからdescriptionを抽出
  const description = metaContents.get('description');
  if (description !== undefined) {
    metadata.description = description.trim();
  }

  // メタタグからkeywordsを抽出
  const keywords = metaContents.get('keywords');
  if (keywords !== undefined) {
    metadata.tags = keywords.split(',').map(tag => tag.trim()).filter(Boolean);
  }

  // カスタムメタタグを抽出
  const sketchType = metaContents.get('sketch-type');
  if (sketchType !== undefined) {
    metadata.type = sketchType.trim();
  }

  return metadata;
}

/**
 * <meta name="..." content="..."> を name (小文字) → content (エンティティをデコード済み) で集める。
 * 属性の順序・他の属性・改行・引用符の種類 (" / ' / なし) を問わない。同じ name は最初のものを使う。
 * @param {string} htmlContent
 * @returns {Map<string, string>}
 */
function extractMetaContents(htmlContent) {
  /** @type {Map<string, string>} */
  const contents = new Map();
  // 引用符で囲んだ値の中の > でタグを閉じない
  const metaTagPattern = /<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const [, attributeText] of htmlContent.matchAll(metaTagPattern)) {
    const attributes = parseAttributes(attributeText);
    const name = attributes.get('name');
    const content = attributes.get('content');
    if (name === undefined || content === undefined) continue;
    const key = name.trim().toLowerCase();
    if (!contents.has(key)) contents.set(key, content);
  }
  return contents;
}

/**
 * タグの属性部分を名前 (小文字) → 値 (エンティティをデコード済み) にする。同じ名前は最初のものを使う。
 * @param {string} attributeText
 * @returns {Map<string, string>}
 */
function parseAttributes(attributeText) {
  /** @type {Map<string, string>} */
  const attributes = new Map();
  const attributePattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const [, rawName, doubleQuoted, singleQuoted, unquoted] of attributeText.matchAll(attributePattern)) {
    const name = rawName.toLowerCase();
    if (attributes.has(name)) continue;
    attributes.set(name, decodeHtmlEntities(doubleQuoted ?? singleQuoted ?? unquoted ?? ''));
  }
  return attributes;
}

/** @type {Record<string, string>} */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * ブラウザがタイトルや属性値として表示する文字に揃えるため、HTML エンティティをデコードする。
 * 数値参照と主要な名前付き参照だけを扱い、知らない名前はそのまま残す。
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal, hex, name) => {
    if (name !== undefined) return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match;
    const codePoint = decimal !== undefined ? Number(decimal) : parseInt(hex, 16);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
  });
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
 * インタラクティブ要素を検出する。
 * 作品の JS (ディレクトリ直下の .js と、<script src> が指すローカルのファイル) が読めないとき
 * (ENOENT 以外の失敗・リンク先の無い symlink)、作品のディレクトリを一覧できないときは、ファイル名を
 * 添えて例外を投げる。黙って飛ばすと、カタログの interactiveElements が前触れなく変わるため (#275)。
 * <script src> が指す先が無い (ENOENT など、ファイルを指していない) 参照は、今までどおり無視する。
 * @param {string} sketchPath
 * @param {string} htmlContent
 * @returns {Promise<string[]>}
 */
export async function detectInteractiveElements(sketchPath, htmlContent) {
  const elements = new Set();

  // HTMLファイル内のインラインスクリプトから検出
  const scriptContent = extractInlineScripts(htmlContent);
  detectInteractivePatterns(scriptContent, elements);

  // 外部JavaScriptファイルを検索・解析
  const jsFiles = await findJavaScriptFiles(sketchPath);
  for (const jsFile of jsFiles) {
    const jsContent = await readSketchScript(sketchPath, jsFile);
    if (jsContent !== null) detectInteractivePatterns(jsContent, elements);
  }

  // HTMLファイル内のスクリプトsrc属性から検出
  const scriptSrcs = extractScriptSrcs(htmlContent);
  for (const src of scriptSrcs) {
    if (src.startsWith('http')) continue; // 外部CDNは除外
    const jsPath = resolve(sketchPath, src);
    // `../` を含む src でスケッチディレクトリ外を読まないようにする
    if (!jsPath.startsWith(resolve(sketchPath) + sep)) continue;
    const jsContent = await readSketchScript(sketchPath, jsPath);
    if (jsContent !== null) detectInteractivePatterns(jsContent, elements);
  }

  return Array.from(elements);
}

/**
 * 作品の JS を読む。ファイルを指していない (無い・途中がファイル・ディレクトリ) ときは null。
 * 読めない (権限など)・リンク先の無い symlink のときは、作品内のパスを添えて例外を投げる。
 * @param {string} sketchPath
 * @param {string} jsPath
 * @returns {Promise<string | null>}
 */
async function readSketchScript(sketchPath, jsPath) {
  try {
    return await readOptionalTextFile(jsPath);
  } catch (error) {
    if (error?.code === 'ENOTDIR' || error?.code === 'EISDIR') return null;
    throw new Error(`Could not read ${relative(sketchPath, jsPath)}: ${error.message}`, { cause: error });
  }
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
 * スケッチディレクトリ直下の .js ファイル (ディレクトリを除く) を返す。
 * ディレクトリを一覧できないときは例外を投げる (detectInteractiveElements)。
 * @param {string} sketchPath
 * @returns {Promise<string[]>}
 */
async function findJavaScriptFiles(sketchPath) {
  let entries;
  try {
    entries = await readdir(sketchPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not list the sketch directory: ${error.message}`, { cause: error });
  }
  return entries
    .filter(entry => entry.name.endsWith('.js') && !entry.isDirectory())
    .map(entry => join(sketchPath, entry.name));
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
