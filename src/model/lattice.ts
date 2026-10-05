// Grid (lattice) presets, constraints and how the tile follows a grid change.

import { type Pt, apply, len, transformRegion } from '../core/geom';
import type { Lattice, SymmetryDef } from '../parquets/types';
import { type Doc, latticeChange } from './doc';

export type GridPreset = 'square' | 'rect' | 'rhombus' | 'parallelogram';

export const GRID_PRESETS: { id: GridPreset; title: string }[] = [
  { id: 'square', title: 'Quadrat' },
  { id: 'rect', title: 'Rechteck' },
  { id: 'rhombus', title: 'Raute' },
  { id: 'parallelogram', title: 'Parallelogramm' },
];

/** Step of the helper grid in world units (the default edge is 1000). */
export const SNAP_STEP = 50;
export const MIN_EDGE = 300;
export const MAX_EDGE = 3000;
/** Smallest allowed angle between a and b. */
const MIN_ANGLE = (25 * Math.PI) / 180;

export function presetLattice(preset: GridPreset, current: Lattice): Lattice {
  const s = Math.round(Math.max(len(current.a), MIN_EDGE) / 10) * 10;
  const r = (x: number) => Math.round(x / 10) * 10;
  switch (preset) {
    case 'square':
      return { a: { x: s, y: 0 }, b: { x: 0, y: s } };
    case 'rect':
      return { a: { x: s, y: 0 }, b: { x: 0, y: r(s * 0.65) } };
    case 'rhombus':
      return { a: { x: s, y: 0 }, b: { x: r(s * 0.5), y: Math.round(s * 0.866) } };
    case 'parallelogram':
      return { a: { x: s, y: 0 }, b: { x: r(s * 0.35), y: r(s * 0.75) } };
  }
}

/** Which preset the lattice currently matches, if any. */
export function presetOf({ a, b }: Lattice): GridPreset | null {
  const la = len(a);
  const lb = len(b);
  const cos = (a.x * b.x + a.y * b.y) / (la * lb);
  const right = Math.abs(cos) < 0.01;
  const equal = Math.abs(la - lb) / la < 0.01;
  if (right && equal) return 'square';
  if (right) return 'rect';
  if (equal) return 'rhombus';
  return 'parallelogram';
}

export function isValidLattice({ a, b }: Lattice): boolean {
  const la = len(a);
  const lb = len(b);
  if (la < MIN_EDGE || lb < MIN_EDGE || la > MAX_EDGE || lb > MAX_EDGE) return false;
  const sin = Math.abs(a.x * b.y - a.y * b.x) / (la * lb);
  return sin >= Math.sin(MIN_ANGLE);
}

/** b = a turned by a quarter, keeping the turning direction of the current lattice. */
function squareFrom(a: Pt, current: Lattice): Lattice {
  const det = current.a.x * current.b.y - current.a.y * current.b.x;
  return { a, b: det >= 0 ? { x: -a.y, y: a.x } : { x: a.y, y: -a.x } };
}

/** Makes the lattice a square (for "Drehen um die Ecke"), keeping the size and direction of a. */
export function squareLattice(current: Lattice): Lattice {
  const a = { x: Math.round(current.a.x), y: Math.round(current.a.y) };
  return squareFrom(a, current);
}

/** New lattice after dragging the control point `which` to `p`, or null if not allowed. */
export function dragLattice(current: Lattice, which: 'a' | 'b', p: Pt, sym: SymmetryDef, snap: boolean): Lattice | null {
  const step = snap ? SNAP_STEP : 1;
  const q = { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
  let next: Lattice;
  if (sym.lattice === 'square') {
    if (which === 'a') next = squareFrom(q, current);
    else {
      // a is b turned back by a quarter.
      const det = current.a.x * current.b.y - current.a.y * current.b.x;
      next = { a: det >= 0 ? { x: q.y, y: -q.x } : { x: -q.y, y: q.x }, b: q };
    }
  } else {
    next = which === 'a' ? { a: q, b: current.b } : { a: current.a, b: q };
  }
  return isValidLattice(next) ? next : null;
}

/** Applies a new lattice; the tile and the drawing are distorted along with it. */
export function withLattice(d: Doc, lattice: Lattice): Doc {
  const m = latticeChange(d.lattice, lattice);
  const scaleFactor = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return {
    ...d,
    lattice,
    tile: transformRegion(d.tile, m),
    strokes: d.strokes.map((s) => ({ ...s, width: s.width * scaleFactor, points: s.points.map((p) => apply(m, p)) })),
  };
}
