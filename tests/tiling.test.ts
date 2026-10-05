import { describe, expect, it } from 'vitest';
import { type Pt, type Region, apply, intersection, invert, pointInRegion, regionArea, transformRegion, union } from '../src/core/geom';
import { type EditTool, applyEdit, snapToBoundary, stampRegion } from '../src/core/tile';
import { symmetryOf } from '../src/parquets';
import { copiesInRange, square } from '../src/parquets/square';
import type { Lattice, SymmetryId } from '../src/parquets/types';

type SymmetryMode = SymmetryId;
const sym = (mode: SymmetryMode) => symmetryOf(square, mode);
const baseTile = (lat: Lattice) => square.baseTile(lat);
const ctx = (lat: Lattice, mode: SymmetryMode) => ({ impl: square, sym: sym(mode), lat });

const SQUARE: Lattice = { a: { x: 1000, y: 0 }, b: { x: 0, y: 1000 } };
const RECT: Lattice = { a: { x: 1200, y: 0 }, b: { x: 0, y: 800 } };
const PARALLELOGRAM: Lattice = { a: { x: 1000, y: 0 }, b: { x: 300, y: 900 } };

/**
 * The copies in a large block must not overlap, and together they must cover
 * the central cell completely.
 */
function expectTiles(tile: Region, lat: Lattice, mode: SymmetryMode) {
  const copies = copiesInRange(lat, sym(mode), -3, 3, -3, 3);
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
    [3 * lat.a.x, 3 * lat.a.y, 3 * lat.b.x, 3 * lat.b.y, -lat.a.x - lat.b.x, -lat.a.y - lat.b.y],
  );
  expect(Math.abs(regionArea(intersection(all, block)) - regionArea(block)) / regionArea(block)).toBeLessThan(1e-4);
  expectSamplesInOneTile(tile, lat, mode);
}

/** Sample points in the central 3x3 cells: each lies in exactly one copy. */
function expectSamplesInOneTile(tile: Region, lat: Lattice, mode: SymmetryMode) {
  const copies = copiesInRange(lat, sym(mode), -3, 3, -3, 3).map((c) => invert(c.m));
  for (let k = 0; k < 400; k++) {
    // Deterministic, irrational-ish offsets avoid hitting edges exactly.
    const s = -1 + 3 * ((k * 0.6180339887 + 0.137) % 1);
    const t = -1 + 3 * ((k * 0.7548776662 + 0.31) % 1);
    const p: Pt = { x: s * lat.a.x + t * lat.b.x, y: s * lat.a.y + t * lat.b.y };
    const hits = copies.filter((inv) => pointInRegion(apply(inv, p), tile)).length;
    expect(hits, `point ${k}`).toBe(1);
  }
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
      const base = baseTile(SQUARE);
      for (const m of sym(mode).neighbourMaps(SQUARE)) {
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
    it(`${mode} on ${lat.a.x}x${lat.b.y}/${lat.b.x}`, () => {
      let tile = baseTile(lat);
      const edits: [EditTool, Region][] = [
        ['add', circle(lat.a.x / 2 - 220, 0, 150)],
        ['nibble', circle(lat.a.x + lat.b.x / 2 - 20, lat.b.y / 2 + 80, 160)],
        ['add', circle(lat.b.x + 200, lat.b.y + 10, 120)],
        ['nibble', circle(lat.b.x / 4, lat.b.y / 4 + 300, 140)],
        ...(mode === 'T' ? [['add', circle(0, 0, 130)] as [EditTool, Region]] : []),
      ];
      for (const [i, [tool, shape]] of edits.entries()) {
        const res = applyEdit(tile, shape, tool, ctx(lat, mode));
        expect(res.ok, (res.ok ? '' : res.reason) + ' edit ' + i).toBe(true);
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
          const res = applyEdit(tile, stampRegion(kind, pl, 120, tool), tool, ctx(SQUARE, mode));
          if (res.ok) tile = res.tile;
        }
      }
      expectTiles(tile, SQUARE, mode);
    }
  });

  it('rejects shapes that reach too far', () => {
    const res = applyEdit(baseTile(SQUARE), circle(500, 0, 700), 'add', ctx(SQUARE, 'T'));
    expect(res.ok).toBe(false);
  });

  it('rejects shapes on a centre of rotation', () => {
    expect(applyEdit(baseTile(SQUARE), circle(500, 0, 150), 'add', ctx(SQUARE, 'C2')).ok).toBe(false);
    expect(applyEdit(baseTile(SQUARE), circle(1000, 0, 150), 'add', ctx(SQUARE, 'C4')).ok).toBe(false);
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
        const res = applyEdit(tile, stampRegion(kinds[i % 3], pl, 60 + rand() * 160, tool), tool, ctx(lat, mode));
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
