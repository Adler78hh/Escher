// The 11 Archimedean parquets, numbered as in class. Only Parkett 7 can be edited so far.

import { square } from './square';
import type { ParquetImpl, ParquetType, SymmetryDef, SymmetryId } from './types';

const t = (n: number, vertex: number[], name: string, impl?: ParquetImpl): ParquetType => ({
  n,
  id: vertex.join('.'),
  vertex,
  name,
  ready: !!impl,
  impl,
});

export const PARQUETS: ParquetType[] = [
  t(1, [3, 3, 3, 3, 3, 3], 'Dreiecke'),
  t(2, [3, 3, 3, 3, 6], 'Dreiecke und Sechsecke, verdreht'),
  t(3, [3, 3, 3, 4, 4], 'Dreiecke und Quadrate in Reihen'),
  t(4, [3, 3, 4, 3, 4], 'Dreiecke und Quadrate, verdreht'),
  t(5, [3, 4, 6, 4], 'Dreiecke, Quadrate, Sechsecke'),
  t(6, [3, 6, 3, 6], 'Dreiecke und Sechsecke'),
  t(7, [4, 4, 4, 4], 'Quadrate', square),
  t(8, [4, 8, 8], 'Quadrate und Achtecke'),
  t(9, [3, 12, 12], 'Dreiecke und Zwölfecke'),
  t(10, [4, 6, 12], 'Quadrate, Sechsecke, Zwölfecke'),
  t(11, [6, 6, 6], 'Sechsecke'),
];

export const vertexLabel = (p: ParquetType): string => `(${p.vertex.join(',')})`;

export function parquetByNumber(n: number): ParquetType {
  return PARQUETS.find((p) => p.n === n) ?? PARQUETS[6];
}

export function implOf(n: number): ParquetImpl {
  return parquetByNumber(n).impl ?? square;
}

export function symmetryOf(impl: ParquetImpl, id: SymmetryId): SymmetryDef {
  return impl.symmetries.find((s) => s.id === id) ?? impl.symmetries[0];
}
