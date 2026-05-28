/**
 * tool カラム内の一覧 + アクションをまとめて担当する panel。テンプレートに既に存在する
 * 以下の DOM をクエリして wire する:
 *
 *   - #outputs-list     ← 出力ごとに 1 行（名前 / 開閉ボタン / 削除）を埋める
 *   - #add-output-btn   ← クリックで withAddedOutput
 *   - #mappings-list    ← mapping を全件フラットに列挙（色 / 名前 / enable / 削除）
 *   - #add-mapping-btn  ← クリックで withAddedMapping
 *   - #export-settings-btn / #import-settings-btn ← 全設定 (MappingsState) の JSON 書出 / 読込
 *
 * 出力管理とマッピング管理は独立した存在として扱う。マッピングがどの出力に映るかは
 * 仮想キャンバス上の quad 座標と各出力の bounds の交差で自動的に決まるので、UI でも
 * 所属関係を表現しない。
 *
 * インポート JSON や localStorage 経由で m.id / m.name に細工された文字列が混入しても
 * XSS にならないよう、`innerHTML` テンプレート補間ではなく DOM API（textContent / dataset /
 * style.setProperty）で組み立てる。
 *
 * rerender は outputs / mappings 別の signature memoize で間引く。出力レイアウトの drag のように
 * tool 列の表示に影響しない変化では DOM rebuild が走らない（フリッカ回避）。
 */

import {
  MAX_OUTPUTS,
  isMappingEnabled,
  isMaskEntry,
  mappingColor,
  parseMappingsState,
  withActiveOutputSet,
  withActiveSet,
  withAddedMapping,
  withAddedMask,
  withAddedOutput,
  withMappingRenamed,
  withMappingReordered,
  withMappingToggled,
  withOutputRenamed,
  withRemovedMapping,
  withRemovedOutput,
} from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';
import { t } from '../../../i18n/index.js';

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
  /**
   * 直近の rerender で使った state の構造シグネチャ（outputs / mappings 別々）。
   * 出力レイアウト drag のように tool 列に映らない変化（position/size 等）では rerender を
   * スキップして DOM rebuild = 一瞬のフリッカを避ける。outputs と mappings を別に持つことで、
   * 片方だけ変わった時に他方を無駄に作り直すのも防ぐ。
   */
  private lastOutputsSig: string | null = null;
  private lastMappingsSig: string | null = null;

  attach(scope: HTMLElement, doc: Document, ctrl: MappingsController, opts: MappingsListPanelAttachOptions): void {
    this.scope = scope;
    this.doc = doc;
    this.ctrl = ctrl;
    this.opts = opts;
    this.wireToolButtons();
    this.rerender();
  }

  /**
   * 親 (handleStateUpdate / replaceState) が state 変更を反映したら呼ぶ。
   * tool 列の表示に影響する場（出力 ID/name、open/close 状態、active output、mapping ID/name/
   * enabled、active mapping）が変わったときだけ該当セクションの DOM を作り直す。
   */
  rerender(): void {
    const oSig = this.computeOutputsSig();
    if (oSig !== this.lastOutputsSig) {
      this.lastOutputsSig = oSig;
      this.renderOutputsSection();
    }
    const mSig = this.computeMappingsSig();
    if (mSig !== this.lastMappingsSig) {
      this.lastMappingsSig = mSig;
      this.renderMappingsSection();
    }
  }

  /** signature を null に戻して次回 rerender を強制的に走らせる（DOM 破棄後など）。 */
  invalidate(): void {
    this.lastOutputsSig = null;
    this.lastMappingsSig = null;
  }

  private computeOutputsSig(): string {
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!ctrl || !opts) return '';
    const state = ctrl.getState();
    const outputs = state.outputs
      .map(o => `${o.id}:${o.name ?? ''}:${opts.isOutputWindowOpen(o.id) ? 1 : 0}`)
      .join('|');
    return `${state.activeOutputId ?? ''}|${state.outputs.length}|${outputs}`;
  }

  private computeMappingsSig(): string {
    const ctrl = this.ctrl;
    if (!ctrl) return '';
    const state = ctrl.getState();
    // drafting フラグも sig に含める — ペン描画開始 / 終了で行のロック表示が切替わる必要があるため。
    const mappings = state.mappings
      .map(m => `${isMaskEntry(m) ? (m.drafting ? 'd' : 'k') : 'm'}:${m.id}:${m.name ?? ''}:${isMappingEnabled(m) ? 1 : 0}`)
      .join('|');
    return `${state.activeId}|${state.mappings.length}|${mappings}`;
  }

  /** ペン描画（drafting マスクが active）中かを返す。 */
  private isPenDrafting(): boolean {
    const ctrl = this.ctrl;
    if (!ctrl) return false;
    const state = ctrl.getState();
    const active = state.mappings.find(m => m.id === state.activeId);
    return !!active && isMaskEntry(active) && !!active.drafting;
  }

  destroy(): void {
    this.scope = null;
    this.doc = null;
    this.ctrl = null;
    this.opts = null;
  }

  // ── 出力セクション ───────────────────────────────────────────

  private renderOutputsSection(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    const doc = this.doc;
    const opts = this.opts;
    if (!scope || !ctrl || !doc || !opts) return;
    const listEl = scope.querySelector('#outputs-list') as HTMLElement | null;
    if (!listEl) return;

    const state = ctrl.getState();
    listEl.replaceChildren();

    const canRemoveOutput = state.outputs.length > 1;

    for (const out of state.outputs) {
      const isActiveOutput = state.activeOutputId === out.id;
      const isOpen = opts.isOutputWindowOpen(out.id);

      const row = doc.createElement('div');
      row.className = `output-item${isActiveOutput ? ' active' : ''}`;
      row.dataset.outputId = out.id;

      const statusBadge = doc.createElement('span');
      statusBadge.className = `output-window-status${isOpen ? ' open' : ''}`;
      statusBadge.textContent = isOpen ? '●' : '○';
      row.appendChild(statusBadge);

      const nameSpan = doc.createElement('span');
      nameSpan.className = 'output-name';
      nameSpan.textContent = out.name ?? out.id;
      nameSpan.title = t('mappingsList.name.title');
      row.appendChild(nameSpan);

      const openBtn = doc.createElement('button');
      openBtn.className = `open-btn${isOpen ? ' is-open' : ''}`;
      openBtn.textContent = isOpen ? t('mappingsList.close') : t('mappingsList.open');
      openBtn.title = isOpen ? t('mappingsList.close.title') : t('mappingsList.open.title');
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (opts.isOutputWindowOpen(out.id)) {
          opts.closeOutputWindow(out.id);
        } else {
          opts.openOutputWindow(out.id);
        }
        this.rerender();
      });
      row.appendChild(openBtn);

      const removeBtn = doc.createElement('button');
      removeBtn.className = 'remove-output-btn';
      removeBtn.textContent = '×';
      removeBtn.title = canRemoveOutput
        ? t('mappingsList.remove.output.title')
        : t('mappingsList.remove.output.disabled');
      removeBtn.disabled = !canRemoveOutput;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ctrl.replaceState(withRemovedOutput(ctrl.getState(), out.id));
      });
      row.appendChild(removeBtn);

      // 行全体クリック / 名前クリックで activeOutputId 切替
      nameSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        ctrl.replaceState(withActiveOutputSet(ctrl.getState(), out.id));
      });
      nameSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startInlineOutputRename(nameSpan, out.id);
      });

      listEl.appendChild(row);
    }

    // 出力追加ボタンの enable/disable
    const addOutputBtn = scope.querySelector('#add-output-btn') as HTMLButtonElement | null;
    if (addOutputBtn) {
      addOutputBtn.disabled = state.outputs.length >= MAX_OUTPUTS;
    }
  }

  // ── マッピングセクション ─────────────────────────────────────

  private renderMappingsSection(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    const doc = this.doc;
    if (!scope || !ctrl || !doc) return;
    const listEl = scope.querySelector('#mappings-list') as HTMLElement | null;
    if (!listEl) return;

    const state = ctrl.getState();
    listEl.replaceChildren();

    const canRemoveMapping = state.mappings.length > 1;
    const penDrafting = this.isPenDrafting();
    // 同 kind 内での通し番号（"Mapping 1, 2, ..." / "Mask 1, 2, ..."）を作るためのカウンタ
    let mappingNum = 0;
    let maskNum = 0;

    state.mappings.forEach((m, idx) => {
      const mask = isMaskEntry(m);
      if (mask) maskNum += 1; else mappingNum += 1;
      const isActive = m.id === state.activeId;
      const enabled = isMappingEnabled(m);
      const fallbackName = mask ? `Mask ${maskNum}` : `Mapping ${mappingNum}`;
      const displayName = m.name ?? fallbackName;
      const color = mappingColor(idx);

      const item = doc.createElement('div');
      item.className = `mapping-list-item${isActive ? ' active' : ''}${enabled ? '' : ' disabled'}${mask ? ' is-mask' : ''}`;
      item.dataset.id = m.id;
      item.dataset.index = String(idx);
      item.style.setProperty('--mapping-color', color);
      // ペン描画中は他項目への切替・並び替えをロック（active な drafting マスクは draggable のまま）。
      const isLocked = penDrafting && !isActive;
      item.draggable = !isLocked;
      item.title = isLocked
        ? t('mappingsList.locked.title')
        : t('mappingsList.drag.title');

      const handle = doc.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '⋮⋮';
      handle.setAttribute('aria-hidden', 'true');
      item.appendChild(handle);

      const chip = doc.createElement('span');
      chip.className = `color-chip${mask ? ' mask' : ''}`;
      item.appendChild(chip);

      const nameSpan = doc.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = displayName;
      item.appendChild(nameSpan);

      if (mask) {
        const kindBadge = doc.createElement('span');
        kindBadge.className = 'kind-badge';
        kindBadge.textContent = t('mappingsList.maskKind');
        item.appendChild(kindBadge);
      }

      const toggleBtn = doc.createElement('button');
      toggleBtn.className = `toggle-btn${enabled ? ' enabled' : ''}`;
      toggleBtn.title = enabled ? t('mappingsList.enabled.title') : t('mappingsList.disabled.title');
      toggleBtn.textContent = enabled ? '●' : '○';
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ctrl.replaceState(withMappingToggled(ctrl.getState(), m.id));
      });
      item.appendChild(toggleBtn);

      const removeBtn = doc.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.title = t('mappingsList.remove');
      removeBtn.textContent = '×';
      removeBtn.disabled = !canRemoveMapping;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ctrl.replaceState(withRemovedMapping(ctrl.getState(), m.id));
      });
      item.appendChild(removeBtn);

      // 行クリックで active 切替（ペン描画中は他項目へ切替えない）
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('remove-btn')) return;
        if (target.classList.contains('toggle-btn')) return;
        if (target.tagName === 'INPUT') return;
        if (this.isPenDrafting()) {
          const cur = ctrl.getState();
          if (m.id !== cur.activeId) return; // 別項目への切替はブロック
        }
        const cur = ctrl.getState();
        if (m.id !== cur.activeId) {
          ctrl.replaceState(withActiveSet(cur, m.id));
        }
      });

      // 名前のダブルクリックでインライン rename
      nameSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startInlineMappingRename(nameSpan, m.id);
      });

      // --- HTML5 drag and drop による並べ替え ---
      item.addEventListener('dragstart', (e) => {
        // ペン描画中は他項目へのドラッグ操作もキャンセル（自身が drafting active なら通す）
        if (this.isPenDrafting() && !isActive) {
          e.preventDefault();
          return;
        }
        const dt = e.dataTransfer;
        if (dt) {
          dt.effectAllowed = 'move';
          // text/plain を入れないと Firefox は drag を始めないので、id を入れておく
          dt.setData('text/plain', m.id);
        }
        item.classList.add('dragging');
        listEl.classList.add('reordering');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        listEl.classList.remove('reordering');
        listEl.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target', 'before', 'after'));
      });
      item.addEventListener('dragover', (e) => {
        if (this.isPenDrafting()) return; // ペン描画中は drop を受けない
        e.preventDefault(); // drop を有効にするためには必須
        const dt = e.dataTransfer;
        if (dt) dt.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        // 視覚的フィードバック: 行の上半分 = before、下半分 = after
        listEl.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target', 'before', 'after'));
        item.classList.add('drop-target', before ? 'before' : 'after');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drop-target', 'before', 'after');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromId = e.dataTransfer?.getData('text/plain');
        if (!fromId || fromId === m.id) return;
        const rect = item.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        const cur = ctrl.getState();
        const fromIdx = cur.mappings.findIndex(x => x.id === fromId);
        if (fromIdx < 0) return;
        let toIdx = idx;
        if (!before) toIdx = idx + 1;
        // 自分より前から自分の後ろに移すときは、from を抜いた後の index を補正
        if (fromIdx < toIdx) toIdx -= 1;
        ctrl.replaceState(withMappingReordered(cur, fromId, toIdx));
      });

      listEl.appendChild(item);
    });
  }

  // ── ツールボタン（add/export/import） ───────────────────────

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
        const newId = next.activeOutputId;
        if (newId) this.opts?.openOutputWindow(newId);
      });
    }

    const addMappingBtn = scope.querySelector('#add-mapping-btn');
    if (addMappingBtn) {
      addMappingBtn.addEventListener('click', () => {
        ctrl.replaceState(withAddedMapping(ctrl.getState()));
      });
    }

    const addMaskBtn = scope.querySelector('#add-mask-btn');
    if (addMaskBtn) {
      addMaskBtn.addEventListener('click', () => {
        ctrl.replaceState(withAddedMask(ctrl.getState()));
      });
    }

    // 全設定の保存・読み込み（マッピングだけでなく outputs / source rect / canvas を含む
     // MappingsState 全体を 1 つの JSON にする）。
    const exportBtn = scope.querySelector('#export-settings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportToFile());
    }

    const importBtn = scope.querySelector('#import-settings-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this.importFromFile());
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
      // 名前が同一でも DOM は <input> に置換済みなので必ず rebuild させる
      this.invalidate();
      ctrl.replaceState(withMappingRenamed(ctrl.getState(), id, input.value));
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      this.invalidate();
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
      // 名前が同一でも DOM は <input> に置換済みなので必ず rebuild させる
      this.invalidate();
      ctrl.replaceState(withOutputRenamed(ctrl.getState(), outputId, input.value));
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      this.invalidate();
      this.rerender();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
  }

  // ── export / import ───────────────────────────────────────────
  // ファイルには MappingsState 全体（outputs / canvas / mappings / activeId 等）を入れる。
  // つまり「マッピング」だけでなく出力レイアウトとソース選択も同じファイルに含まれる。

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
    a.download = `dropcaster-settings-${ts}.json`;
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
              opts.getHostWin()?.alert(t('mappingsList.import.invalid'));
              return;
            }
            ctrl.replaceState(parsed);
          } catch (error) {
            opts.getHostWin()?.alert(t('mappingsList.import.parseError'));
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
