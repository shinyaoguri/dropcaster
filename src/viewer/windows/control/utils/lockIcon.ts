/**
 * 編集ロック (#190) の鍵のアイコン (線画 16px)。一覧の鍵ボタンとマッピング列の「ロック中」表示で同じ形を使う。
 * locked = true は閉じた鍵、false は開いた鍵。色は currentColor。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function createLockIcon(doc: Document, locked: boolean): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('dc-lock-icon');
  const body = doc.createElementNS(SVG_NS, 'rect');
  body.setAttribute('x', '5'); body.setAttribute('y', '11'); body.setAttribute('width', '14'); body.setAttribute('height', '10'); body.setAttribute('rx', '2');
  const shackle = doc.createElementNS(SVG_NS, 'path');
  shackle.setAttribute('d', locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.7-1.5');
  svg.append(body, shackle);
  return svg;
}
