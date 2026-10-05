import { describe, expect, it } from 'vitest';
import { intersection, regionArea, union, type Region } from '../src/core/geom';
import { growParquet } from '../src/parquets/archimedean';
import { PARQUETS } from '../src/parquets';

const S = 1000; // scale to integer coordinates

describe('Archimedean parquets grow without overlaps', () => {
  for (const p of PARQUETS) {
    it(`Parkett ${p.n} (${p.vertex.join(',')})`, () => {
      const polys = growParquet(p.vertex, 7);
      expect(polys.length).toBeGreaterThan(8);
      let all: Region = [];
      let sum = 0;
      for (const poly of polys) {
        const r: Region = [[poly.points.map((q) => ({ x: Math.round(q.x * S), y: Math.round(q.y * S) }))]];
        sum += regionArea(r);
        all = union(all, r);
      }
      expect(Math.abs(regionArea(all) - sum) / sum).toBeLessThan(1e-3);
      // Gap-free: a disc of radius 4 around the start is covered completely.
      const disc: Region = [[Array.from({ length: 48 }, (_, i) => ({ x: Math.round(Math.cos((i / 48) * Math.PI * 2) * 4 * S), y: Math.round(Math.sin((i / 48) * Math.PI * 2) * 4 * S) }))]];
      expect(Math.abs(regionArea(intersection(all, disc)) - regionArea(disc)) / regionArea(disc)).toBeLessThan(1e-4);
    });
  }
});
