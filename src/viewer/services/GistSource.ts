// 公開 Gist の ID からスケッチを解決するソース。
// GET /gists/{id} を 1 本叩き、core/gist-sketch-builder で srcdoc 用 HTML を
// 組み立て、SketchPageController が扱う Sketch 型に詰めて返す。
//
// OpenProcessingSource と対になる 2 つ目の取り込み元。OP と違い
// アセット proxy も engine の概念も無いので、設定 (getConfig) には依存しない。

import { fetchGist } from '../../core/modules/gist-api-client.js';
import { assembleGistSketchHtml, resolveGistTitle } from '../../core/modules/gist-sketch-builder.js';
import type { Sketch } from '../types/sketch.js';

export class GistSource {
  /**
   * Gist ID を解決して Sketch を返す。
   * 取得に失敗した場合は gist-api-client の各エラーがそのまま伝播する
   * (GistNotFoundError / GistRateLimitError / GistFormatError)。
   */
  async resolve(gistId: string): Promise<Sketch> {
    const gist = await fetchGist(gistId);
    const html = assembleGistSketchHtml({ gist });
    const title = resolveGistTitle(gist);

    return {
      id: `gist-${gist.id}`,
      title: title || `Gist ${gist.id.slice(0, 7)}`,
      // description は canvastage が付ける `<name> — canvastage sketch` のことが多い。
      // タイトルと重複する情報しか無いので、そのときは表示しない。
      description: title && gist.description.startsWith(title) ? '' : gist.description,
      path: '',
      type: 'gist',
      tags: [],
      interactiveElements: [],
      lastModified: gist.updatedAt,
      sketchUrl: gist.htmlUrl,
      userData: gist.ownerLogin
        ? {
            userId: gist.ownerLogin,
            userName: gist.ownerLogin,
            userUrl: gist.ownerUrl,
          }
        : undefined,
      srcdoc: html,
      meta: {
        mode: 'gist',
        // Gist にアップロード済みアセットの置き場は無く、外部参照はすべて
        // 作者が書いた絶対 URL (CDN) なので proxy 概念自体が無い。
        hasExternalAssets: false,
        proxiedAssets: false,
      },
    };
  }
}
