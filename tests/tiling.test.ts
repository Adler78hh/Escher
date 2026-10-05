import { describe, expect, it } from 'vitest';
import { type Region, intersection, regionArea, transformRegion, union } from '../src/geom';
import { type Lattice, type SymmetryMode, copiesInRange, edgeNeighbours } from '../src/symmetry';
import { type EditTool, applyEdit, baseTile, snapToBoundary, stampRegion } from '../src/tile';

const SQUARE: Lattice = { u: { x: 1000, y: 0 }, v: { x: 0, y: 1000 } };
const RECT: Lattice = { u: { x: 1200, y: 0 }, v: { x: 0, y: 800 } };
const PARALLELOGRAM: Lattice = { u: { x: 1000, y: 0 }, v: { x: 300, y: 900 } };

/**
 * The copies in a large block must not overlap, and together they must cover
 * the central cell completely.
 */
function expectTiles(tile: Region, lat: Lattice, mode: SymmetryMode) {
  const copies = copiesInRange(lat, mode, -3, 3, -3, 3);
  expect(copies.length).toBe(49);
  const regions = copies.map((c) => transformRegion(tile, c.m));
  let all: Region = [];
  let sum = 0;
  for (const r of regions) {
    all = union(all, r);
    sum += regionArea(r);
  }
  // No overlaps: area of the union equals the summed areas (up to rounding).
  expect(Math.abs(regionArea(all) - sum) / sum).toBeLessThan(1e-4);
  // No gaps: the central 3x3 block of cells is covered.
  const block = transformRegion(
    [
      [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      ],
    ],
    [3 * lat.u.x, 3 * lat.u.y, 3 * lat.v.x, 3 * lat.v.y, -lat.u.x - lat.v.x, -lat.u.y - lat.v.y],
  );
  expect(Math.abs(regionArea(intersection(all, block)) - regionArea(block)) / regionArea(block)).toBeLessThan(1e-4);
}

function circle(cx: number, cy: number, r: number): Region {
  return [
    [
      Array.from({ length: 32 }, (_, i) => ({
        x: Math.round(cx + Math.cos((i / 32) * Math.PI * 2) * r),
        y: Math.round(cy + Math.sin((i / 32) * Math.PI * 2) * r),
      })),
    ],
  ];
}

describe('symmetry groups', () => {
  for (const mode of ['T', 'C2', 'C4'] as SymmetryMode[]) {
    it(`edge neighbours of ${mode} touch the base cell`, () => {
      const g = edgeNeighbours(SQUARE, mode);
      const base = baseTile(SQUARE);
      for (const m of Object.values(g)) {
        const n = transformRegion(base, m);
        expect(regionArea(intersection(n, base))).toBe(0);
        expect(regionArea(union(n, base))).toBe(2_000_000);
      }
    });
  }
});

describe('editing keeps the tile tileable', () => {
  const cases: [SymmetryMode, Lattice][] = [
    ['T', SQUARE],
    ['T', PARALLELOGRAM],
    ['C2', RECT],
    ['C2', PARALLELOGRAM],
    ['C4', SQUARE],
  ];
  for (const [mode, lat] of cases) {
    it(`${mode} on ${lat.u.x}x${lat.v.y}/${lat.v.x}`, () => {
      let tile = baseTile(lat);
      const edits: [EditTool, Region][] = [
        ['add', circle(lat.u.x / 2 - 220, 0, 150)],
        ['nibble', circle(lat.u.x + lat.v.x / 2 - 20, lat.v.y / 2 + 80, 160)],
        ['add', circle(lat.v.x + 200, lat.v.y + 10, 120)],
        ['nibble', circle(lat.v.x / 4, lat.v.y / 4 + 300, 140)],
        ...(mode === 'T' ? [['add', circle(0, 0, 130)] as [EditTool, Region]] : []),
      ];
      for (const [i, [tool, shape]] of edits.entries()) {
        const res = applyEdit(tile, shape, tool, lat, mode);
        expect(res.ok, (res.ok ? "" : res.reason) + " edit " + i).toBe(true);
        if (res.ok) tile = res.tile;
      }
      expect(Math.abs(regionArea(tile) / regionArea(baseTile(lat)) - 1)).toBeLessThan(1e-3);
      expectTiles(tile, lat, mode);
    });
  }

  it('stamps snap to the edge and keep the tiling', () => {
    for (const mode of ['T', 'C2', 'C4'] as SymmetryMode[]) {
      let tile = baseTile(SQUARE);
      for (const [p, tool] of [
        [{ x: 300, y: -20 }, 'add'],
        [{ x: 1010, y: 600 }, 'nibble'],
        [{ x: 700, y: 990 }, 'add'],
      ] as const) {
        const pl = snapToBoundary(p, tile, 200, 100)!;
        expect(pl).not.toBeNull();
        for (const kind of ['circle', 'triangle', 'rect'] as const) {
          const res = applyEdit(tile, stampRegion(kind, pl, 120, tool), tool, SQUARE, mode);
          if (res.ok) tile = res.tile;
        }
      }
      expectTiles(tile, SQUARE, mode);
    }
  });

  it('rejects shapes that reach too far', () => {
    const res = applyEdit(baseTile(SQUARE), circle(500, 0, 700), 'add', SQUARE, 'T');
    expect(res.ok).toBe(false);
  });

  it('rejects shapes on a centre of rotation', () => {
    expect(applyEdit(baseTile(SQUARE), circle(500, 0, 150), 'add', SQUARE, 'C2').ok).toBe(false);
    expect(applyEdit(baseTile(SQUARE), circle(1000, 0, 150), 'add', SQUARE, 'C4').ok).toBe(false);
  });
});

describe('random edits', () => {
  // Small deterministic PRNG so failures are reproducible.
  function rng(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }
  const cases: [SymmetryMode, Lattice][] = [
    ['T', PARALLELOGRAM],
    ['C2', RECT],
    ['C4', SQUARE],
  ];
  for (const [mode, lat] of cases) {
    it(`${mode}: 25 random stamps keep the tiling`, () => {
      const rand = rng(mode.length * 7 + 3);
      let tile = baseTile(lat);
      let accepted = 0;
      for (let i = 0; i < 25; i++) {
        const p = { x: rand() * 1400 - 200, y: rand() * 1200 - 200 };
        const pl = snapToBoundary(p, tile, 200, 400);
        if (!pl) continue;
        const kinds = ['circle', 'triangle', 'rect'] as const;
        const tool: EditTool = rand() < 0.5 ? 'add' : 'nibble';
        const res = applyEdit(tile, stampRegion(kinds[i % 3], pl, 60 + rand() * 160, tool), tool, lat, mode);
        if (res.ok) {
          tile = res.tile;
          accepted++;
        }
      }
      expect(accepted).toBeGreaterThan(10);
      expectTiles(tile, lat, mode);
    });
  }
});
