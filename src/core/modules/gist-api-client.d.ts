export interface GistData {
  /** Gist ID (32 桁 hex) */
  id: string;
  /** Gist の description。canvastage は `<name> — canvastage sketch` を入れる */
  description: string;
  /** 所有者の GitHub ログイン名。匿名 Gist では空 */
  ownerLogin: string;
  /** 所有者の Gist 一覧 URL。ownerLogin が空なら空 */
  ownerUrl: string;
  /** Gist のページ URL */
  htmlUrl: string;
  /** ISO8601。updated_at → created_at の順で解決 */
  updatedAt: string;
  /** ファイル名 → 内容。API のキー順（= ファイル名昇順）を保つ */
  files: Map<string, string>;
}

export class GistRateLimitError extends Error {
  constructor(retryAfterMs: number, message?: string);
  retryAfterMs: number;
}

export class GistFormatError extends Error {
  constructor(message: string);
}

export class GistNotFoundError extends Error {
  constructor(gistId: string);
}

export function fetchGist(gistId: string): Promise<GistData>;
export function normalizeGistId(value: unknown): string;
