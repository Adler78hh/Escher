// The drawing area: shows the parquet, the grid or the tile being edited and
// turns pointer input into edits.

import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  type Affine,
  type Pt,
  type Region,
  IDENTITY,
  add,
  apply,
  bounds,
  invert,
  len,
  pointInRegion,
  regionToPath,
} from '../core/geom';
import { type Placement, applyEdit, snapToBoundary, stampRegion } from '../core/tile';
import { baseTileOf } from '../model/doc';
import { SNAP_STEP, dragLattice, withLattice } from '../model/lattice';
import type { View } from '../parquets/types';
import { copyColor, lineWidth, parquetMarkup, tileDefs } from '../render/markup';
import { store, useStore } from './store';

/** Colours for edges that belong together. */
export const EDGE_COLORS = ['#1e88e5', '#e53935', '#43a047', '#fb8c00'];

const ADD = '#2e7d32';
const NIBBLE = '#c62828';

type Gesture =
  | { kind: 'handle'; which: 'a' | 'b' }
  | { kind: 'free'; points: Pt[] }
  | { kind: 'stamp' }
  | { kind: 'brush'; points: Pt[]; copy: Affine };

export function Stage() {
  const s = useStore();
  const { doc, ui } = s;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [overlay, setOverlay] = useState<ReactNode>(null);
  const gesture = useRef<Gesture | null>(null);
  const placement = useRef<Placement | null>(null);
  const frozen = useRef<View | null>(null);

  useLayoutEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clear previews when the step or tool changes.
  useEffect(() => setOverlay(null), [ui.step, ui.finish, ui.tool, ui.shape]);

  const side = Math.max(len(doc.lattice.a), len(doc.lattice.b));
  const lw = lineWidth(doc);
  const finishView = ui.step === 5 && ui.finish !== 'design';
  const mode: 'parquet' | 'symmetry' | 'grid' | 'edit' =
    ui.step === 1 || finishView ? 'parquet' : ui.step === 2 ? 'symmetry' : ui.step === 3 ? 'grid' : 'edit';

  const view = frozen.current ?? computeView();

  function computeView(): View {
    const { a, b } = doc.lattice;
    const aspect = size.w > 0 && size.h > 0 ? size.w / size.h : 1.4;
    const corners = [{ x: 0, y: 0 }, a, b, add(a, b)];
    if (mode === 'parquet') {
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const cells = ui.step === 5 && ui.finish === 'show' ? ui.zoom : 5;
      let w = cells * side;
      let h = w / aspect;
      if (h < cells * side * 0.75) {
        h = cells * side * 0.75;
        w = h * aspect;
      }
      return { minX: c.x - w / 2, minY: c.y - h / 2, maxX: c.x + w / 2, maxY: c.y + h / 2 };
    }
    // Fit the grid cell (and the tile) plus a margin, so the neighbours show around it.
    const tb = bounds(doc.tile);
    const minX = Math.min(...corners.map((p) => p.x), tb.minX);
    const maxX = Math.max(...corners.map((p) => p.x), tb.maxX);
    const minY = Math.min(...corners.map((p) => p.y), tb.minY);
    const maxY = Math.max(...corners.map((p) => p.y), tb.maxY);
    const m = side * (mode === 'grid' ? 0.9 : 0.55);
    let w = maxX - minX + 2 * m;
    let h = maxY - minY + 2 * m;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
  }

  // ---------------------------------------------------------------------------
  // Content

  let content = '';
  const impl = s.impl;
  const sym = s.sym;
  if (mode === 'parquet') {
    content = parquetMarkup(doc, impl.copiesForView(doc.lattice, sym, view, 2));
  } else {
    const t = tileDefs(doc);
    content = `<defs>${t.defs}</defs>`;
    const showNeighbours = mode === 'grid' || mode === 'symmetry' || ui.neighbours;
    if (showNeighbours) {
      const copies = mode === 'grid' ? impl.copiesForView(doc.lattice, sym, view, 1) : impl.copiesAround(doc.lattice, sym, 2);
      for (const c of copies) {
        if (c.m.every((v, i) => v === IDENTITY[i])) continue;
        content += t.copy(c.m, copyColor(doc, c), { stroke: '#555', strokeWidth: lw * 0.6, opacity: 0.4 });
      }
    }
    content += `<path d="${regionToPath(baseTileOf(doc))}" fill="none" stroke="#888" stroke-width="${lw * 0.7}" stroke-dasharray="${lw * 3} ${lw * 3}"/>`;
    content += t.copy(IDENTITY, doc.colors[0], { stroke: '#111', strokeWidth: lw * 1.6 });
  }

  // ---------------------------------------------------------------------------
  // Pointer input

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const editCtx = () => ({ impl: store.impl, sym: store.sym, lat: store.doc.lattice });

  function tryEdit(shape: Region) {
    const d = store.doc;
    const res = applyEdit(d.tile, shape, store.ui.tool, editCtx());
    if (!res.ok) store.toast(res.reason);
    else store.commit({ ...d, tile: res.tile });
  }

  function stampPreview(p: Pt) {
    const d = store.doc;
    const shape = store.ui.shape;
    const sz = store.ui.stampSize * side;
    placement.current = snapToBoundary(p, d.tile, sz, side * 0.3);
    if (!placement.current || shape === 'free') {
      setOverlay(null);
      return;
    }
    const r = stampRegion(shape, placement.current, sz, store.ui.tool);
    const color = store.ui.tool === 'add' ? ADD : NIBBLE;
    setOverlay(
      <>
        <path d={regionToPath(r)} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={lw} />
        <circle cx={placement.current.point.x} cy={placement.current.point.y} r={side * 0.012} fill={color} />
      </>,
    );
  }

  /** Copy of the tile under the point, so drawing on a neighbour lands on the tile. */
  function copyAt(p: Pt): Affine {
    for (const c of impl.copiesAround(doc.lattice, sym, 2)) {
      if (pointInRegion(apply(invert(c.m), p), doc.tile)) return c.m;
    }
    return IDENTITY;
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    const p = toWorld(e);
    const handle = (e.target as Element).closest('[data-handle]');
    if (mode === 'grid' && handle) {
      gesture.current = { kind: 'handle', which: handle.getAttribute('data-handle') as 'a' | 'b' };
      frozen.current = view;
    } else if (mode === 'edit' && ui.step === 4 && ui.shape === 'free') {
      gesture.current = { kind: 'free', points: [p] };
    } else if (mode === 'edit' && ui.step === 4) {
      gesture.current = { kind: 'stamp' };
      stampPreview(p);
    } else if (mode === 'edit' && ui.step === 5 && ui.brush) {
      const copy = copyAt(p);
      gesture.current = { kind: 'brush', points: [apply(invert(copy), p)], copy };
    } else return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const p = toWorld(e);
    const g = gesture.current;
    if (!g) {
      if (mode === 'edit' && ui.step === 4 && ui.shape !== 'free' && e.pointerType !== 'touch') stampPreview(p);
      return;
    }
    const minStep = side * 0.004;
    switch (g.kind) {
      case 'handle': {
        const d = store.doc;
        const next = dragLattice(d.lattice, g.which, p, store.sym, store.ui.snap);
        if (next) store.live(withLattice(d, next));
        break;
      }
      case 'free': {
        const last = g.points[g.points.length - 1];
        if (len({ x: p.x - last.x, y: p.y - last.y }) > minStep) g.points.push(p);
        setOverlay(<Polyline points={g.points} color={store.ui.tool === 'add' ? ADD : NIBBLE} width={lw * 1.2} />);
        break;
      }
      case 'stamp':
        stampPreview(p);
        break;
      case 'brush': {
        const q = apply(invert(g.copy), p);
        const last = g.points[g.points.length - 1];
        if (len({ x: q.x - last.x, y: q.y - last.y }) > minStep) g.points.push(q);
        setOverlay(<Polyline points={g.points.map((pt) => apply(g.copy, pt))} color={ui.penColor} width={ui.penWidth * side} />);
        break;
      }
    }
  }

  function endGesture(cancel: boolean) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    setOverlay(null);
    switch (g.kind) {
      case 'handle':
        frozen.current = null;
        store.endLive();
        break;
      case 'free':
        if (!cancel && g.points.length >= 3) tryEdit([[g.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))]]);
        break;
      case 'stamp':
        if (!cancel && placement.current && store.ui.shape !== 'free') {
          tryEdit(stampRegion(store.ui.shape, placement.current, store.ui.stampSize * side, store.ui.tool));
        }
        placement.current = null;
        break;
      case 'brush':
        if (!cancel) {
          const d = store.doc;
          const stroke = {
            points: g.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
            color: store.ui.penColor,
            width: Math.round(store.ui.penWidth * side),
          };
          store.commit({ ...d, strokes: [...d.strokes, stroke] });
        }
        break;
    }
  }

  return (
    <svg
      ref={svgRef}
      id="canvas"
      viewBox={`${view.minX} ${view.minY} ${view.maxX - view.minX} ${view.maxY - view.minY}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endGesture(false)}
      onPointerCancel={() => endGesture(true)}
      onPointerLeave={(e) => {
        if (!gesture.current && e.pointerType !== 'touch') setOverlay(null);
      }}
    >
      {mode === 'grid' && ui.snap && <HelperGrid view={view} width={lw * 0.4} />}
      <g dangerouslySetInnerHTML={{ __html: content }} />
      {(mode === 'symmetry' || mode === 'edit') && <EdgeMarks lw={lw} side={side} centres={mode === 'symmetry' || ui.step === 4} solid={mode === 'symmetry'} />}
      {mode === 'grid' && <GridHandles lw={lw} side={side} view={view} />}
      <g>{overlay}</g>
    </svg>
  );
}

function Polyline({ points, color, width }: { points: Pt[]; color: string; width: number }) {
  if (!points.length) return null;
  return (
    <path
      d={'M' + points.map((p) => `${p.x} ${p.y}`).join('L')}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Edges of the grid cell coloured by the group they belong to, plus the centres of rotation. */
function EdgeMarks({ lw, side, centres, solid }: { lw: number; side: number; centres: boolean; solid: boolean }) {
  const { doc, impl, sym } = useStore();
  const c = impl.corners(doc.lattice);
  const r = side * 0.025;
  return (
    <g pointerEvents="none">
      {sym.edges.map((e, i) => {
        const p = c[i];
        const q = c[(i + 1) % c.length];
        return (
          <line
            key={i}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            stroke={EDGE_COLORS[e.group % EDGE_COLORS.length]}
            strokeWidth={lw * (solid ? 3 : 2.2)}
            strokeOpacity={solid ? 0.95 : 0.75}
            strokeLinecap="round"
            strokeDasharray={solid ? undefined : `${lw * 6} ${lw * 3}`}
          />
        );
      })}
      {centres &&
        sym.rotationCentres(doc.lattice).map((rc, i) =>
          rc.order === 2 ? (
            <circle key={i} cx={rc.point.x} cy={rc.point.y} r={r} fill="#fff" stroke="#111" strokeWidth={lw * 0.8} />
          ) : (
            <rect
              key={i}
              x={rc.point.x - r * 1.2}
              y={rc.point.y - r * 1.2}
              width={r * 2.4}
              height={r * 2.4}
              fill="#fff"
              stroke="#111"
              strokeWidth={lw * 0.8}
              transform={`rotate(45 ${rc.point.x} ${rc.point.y})`}
            />
          ),
        )}
    </g>
  );
}

function HelperGrid({ view, width }: { view: View; width: number }) {
  const lines: ReactNode[] = [];
  const x0 = Math.floor(view.minX / SNAP_STEP) * SNAP_STEP;
  const y0 = Math.floor(view.minY / SNAP_STEP) * SNAP_STEP;
  for (let x = x0; x <= view.maxX; x += SNAP_STEP) lines.push(<line key={'x' + x} x1={x} y1={view.minY} x2={x} y2={view.maxY} />);
  for (let y = y0; y <= view.maxY; y += SNAP_STEP) lines.push(<line key={'y' + y} x1={view.minX} y1={y} x2={view.maxX} y2={y} />);
  return (
    <g stroke="#000" strokeOpacity={0.08} strokeWidth={width} pointerEvents="none">
      {lines}
    </g>
  );
}

function GridHandles({ lw, side, view }: { lw: number; side: number; view: View }) {
  const { doc, impl } = useStore();
  const { a, b } = doc.lattice;
  // Lattice points in view.
  const dots: ReactNode[] = [];
  const T = impl.symmetries[0];
  for (const c of impl.copiesForView(doc.lattice, T, view, 1)) {
    const p = apply(c.m, { x: 0, y: 0 });
    dots.push(<circle key={c.key} cx={p.x} cy={p.y} r={side * 0.018} fill="#333" />);
  }
  const handle = (name: 'a' | 'b', p: Pt) => (
    <g className="handle" data-handle={name} key={name}>
      <circle cx={p.x} cy={p.y} r={side * 0.1} fill="transparent" />
      <circle cx={p.x} cy={p.y} r={side * 0.05} fill="#e53935" stroke="#fff" strokeWidth={lw} />
      <text x={p.x} y={p.y} dy="0.35em" textAnchor="middle" fontSize={side * 0.055} fontWeight={700} fill="#fff" pointerEvents="none">
        {name}
      </text>
    </g>
  );
  return (
    <g>
      {dots}
      <line x1={0} y1={0} x2={a.x} y2={a.y} stroke="#e53935" strokeWidth={lw * 1.5} pointerEvents="none" />
      <line x1={0} y1={0} x2={b.x} y2={b.y} stroke="#e53935" strokeWidth={lw * 1.5} pointerEvents="none" />
      <circle cx={0} cy={0} r={side * 0.035} fill="#333" stroke="#fff" strokeWidth={lw} />
      {handle('a', a)}
      {handle('b', b)}
    </g>
  );
}
