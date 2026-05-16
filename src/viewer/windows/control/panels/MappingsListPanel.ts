/**
 * マッピング一覧（出力ごとにグループ化）と、出力／マッピングの追加・削除・export/import
 * ボタンを担当する panel。tools カラム上半分の UI。
 *
 * 構造:
 *   - 出力ごとに `.output-group` ヘッダ（名前・開閉ボタン・削除）
 *     - その下に所属 mapping の list と、その出力に mapping を足す `+` ボタン
 *   - 全体下に `+ 出力を追加` と export/import ボタン
 *
 * インポート JSON や localStorage 経由で m.id / m.name に細工された文字列が混入しても
 * XSS にならないよう、`innerHTML` テンプレート補間ではなく DOM API（textContent / dataset /
 * style.setProperty）で組み立てる。
 */

import {
  MAX_OUTPUTS,
  isMappingEnabled,
  mappingColor,
  parseMappingsState,
  withActiveOutputSet,
  withActiveSet,
  withAddedMapping,
  withAddedOutput,
  withMappingRenamed,
  withMappingToggled,
  withOutputRenamed,
  withRemovedMapping,
  withRemovedOutput,
} from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';

export interface MappingsListPanelAttachOptions {
  /** alert ダイアログを出す window（host の defaultView）。読み込み失敗の通知に使う。 */
  getHostWin: () => Window | null;
  /** 出力ウィンドウを開く／閉じる（ControlHost 経由）。 */
  openOutputWindow: (outputId: string) => void;
  closeOutputWindow: (outputId: string) => void;
  /** 出力ウィンドウが開いているかの問い合わせ（ヘッダの「開く／閉じる」表示用）。 */
  isOutputWindowOpen: (outputId: string) => boolean;
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
    const opts = this.opts;
    if (!scope || !ctrl || !doc || !opts) return;

    const state = ctrl.getState();
    const listEl = scope.querySelector('#mappings-list') as HTMLElement | null;
    if (!listEl) return;

    listEl.replaceChildren();

    // インデックス（mapping color 計算用 — 全 state.mappings 上の位置）
    const indexById = new Map<string, number>();
    state.mappings.forEach((m, i) => indexById.set(m.id, i));

    const canRemoveMapping = state.mappings.length > 1;
    const canRemoveOutput = state.outputs.length > 1;
    const canAddMapping = true; // 個数上限は無いので常に true

    for (const out of state.outputs) {
      const isActiveOutput = state.activeOutputId === out.id;
      const group = doc.createElement('div');
      group.className = `output-group${isActiveOutput ? ' active' : ''}`;
      group.dataset.outputId = out.id;

      // ── ヘッダ ──
      const header = doc.createElement('div');
      header.className = 'output-group-header';

      const isOpen = opts.isOutputWindowOpen(out.id);
      const statusBadge = doc.createElement('span');
      statusBadge.className = `output-window-status${isOpen ? ' open' : ''}`;
      statusBadge.textContent = isOpen ? '●' : '○';
      header.appendChild(statusBadge);

      const nameSpan = doc.createElement('span');
      nameSpan.className = 'output-name';
      nameSpan.textContent = out.name ?? out.id;
      nameSpan.title = '出力名（ダブルクリックで編集）';
      header.appendChild(nameSpan);

      const openBtn = doc.createElement('button');
      openBtn.className = `open-btn${isOpen ? ' is-open' : ''}`;
      openBtn.dataset.outputId = out.id;
      openBtn.textContent = isOpen ? '閉じる' : '開く';
      openBtn.title = isOpen ? 'この出力ウィンドウを閉じる' : 'この出力をポップアウトで開く';
      header.appendChild(openBtn);

      const removeOutputBtn = doc.createElement('button');
      removeOutputBtn.className = 'remove-output-btn';
      removeOutputBtn.dataset.outputId = out.id;
      removeOutputBtn.textContent = '×';
      removeOutputBtn.title = canRemoveOutput
        ? 'この出力を削除（mapping は最初の出力へ移籍）'
        : '最後の出力は削除できません';
      removeOutputBtn.disabled = !canRemoveOutput;
      header.appendChild(removeOutputBtn);

      group.appendChild(header);

      // ── mappings ──
      const mappingsWrap = doc.createElement('div');
      mappingsWrap.className = 'output-group-mappings';

      const owned = state.mappings.filter(m => m.outputId === out.id);
      for (const m of owned) {
        const idx = indexById.get(m.id) ?? 0;
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

        const mappingNameSpan = doc.createElement('span');
        mappingNameSpan.className = 'name';
        mappingNameSpan.textContent = displayName;
        item.appendChild(mappingNameSpan);

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
        if (!canRemoveMapping) removeBtn.disabled = true;
        item.appendChild(removeBtn);

        mappingsWrap.appendChild(item);
      }

      const addHereBtn = doc.createElement('button');
      addHereBtn.className = 'add-mapping-here-btn';
      addHereBtn.dataset.outputId = out.id;
      addHereBtn.textContent = `＋ この出力に mapping を追加`;
      addHereBtn.disabled = !canAddMapping;
      mappingsWrap.appendChild(addHereBtn);

      group.appendChild(mappingsWrap);
      listEl.appendChild(group);
    }

    this.wireListInteractions();
  }

  destroy(): void {
    this.scope = null;
    this.doc = null;
    this.ctrl = null;
    this.opts = null;
  }

  // ── イベント wiring ─────────────────────────────────────────

  private wireToolButtons(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    if (!scope || !ctrl) return;

    const addOutputBtn = scope.querySelector('#add-output-btn');
    if (addOutputBtn) {
      addOutputBtn.addEventListener('click', () => {
        const before = ctrl.getState();
        const next = withAddedOutput(before);
        if (next === before) return; // MAX_OUTPUTS で頭打ち — no-op
        ctrl.replaceState(next);
        // 直後に同じ user gesture でポップアウトを開く（ユーザの「増やすと出る」期待に合わせる）。
        // next.activeOutputId は withAddedOutput が新規 id を入れている。
        const newId = next.activeOutputId;
        if (newId) this.opts?.openOutputWindow(newId);
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

  /** rerender 後の listEl の中のボタン／要素に handler を張る。 */
  private wireListInteractions(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!scope || !ctrl || !opts) return;
    const listEl = scope.querySelector('#mappings-list') as HTMLElement | null;
    if (!listEl) return;

    // mapping-list-item のアクティブ化（toggle / remove ボタンは除外）
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
        this.startInlineMappingRename(nameSpan, id);
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id!;
        ctrl.replaceState(withRemovedMapping(ctrl.getState(), id));
      });
    });

    // output-group ヘッダ
    listEl.querySelectorAll<HTMLButtonElement>('.open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const outputId = btn.dataset.outputId!;
        if (opts.isOutputWindowOpen(outputId)) {
          opts.closeOutputWindow(outputId);
        } else {
          opts.openOutputWindow(outputId);
        }
        // 開閉直後の表示更新
        this.rerender();
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>('.remove-output-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const outputId = btn.dataset.outputId!;
        ctrl.replaceState(withRemovedOutput(ctrl.getState(), outputId));
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>('.add-mapping-here-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const outputId = btn.dataset.outputId!;
        const s1 = withActiveOutputSet(ctrl.getState(), outputId);
        ctrl.replaceState(withAddedMapping(s1));
      });
    });

    listEl.querySelectorAll<HTMLSpanElement>('.output-group-header .output-name').forEach(nameSpan => {
      nameSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const groupEl = nameSpan.closest('.output-group') as HTMLDivElement | null;
        const outputId = groupEl?.dataset.outputId;
        if (!outputId) return;
        this.startInlineOutputRename(nameSpan, outputId);
      });
      // クリックで activeOutputId を設定（次の add mapping の宛先）
      nameSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupEl = nameSpan.closest('.output-group') as HTMLDivElement | null;
        const outputId = groupEl?.dataset.outputId;
        if (!outputId) return;
        ctrl.replaceState(withActiveOutputSet(ctrl.getState(), outputId));
      });
    });

    // 出力追加ボタンを再評価（MAX_OUTPUTS で disable）
    const addOutputBtn = scope.querySelector('#add-output-btn') as HTMLButtonElement | null;
    if (addOutputBtn) {
      addOutputBtn.disabled = ctrl.getState().outputs.length >= MAX_OUTPUTS;
    }
  }

  // ── インライン rename ────────────────────────────────────────

  private startInlineMappingRename(nameSpan: HTMLElement, id: string): void {
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
      this.rerender();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
  }

  private startInlineOutputRename(nameSpan: HTMLElement, outputId: string): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    if (!doc || !ctrl) return;
    const input = doc.createElement('input');
    input.className = 'output-name-input';
    input.type = 'text';
    input.value = nameSpan.textContent ?? '';
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      ctrl.replaceState(withOutputRenamed(ctrl.getState(), outputId, input.value));
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      this.rerender();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
  }

  // ── export / import ───────────────────────────────────────────

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
}
