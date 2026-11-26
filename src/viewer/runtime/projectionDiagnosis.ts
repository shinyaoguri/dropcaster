import { t } from '../i18n/index.js';

/**
 * 投影が映らないときの原因を、観測できた事実だけで表す状態モデル (#196)。
 *
 * - 作品側 (ソース) は WindowController が iframe の <canvas> と captureStream の経過から決める。
 * - 出力側は出力ウィンドウの開閉と、出力の <video>.play() の結果から決める。
 *
 * 黒いピクセルが続く・canvas の更新が無いといった推定は状態にしない (静止した作品を失敗と言わない)。
 * #121 の準備完了の判定も、このモデルと {@link sourceDiagnosisLevel} / {@link outputDiagnosisLevel} を読む想定。
 */
export type SourceDiagnosis =
  /** 配信していない (マッピングを開いていない)。 */
  | { kind: 'idle' }
  /** 作品の読み込み・canvas の出現を待っている。 */
  | { kind: 'waiting' }
  /** 待ち時間を過ぎても作品の document に <canvas> が無い。 */
  | { kind: 'noCanvas' }
  /** canvas.captureStream() が例外を投げた・MediaStream を返さなかった。error は例外名。 */
  | { kind: 'captureFailed'; error: string }
  /** captureStream の video track が終了・mute したので取り直している。 */
  | { kind: 'recapturing' }
  /** テストパターンを映している (作品は映していないが、失敗ではない)。 */
  | { kind: 'testPattern' }
  /** 作品の最初の <canvas> を映している。canvasCount は document 内の <canvas> の数。 */
  | { kind: 'ok'; canvasCount: number };

export type OutputDiagnosis =
  /** 出力ウィンドウを開いていない。 */
  | { kind: 'notOpen' }
  /** 出力ウィンドウが開いていて、再生の失敗は観測していない。 */
  | { kind: 'open' }
  /** 出力ウィンドウの <video>.play() が拒否された。error は例外名。 */
  | { kind: 'playError'; error: string };

/** 出力 id → 出力側の状態。state.outputs の全出力を持つ。 */
export type OutputDiagnosisMap = Record<string, OutputDiagnosis>;

/** 正常 / 未確認 (まだ分からない・始まっていない) / 注意 / 失敗。 */
export type DiagnosisLevel = 'ok' | 'pending' | 'notice' | 'error';

export function sourceDiagnosisLevel(d: SourceDiagnosis): DiagnosisLevel {
  switch (d.kind) {
    case 'ok': return d.canvasCount > 1 ? 'notice' : 'ok';
    case 'testPattern': return 'ok';
    case 'idle':
    case 'waiting': return 'pending';
    case 'recapturing': return 'notice';
    case 'noCanvas':
    case 'captureFailed': return 'error';
  }
}

export function outputDiagnosisLevel(d: OutputDiagnosis): DiagnosisLevel {
  switch (d.kind) {
    case 'open': return 'ok';
    case 'notOpen': return 'pending';
    case 'playError': return 'error';
  }
}

/** 例外から表示用の名前を取り出す (DOMException は別 realm でも name を持つ)。 */
export function diagnosisErrorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name ? name : 'Error';
}

export interface DiagnosisMessage {
  /** 観測した事実。 */
  text: string;
  /** 対処。 */
  hint?: string;
}

/** ソース列に出す文。映していて canvas が 1 枚だけのときなど、知らせることが無ければ null。 */
export function sourceDiagnosisMessage(d: SourceDiagnosis, size: { width: number; height: number }): DiagnosisMessage | null {
  switch (d.kind) {
    case 'waiting': return { text: t('diagnosis.source.waiting') };
    case 'noCanvas': return { text: t('diagnosis.source.noCanvas'), hint: t('diagnosis.source.noCanvasHint') };
    case 'captureFailed': return {
      text: t('diagnosis.source.captureFailed', { error: d.error }),
      // captureStream の SecurityError は canvas が origin-clean でないとき (仕様) にだけ起きる。
      hint: t(d.error === 'SecurityError' ? 'diagnosis.source.securityHint' : 'diagnosis.source.captureFailedHint'),
    };
    case 'recapturing': return { text: t('diagnosis.source.recapturing') };
    case 'ok': return d.canvasCount > 1
      ? { text: t('diagnosis.source.multipleCanvases', { count: d.canvasCount, width: size.width, height: size.height }) }
      : null;
    case 'idle':
    case 'testPattern': return null;
  }
}

/** 出力一覧の行に出す文。開いていて再生の失敗が無ければ null。 */
export function outputDiagnosisMessage(d: OutputDiagnosis): DiagnosisMessage | null {
  switch (d.kind) {
    case 'notOpen': return { text: t('diagnosis.output.notOpen') };
    case 'playError': return {
      text: t('diagnosis.output.playError', { error: d.error }),
      // play() の NotAllowedError は、ブラウザが自動再生を許していないときに返る。
      hint: t(d.error === 'NotAllowedError' ? 'diagnosis.output.notAllowedHint' : 'diagnosis.output.playErrorHint'),
    };
    case 'open': return null;
  }
}
