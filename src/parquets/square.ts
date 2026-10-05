// Parkett 7 (4,4,4,4): the square grid and its distortions to rectangles,
// rhombi and parallelograms.
//
// Corners of the base cell (screen coordinates, y points down):
//   P0 = 0 (top left), P1 = a, P2 = a + b, P3 = b.
// Edges: 0 = P0→P1 "oben", 1 = P1→P2 "rechts", 2 = P2→P3 "unten", 3 = P3→P0 "links".
// For each symmetry we know the motions onto the four edge neighbours; every
// other copy is reached by composing them.

import { type Affine, type Pt, IDENTITY, add, apply, compose, halfTurn, linearAbout, scale, translation } from '../core/geom';
import type { Copy, Lattice, ParquetImpl, SymmetryDef, View } from './types';

const EDGE_NAMES = ['oben', 'rechts', 'unten', 'links'];

const corners = ({ a, b }: Lattice): Pt[] => [{ x: 0, y: 0 }, a, add(a, b), b];
const mid = (p: Pt, q: Pt): Pt => scale(add(p, q), 0.5);

/** Linear quarter turn R with R(a) = b, as [xx, yx, xy, yy] (requires a square lattice). */
export function quarterTurn({ a, b }: Lattice): [number, number, number, number] {
  // (x, y) -> (-y, x) maps a to b if b = (-a.y, a.x); otherwise it is the other way round.
  const plus = Math.abs(-a.y - b.x) + Math.abs(a.x - b.y) < 1e-9;
  return plus ? [0, 1, -1, 0] : [0, -1, 1, 0];
}

const T: SymmetryDef = {
  id: 'T',
  title: 'Verschieben',
  kidText: 'Was du oben anbaust, wird unten weggenommen. Links und rechts genauso.',
  rule: 'Gegenüberliegende Kanten gehören zusammen und werden durch Verschiebung aufeinander abgebildet.',
  lattice: 'any',
  edges: EDGE_NAMES.map((name, i) => ({ name, group: i % 2 })),
  neighbourMaps: ({ a, b }) => [translation(scale(b, -1)), translation(a), translation(b), translation(scale(a, -1))],
  rotationCentres: () => [],
};

const C2: SymmetryDef = {
  id: 'C2',
  title: 'Drehen um die Kantenmitte',
  kidText: 'Jede Kante dreht sich um ihren Mittelpunkt. Was du auf der einen Hälfte anbaust, wird auf der anderen Hälfte weggenommen.',
  rule: 'Jede Kante wird durch eine 180°-Drehung um ihren Mittelpunkt auf sich selbst abgebildet.',
  lattice: 'any',
  edges: EDGE_NAMES.map((name, i) => ({ name, group: i })),
  neighbourMaps: (lat) => {
    const c = corners(lat);
    return [0, 1, 2, 3].map((i) => halfTurn(mid(c[i], c[(i + 1) % 4])));
  },
  rotationCentres: (lat) => {
    const c = corners(lat);
    return [0, 1, 2, 3].map((i) => ({ point: mid(c[i], c[(i + 1) % 4]), order: 2 as const }));
  },
};

const C4: SymmetryDef = {
  id: 'C4',
  title: 'Drehen um die Ecke',
  kidText: 'Die Kante dreht sich um eine Ecke zur Nachbarkante. Was du oben anbaust, wird links weggenommen.',
  rule: 'Benachbarte Kanten gehören zusammen und werden durch eine 90°-Drehung um ihre gemeinsame Ecke aufeinander abgebildet.',
  lattice: 'square',
  // oben/links turn about P0, rechts/unten about P2.
  edges: EDGE_NAMES.map((name, i) => ({ name, group: i === 0 || i === 3 ? 0 : 1 })),
  neighbourMaps: (lat) => {
    const [xx, yx, xy, yy] = quarterTurn(lat);
    const [p0, , p2] = corners(lat);
    // R about P0 carries the base cell onto the left neighbour, R⁻¹ onto the one above;
    // about P2, R gives the right neighbour and R⁻¹ the one below.
    const R = (c: Pt) => linearAbout(xx, yx, xy, yy, c);
    const Ri = (c: Pt) => linearAbout(xx, xy, yx, yy, c);
    return [Ri(p0), R(p2), Ri(p2), R(p0)];
  },
  rotationCentres: (lat) => {
    const c = corners(lat);
    return [
      { point: c[0], order: 4 },
      { point: c[2], order: 4 },
      { point: c[1], order: 2 },
      { point: c[3], order: 2 },
    ];
  },
};

/** Lattice coordinates (α, β) with p = α a + β b. */
export function latticeCoords({ a, b }: Lattice, p: Pt): [number, number] {
  const det = a.x * b.y - a.y * b.x;
  return [(p.x * b.y - p.y * b.x) / det, (a.x * p.y - a.y * p.x) / det];
}

/** Cell index of a copy, from where it puts the centre of the base cell. */
function cellOf(lat: Lattice, m: Affine): [number, number] {
  const [i, j] = latticeCoords(lat, apply(m, scale(add(lat.a, lat.b), 0.5)));
  return [Math.round(i - 0.5), Math.round(j - 0.5)];
}

function turnOf(m: Affine): number {
  return ((Math.round(Math.atan2(m[1], m[0]) / (Math.PI / 2)) % 4) + 4) % 4;
}

/** Walks from the base tile across edges and collects the copies in an index rectangle. */
export function copiesInRange(lat: Lattice, sym: SymmetryDef, iMin: number, iMax: number, jMin: number, jMax: number): Copy[] {
  const gens = sym.neighbourMaps(lat);
  const lo = [Math.min(iMin, 0), Math.min(jMin, 0)];
  const hi = [Math.max(iMax, 0), Math.max(jMax, 0)];
  const make = (m: Affine, [i, j]: [number, number]): Copy & { i: number; j: number } => ({
    m,
    key: `${i},${j}`,
    checker: (((i + j) % 2) + 2) % 2 === 0 ? 0 : 1,
    turn: turnOf(m),
    i,
    j,
  });
  const start = make(IDENTITY, [0, 0]);
  const seen = new Map([[start.key, start]]);
  const queue = [start];
  for (let k = 0; k < queue.length; k++) {
    for (const g of gens) {
      const m = compose(queue[k].m, g);
      const cell = cellOf(lat, m);
      if (cell[0] < lo[0] || cell[0] > hi[0] || cell[1] < lo[1] || cell[1] > hi[1]) continue;
      const c = make(m, cell);
      if (seen.has(c.key)) continue;
      seen.set(c.key, c);
      queue.push(c);
    }
  }
  return [...seen.values()]
    .filter((c) => c.i >= iMin && c.i <= iMax && c.j >= jMin && c.j <= jMax)
    .map(({ m, key, checker, turn }) => ({ m, key, checker, turn }));
}

export const square: ParquetImpl = {
  defaultLattice: { a: { x: 1000, y: 0 }, b: { x: 0, y: 1000 } },
  symmetries: [T, C2, C4],
  corners,
  baseTile: (lat) => [[corners(lat)]],
  copiesAround: (lat, sym, r) => copiesInRange(lat, sym, -r, r, -r, r),
  copiesForView(lat, sym, view: View, pad = 2) {
    const ij = [
      { x: view.minX, y: view.minY },
      { x: view.maxX, y: view.minY },
      { x: view.minX, y: view.maxY },
      { x: view.maxX, y: view.maxY },
    ].map((p) => latticeCoords(lat, p));
    return copiesInRange(
      lat,
      sym,
      Math.floor(Math.min(...ij.map((c) => c[0]))) - pad,
      Math.ceil(Math.max(...ij.map((c) => c[0]))) + pad,
      Math.floor(Math.min(...ij.map((c) => c[1]))) - pad,
      Math.ceil(Math.max(...ij.map((c) => c[1]))) + pad,
    );
  },
};
