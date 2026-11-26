/**
 * 投影が映らないときの原因を操作画面に出す panel (#196)。
 *
 *   - #dc-source-status  ← ソース列の見出しの下。作品側の状態 (canvas 待ち・canvas なし・capture 失敗・
 *                          取り直し中・canvas が複数) と対処を出す。映していて知らせることが無いときは隠す。
 *   - 出力一覧の各行      ← 出力側の状態は MappingsListPanel が描く。ここは変化を知らせるだけ。
 *
 * WebGL コンテキストのロスト中は上端の警告の帯が原因と対処を示すので、ソース列には重ねて出さない。
 * 文言は言語を切り替えると描き直す。
 */

import { onLangChange } from '../../../i18n/index.js';
import {
  sourceDiagnosisLevel,
  sourceDiagnosisMessage,
  type SourceDiagnosis,
} from '../../../runtime/projectionDiagnosis';
import type { ControlHost, Unsubscribe } from '../ControlHost';

export interface ProjectionDiagnosisPanelOptions {
  /** 出力側の状態が変わったとき (出力一覧を描き直す)。 */
  onOutputDiagnosisChange: () => void;
}

export class ProjectionDiagnosisPanel {
  private host: ControlHost | null = null;
  private unsubs: Unsubscribe[] = [];
  private webglLost = false;

  attach(host: ControlHost, opts: ProjectionDiagnosisPanelOptions): void {
    this.destroy();
    this.host = host;
    this.unsubs.push(
      host.onSourceDiagnosisChange(() => this.render()),
      host.onVideoDimensionsChange(() => this.render()),
      host.onWebglContextChange(status => { this.webglLost = status === 'lost'; this.render(); }),
      host.onOutputDiagnosisChange(() => opts.onOutputDiagnosisChange()),
      onLangChange(() => this.render()),
    );
    this.render();
  }

  /** ソース列の案内を、いまの作品側の状態に合わせて描き直す。 */
  render(): void {
    const host = this.host;
    const el = host?.host.querySelector<HTMLElement>('#dc-source-status');
    if (!host || !el) return;
    const diagnosis: SourceDiagnosis = host.getSourceDiagnosis();
    const message = this.webglLost ? null : sourceDiagnosisMessage(diagnosis, host.getVideoDimensions());
    el.dataset.kind = diagnosis.kind;
    el.dataset.level = sourceDiagnosisLevel(diagnosis);
    el.hidden = !message;
    const text = el.querySelector('.dc-source-status-text');
    const hint = el.querySelector<HTMLElement>('.dc-source-status-hint');
    if (text) text.textContent = message?.text ?? '';
    if (hint) {
      hint.textContent = message?.hint ?? '';
      hint.hidden = !message?.hint;
    }
  }

  destroy(): void {
    this.unsubs.forEach(u => { try { u(); } catch { /* ignore */ } });
    this.unsubs = [];
    this.host = null;
    this.webglLost = false;
  }
}
