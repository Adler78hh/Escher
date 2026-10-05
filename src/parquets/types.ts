// Parquet types and symmetries are described as data, so further parquets can
// be added later without touching the editor.

import type { Affine, Pt, Region } from '../core/geom';

/** Lattice spanned by the vectors a and b; the base cell has the corners 0, a, a+b, b. */
export interface Lattice {
  a: Pt;
  b: Pt;
}

export type SymmetryId = 'T' | 'C2' | 'C4';

/** One copy of the tile in the parquet. */
export interface Copy {
  /** Motion carrying the base tile onto this copy. */
  m: Affine;
  /** Stable key (e.g. the lattice cell). */
  key: string;
  /** Colour class for "Abwechselnd": neighbours across an edge always differ. */
  checker: 0 | 1;
  /** Orientation class (0–3) for colouring by rotation. */
  turn: number;
}

export interface View {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface EdgeDef {
  /** Name as seen on screen ("oben", "rechts", …). */
  name: string;
  /** Edges with the same group belong together and change together. */
  group: number;
}

/** A point the tile is turned about; shapes must not sit right on it. */
export interface RotationCentre {
  point: Pt;
  order: 2 | 4;
}

export interface SymmetryDef {
  id: SymmetryId;
  title: string;
  /** Explanation for children. */
  kidText: string;
  /** The precise rule. */
  rule: string;
  /** Only lattices of this kind are allowed. */
  lattice: 'any' | 'square';
  /** Edges of the base tile, in the order of `corners`. */
  edges: EdgeDef[];
  /**
   * For each edge e: the motion that carries the base tile onto its neighbour
   * across e. (The prompt's g_e, "neighbour back onto the base tile", is its inverse.)
   */
  neighbourMaps(lat: Lattice): Affine[];
  rotationCentres(lat: Lattice): RotationCentre[];
}

export interface ParquetType {
  /** Number as used in class (1–11). */
  n: number;
  id: string;
  /** Vertex configuration, e.g. [4, 4, 4, 4]. */
  vertex: number[];
  name: string;
  ready: boolean;
  /** Only for ready types: */
  impl?: ParquetImpl;
}

export interface ParquetImpl {
  defaultLattice: Lattice;
  symmetries: SymmetryDef[];
  /** Corners of the base tile (fixed points of the editing). */
  corners(lat: Lattice): Pt[];
  baseTile(lat: Lattice): Region;
  /** All copies needed to cover the view. */
  copiesForView(lat: Lattice, sym: SymmetryDef, view: View, pad?: number): Copy[];
  /** The base tile and the copies around it (ring of the given radius). */
  copiesAround(lat: Lattice, sym: SymmetryDef, radius: number): Copy[];
}
