// OpenProcessing 作品 ID からスケッチを解決するソース。
// /api/sketch/{id} と /api/sketch/{id}/code を叩き、core/op-sketch-builder で
// srcdoc 用 HTML を組み立て、SketchPageController が扱う Sketch 型に詰めて返す。
//
// 同期的なリスト機能 (gallery 用) は持たない (ID は呼び出し側が知っている前提)。

import { OpenProcessingApiClient } from '../../core/modules/op-api-client.js';
import { assembleOpSketchHtml, hasExternalDeckardAsset } from '../../core/modules/op-sketch-builder.js';
import { getConfig } from '../config.js';
import { API_CONFIG } from '../../core/modules/constants.js';
import type { Sketch } from '../types/sketch.js';

export class UnsupportedEngineModeError extends Error {
  readonly mode: string;
  readonly sketchId: string;
  constructor(sketchId: string, mode: string) {
    super(`OpenProcessing engine mode "${mode}" は現在未対応です (sketch ${sketchId})`);
    this.name = 'UnsupportedEngineModeError';
    this.mode = mode;
    this.sketchId = sketchId;
  }
}

export class OpenProcessingSource {
  private client: OpenProcessingApiClient;

  constructor() {
    const cfg = getConfig();
    this.client = new OpenProcessingApiClient({
      apiToken: cfg.openProcessingApiToken,
      // apiRequestIntervalMs はクライアント側のデフォルト (Browser=500ms) に任せる。
      // 連打を平準化する程度で普段の操作には影響しない。SW の OP_META_CACHE も効くので
      // 同じスケッチの再表示では API を叩かない。
    });
  }

  /**
   * sketch ID を解決して Sketch を返す。mode が許可リストに無い場合は
   * UnsupportedEngineModeError を throw する。
   */
  async resolve(sketchId: string): Promise<Sketch> {
    const id = normalizeId(sketchId);
    if (!/^\d+$/.test(id)) throw new Error(`invalid OpenProcessing sketch id: "${sketchId}"`);

    const cfg = getConfig();
    const supportedModes = cfg.supportedOpModes ?? ['p5js'];

    const [meta, codeTabs] = await Promise.all([
      this.client.getSketch(id),
      this.client.getSketchCode(id),
    ]);

    const mode = meta.mode ?? '';
    if (!supportedModes.includes(mode)) {
      throw new UnsupportedEngineModeError(id, mode || 'unknown');
    }

    const proxiedAssets = !!cfg.assetProxyBaseUrl;
    const html = assembleOpSketchHtml({
      meta,
      codeTabs,
      options: {
        assetProxyBaseUrl: cfg.assetProxyBaseUrl,
        // proxy 経由なら同一オリジン扱いになるので cors shim は不要だが、
        // proxy 未設定 (degraded) の場合に最低限の動作確認 (canvas は taint するが setup は走る) を
        // させるため shim は OFF にしておく。OP の挙動に近くなる。
        injectCorsShim: false,
        injectErrorShim: false,
      },
    });

    const userId = normalizeString(meta.userID ?? meta.userId ?? meta.user?.userID);
    const username = normalizeString(meta.username ?? meta.user?.username ?? meta.user?.fullname);

    return {
      id: `op-${id}`,
      title: normalizeString(meta.title) || `OpenProcessing ${id}`,
      description: normalizeString(meta.description),
      path: '',
      type: meta.mode || 'p5js',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      interactiveElements: [],
      lastModified: normalizeString(meta.updatedOn) || normalizeString(meta.createdOn),
      sketchUrl: `${API_CONFIG.baseUrl}/sketch/${id}`,
      userData: userId ? {
        userId,
        userName: username || userId,
        userUrl: `${API_CONFIG.baseUrl}/user/${userId}/`,
      } : undefined,
      srcdoc: html,
      meta: {
        mode: meta.mode,
        license: meta.license,
        hasExternalAssets: hasExternalDeckardAsset(codeTabs),
        proxiedAssets,
      },
    };
  }
}

function normalizeId(value: unknown): string {
  return normalizeString(value).replace(/^sketch/i, '');
}

function normalizeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
