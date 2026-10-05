// Editing operations on the tile.
//
// "Hinzufügen": the part of a shape that sticks out of the tile is added. It
// overlaps neighbouring tiles; each neighbour must lose that part, so the base
// tile loses its pre-image under the neighbour's symmetry map.
// "Anknabbern": the part of a shape inside the tile is removed and handed to
// the neighbour next to it, so the base tile gains its pre-image.
// Either way the tile keeps its area and still fills the plane without gaps.

import {
  type Pt,
  type Region,
  centroid,
  cleanRegion,
  difference,
  intersection,
  invert,
  isIdentity,
  len,
  nearestOnBoundary,
  pointInRegion,
  regionArea,
  rings,
  sub,
  transformRegion,
  union,
} from './geom';
import type { Lattice, ParquetImpl, SymmetryDef } from '../parquets/types';

export type EditTool = 'add' | 'nibble';

export type EditResult = { ok: true; tile: Region } | { ok: false; reason: string };

/** What an edit needs to know about the parquet. */
export interface EditContext {
  impl: ParquetImpl;
  sym: SymmetryDef;
  lat: Lattice;
}

export function applyEdit(tile: Region, shape: Region, tool: EditTool, { impl, sym, lat }: EditContext): EditResult {
  const area0 = regionArea(tile);
  const tol = Math.max(50, area0 * 1e-4);
  const r = cleanRegion(shape);
  if (regionArea(r) < tol) return { ok: false, reason: 'Die Form ist zu klein.' };

  const neighbours = impl
    .copiesAround(lat, sym, 2)
    .filter((c) => !isIdentity(c.m))
    .map((c) => ({ ...c, region: transformRegion(tile, c.m) }));
  let next: Region;

  if (tool === 'add') {
    const added = difference(r, tile);
    const addedArea = regionArea(added);
    if (addedArea < tol) return { ok: false, reason: 'Zum Hinzufügen muss die Form über den Rand der Fliese hinausragen.' };
    let removed: Region = [];
    let covered = 0;
    for (const n of neighbours) {
      const piece = intersection(added, n.region);
      const a = regionArea(piece);
      if (a < 1) continue;
      covered += a;
      removed = union(removed, transformRegion(piece, invert(n.m)));
    }
    if (Math.abs(covered - addedArea) > tol) return { ok: false, reason: 'Die Form reicht zu weit über die Nachbarfliesen hinaus.' };
    next = difference(union(tile, added), removed);
  } else {
    const nibbled = intersection(r, tile);
    if (regionArea(nibbled) < tol) return { ok: false, reason: 'Zum Anknabbern muss die Form in der Fliese liegen.' };
    // The neighbour that takes the piece: the one the shape reaches into most,
    // otherwise the one closest to the nibbled piece.
    let best = neighbours[0];
    let bestScore = -Infinity;
    const c = centroid(nibbled);
    for (const n of neighbours) {
      const overlap = regionArea(intersection(r, n.region));
      const near = nearestOnBoundary(c, n.region);
      const score = overlap > 1 ? overlap : -(near ? near.dist : Infinity);
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    const moved = transformRegion(nibbled, invert(best.m));
    next = union(difference(tile, nibbled), moved);
  }

  const centreHint =
    sym.id === 'T' ? '' : ' Tipp: Setze die Form nicht genau auf einen Drehpunkt (Kantenmitte oder Ecke), sondern daneben.';
  if (Math.abs(regionArea(next) - area0) > tol) {
    return { ok: false, reason: 'Die Form überschneidet sich mit ihrem eigenen Gegenstück.' + centreHint };
  }
  if (next.length !== 1) {
    return { ok: false, reason: 'Die Fliese würde in mehrere Teile zerfallen.' + centreHint };
  }
  if (next[0].length !== 1) {
    return { ok: false, reason: 'Die Fliese würde ein Loch bekommen.' };
  }
  return { ok: true, tile: next };
}

// ---------------------------------------------------------------------------
// Ready-made shapes that snap onto the tile boundary

export type StampKind = 'circle' | 'triangle' | 'rect';

export interface Placement {
  point: Pt;
  tangent: Pt;
  /** Unit normal pointing out of the tile. */
  normal: Pt;
}

/**
 * Finds where a stamp at `p` snaps to the tile boundary. The direction is
 * averaged over the boundary near the snap point so freehand edges still give
 * a calm orientation.
 */
export function snapToBoundary(p: Pt, tile: Region, size: number, maxDist: number): Placement | null {
  const near = nearestOnBoundary(p, tile);
  if (!near || near.dist > maxDist) return null;
  // Principal direction of the boundary points within `size` of the snap point.
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let n = 0;
  for (const ring of rings(tile)) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      // Sample each segment so long straight edges are weighted by length.
      const steps = Math.max(1, Math.ceil(len(sub(b, a)) / (size / 8)));
      for (let k = 0; k < steps; k++) {
        const q = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
        const d = sub(q, near.point);
        if (len(d) > size * 0.6) continue;
        sxx += d.x * d.x;
        sxy += d.x * d.y;
        syy += d.y * d.y;
        n++;
      }
    }
  }
  let tangent = near.tangent;
  if (n > 2) {
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    tangent = { x: Math.cos(angle), y: Math.sin(angle) };
  }
  let normal = { x: -tangent.y, y: tangent.x };
  const probe = { x: near.point.x + normal.x * size * 0.05, y: near.point.y + normal.y * size * 0.05 };
  if (pointInRegion(probe, tile)) normal = { x: -normal.x, y: -normal.y };
  return { point: near.point, tangent, normal };
}

/**
 * Stamp outline in world coordinates. Shapes reach out of the tile for "add"
 * and into it for "nibble"; they overlap the boundary a little on the other
 * side so the cut is clean (that overlap is ignored by the edit).
 */
export function stampRegion(kind: StampKind, pl: Placement, size: number, tool: EditTool): Region {
  const r = size / 2;
  const dir = tool === 'add' ? 1 : -1;
  const back = -r * 0.25;
  let local: Pt[];
  switch (kind) {
    case 'circle':
      local = Array.from({ length: 40 }, (_, i) => {
        const t = (i / 40) * Math.PI * 2;
        return { x: Math.cos(t) * r, y: Math.sin(t) * r };
      });
      break;
    case 'triangle':
      local = [
        { x: -r, y: back },
        { x: r, y: back },
        { x: 0, y: r * 1.4 },
      ];
      break;
    case 'rect':
      local = [
        { x: -r * 0.7, y: back },
        { x: r * 0.7, y: back },
        { x: r * 0.7, y: r },
        { x: -r * 0.7, y: r },
      ];
      break;
  }
  const { point, tangent, normal } = pl;
  return [
    [
      local.map((q) => ({
        x: Math.round(point.x + tangent.x * q.x + normal.x * q.y * dir),
        y: Math.round(point.y + tangent.y * q.x + normal.y * q.y * dir),
      })),
    ],
  ];
}

