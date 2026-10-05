// Grows an Archimedean parquet from its vertex configuration, e.g. (3,3,4,3,4).
// All 11 are vertex-transitive: around every vertex the same polygons meet in
// the same cyclic order (possibly mirrored). Starting at one vertex we place
// regular polygons and then complete each neighbouring vertex so that it
// matches the configuration and the polygons already there.
// Used for the preview pictures in step 1 (and later for further parquets).

import type { Pt } from '../core/geom';

export interface RegularPolygon {
  sides: number;
  points: Pt[];
}

const TAU = Math.PI * 2;
const interior = (n: number) => (Math.PI * (n - 2)) / n;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/**
 * Merges points that differ only by rounding, so a vertex reached along
 * different paths is recognised as the same one.
 */
class PointPool {
  private cells = new Map<string, { p: Pt; id: number }[]>();
  private ids = new Map<Pt, number>();

  canon(p: Pt): Pt {
    const cx = Math.floor(p.x * 100);
    const cy = Math.floor(p.y * 100);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const q of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(q.p.x - p.x, q.p.y - p.y) < 1e-6) return q.p;
        }
      }
    }
    const entry = { p, id: this.ids.size };
    this.ids.set(p, entry.id);
    const k = `${cx},${cy}`;
    this.cells.set(k, [...(this.cells.get(k) ?? []), entry]);
    return p;
  }

  key(p: Pt): string {
    return String(this.ids.get(this.canon(p)));
  }
}

const centreOf = (pts: Pt[]): Pt => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/** True if two convex polygons overlap with positive area (touching does not count). */
function convexOverlap(p: Pt[], q: Pt[]): boolean {
  // Separating axis theorem: they are apart if some edge normal separates them.
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const nx = a.y - b.y;
      const ny = b.x - a.x;
      const proj = (pts: Pt[]) => pts.map((v) => v.x * nx + v.y * ny);
      const pp = proj(p);
      const qq = proj(q);
      if (Math.max(...pp) <= Math.min(...qq) + 1e-6 || Math.max(...qq) <= Math.min(...pp) + 1e-6) return false;
    }
  }
  return true;
}

interface Sector {
  start: number;
  sides: number;
}

export function growParquet(config: number[], radius: number): RegularPolygon[] {
  const polygons: RegularPolygon[] = [];
  const pool = new PointPool();
  const key = (p: Pt) => pool.key(p);
  /** Regular n-gon with the edge from `v` in direction `dir`, lying to the left of it (counter-clockwise). */
  const polygonFrom = (v: Pt, dir: number, n: number): Pt[] => {
    const pts: Pt[] = [pool.canon(v)];
    let p = v;
    let a = dir;
    for (let i = 1; i < n; i++) {
      p = { x: p.x + Math.cos(a), y: p.y + Math.sin(a) };
      p = pool.canon(p);
      pts.push(p);
      a += TAU / n;
    }
    return pts;
  };
  const polyKeys = new Set<string>();
  /** Centres of the placed polygons, to detect overlaps. */
  const centres: { c: Pt; pts: Pt[] }[] = [];
  /** Sectors (polygon corners) already placed at each vertex. */
  const sectors = new Map<string, Sector[]>();
  const points = new Map<string, Pt>();

  const addPolygon = (pts: Pt[], n: number) => {
    const k = pts
      .map(key)
      .sort()
      .join(' ');
    if (polyKeys.has(k)) return;
    polyKeys.add(k);
    polygons.push({ sides: n, points: pts });
    centres.push({ c: centreOf(pts), pts });
    for (let i = 0; i < n; i++) {
      const v = pts[i];
      const next = pts[(i + 1) % n];
      const vk = key(v);
      points.set(vk, v);
      // Counter-clockwise sector at v: from the edge to `next` over to the edge to `prev`.
      const start = norm(Math.atan2(next.y - v.y, next.x - v.x));
      const list = sectors.get(vk) ?? [];
      list.push({ start, sides: n });
      sectors.set(vk, list);
    }
  };

  const close = (a: number, b: number) => Math.abs(norm(a - b + Math.PI) - Math.PI) < 1e-6;

  /** All ways to complete a vertex with the given sectors to the configuration. */
  const completions = (have: Sector[]): Sector[][] => {
    const out: Sector[][] = [];
    const k = config.length;
    for (const order of [config, [...config].reverse()]) {
      for (let r = 0; r < k; r++) {
        // Candidate: sector r of this order starts where the first known sector starts.
        if (order[r] !== have[0].sides) continue;
        const predicted: Sector[] = [];
        let angle = have[0].start;
        for (let i = 0; i < k; i++) {
          const n = order[(r + i) % k];
          predicted.push({ start: norm(angle), sides: n });
          angle += interior(n);
        }
        if (have.every((h) => predicted.some((p) => p.sides === h.sides && close(p.start, h.start)))) out.push(predicted);
      }
    }
    return out;
  };

  /** Completes the vertex so that its sectors follow the configuration. */
  const complete = (v: Pt) => {
    const have = sectors.get(key(v)) ?? [];
    if (!have.length) return;
    for (const predicted of completions(have)) {
      const fresh = predicted
        .filter((p) => !have.some((h) => close(h.start, p.start)))
        .map((p) => ({ pts: polygonFrom(v, p.start, p.sides), sides: p.sides }));
      // A wrong choice shows up at the new polygons' other vertices: there the
      // corners no longer fit together into the configuration.
      const extra = new Map<string, Sector[]>();
      for (const f of fresh) {
        f.pts.forEach((w, i) => {
          const next = f.pts[(i + 1) % f.sides];
          const list = extra.get(key(w)) ?? [];
          list.push({ start: norm(Math.atan2(next.y - w.y, next.x - w.x)), sides: f.sides });
          extra.set(key(w), list);
        });
      }
      const ok = [...extra].every(([k, list]) => {
        const all = [...(sectors.get(k) ?? []), ...list];
        const distinct = all.every((x, i) => all.findIndex((y) => close(x.start, y.start)) === i);
        return distinct && completions(all).length > 0;
      });
      if (!ok) continue;
      // Also reject placements that overlap polygons further away.
      const placed = [...centres];
      const overlaps = fresh.some((f) => {
        const c = centreOf(f.pts);
        return placed.some((e) => Math.hypot(e.c.x - c.x, e.c.y - c.y) < 4 && convexOverlap(f.pts, e.pts));
      });
      if (overlaps) continue;
      for (const f of fresh) addPolygon(f.pts, f.sides);
      return;
    }
  };

  // Seed: the configuration around the origin.
  let angle = 0;
  for (const n of config) {
    addPolygon(polygonFrom({ x: 0, y: 0 }, angle, n), n);
    angle += interior(n);
  }
  // Complete the most constrained vertex first: where most of the corner is
  // already filled, the configuration leaves the fewest choices.
  const done = new Set<string>();
  for (;;) {
    let best: Pt | null = null;
    let bestScore = -Infinity;
    for (const [k, p] of points) {
      const d = Math.hypot(p.x, p.y);
      if (done.has(k) || d > radius) continue;
      const filled = (sectors.get(k) ?? []).reduce((sum, h) => sum + interior(h.sides), 0);
      const score = filled * 100 - d;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) break;
    done.add(key(best));
    complete(best);
  }
  return polygons;
}
