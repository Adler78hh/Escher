// Document state, undo/redo and local autosave.

import type { Affine, Pt, Region } from '../core/geom';
import { implOf } from '../parquets';
import type { Lattice, SymmetryId } from '../parquets/types';

export type Coloring = 'single' | 'checker' | 'rotation';

export interface Stroke {
  points: Pt[];
  color: string;
  width: number;
}

export interface Doc {
  /** Parquet number (1–11). */
  parquet: number;
  symmetry: SymmetryId;
  lattice: Lattice;
  tile: Region;
  strokes: Stroke[];
  /** Fill colours: [0] the piece, [1] second colour for "Abwechselnd", [2], [3] for four turns. */
  colors: string[];
  coloring: Coloring;
  outlines: boolean;
}

export function newDoc(): Doc {
  const impl = implOf(7);
  const lattice = impl.defaultLattice;
  return {
    parquet: 7,
    symmetry: 'T',
    lattice,
    tile: impl.baseTile(lattice),
    strokes: [],
    colors: ['#f2a541', '#3a86c8', '#9b5de5', '#e05263'],
    coloring: 'checker',
    outlines: true,
  };
}

export const baseTileOf = (doc: Doc): Region => implOf(doc.parquet).baseTile(doc.lattice);

/** True once the tile differs from the plain grid cell. */
export function isEdited(doc: Doc): boolean {
  return JSON.stringify(doc.tile) !== JSON.stringify(baseTileOf(doc)) || doc.strokes.length > 0;
}

/** Affine map carrying the old lattice cell onto the new one (both anchored at the origin). */
export function latticeChange(from: Lattice, to: Lattice): Affine {
  const det = from.a.x * from.b.y - from.a.y * from.b.x;
  // Inverse of [a b] (columns).
  const i00 = from.b.y / det;
  const i01 = -from.b.x / det;
  const i10 = -from.a.y / det;
  const i11 = from.a.x / det;
  // [a' b'] * inv([a b])
  return [
    to.a.x * i00 + to.b.x * i10,
    to.a.y * i00 + to.b.y * i10,
    to.a.x * i01 + to.b.x * i11,
    to.a.y * i01 + to.b.y * i11,
    0,
    0,
  ];
}

const STORAGE_KEY = 'escher-doc-v2';

export function loadDoc(): Doc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as Doc;
    if (!doc.lattice?.a || !doc.tile || !Array.isArray(doc.colors)) return null;
    return { ...newDoc(), ...doc };
  } catch {
    return null;
  }
}

export function saveDoc(doc: Doc): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage may be unavailable (private mode); the app still works.
  }
}

export class History {
  private past: string[] = [];
  private future: string[] = [];
  /** State before a live change (slider, colour picker, drag) began. */
  private liveBase: string | null = null;

  constructor(private current: Doc) {}

  get doc(): Doc {
    return this.current;
  }

  /** Records a new state. */
  push(next: Doc): void {
    this.commit();
    this.past.push(JSON.stringify(this.current));
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.current = next;
  }

  /** Shows an intermediate state without recording it; `commit` records the whole change once. */
  replaceLive(next: Doc): void {
    if (this.liveBase === null) this.liveBase = JSON.stringify(this.current);
    this.current = next;
  }

  commit(): void {
    if (this.liveBase === null) return;
    if (this.liveBase !== JSON.stringify(this.current)) {
      this.past.push(this.liveBase);
      this.future = [];
    }
    this.liveBase = null;
  }

  undo(): boolean {
    this.commit();
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(JSON.stringify(this.current));
    this.current = JSON.parse(prev);
    return true;
  }

  redo(): boolean {
    this.commit();
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(JSON.stringify(this.current));
    this.current = JSON.parse(next);
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
