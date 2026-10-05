// Lattices and symmetry groups for the (4,4,4,4) grid.
//
// The base cell is the parallelogram spanned by u and v at the origin:
//   P0 = 0, P1 = u, P2 = u + v, P3 = v.
// For each symmetry we know the four maps that carry the base tile onto its
// edge neighbours. Every other tile of the parquet is reached by composing
// these maps, which works the same for all symmetry types.

import { type Affine, type Pt, IDENTITY, add, apply, compose, halfTurn, linearAbout, scale, translation } from './geom';

export interface Lattice {
  u: Pt;
  v: Pt;
}

/**
 * T  – Verschiebung: opposite edges are translated copies.
 * C2 – Drehung um die Kantenmitte: every edge is point-symmetric about its midpoint.
 * C4 – Drehung um eine Ecke um 90°: an edge turns into its neighbour edge (square only).
 */
export type SymmetryMode = 'T' | 'C2' | 'C4';

export type EdgeName = 'bottom' | 'right' | 'top' | 'left';

export interface Copy {
  m: Affine;
  cell: [number, number];
}

/** Maps carrying the base tile onto the neighbour across the given edge. */
export function edgeNeighbours(lat: Lattice, mode: SymmetryMode): Record<EdgeName, Affine> {
  const { u, v } = lat;
  switch (mode) {
    case 'T':
      return {
        bottom: translation(scale(v, -1)),
        top: translation(v),
        left: translation(scale(u, -1)),
        right: translation(u),
      };
    case 'C2':
      return {
        bottom: halfTurn(scale(u, 0.5)),
        top: halfTurn(add(v, scale(u, 0.5))),
        left: halfTurn(scale(v, 0.5)),
        right: halfTurn(add(u, scale(v, 0.5))),
      };
    case 'C4': {
      // R is the quarter turn carrying u onto v (requires |u| = |v| and u ⟂ v).
      const R = quarterTurn(lat);
      const Ri: [number, number, number, number] = [R[0], R[2], R[1], R[3]];
      return {
        top: linearAbout(R[0], R[1], R[2], R[3], v),
        left: linearAbout(Ri[0], Ri[1], Ri[2], Ri[3], v),
        right: linearAbout(Ri[0], Ri[1], Ri[2], Ri[3], u),
        bottom: linearAbout(R[0], R[1], R[2], R[3], u),
      };
    }
  }
}

/** Linear quarter turn [a, b, c, d] with R(u) = v. */
function quarterTurn(lat: Lattice): [number, number, number, number] {
  const { u, v } = lat;
  // Rotation by +90° is (x, y) -> (-y, x); check which orientation maps u to v.
  const ccw = Math.abs(-u.y - v.x) + Math.abs(u.x - v.y) < 1e-9;
  return ccw ? [0, 1, -1, 0] : [0, -1, 1, 0];
}

/** Lattice coordinates (α, β) with p = α u + β v. */
export function latticeCoords(lat: Lattice, p: Pt): [number, number] {
  const { u, v } = lat;
  const det = u.x * v.y - u.y * v.x;
  return [(p.x * v.y - p.y * v.x) / det, (u.x * p.y - u.y * p.x) / det];
}

/** Cell index of a copy, from where it puts the centre of the base cell. */
export function cellOf(lat: Lattice, m: Affine): [number, number] {
  const c = apply(m, scale(add(lat.u, lat.v), 0.5));
  const [a, b] = latticeCoords(lat, c);
  return [Math.round(a - 0.5), Math.round(b - 0.5)];
}

/**
 * All copies of the tile whose cells lie in the given index rectangle,
 * found by walking from the base tile across edges.
 */
export function copiesInRange(
  lat: Lattice,
  mode: SymmetryMode,
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): Copy[] {
  const gens = Object.values(edgeNeighbours(lat, mode));
  const seen = new Map<string, Copy>();
  const queue: Copy[] = [{ m: IDENTITY, cell: [0, 0] }];
  seen.set('0,0', queue[0]);
  const inside = ([a, b]: [number, number]) => a >= aMin && a <= aMax && b >= bMin && b <= bMax;
  // The walk may need to start outside the requested range if it does not contain 0,0.
  const walkMin = [Math.min(aMin, 0), Math.min(bMin, 0)];
  const walkMax = [Math.max(aMax, 0), Math.max(bMax, 0)];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const g of gens) {
      const m = compose(cur.m, g);
      const cell = cellOf(lat, m);
      const key = cell.join(',');
      if (seen.has(key)) continue;
      if (cell[0] < walkMin[0] || cell[0] > walkMax[0] || cell[1] < walkMin[1] || cell[1] > walkMax[1]) continue;
      const copy = { m, cell };
      seen.set(key, copy);
      queue.push(copy);
    }
  }
  return [...seen.values()].filter((c) => inside(c.cell));
}

/** Copies around the base tile (excluding the base tile itself). */
export function neighbourCopies(lat: Lattice, mode: SymmetryMode, radius = 2): Copy[] {
  return copiesInRange(lat, mode, -radius, radius, -radius, radius).filter((c) => c.cell[0] !== 0 || c.cell[1] !== 0);
}

/** Copies needed to cover an axis-aligned world rectangle. */
export function copiesForView(
  lat: Lattice,
  mode: SymmetryMode,
  view: { minX: number; minY: number; maxX: number; maxY: number },
  pad = 2,
): Copy[] {
  const corners: Pt[] = [
    { x: view.minX, y: view.minY },
    { x: view.maxX, y: view.minY },
    { x: view.minX, y: view.maxY },
    { x: view.maxX, y: view.maxY },
  ];
  const ab = corners.map((p) => latticeCoords(lat, p));
  const aMin = Math.floor(Math.min(...ab.map((c) => c[0]))) - pad;
  const aMax = Math.ceil(Math.max(...ab.map((c) => c[0]))) + pad;
  const bMin = Math.floor(Math.min(...ab.map((c) => c[1]))) - pad;
  const bMax = Math.ceil(Math.max(...ab.map((c) => c[1]))) + pad;
  return copiesInRange(lat, mode, aMin, aMax, bMin, bMax);
}

/** Orientation index of a copy (0–3), used for the "Farbe nach Drehung" colouring. */
export function orientationOf(m: Affine): number {
  const angle = Math.atan2(m[1], m[0]);
  return ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
}
