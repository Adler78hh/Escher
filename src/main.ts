import './style.css';
import { type Affine, type Pt, type Region, IDENTITY, apply, bounds, invert, len, pointInRegion, regionToPath, transformRegion } from './geom';
import { PAGE, type PrintOptions, areaSvg, downloadSvg, pieceSizeMm, printPages, templateSvg } from './print';
import { copyColor, esc, lineWidth, parquetMarkup, tileDefs } from './render';
import { type Coloring, type Doc, type GridForm, History, isEdited, latticeChange, loadDoc, newDoc, saveDoc } from './state';
import { type Copy, type Lattice, type SymmetryMode, copiesForView, copiesInRange } from './symmetry';
import { type EditTool, type Placement, type StampKind, applyEdit, baseTile, snapToBoundary, stampRegion } from './tile';

// ---------------------------------------------------------------------------
// Static content

const STEPS = ['Parkett', 'Raster', 'Fliese', 'Gestalten', 'Anzeigen', 'Ausgabe'];

/** The 11 parquets of regular polygons (vertex configurations), numbered as in class. Only Parkett 7 is available so far. */
const PARQUETS: { n: number; id: string; label: string; ready: boolean }[] = [
  { n: 1, id: '3.3.3.3.3.3', label: '(3,3,3,3,3,3)', ready: false },
  { n: 2, id: '3.3.3.3.6', label: '(3,3,3,3,6)', ready: false },
  { n: 3, id: '3.3.3.4.4', label: '(3,3,3,4,4)', ready: false },
  { n: 4, id: '3.3.4.3.4', label: '(3,3,4,3,4)', ready: false },
  { n: 5, id: '3.4.6.4', label: '(3,4,6,4)', ready: false },
  { n: 6, id: '3.6.3.6', label: '(3,6,3,6)', ready: false },
  { n: 7, id: '4.4.4.4', label: '(4,4,4,4)', ready: true },
  { n: 8, id: '4.8.8', label: '(4,8,8)', ready: false },
  { n: 9, id: '3.12.12', label: '(3,12,12)', ready: false },
  { n: 10, id: '4.6.12', label: '(4,6,12)', ready: false },
  { n: 11, id: '6.6.6', label: '(6,6,6)', ready: false },
];

const SYMMETRIES: { id: SymmetryMode; title: string; text: string }[] = [
  { id: 'T', title: 'Verschieben', text: 'Was oben herausragt, fehlt unten – links und rechts genauso.' },
  { id: 'C2', title: 'Drehen um die Kantenmitte', text: 'Jede Kante wird um ihre Mitte um 180° gedreht.' },
  { id: 'C4', title: 'Drehen um die Ecke (90°)', text: 'Die obere Kante wird zur linken – wie bei Eschers Eidechsen. Nur beim Quadrat.' },
];

const FORMS: { id: GridForm; title: string }[] = [
  { id: 'square', title: 'Quadrat' },
  { id: 'rect', title: 'Rechteck' },
  { id: 'parallelogram', title: 'Parallelogramm' },
];

const SHAPES: { id: 'free' | StampKind; title: string; icon: string }[] = [
  { id: 'free', title: 'Freihand', icon: '✎' },
  { id: 'circle', title: 'Kreis', icon: '●' },
  { id: 'triangle', title: 'Dreieck', icon: '▲' },
  { id: 'rect', title: 'Rechteck', icon: '■' },
];

const FILL_SWATCHES = ['#f2a541', '#e05263', '#3a86c8', '#7bc950', '#9b5de5', '#f15bb5', '#00bbf9', '#fee440', '#8d6e63', '#ffffff', '#9e9e9e', '#2b2d42'];
const PEN_SWATCHES = ['#1b1b1b', '#ffffff', '#c62828', '#1565c0', '#2e7d32', '#6d4c41', '#f9a825'];

// ---------------------------------------------------------------------------
// State

interface UiState {
  step: number;
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
  print: PrintOptions & { template: boolean; area: boolean };
}

const history = new History(loadDoc() ?? newDoc());
const ui: UiState = {
  step: 1,
  tool: 'add',
  shape: 'free',
  stampSize: 0.22,
  neighbours: true,
  brush: true,
  penColor: '#1b1b1b',
  penWidth: 0.012,
  zoom: 6,
  print: { sideCm: 5, coloredTemplate: false, template: true, area: true },
};

const doc = (): Doc => history.doc;
const side = (): number => Math.max(len(doc().lattice.u), len(doc().lattice.v));

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const svg = $('#canvas') as unknown as SVGSVGElement;
const panel = $<HTMLElement>('#panel');

function commitDoc(next: Doc, opts: { panel?: boolean } = {}) {
  history.push(next);
  saveDoc(next);
  render(opts.panel ?? true);
}

function liveDoc(next: Doc) {
  history.replaceLive(next);
  renderCanvas();
}

function endLive() {
  history.commit();
  saveDoc(doc());
  render(true);
}

// ---------------------------------------------------------------------------
// Toast messages

let toastTimer = 0;
function toast(text: string) {
  const el = $<HTMLElement>('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 4500);
}

// ---------------------------------------------------------------------------
// Rendering

function render(withPanel: boolean) {
  renderSteps();
  if (withPanel) renderPanel();
  renderCanvas();
}

function renderSteps() {
  $<HTMLElement>('#steps').innerHTML = STEPS.map(
    (s, i) => `<button class="step ${ui.step === i + 1 ? 'active' : ''}" data-step="${i + 1}"><span class="num">${i + 1}</span><span class="label">${s}</span></button>`,
  ).join('');
  ($('#undo') as HTMLButtonElement).disabled = !history.canUndo;
  ($('#redo') as HTMLButtonElement).disabled = !history.canRedo;
}

/** Current view rectangle in world coordinates (matches the canvas aspect ratio). */
let view = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
let frozenView: typeof view | null = null;

function computeView(): typeof view {
  if (frozenView) return frozenView;
  const { u, v } = doc().lattice;
  const rect = svg.getBoundingClientRect();
  const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1.4;
  let cx: number;
  let cy: number;
  let w: number;
  let h: number;
  if (ui.step === 5 || ui.step === 6 || ui.step === 1) {
    cx = (u.x + v.x) / 2;
    cy = (u.y + v.y) / 2;
    const cells = ui.step === 5 ? ui.zoom : 5;
    w = cells * side();
    h = w / aspect;
    if (h < cells * side() * 0.75) {
      h = cells * side() * 0.75;
      w = h * aspect;
    }
  } else {
    // Fit the grid cell plus a margin, so the neighbours show around it.
    const corners = [{ x: 0, y: 0 }, u, v, { x: u.x + v.x, y: u.y + v.y }];
    const tb = bounds(doc().tile);
    const minX = Math.min(...corners.map((p) => p.x), tb.minX);
    const maxX = Math.max(...corners.map((p) => p.x), tb.maxX);
    const minY = Math.min(...corners.map((p) => p.y), tb.minY);
    const maxY = Math.max(...corners.map((p) => p.y), tb.maxY);
    const m = side() * (ui.step === 2 ? 0.9 : 0.55);
    cx = (minX + maxX) / 2;
    cy = (minY + maxY) / 2;
    w = maxX - minX + 2 * m;
    h = maxY - minY + 2 * m;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
  }
  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
}

function renderCanvas() {
  view = computeView();
  svg.setAttribute('viewBox', `${view.minX} ${view.minY} ${view.maxX - view.minX} ${view.maxY - view.minY}`);
  const d = doc();
  const lw = lineWidth(d);
  let out = '';
  if (ui.step === 1 || ui.step >= 5) {
    out = parquetMarkup(d, copiesForView(d.lattice, d.mode, view, 2));
  } else if (ui.step === 2) {
    out = gridMarkup(d, lw);
  } else {
    out = editMarkup(d, lw);
  }
  svg.innerHTML = out + `<g id="overlay"></g>`;
}

function gridMarkup(d: Doc, lw: number): string {
  const { u, v } = d.lattice;
  const t = tileDefs(d);
  const copies = copiesForView(d.lattice, d.mode, view, 1);
  let s = `<defs>${t.defs}</defs>`;
  s += copies
    .filter((c) => c.cell[0] !== 0 || c.cell[1] !== 0)
    .map((c) => t.copy(c.m, copyColor(d, c), { stroke: '#555', strokeWidth: lw * 0.6, opacity: 0.35 }))
    .join('');
  s += t.copy([1, 0, 0, 1, 0, 0], d.colors[0], { stroke: '#222', strokeWidth: lw * 1.5 });
  // Lattice points.
  const r = side() * 0.018;
  for (const c of copiesInRange(d.lattice, 'T', -3, 3, -3, 3)) {
    const p = apply(c.m, { x: 0, y: 0 });
    s += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#333"/>`;
  }
  // Drag handles.
  const handle = (name: string, p: Pt) =>
    `<g class="handle" data-handle="${name}"><circle cx="${p.x}" cy="${p.y}" r="${side() * 0.09}" fill="transparent"/>` +
    `<circle cx="${p.x}" cy="${p.y}" r="${side() * 0.045}" fill="#e53935" stroke="#fff" stroke-width="${lw}"/></g>`;
  s += `<circle cx="0" cy="0" r="${side() * 0.035}" fill="#333" stroke="#fff" stroke-width="${lw}"/>`;
  if (d.form !== 'square') s += handle('u', u) + handle('v', v);
  else s += handle('u', u);
  return s;
}

function editMarkup(d: Doc, lw: number): string {
  const t = tileDefs(d);
  let s = `<defs>${t.defs}</defs>`;
  if (ui.neighbours) {
    for (const c of copiesInRange(d.lattice, d.mode, -2, 2, -2, 2)) {
      if (c.cell[0] === 0 && c.cell[1] === 0) continue;
      s += t.copy(c.m, copyColor(d, c), { stroke: '#555', strokeWidth: lw * 0.6, opacity: 0.4 });
    }
  }
  // Plain grid cell for orientation.
  s += `<path d="${regionToPath(baseTile(d.lattice))}" fill="none" stroke="#888" stroke-width="${lw * 0.7}" stroke-dasharray="${lw * 3} ${lw * 3}"/>`;
  s += t.copy([1, 0, 0, 1, 0, 0], d.colors[0], { stroke: '#111', strokeWidth: lw * 1.6 });
  if (ui.step === 3) s += rotationCentres(d, lw);
  return s;
}

/** Marks the points the tile is turned about – shapes must not sit right on them. */
function rotationCentres(d: Doc, lw: number): string {
  const { u, v } = d.lattice;
  const mid = (p: Pt, q: Pt) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const o = { x: 0, y: 0 };
  const w = { x: u.x + v.x, y: u.y + v.y };
  const r = side() * 0.025;
  const dot = (p: Pt) => `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#fff" stroke="#111" stroke-width="${lw * 0.8}"/>`;
  const square = (p: Pt) =>
    `<rect x="${p.x - r * 1.2}" y="${p.y - r * 1.2}" width="${r * 2.4}" height="${r * 2.4}" fill="#fff" stroke="#111" stroke-width="${lw * 0.8}" transform="rotate(45 ${p.x} ${p.y})"/>`;
  if (d.mode === 'C2') return [mid(o, u), mid(u, w), mid(w, v), mid(v, o)].map(dot).join('');
  if (d.mode === 'C4') return [o, w].map(dot).join('') + [u, v].map(square).join('');
  return '';
}

function overlay(markup: string) {
  const g = svg.querySelector('#overlay');
  if (g) g.innerHTML = markup;
}

// ---------------------------------------------------------------------------
// Panel

function renderPanel() {
  const d = doc();
  let h = '';
  switch (ui.step) {
    case 1:
      h = `<h2>1 · Parkett wählen</h2>
        <p class="hint">Wähle die Grundform des Parketts. Für den Anfang gibt es Parkett 7, das Quadratgitter (4,4,4,4).</p>
        <div class="cards parquets">${PARQUETS.map(
          (p) => `<button class="card ${d.parquet === p.id ? 'active' : ''}" data-parquet="${p.id}" ${p.ready ? '' : 'disabled'}>
            <span class="card-title">Parkett ${p.n}</span><span class="card-label">${p.label}</span><span class="card-text">${p.ready ? 'Quadrat-Gitter' : 'kommt später'}</span></button>`,
        ).join('')}</div>`;
      break;
    case 2:
      h = `<h2>2 · Raster und Symmetrie</h2>
        <h3>Wie passen die Kanten zusammen?</h3>
        <div class="cards">${SYMMETRIES.map(
          (s) => `<button class="card ${d.mode === s.id ? 'active' : ''}" data-mode="${s.id}">
            <span class="card-title">${s.title}</span><span class="card-text">${s.text}</span></button>`,
        ).join('')}</div>
        <h3>Form des Rasters</h3>
        <div class="seg">${FORMS.map(
          (f) => `<button class="${d.form === f.id ? 'active' : ''}" data-form="${f.id}" ${d.mode === 'C4' && f.id !== 'square' ? 'disabled' : ''}>${f.title}</button>`,
        ).join('')}</div>
        <p class="hint">${
          d.form === 'square'
            ? 'Beim Quadrat gibt es nichts zu verschieben.'
            : 'Ziehe die roten Punkte, um das Raster zu verändern.'
        }${isEdited(d) ? ' Deine Fliese wird dabei mit verzerrt.' : ''}</p>`;
      break;
    case 3:
      h = `<h2>3 · Fliese bearbeiten</h2>
        <div class="seg big">
          <button class="${ui.tool === 'add' ? 'active add' : ''}" data-tool="add">＋ Hinzufügen</button>
          <button class="${ui.tool === 'nibble' ? 'active nibble' : ''}" data-tool="nibble">－ Anknabbern</button>
        </div>
        <h3>Form</h3>
        <div class="seg">${SHAPES.map(
          (s) => `<button class="${ui.shape === s.id ? 'active' : ''}" data-shape="${s.id}"><span class="ico">${s.icon}</span> ${s.title}</button>`,
        ).join('')}</div>
        ${
          ui.shape === 'free'
            ? `<p class="hint">Male eine geschlossene Form über den Rand der Fliese. ${
                ui.tool === 'add' ? 'Was außen liegt, kommt dazu' : 'Was innen liegt, wird abgeknabbert'
              } – auf der Gegenseite passiert automatisch das Gegenteil.</p>`
            : `<label class="slider">Größe <input type="range" min="0.06" max="0.5" step="0.01" value="${ui.stampSize}" data-input="stampSize"></label>
               <p class="hint">Fahre an den Rand der Fliese – die Form rastet ein. Tippen oder klicken setzt sie.</p>`
        }
        ${d.mode !== 'T' ? `<p class="hint">Die weißen Punkte sind Drehpunkte. Setze Formen daneben, nicht genau darauf.</p>` : ''}
        <label class="check"><input type="checkbox" data-check="neighbours" ${ui.neighbours ? 'checked' : ''}> Nachbarfliesen zeigen</label>
        <button class="secondary" data-action="reset-tile">Fliese zurücksetzen</button>`;
      break;
    case 4:
      h = `<h2>4 · Gestalten</h2>
        <h3>Farbe der Fliese</h3>
        ${swatches(FILL_SWATCHES, d.colors[0], 'fill')}
        <label class="color">Eigene Farbe <input type="color" value="${d.colors[0]}" data-color="0"></label>
        <h3>Zeichnen</h3>
        <label class="check"><input type="checkbox" data-check="brush" ${ui.brush ? 'checked' : ''}> Mit dem Stift auf die Fliese malen (Augen, Muster …)</label>
        ${swatches(PEN_SWATCHES, ui.penColor, 'pen')}
        <label class="slider">Strichstärke <input type="range" min="0.004" max="0.05" step="0.002" value="${ui.penWidth}" data-input="penWidth"></label>
        <button class="secondary" data-action="clear-strokes" ${d.strokes.length ? '' : 'disabled'}>Alle Linien löschen</button>`;
      break;
    case 5: {
      const colorings: { id: Coloring; title: string }[] = [
        { id: 'single', title: 'Eine Farbe' },
        { id: 'checker', title: 'Schachbrett' },
      ];
      if (d.mode !== 'T') colorings.push({ id: 'rotation', title: 'Nach Drehung' });
      const used = d.coloring === 'single' ? 1 : d.coloring === 'rotation' && d.mode === 'C4' ? 4 : 2;
      h = `<h2>5 · Parkett anzeigen</h2>
        <div class="seg">${colorings
          .map((c) => `<button class="${d.coloring === c.id ? 'active' : ''}" data-coloring="${c.id}">${c.title}</button>`)
          .join('')}</div>
        <div class="colors">${d.colors
          .slice(0, used)
          .map((c, i) => `<label class="color">Farbe ${i + 1} <input type="color" value="${c}" data-color="${i}"></label>`)
          .join('')}</div>
        <label class="check"><input type="checkbox" data-check="outlines" ${d.outlines ? 'checked' : ''}> Umrisse zeigen</label>
        <label class="slider">Zoom <input type="range" min="2" max="14" step="0.5" value="${ui.zoom}" data-input="zoom"></label>`;
      break;
    }
    case 6: {
      const size = pieceSizeMm(d, ui.print);
      const tooBig = size.w > PAGE.w || size.h > PAGE.h - 20;
      h = `<h2>6 · Ausgabe</h2>
        <label class="number">Kantenlänge des Rasters <input type="number" min="1" max="25" step="0.5" value="${ui.print.sideCm}" data-print="sideCm"> cm</label>
        <p class="hint">Das Puzzlestück ist dann ${fmt(size.w / 10)} × ${fmt(size.h / 10)} cm groß.${
          tooBig ? ' <strong>Es passt nicht auf ein A4-Blatt – wähle eine kleinere Kantenlänge.</strong>' : ''
        }</p>
        <h3>Was soll gedruckt werden?</h3>
        <label class="check"><input type="checkbox" data-pcheck="template" ${ui.print.template ? 'checked' : ''}> Schablone zum Ausschneiden</label>
        <label class="check indent"><input type="checkbox" data-pcheck="coloredTemplate" ${ui.print.coloredTemplate ? 'checked' : ''}> Schablone farbig mit Zeichnung</label>
        <label class="check"><input type="checkbox" data-pcheck="area" ${ui.print.area ? 'checked' : ''}> Ausgefüllte Fläche (A4)</label>
        <button class="primary" data-action="print">🖨 Drucken / als PDF speichern</button>
        <p class="hint">Im Druckdialog „Tatsächliche Größe“ bzw. Skalierung 100 % wählen, damit die Maße stimmen.</p>
        <div class="row">
          <button class="secondary" data-action="svg-template">SVG Schablone</button>
          <button class="secondary" data-action="svg-area">SVG Fläche</button>
        </div>`;
      break;
    }
  }
  const nav = `<div class="nav">
      <button class="secondary" data-action="prev" ${ui.step === 1 ? 'disabled' : ''}>← Zurück</button>
      <button class="primary" data-action="next" ${ui.step === STEPS.length ? 'disabled' : ''}>Weiter →</button>
    </div>`;
  panel.innerHTML = `<div class="panel-body">${h}</div>${nav}`;
}

const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });

function swatches(list: string[], current: string, kind: string): string {
  return `<div class="swatches">${list
    .map(
      (c) => `<button class="swatch ${c.toLowerCase() === current.toLowerCase() ? 'active' : ''}" style="background:${esc(c)}" data-swatch="${kind}" data-value="${c}" aria-label="Farbe ${c}"></button>`,
    )
    .join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Document changes

/** Applies a new lattice, distorting the tile and drawing along with it. */
function withLattice(d: Doc, lattice: Lattice): Doc {
  const m = latticeChange(d.lattice, lattice);
  const scaleFactor = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return {
    ...d,
    lattice,
    tile: transformRegion(d.tile, m),
    strokes: d.strokes.map((s) => ({ ...s, width: s.width * scaleFactor, points: s.points.map((p) => apply(m, p)) })),
  };
}

function latticeFor(form: GridForm, current: Lattice): Lattice {
  const w = Math.round(len(current.u) / 10) * 10;
  const h = Math.round(len(current.v) / 10) * 10;
  switch (form) {
    case 'square':
      return { u: { x: w, y: 0 }, v: { x: 0, y: w } };
    case 'rect':
      return { u: { x: w, y: 0 }, v: { x: 0, y: h === w ? Math.round((w * 0.7) / 10) * 10 : h } };
    case 'parallelogram':
      return { u: { x: w, y: 0 }, v: { x: Math.round((w * 0.3) / 10) * 10, y: Math.abs(current.v.y) || h } };
  }
}

function setMode(mode: SymmetryMode) {
  const d = doc();
  if (mode === d.mode) return;
  if (isEdited(d) && !confirm('Beim Wechsel der Symmetrie wird die Fliese zurückgesetzt. Fortfahren?')) return;
  let lattice = d.lattice;
  let form = d.form;
  if (mode === 'C4' && form !== 'square') {
    form = 'square';
    lattice = latticeFor('square', lattice);
  }
  const coloring: Coloring = mode === 'T' && d.coloring === 'rotation' ? 'checker' : d.coloring;
  commitDoc({ ...d, mode, form, lattice, coloring, tile: baseTile(lattice), strokes: [] });
}

function setForm(form: GridForm) {
  const d = doc();
  if (form === d.form) return;
  commitDoc({ ...withLattice(d, latticeFor(form, d.lattice)), form });
}

function tryEdit(shape: Region) {
  const d = doc();
  const res = applyEdit(d.tile, shape, ui.tool, d.lattice, d.mode);
  if (!res.ok) {
    toast(res.reason);
    renderCanvas();
    return;
  }
  commitDoc({ ...d, tile: res.tile }, { panel: false });
}

// ---------------------------------------------------------------------------
// Pointer input on the canvas

function toWorld(e: PointerEvent): Pt {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

type Gesture =
  | { kind: 'handle'; name: 'u' | 'v'; start: Doc }
  | { kind: 'free'; points: Pt[] }
  | { kind: 'stamp' }
  | { kind: 'brush'; points: Pt[]; copy: Affine };

let gesture: Gesture | null = null;
let placement: Placement | null = null;

function stampPreview(p: Pt) {
  const d = doc();
  const size = ui.stampSize * side();
  placement = snapToBoundary(p, d.tile, size, side() * 0.3);
  if (!placement || ui.shape === 'free') {
    overlay('');
    return;
  }
  const r = stampRegion(ui.shape, placement, size, ui.tool);
  const color = ui.tool === 'add' ? '#2e7d32' : '#c62828';
  overlay(
    `<path d="${regionToPath(r)}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="${lineWidth(d)}"/>` +
      `<circle cx="${placement.point.x}" cy="${placement.point.y}" r="${side() * 0.012}" fill="${color}"/>`,
  );
}

function polyline(points: Pt[], color: string, width: number, closed = false): string {
  if (!points.length) return '';
  const dd = 'M' + points.map((p) => `${p.x} ${p.y}`).join('L') + (closed ? 'Z' : '');
  return `<path d="${dd}" fill="${closed ? color : 'none'}" fill-opacity="0.25" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Copy of the tile under the point (base tile or a neighbour), so drawing on neighbours lands on the tile. */
function copyAt(p: Pt): Copy | null {
  const d = doc();
  for (const c of copiesInRange(d.lattice, d.mode, -2, 2, -2, 2)) {
    if (pointInRegion(apply(invert(c.m), p), d.tile)) return c;
  }
  return null;
}

svg.addEventListener('pointerdown', (e) => {
  const p = toWorld(e);
  const target = (e.target as Element).closest('[data-handle]');
  if (ui.step === 2 && target) {
    gesture = { kind: 'handle', name: target.getAttribute('data-handle') as 'u' | 'v', start: doc() };
    frozenView = view;
  } else if (ui.step === 3 && ui.shape === 'free') {
    gesture = { kind: 'free', points: [p] };
  } else if (ui.step === 3) {
    gesture = { kind: 'stamp' };
    stampPreview(p);
  } else if (ui.step === 4 && ui.brush) {
    // Drawing on a neighbour draws on the tile: map the points back through that copy.
    const copy = copyAt(p)?.m ?? IDENTITY;
    gesture = { kind: 'brush', points: [apply(invert(copy), p)], copy };
  } else return;
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
});

svg.addEventListener('pointermove', (e) => {
  const p = toWorld(e);
  if (!gesture) {
    if (ui.step === 3 && ui.shape !== 'free' && e.pointerType !== 'touch') stampPreview(p);
    return;
  }
  const minStep = side() * 0.004;
  switch (gesture.kind) {
    case 'handle':
      dragHandle(gesture.name, gesture.start, p);
      break;
    case 'free': {
      const last = gesture.points[gesture.points.length - 1];
      if (len({ x: p.x - last.x, y: p.y - last.y }) > minStep) gesture.points.push(p);
      overlay(polyline(gesture.points, ui.tool === 'add' ? '#2e7d32' : '#c62828', lineWidth(doc()) * 1.2, false));
      break;
    }
    case 'stamp':
      stampPreview(p);
      break;
    case 'brush': {
      const copy = gesture.copy;
      const q = apply(invert(copy), p);
      const last = gesture.points[gesture.points.length - 1];
      if (len({ x: q.x - last.x, y: q.y - last.y }) > minStep) gesture.points.push(q);
      overlay(polyline(gesture.points.map((pt) => apply(copy, pt)), ui.penColor, ui.penWidth * side()));
      break;
    }
  }
});

function endGesture(cancel: boolean) {
  const g = gesture;
  gesture = null;
  if (!g) return;
  switch (g.kind) {
    case 'handle':
      frozenView = null;
      endLive();
      break;
    case 'free':
      overlay('');
      if (!cancel && g.points.length >= 3) tryEdit([[g.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))]]);
      break;
    case 'stamp':
      if (!cancel && placement && ui.shape !== 'free') {
        tryEdit(stampRegion(ui.shape, placement, ui.stampSize * side(), ui.tool));
      }
      overlay('');
      placement = null;
      break;
    case 'brush':
      overlay('');
      if (!cancel) {
        const d = doc();
        commitDoc(
          { ...d, strokes: [...d.strokes, { points: g.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })), color: ui.penColor, width: Math.round(ui.penWidth * side()) }] },
          { panel: true },
        );
      }
      break;
  }
}

svg.addEventListener('pointerup', () => endGesture(false));
svg.addEventListener('pointercancel', () => endGesture(true));
svg.addEventListener('pointerleave', (e) => {
  if (!gesture && e.pointerType !== 'touch') overlay('');
});

function dragHandle(name: 'u' | 'v', start: Doc, p: Pt) {
  const snap = (x: number) => Math.round(x / 10) * 10;
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  const lat = start.lattice;
  const w = len(lat.u);
  let next: Lattice;
  if (name === 'u') {
    const nw = snap(clamp(p.x, 300, 3000));
    next =
      start.form === 'square'
        ? { u: { x: nw, y: 0 }, v: { x: 0, y: nw } }
        : { u: { x: nw, y: 0 }, v: lat.v };
  } else {
    const ny = snap(clamp(p.y, 300, 3000));
    next =
      start.form === 'parallelogram'
        ? { u: lat.u, v: { x: snap(clamp(p.x, -w, w)), y: ny } }
        : { u: lat.u, v: { x: 0, y: ny } };
  }
  liveDoc(withLattice(start, next));
}

// ---------------------------------------------------------------------------
// Panel and toolbar events

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!el || el.disabled) return;
  const ds = el.dataset;
  const d = doc();
  if (ds.step) goTo(+ds.step);
  else if (ds.parquet) commitDoc({ ...d, parquet: ds.parquet });
  else if (ds.mode) setMode(ds.mode as SymmetryMode);
  else if (ds.form) setForm(ds.form as GridForm);
  else if (ds.tool) {
    ui.tool = ds.tool as EditTool;
    render(true);
  } else if (ds.shape) {
    ui.shape = ds.shape as UiState['shape'];
    render(true);
  } else if (ds.coloring) commitDoc({ ...d, coloring: ds.coloring as Coloring });
  else if (ds.swatch === 'fill') commitDoc({ ...d, colors: [ds.value!, ...d.colors.slice(1)] });
  else if (ds.swatch === 'pen') {
    ui.penColor = ds.value!;
    ui.brush = true;
    render(true);
  } else if (ds.action) action(ds.action);
  else if (el.id === 'undo') undo();
  else if (el.id === 'redo') redo();
});

function action(name: string) {
  const d = doc();
  switch (name) {
    case 'prev':
      goTo(ui.step - 1);
      break;
    case 'next':
      goTo(ui.step + 1);
      break;
    case 'reset-tile':
      if (isEdited(d) && confirm('Fliese wirklich zurücksetzen?')) commitDoc({ ...d, tile: baseTile(d.lattice), strokes: [] });
      break;
    case 'clear-strokes':
      commitDoc({ ...d, strokes: [] });
      break;
    case 'print': {
      const pages = [];
      if (ui.print.template) pages.push(templateSvg(d, ui.print));
      if (ui.print.area) pages.push(areaSvg(d, ui.print));
      if (!pages.length) toast('Wähle aus, was gedruckt werden soll.');
      else printPages(pages);
      break;
    }
    case 'svg-template':
      downloadSvg(templateSvg(d, ui.print), 'escher-schablone.svg');
      break;
    case 'svg-area':
      downloadSvg(areaSvg(d, ui.print), 'escher-flaeche.svg');
      break;
  }
}

panel.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const ds = el.dataset;
  if (ds.input) {
    (ui as unknown as Record<string, number>)[ds.input] = +el.value;
    renderCanvas();
  } else if (ds.color) {
    const colors = [...doc().colors];
    colors[+ds.color] = el.value;
    liveDoc({ ...doc(), colors });
  }
});

panel.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const ds = el.dataset;
  if (ds.color) endLive();
  else if (ds.check === 'neighbours' || ds.check === 'brush') {
    ui[ds.check] = el.checked;
    render(true);
  } else if (ds.check === 'outlines') commitDoc({ ...doc(), outlines: el.checked });
  else if (ds.pcheck) {
    (ui.print as unknown as Record<string, boolean>)[ds.pcheck] = el.checked;
    render(true);
  } else if (ds.print === 'sideCm') {
    const v = parseFloat(el.value.replace(',', '.'));
    if (v > 0) ui.print.sideCm = Math.min(25, v);
    render(true);
  }
});

function goTo(step: number) {
  ui.step = Math.max(1, Math.min(STEPS.length, step));
  overlay('');
  render(true);
}

function undo() {
  if (history.undo()) {
    saveDoc(doc());
    render(true);
  }
}

function redo() {
  if (history.redo()) {
    saveDoc(doc());
    render(true);
  }
}

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
});

new ResizeObserver(() => renderCanvas()).observe(svg);
render(true);
