// SVG markup for tiles and parquets, shared by the screen and the print output.

import { type Affine, affineToSvg, len, regionToPath } from '../core/geom';
import type { Doc, Stroke } from '../model/doc';
import type { Copy } from '../parquets/types';

let uid = 0;

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function strokePath(s: Stroke): string {
  if (s.points.length === 1) {
    const p = s.points[0];
    return `M${p.x} ${p.y}l0.01 0`;
  }
  return 'M' + s.points.map((p) => `${Math.round(p.x)} ${Math.round(p.y)}`).join('L');
}

/** Typical outline width in world units. */
export const lineWidth = (doc: Doc): number => Math.max(len(doc.lattice.a), len(doc.lattice.b)) * 0.006;

export function copyColor(doc: Doc, c: Copy): string {
  switch (doc.coloring) {
    case 'single':
      return doc.colors[0];
    case 'checker':
      return doc.colors[c.checker];
    case 'rotation':
      // C4: one colour per quarter turn; C2: upright vs. upside down.
      return doc.colors[doc.symmetry === 'C4' ? c.turn : c.turn === 0 ? 0 : 1];
  }
}

export interface TileDefs {
  defs: string;
  /** Markup for one copy of the tile under the given transform. */
  copy: (m: Affine, fill: string, opts?: { stroke?: string; strokeWidth?: number; opacity?: number; extra?: string }) => string;
}

/** Defines the tile shape and its drawing once so copies can reuse them. */
export function tileDefs(doc: Doc): TileDefs {
  const id = `t${++uid}`;
  const d = regionToPath(doc.tile);
  const art = doc.strokes
    .map(
      (s) =>
        `<path d="${strokePath(s)}" fill="none" stroke="${esc(s.color)}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  const defs =
    `<path id="${id}-shape" d="${d}"/>` +
    `<clipPath id="${id}-clip" clipPathUnits="userSpaceOnUse"><path d="${d}"/></clipPath>` +
    `<g id="${id}-art">${art}</g>`;
  const lw = lineWidth(doc);
  return {
    defs,
    copy: (m, fill, opts = {}) =>
      `<g transform="${affineToSvg(m)}"${opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : ''}${opts.extra ?? ''}>` +
      `<use href="#${id}-shape" fill="${esc(fill)}"/>` +
      (art ? `<g clip-path="url(#${id}-clip)"><use href="#${id}-art"/></g>` : '') +
      (opts.stroke
        ? `<use href="#${id}-shape" fill="none" stroke="${esc(opts.stroke)}" stroke-width="${opts.strokeWidth ?? lw}" stroke-linejoin="round"/>`
        : '') +
      `</g>`,
  };
}

/** A whole parquet: every copy coloured according to the document settings. */
export function parquetMarkup(doc: Doc, copies: Copy[], strokeWidth?: number): string {
  const t = tileDefs(doc);
  const outline = doc.outlines ? '#222' : undefined;
  return `<defs>${t.defs}</defs>` + copies.map((c) => t.copy(c.m, copyColor(doc, c), { stroke: outline, strokeWidth })).join('');
}
