export interface Sketch {
  id: string;
  title: string;
  description: string;
  /** ローカル配信パス（public/sketches/{id}/index.html 等）。OP 由来の sketch では空文字。 */
  path: string;
  type: string;
  tags: string[];
  interactiveElements: string[];
  lastModified: string;
  previewGif?: string; // オプショナルに変更
  sketchUrl?: string; // オリジナルスケッチのURL
  userData?: {
    userId: string;
    userName: string;
    userUrl: string;
  };
  /**
   * iframe.srcdoc 用の組み立て済み HTML 文字列。
   * 指定されていれば SketchPageController はこちらを優先し、path は無視する。
   * OpenProcessingSource が API レスポンスから組み立ててセットする。
   */
  srcdoc?: string;
  /** 追加メタ情報。サブヘッダ表示・ライセンス表記・proxy 有無のヒント等に使う。 */
  meta?: {
    /** 'p5js' など。OP の engine mode に対応 */
    mode?: string;
    license?: string;
    /** code 内に deckard アセットが含まれていたか (taint 警告 UI 用) */
    hasExternalAssets?: boolean;
    /** assemble 時に assetProxyBaseUrl で書き換えたか */
    proxiedAssets?: boolean;
  };
}

export interface SketchService {
  loadSketches(): Promise<Sketch[]>;
  getSketchById(id: string): Sketch | undefined;
  getAllSketches(): Sketch[];
  isReady(): boolean;
}
