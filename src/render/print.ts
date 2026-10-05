// Print output at true size: a cut-out template of the piece and a filled area.
// Both are SVGs measured in millimetres; printing uses the browser's print
// dialog (which can also save as PDF).

import { bounds, len, regionToPath } from '../core/geom';
import type { Doc } from '../model/doc';
import { implOf, symmetryOf } from '../parquets';
import { esc, parquetMarkup, tileDefs } from './markup';

/** Printable area of an A4 page with 10 mm margins. */
export const PAGE = { w: 190, h: 277 };

export interface PrintOptions {
  /** Edge length of the grid cell (length of u) in centimetres. */
  sideCm: number;
  /** Template filled with the piece colour and drawing instead of a plain outline. */
  coloredTemplate: boolean;
}

/** Millimetres per world unit. */
const mmPerUnit = (doc: Doc, o: PrintOptions): number => (o.sideCm * 10) / len(doc.lattice.a);

/** Size of the piece in millimetres (its bounding box). */
export function pieceSizeMm(doc: Doc, o: PrintOptions): { w: number; h: number } {
  const b = bounds(doc.tile);
  const k = mmPerUnit(doc, o);
  return { w: (b.maxX - b.minX) * k, h: (b.maxY - b.minY) * k };
}

const svgOpen = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`;

export function templateSvg(doc: Doc, o: PrintOptions): string {
  const k = mmPerUnit(doc, o);
  const b = bounds(doc.tile);
  const w = (b.maxX - b.minX) * k;
  const h = (b.maxY - b.minY) * k;
  const ox = (PAGE.w - w) / 2 - b.minX * k;
  const oy = (PAGE.h - 20 - h) / 2 - b.minY * k;
  const t = tileDefs(doc);
  const body = o.coloredTemplate ? `<defs>${t.defs}</defs>` + t.copy([1, 0, 0, 1, 0, 0], doc.colors[0]) : '';
  return (
    svgOpen(PAGE.w, PAGE.h) +
    `<g transform="translate(${ox} ${oy}) scale(${k})">${body}` +
    `<path d="${regionToPath(doc.tile)}" fill="none" stroke="#000" stroke-width="${0.4 / k}" stroke-dasharray="${3 / k} ${1.5 / k}"/></g>` +
    `<text x="${PAGE.w / 2}" y="${PAGE.h - 6}" font-family="sans-serif" font-size="4" text-anchor="middle" fill="#444">` +
    esc(`Schablone – Rasterkante ${o.sideCm.toLocaleString('de-DE')} cm – an der gestrichelten Linie ausschneiden`) +
    `</text></svg>`
  );
}

export function areaSvg(doc: Doc, o: PrintOptions): string {
  const k = mmPerUnit(doc, o);
  const view = { minX: 0, minY: 0, maxX: PAGE.w / k, maxY: PAGE.h / k };
  const impl = implOf(doc.parquet);
  const copies = impl.copiesForView(doc.lattice, symmetryOf(impl, doc.symmetry), view, 2);
  return (
    svgOpen(PAGE.w, PAGE.h) +
    `<defs><clipPath id="page"><rect width="${PAGE.w}" height="${PAGE.h}"/></clipPath></defs>` +
    `<g clip-path="url(#page)"><g transform="scale(${k})">${parquetMarkup(doc, copies, 0.3 / k)}</g></g></svg>`
  );
}

export function downloadSvg(svg: string, name: string): void {
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function printPages(pages: string[]): void {
  const host = document.getElementById('print-root')!;
  host.innerHTML = pages.map((p) => `<div class="print-page">${p}</div>`).join('');
  window.print();
}
