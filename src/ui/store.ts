// App store: the document with its history plus UI settings. Components
// subscribe through `useStore`.

import { useSyncExternalStore } from 'react';
import type { StampKind, EditTool } from '../core/tile';
import { type Doc, History, loadDoc, newDoc, saveDoc } from '../model/doc';
import { implOf, symmetryOf } from '../parquets';
import type { PrintOptions } from '../render/print';

export const STEPS = ['Parkett', 'Symmetrie', 'Raster', 'Bearbeiten', 'Gestalten'] as const;

export type FinishTab = 'design' | 'show' | 'print';

export interface UiState {
  step: number;
  /** Sub-tab of step 5. */
  finish: FinishTab;
  tool: EditTool;
  shape: 'free' | StampKind;
  /** Stamp size as a fraction of the grid edge. */
  stampSize: number;
  neighbours: boolean;
  brush: boolean;
  penColor: string;
  /** Pen width as a fraction of the grid edge. */
  penWidth: number;
  /** Cells across the screen in the parquet view. */
  zoom: number;
  /** Snap grid points to the helper grid. */
  snap: boolean;
  print: PrintOptions & { template: boolean; area: boolean };
}

type Listener = () => void;

class Store {
  readonly history = new History(loadDoc() ?? newDoc());
  ui: UiState = {
    step: 1,
    finish: 'design',
    tool: 'add',
    shape: 'free',
    stampSize: 0.22,
    neighbours: true,
    brush: true,
    penColor: '#1b1b1b',
    penWidth: 0.012,
    zoom: 6,
    snap: true,
    print: { sideCm: 5, coloredTemplate: false, template: true, area: true },
  };
  toastText = '';
  toastId = 0;
  version = 0;
  private listeners = new Set<Listener>();

  get doc(): Doc {
    return this.history.doc;
  }

  get impl() {
    return implOf(this.doc.parquet);
  }

  get sym() {
    return symmetryOf(this.impl, this.doc.symmetry);
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Records a new document state (one undo step). */
  commit(next: Doc) {
    this.history.push(next);
    saveDoc(next);
    this.emit();
  }

  /** Shows an intermediate state while dragging; `endLive` records it as one step. */
  live(next: Doc) {
    this.history.replaceLive(next);
    this.emit();
  }

  endLive() {
    this.history.commit();
    saveDoc(this.doc);
    this.emit();
  }

  undo() {
    if (this.history.undo()) {
      saveDoc(this.doc);
      this.emit();
    }
  }

  redo() {
    if (this.history.redo()) {
      saveDoc(this.doc);
      this.emit();
    }
  }

  setUi(patch: Partial<UiState>) {
    this.ui = { ...this.ui, ...patch };
    this.emit();
  }

  toast(text: string) {
    this.toastText = text;
    this.toastId++;
    this.emit();
  }
}

export const store = new Store();

export function useStore(): Store {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store;
}
