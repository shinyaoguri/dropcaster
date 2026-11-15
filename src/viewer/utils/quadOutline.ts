/**
 * マッピングの輪郭（quad の枠線）を、変形しない仮想キャンバス寸法の SVG で描く部品。
 *
 * マッピングの映像は「仮想キャンバス寸法の div を matrix3d で quad へ写像する」方式で描いている
 * （applyQuadCanvas）。この div に border などの描画面を持たせてはいけない (#156):
 * 遠近を含む matrix3d では Chrome が祖先の縮小倍率をラスタライズに使えず、仮想キャンバス全体を
 * ほぼ等倍で描くレイヤーになる。マッピング × 出力の数だけ並ぶとタイルメモリの上限を超え、
 * 関係のない UI まで矩形単位で描かれなくなる（checkerboard）。
 *
 * そこで warp する div には <video> だけを載せ（映像はタイルを使わない）、輪郭はこの SVG に
 * `<polygon>` で描く。SVG 自体は変形しないので、親の縮小倍率でラスタライズされる。
 *
 * 置き方の約束:
 *   - SVG は warp する div の**直後の兄弟**に置く（前面のマッピングが背面の輪郭を隠す前後関係を保つ）。
 *   - z-index・表示状態・線の色は warp する div に揃える（syncQuadOutline が div の style から写す）。
 *   - 線の見た目（色・太さ・破線）は CSS で `.dc-quad-outline` 系のクラスに当てる。
 */

import type { Quad } from './mappingTransform';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 輪郭の SVG を作る。className は `dc-quad-outline` に足す見た目用のクラス。 */
export function createQuadOutline(doc: Document, className: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', `dc-quad-outline ${className}`.trim());
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.appendChild(doc.createElementNS(SVG_NS, 'polygon'));
  return svg;
}

/**
 * 輪郭を quad（仮想キャンバス px）に合わせ、z-index・表示状態を warp する div から写す。
 * warp する div を applyQuadCanvas・z-index 設定で更新した**後**に呼ぶ。
 * 退化した quad では applyQuadCanvas が div を visibility: hidden にするので、輪郭も隠れる。
 */
export function syncQuadOutline(
  svg: SVGSVGElement,
  warped: HTMLElement,
  quad: Quad,
  canvasWidth: number,
  canvasHeight: number,
): void {
  svg.setAttribute('viewBox', `0 0 ${canvasWidth} ${canvasHeight}`);
  svg.setAttribute('width', `${canvasWidth}`);
  svg.setAttribute('height', `${canvasHeight}`);
  const corners = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  svg.firstElementChild?.setAttribute('points', corners.map(p => `${p.x},${p.y}`).join(' '));
  syncQuadOutlineStyle(svg, warped);
}

/** z-index・表示状態・線の色（--mapping-color）だけを warp する div から写す（quad が変わらない更新用）。 */
export function syncQuadOutlineStyle(svg: SVGSVGElement, warped: HTMLElement): void {
  svg.style.zIndex = warped.style.zIndex;
  svg.style.setProperty('--mapping-color', warped.style.getPropertyValue('--mapping-color'));
  svg.style.display = warped.style.display;
  svg.style.visibility = warped.style.visibility;
}
