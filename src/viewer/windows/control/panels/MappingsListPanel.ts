/**
 * マッピング一覧（list アイテム）と、追加 / 削除 / 保存（export JSON）/ 読み込み（import JSON）
 * ボタンを担当する panel。tools カラム上半分の UI。
 *
 * インポート JSON や localStorage 経由で m.id / m.name に細工された文字列が混入しても
 * XSS にならないよう、`innerHTML` テンプレート補間ではなく DOM API（textContent / dataset /
 * style.setProperty）で組み立てる。
 */

import {
  isMappingEnabled,
  mappingColor,
  parseMappingsState,
  withActiveSet,
  withAddedMapping,
  withMappingRenamed,
  withMappingToggled,
  withRemovedMapping,
} from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';

export interface MappingsListPanelAttachOptions {
  /** alert ダイアログを出す window（host の defaultView）。読み込み失敗の通知に使う。 */
  getHostWin: () => Window | null;
}

export class MappingsListPanel {
  private scope: HTMLElement | null = null;
  private doc: Document | null = null;
  private ctrl: MappingsController | null = null;
  private opts: MappingsListPanelAttachOptions | null = null;

  attach(scope: HTMLElement, doc: Document, ctrl: MappingsController, opts: MappingsListPanelAttachOptions): void {
    this.scope = scope;
    this.doc = doc;
    this.ctrl = ctrl;
    this.opts = opts;
    this.wireToolButtons();
    this.rerender();
  }

  /** 親 (handleStateUpdate / replaceState) が state 変更を反映したら呼ぶ。 */
  rerender(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    const doc = this.doc;
    if (!scope || !ctrl || !doc) return;

    const state = ctrl.getState();
    const listEl = scope.querySelector('#mappings-list') as HTMLElement | null;
    if (!listEl) return;

    const canRemove = state.mappings.length > 1;
    listEl.replaceChildren();

    state.mappings.forEach((m, idx) => {
      const isActive = m.id === state.activeId;
      const enabled = isMappingEnabled(m);
      const displayName = m.name ?? `Mapping ${idx + 1}`;
      const color = mappingColor(idx);

      const item = doc.createElement('div');
      item.className = `mapping-list-item${isActive ? ' active' : ''}${enabled ? '' : ' disabled'}`;
      item.dataset.id = m.id;
      item.style.setProperty('--mapping-color', color);

      const chip = doc.createElement('span');
      chip.className = 'color-chip';
      item.appendChild(chip);

      const nameSpan = doc.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = displayName;
      item.appendChild(nameSpan);

      const toggleBtn = doc.createElement('button');
      toggleBtn.className = `toggle-btn${enabled ? ' enabled' : ''}`;
      toggleBtn.dataset.id = m.id;
      toggleBtn.title = enabled ? '出力中（クリックで停止）' : '停止中（クリックで出力）';
      toggleBtn.textContent = enabled ? '●' : '○';
      item.appendChild(toggleBtn);

      const removeBtn = doc.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.dataset.id = m.id;
      removeBtn.title = '削除';
      removeBtn.textContent = '×';
      if (!canRemove) removeBtn.disabled = true;
      item.appendChild(removeBtn);

      listEl.appendChild(item);
    });

    listEl.querySelectorAll<HTMLDivElement>('.mapping-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('remove-btn')) return;
        if (target.classList.contains('toggle-btn')) return;
        const id = item.dataset.id!;
        const cur = ctrl.getState();
        if (id !== cur.activeId) {
          ctrl.replaceState(withActiveSet(cur, id));
        }
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id!;
        ctrl.replaceState(withMappingToggled(ctrl.getState(), id));
      });
    });

    listEl.querySelectorAll<HTMLSpanElement>('.mapping-list-item .name').forEach(nameSpan => {
      nameSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const itemEl = nameSpan.closest('.mapping-list-item') as HTMLDivElement | null;
        const id = itemEl?.dataset.id;
        if (!id) return;
        this.startInlineRename(nameSpan, id);
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id!;
        ctrl.replaceState(withRemovedMapping(ctrl.getState(), id));
      });
    });
  }

  destroy(): void {
    this.scope = null;
    this.doc = null;
    this.ctrl = null;
    this.opts = null;
  }

  private wireToolButtons(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    if (!scope || !ctrl) return;

    const addBtn = scope.querySelector('#add-mapping-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        ctrl.replaceState(withAddedMapping(ctrl.getState()));
      });
    }

    const exportBtn = scope.querySelector('#export-mappings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportToFile());
    }

    const importBtn = scope.querySelector('#import-mappings-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this.importFromFile());
    }
  }

  private exportToFile(): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    if (!doc || !ctrl) return;
    const json = JSON.stringify(ctrl.getState(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `dropcaster-mappings-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importFromFile(): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!doc || !ctrl || !opts) return;
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text()
        .then(text => {
          try {
            const parsed = parseMappingsState(JSON.parse(text));
            if (!parsed) {
              opts.getHostWin()?.alert('読み込みに失敗しました（フォーマット不正）');
              return;
            }
            ctrl.replaceState(parsed);
          } catch (error) {
            opts.getHostWin()?.alert('読み込みに失敗しました（JSON 解析失敗）');
            console.error('MappingsListPanel: JSON parse error', error);
          }
        })
        .catch(error => {
          console.error('MappingsListPanel: file read error', error);
        });
    });
    input.click();
  }

  private startInlineRename(nameSpan: HTMLElement, id: string): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    if (!doc || !ctrl) return;
    const input = doc.createElement('input');
    input.className = 'name-input';
    input.type = 'text';
    input.value = nameSpan.textContent ?? '';
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      ctrl.replaceState(withMappingRenamed(ctrl.getState(), id, input.value));
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      this.rerender(); // 元の表示に戻す
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
  }
}
