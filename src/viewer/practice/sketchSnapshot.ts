import type { OpSketchMeta, OpCodeTab } from '../../core/modules/op-sketch-builder.js';
import { sha256Hex } from '../utils/sha256.ts';

/**
 * 固定した OP / Gist 作品のコード (#197)。IndexedDB の別の store に `hash` をキーにして置き、Project の content は
 * `revisionPinned: true` と `hash` だけを持つ。書き出しには含めない (第三者のコードを再配布しない、#120 の決定)。
 * 素材 (画像・音・外部ライブラリ) は含まない。作品は取得元の素材を読み込む。
 */
export type SnapshotPayload =
  | { kind: 'op'; ref: string; meta: OpSketchMeta; codeTabs: OpCodeTab[] }
  | { kind: 'gist'; ref: string; gist: { id: string; description: string; ownerLogin: string; ownerUrl: string;
      htmlUrl: string; updatedAt: string; files: [string, string][] } };
export interface SketchSnapshot {
  hash: string;
  /** このコードを取得した日時 (ISO)。固定の日時として表示する。 */
  fetchedAt: string;
  /** 作者・作品 URL・ライセンス。Gist にはライセンスの情報が無い。 */
  source: { author: string; url: string; license: string | null };
  payload: SnapshotPayload;
}

/** 照合に使う内容。作品の見た目を決める部分だけを入れ、閲覧数などの変わりやすいメタデータは入れない。 */
function canonical(payload: SnapshotPayload): unknown {
  if (payload.kind === 'gist') {
    return { format: 1, kind: 'gist', ref: payload.ref.toLowerCase(),
      files: [...payload.gist.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
  }
  const { meta } = payload;
  return { format: 1, kind: 'op', ref: payload.ref, mode: meta.mode ?? '', engineURL: meta.engineURL ?? '', fileBase: meta.fileBase ?? '',
    libraries: (Array.isArray(meta.libraries) ? meta.libraries : []).map(library => String(library?.url ?? '')),
    tabs: (Array.isArray(payload.codeTabs) ? payload.codeTabs : []).map(tab => ({ title: String(tab?.title ?? ''), code: String(tab?.code ?? ''),
      order: Number.isFinite(tab?.orderID) ? tab.orderID : null })) };
}
/** どのブラウザ・配信 (非 secure context を含む) でも同じ値になる、作品の参照とコードの SHA-256。 */
export function snapshotHash(payload: SnapshotPayload): string { return sha256Hex(JSON.stringify(canonical(payload))); }

const text = (value: unknown) => value === null || value === undefined ? '' : String(value).trim();
export function createSnapshot(payload: SnapshotPayload, fetchedAt = new Date().toISOString()): SketchSnapshot {
  const source = payload.kind === 'op'
    ? { author: text(payload.meta.fullname ?? payload.meta.user?.fullname) || text(payload.meta.username ?? payload.meta.user?.username),
        url: `https://openprocessing.org/sketch/${payload.ref}`, license: text(payload.meta.license) || null }
    : { author: payload.gist.ownerLogin, url: payload.gist.htmlUrl, license: null };
  return { hash: snapshotHash(payload), fetchedAt, source, payload };
}

/**
 * いま表示している作品 (Sketch の id ごと) のコード。OP / Gist の取得元が作品を組み立てるたびに入れる。
 * 「固定」は取得し直さずに、リハーサルで見ていたこの版を固定する。保存はしない。
 */
export const shownSnapshots = new Map<string, SketchSnapshot>();
