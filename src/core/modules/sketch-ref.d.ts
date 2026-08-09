/** 入力欄が受け付ける作品参照。source ごとにルートが分かれる。 */
export interface SketchRef {
  source: 'op' | 'gist';
  id: string;
}

export function parseOpId(raw: string): string | null;
export function parseGistId(raw: string): string | null;
export function parseSketchRef(raw: string): SketchRef | null;
