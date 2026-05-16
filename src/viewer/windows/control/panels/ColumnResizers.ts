/**
 * 3 カラム（tool / source / mapping）の間に置かれた .dc-column-resizer を
 * マウスでドラッグして幅を調整するための panel。state とは完全に独立で、
 * localStorage に保存・次回マウント時に復元する。
 *
 *   - tool 側リサイザ: tool-column の width を直接書き換える（min/max は CSS でクランプ）。
 *     source・mapping は flex で残りを分け合う。
 *   - source 側リサイザ: source-column の flex-basis を書き換えて source vs mapping の
 *     比率を変える。mapping は flex 維持で残りを取る。
 */

import { CleanupStack } from '../../../utils/cleanupStack';

const STORAGE_KEY = 'dropcaster.control.columnWidths.v1';

export class ColumnResizers {
  /** attach 時に追加した listener / 進行中の drag を撤去するためのフック群。 */
  private cleanups = new CleanupStack();

  attach(scope: HTMLElement, doc: Document): void {
    const toolCol = scope.querySelector<HTMLElement>('.tool-column');
    const sourceCol = scope.querySelector<HTMLElement>('.source-column');
    const mappingCol = scope.querySelector<HTMLElement>('.mapping-column');
    if (!toolCol || !sourceCol || !mappingCol) return;

    this.restoreColumnWidths(toolCol, sourceCol);

    scope.querySelectorAll<HTMLElement>('.dc-column-resizer').forEach(resizer => {
      const edge = resizer.dataset.resizeEdge;
      if (edge !== 'tool' && edge !== 'source') return;

      const onMouseDown = (e: MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startToolW = toolCol.getBoundingClientRect().width;
        const startSourceW = sourceCol.getBoundingClientRect().width;
        const startMappingW = mappingCol.getBoundingClientRect().width;
        resizer.classList.add('dragging');
        const prevCursor = doc.body.style.cursor;
        const prevUserSelect = doc.body.style.userSelect;
        doc.body.style.cursor = 'col-resize';
        doc.body.style.userSelect = 'none';

        // source / mapping 両方に同じ JS 側の最低幅を課す（CSS min-width はさらに上から効く）。
        // 右方向の上限は「いまの mapping 幅をこの最低幅まで縮められる量」で決まる。
        const MIN_COL_W = 280;

        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          if (edge === 'tool') {
            toolCol.style.width = `${Math.max(180, startToolW + dx)}px`;
          } else {
            const maxDx = Math.max(0, startMappingW - MIN_COL_W);
            const clampedDx = Math.min(dx, maxDx);
            const nextSourceW = Math.max(MIN_COL_W, startSourceW + clampedDx);
            sourceCol.style.flex = '0 0 auto';
            sourceCol.style.width = `${nextSourceW}px`;
          }
        };

        const finish = () => {
          resizer.classList.remove('dragging');
          doc.body.style.cursor = prevCursor;
          doc.body.style.userSelect = prevUserSelect;
          doc.removeEventListener('mousemove', onMove);
          doc.removeEventListener('mouseup', finish);
          this.persistColumnWidths(toolCol, sourceCol);
          // drag が綺麗に終わったので cleanups からも外す（destroy で二重呼びさせない）
          this.cleanups.remove(finish);
        };

        doc.addEventListener('mousemove', onMove);
        doc.addEventListener('mouseup', finish);
        // route 切替などで destroy() が来ても進行中の drag を確実に畳む
        this.cleanups.push(finish);
      };

      resizer.addEventListener('mousedown', onMouseDown);
      this.cleanups.push(() => resizer.removeEventListener('mousedown', onMouseDown));
    });
  }

  destroy(): void {
    // 進行中の drag があれば finish() で listener も body style も戻る
    this.cleanups.runAll();
  }

  private persistColumnWidths(toolCol: HTMLElement, sourceCol: HTMLElement): void {
    try {
      const payload = {
        tool: toolCol.getBoundingClientRect().width,
        source: sourceCol.getBoundingClientRect().width,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* ignore quota / private mode */ }
  }

  private restoreColumnWidths(toolCol: HTMLElement, sourceCol: HTMLElement): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { tool?: number; source?: number };
      if (typeof data.tool === 'number' && data.tool > 0) {
        toolCol.style.width = `${data.tool}px`;
      }
      if (typeof data.source === 'number' && data.source > 0) {
        sourceCol.style.flex = '0 0 auto';
        sourceCol.style.width = `${data.source}px`;
      }
    } catch { /* ignore parse error */ }
  }
}
