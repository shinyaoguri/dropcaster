// 出力ウィンドウで押したキーを、投影中のスケッチ iframe へ届けるための部品 (#163)。
//
// 投影中のスケッチ iframe は visibility:hidden でフォーカスが入らないので、出力ウィンドウの
// key* を写し取り、iframe の document で同じ KeyboardEvent を発生させる。
// tests/ から直接 import できるよう、このファイルは他のモジュールを import しない。

/** 作品へ渡すキーイベントの値。KeyboardEvent から必要なものだけを写し取る。 */
export interface SketchKey {
  type: 'keydown' | 'keyup' | 'keypress';
  key: string;
  code: string;
  keyCode: number;
  which: number;
  charCode: number;
  location: number;
  repeat: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}

/** KeyboardEvent（または同じ名前のプロパティを持つもの）から SketchKey を作る。 */
export function toSketchKey(e: { [K in keyof SketchKey]: K extends 'type' ? string : SketchKey[K] }): SketchKey {
  return {
    type: e.type as SketchKey['type'],
    key: e.key, code: e.code, keyCode: e.keyCode, which: e.which, charCode: e.charCode,
    location: e.location, repeat: e.repeat,
    ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
    isComposing: e.isComposing,
  };
}

/**
 * 押しているキーを覚えておき、出力ウィンドウがフォーカスを失ったときにまとめて離す。
 * フォーカスが外れると keyup は出力ウィンドウに来ないので、そのままだと作品の
 * keyIsDown() が true のまま残る。
 */
export class HeldKeys {
  private readonly held = new Map<string, SketchKey>();

  /**
   * key を記録し、作品へ送るべきかを返す。keyup は対応する keydown を送ったときだけ送る
   * （出力 UI のボタン上で押し始めたキーや、releaseAll で離し済みのキーの keyup を作品へ漏らさない）。
   */
  accept(key: SketchKey): boolean {
    const id = key.code || key.key;
    if (key.type === 'keyup') return this.held.delete(id);
    if (key.type === 'keydown') this.held.set(id, key);
    return true;
  }

  /** 押しているキーそれぞれの keyup を返し、記録を空にする。 */
  releaseAll(): SketchKey[] {
    const released = [...this.held.values()].map(key => ({ ...key, type: 'keyup' as const, repeat: false }));
    this.held.clear();
    return released;
  }
}

/**
 * スケッチ iframe の中で key を発生させる。作品が preventDefault したら true を返す。
 *
 * イベントは iframe 側の KeyboardEvent で作る（作品の instanceof 判定を壊さないため）。
 * keyCode / which / charCode は KeyboardEventInit で指定できず 0 になるので上書きする。
 * p5.js 1.x はこれらで keyCode と keyIsDown() を決める。
 */
export function dispatchSketchKey(iframe: HTMLIFrameElement | null, key: SketchKey): boolean {
  if (!iframe) return false;
  let doc: Document | null;
  let win: (Window & typeof globalThis) | null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow as (Window & typeof globalThis) | null;
  } catch {
    return false; // cross-origin の作品には届けない（ADR 0001 の同一オリジン前提）
  }
  if (!doc || !win) return false;
  const { type, keyCode, which, charCode, ...init } = key;
  const event = new win.KeyboardEvent(type, { ...init, bubbles: true, cancelable: true, composed: true });
  for (const [name, value] of Object.entries({ keyCode, which, charCode })) {
    Object.defineProperty(event, name, { get: () => value });
  }
  const target = doc.activeElement ?? doc.body ?? doc;
  return !target.dispatchEvent(event);
}
