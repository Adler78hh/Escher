// Document state, undo/redo and local autosave.

import type { Affine, Pt, Region } from './geom';
import { type Lattice, type SymmetryMode } from './symmetry';
import { baseTile } from './tile';

export type GridForm = 'square' | 'rect' | 'parallelogram';
export type Coloring = 'single' | 'checker' | 'rotation';

export interface Stroke {
  points: Pt[];
  color: string;
  width: number;
}

export interface Doc {
  parquet: string;
  mode: SymmetryMode;
  form: GridForm;
  lattice: Lattice;
  tile: Region;
  strokes: Stroke[];
  /** Fill colours: [0] the piece, [1] second colour for the checkerboard, [2], [3] for four orientations. */
  colors: string[];
  coloring: Coloring;
  outlines: boolean;
}

export const DEFAULT_SIDE = 1000;

export function newDoc(): Doc {
  const lattice: Lattice = { u: { x: DEFAULT_SIDE, y: 0 }, v: { x: 0, y: DEFAULT_SIDE } };
  return {
    parquet: '4.4.4.4',
    mode: 'T',
    form: 'square',
    lattice,
    tile: baseTile(lattice),
    strokes: [],
    colors: ['#f2a541', '#3a86c8', '#7bc950', '#e05263'],
    coloring: 'checker',
    outlines: true,
  };
}

/** True once the tile differs from the plain grid cell. */
export function isEdited(doc: Doc): boolean {
  return JSON.stringify(doc.tile) !== JSON.stringify(baseTile(doc.lattice)) || doc.strokes.length > 0;
}

/** Affine map carrying the old lattice cell onto the new one (both anchored at the origin). */
export function latticeChange(from: Lattice, to: Lattice): Affine {
  const det = from.u.x * from.v.y - from.u.y * from.v.x;
  // Inverse of [u v] (columns).
  const i00 = from.v.y / det;
  const i01 = -from.v.x / det;
  const i10 = -from.u.y / det;
  const i11 = from.u.x / det;
  // [u' v'] * inv([u v])
  const a = to.u.x * i00 + to.v.x * i10;
  const c = to.u.x * i01 + to.v.x * i11;
  const b = to.u.y * i00 + to.v.y * i10;
  const d = to.u.y * i01 + to.v.y * i11;
  return [a, b, c, d, 0, 0];
}

const STORAGE_KEY = 'escher-doc-v1';

export function loadDoc(): Doc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as Doc;
    if (!doc.lattice || !doc.tile || !Array.isArray(doc.colors)) return null;
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
