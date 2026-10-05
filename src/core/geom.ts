// Geometry kernel: points, affine maps and boolean operations on regions.
//
// All region coordinates are integers. The lattice vectors are integers too and
// every symmetry we use (translations, 180° and 90° rotations about lattice
// points or edge midpoints) maps the integer grid onto itself, so the copies of
// a tile line up exactly and boolean operations never leave hairline gaps.

import pc, { type MultiPolygon } from 'polygon-clipping';

export interface Pt {
  x: number;
  y: number;
}

/** A closed ring (the first point is not repeated at the end). */
export type Ring = Pt[];
/** A polygon: outer ring followed by its holes. */
export type Polygon = Ring[];
/** A region is a set of polygons. */
export type Region = Polygon[];

/** Affine map: x' = a*x + c*y + e, y' = b*x + d*y + f (same layout as SVG matrix()). */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const isIdentity = (m: Affine): boolean => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

export const add = (p: Pt, q: Pt): Pt => ({ x: p.x + q.x, y: p.y + q.y });
export const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
export const scale = (p: Pt, s: number): Pt => ({ x: p.x * s, y: p.y * s });
export const dot = (p: Pt, q: Pt): number => p.x * q.x + p.y * q.y;
export const len = (p: Pt): number => Math.hypot(p.x, p.y);

export function apply(m: Affine, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** compose(m, n) applies n first, then m. */
export function compose(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export const translation = (v: Pt): Affine => [1, 0, 0, 1, v.x, v.y];

/** Linear part given by the images of the unit vectors, applied about `center`. */
export function linearAbout(a: number, b: number, c: number, d: number, center: Pt): Affine {
  const m: Affine = [a, b, c, d, 0, 0];
  const moved = apply(m, center);
  return [a, b, c, d, center.x - moved.x, center.y - moved.y];
}

/** Point reflection (180° rotation) about `center`. */
export const halfTurn = (center: Pt): Affine => [-1, 0, 0, -1, 2 * center.x, 2 * center.y];

export function transformRegion(region: Region, m: Affine): Region {
  return region.map((poly) =>
    poly.map((ring) =>
      ring.map((p) => {
        const q = apply(m, p);
        return { x: Math.round(q.x), y: Math.round(q.y) };
      }),
    ),
  );
}

export const rings = (r: Region): Ring[] => r.flat();

// ---------------------------------------------------------------------------
// Boolean operations (polygon-clipping). Results are snapped back to the
// integer grid so that symmetric copies stay exactly aligned.

const toPC = (r: Region): MultiPolygon => r.map((poly) => poly.map((ring) => ring.map((p) => [p.x, p.y])));

function fromPC(mp: MultiPolygon): Region {
  const out: Region = [];
  for (const poly of mp) {
    const rs: Ring[] = [];
    for (const ring of poly) {
      const pts: Ring = [];
      for (const [x, y] of ring) {
        const q = { x: Math.round(x), y: Math.round(y) };
        const last = pts[pts.length - 1];
        if (!last || last.x !== q.x || last.y !== q.y) pts.push(q);
      }
      // polygon-clipping repeats the first point at the end.
      while (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
      if (pts.length >= 3 && Math.abs(ringArea(pts)) > 4) rs.push(pts);
      else if (rs.length === 0) break; // degenerate outer ring: drop the whole polygon
    }
    if (rs.length) out.push(rs);
  }
  return out;
}

export const union = (a: Region, b: Region): Region => fromPC(pc.union(toPC(a), toPC(b)));
export const difference = (a: Region, b: Region): Region => fromPC(pc.difference(toPC(a), toPC(b)));
export const intersection = (a: Region, b: Region): Region => fromPC(pc.intersection(toPC(a), toPC(b)));

/** Turns a possibly self-intersecting freehand loop into a clean region. */
export const cleanRegion = (r: Region): Region => fromPC(pc.union(toPC(r)));

/** Signed ring area (sign depends on orientation). */
export function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return s / 2;
}

export const regionArea = (r: Region): number =>
  r.reduce((s, [outer, ...holes]) => s + Math.abs(ringArea(outer)) - holes.reduce((h, ring) => h + Math.abs(ringArea(ring)), 0), 0);

export function centroid(r: Region): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (const [outer, ...holes] of r) {
    for (const [k, ring] of [outer, ...holes].entries()) {
      // Outer rings count positive, holes negative, whatever their orientation.
      const sign = Math.sign(ringArea(ring)) * (k === 0 ? 1 : -1);
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const cross = (ring[j].x * ring[i].y - ring[i].x * ring[j].y) * sign;
        a += cross;
        cx += (ring[j].x + ring[i].x) * cross;
        cy += (ring[j].y + ring[i].y) * cross;
      }
    }
  }
  if (Math.abs(a) < 1e-9) return r[0]?.[0]?.[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function bounds(r: Region): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings(r)) {
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Even-odd point-in-region test (holes count as outside). */
export function pointInRegion(p: Pt, r: Region): boolean {
  let inside = false;
  for (const ring of rings(r)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Closest point on the region boundary together with the unit tangent of that segment. */
export function nearestOnBoundary(p: Pt, r: Region): { point: Pt; tangent: Pt; dist: number } | null {
  let best: { point: Pt; tangent: Pt; dist: number } | null = null;
  for (const ring of rings(r)) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ab = sub(b, a);
      const l2 = dot(ab, ab);
      if (l2 === 0) continue;
      const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
      const q = add(a, scale(ab, t));
      const d = len(sub(p, q));
      if (!best || d < best.dist) best = { point: q, tangent: scale(ab, 1 / Math.sqrt(l2)), dist: d };
    }
  }
  return best;
}

export function regionToPath(r: Region): string {
  return rings(r)
    .map((ring) => 'M' + ring.map((p) => `${p.x} ${p.y}`).join('L') + 'Z')
    .join('');
}

export const affineToSvg = (m: Affine): string => `matrix(${m.map((v) => +v.toFixed(6)).join(' ')})`;
