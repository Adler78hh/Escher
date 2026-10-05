// Side panel: the controls for each step.

import { type ReactNode, useEffect, useRef } from 'react';
import type { StampKind } from '../core/tile';
import { type Coloring, type Doc, baseTileOf, isEdited } from '../model/doc';
import { GRID_PRESETS, type GridPreset, presetLattice, presetOf, squareLattice, withLattice } from '../model/lattice';
import { PARQUETS, vertexLabel } from '../parquets';
import type { SymmetryId } from '../parquets/types';
import { PAGE, areaSvg, downloadSvg, pieceSizeMm, printPages, templateSvg } from '../render/print';
import { ParquetThumb } from './ParquetThumb';
import { EDGE_COLORS } from './Stage';
import { type FinishTab, STEPS, store, useStore } from './store';

const SHAPES: { id: 'free' | StampKind; title: string; icon: string }[] = [
  { id: 'free', title: 'Freihand', icon: '✎' },
  { id: 'circle', title: 'Halbkreis', icon: '◖' },
  { id: 'triangle', title: 'Zacke', icon: '▲' },
  { id: 'rect', title: 'Lasche', icon: '■' },
];

const FILL_SWATCHES = ['#f2a541', '#e05263', '#3a86c8', '#7bc950', '#9b5de5', '#f15bb5', '#00bbf9', '#fee440', '#8d6e63', '#ffffff', '#9e9e9e', '#2b2d42'];
const PEN_SWATCHES = ['#1b1b1b', '#ffffff', '#c62828', '#1565c0', '#2e7d32', '#6d4c41', '#f9a825'];

const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });

export function Panel() {
  const { ui } = useStore();
  const body = [<StepParquet />, <StepSymmetry />, <StepGrid />, <StepEdit />, <StepFinish />][ui.step - 1];
  return (
    <aside id="panel">
      <div className="panel-body">{body}</div>
      <div className="nav">
        <button className="secondary" disabled={ui.step === 1} onClick={() => store.setUi({ step: ui.step - 1 })}>
          ← Zurück
        </button>
        <button className="primary" disabled={ui.step === STEPS.length} onClick={() => store.setUi({ step: ui.step + 1 })}>
          Weiter →
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Step 1

function StepParquet() {
  const { doc } = useStore();
  return (
    <>
      <h2>1 · Parkett wählen</h2>
      <p className="hint">Wähle die Grundform. Für den Anfang gibt es Parkett 7 aus Quadraten.</p>
      <div className="cards parquets">
        {PARQUETS.map((p) => (
          <button
            key={p.n}
            className={`card parquet ${doc.parquet === p.n ? 'active' : ''}`}
            disabled={!p.ready}
            onClick={() => doc.parquet !== p.n && store.commit({ ...doc, parquet: p.n })}
          >
            <ParquetThumb vertex={p.vertex} />
            <span className="card-title">Parkett {p.n}</span>
            <span className="card-label">{vertexLabel(p)}</span>
            {!p.ready && <span className="card-text">kommt bald</span>}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2

function StepSymmetry() {
  const { doc, impl, sym } = useStore();
  const choose = (id: SymmetryId) => {
    if (id === doc.symmetry) return;
    if (isEdited(doc) && !confirm('Wenn du die Symmetrie wechselst, fängt deine Fliese wieder neu an. Weiter?')) return;
    const next = impl.symmetries.find((s) => s.id === id)!;
    const lattice = next.lattice === 'square' ? squareLattice(doc.lattice) : doc.lattice;
    const coloring: Coloring = id === 'T' && doc.coloring === 'rotation' ? 'checker' : doc.coloring;
    const fresh: Doc = { ...doc, symmetry: id, lattice, coloring, strokes: [] };
    store.commit({ ...fresh, tile: baseTileOf(fresh) });
  };
  return (
    <>
      <h2>2 · Symmetrie wählen</h2>
      <p className="hint">Wie gehören die Kanten zusammen? Kanten mit der gleichen Farbe verändern sich gemeinsam.</p>
      <div className="cards">
        {impl.symmetries.map((s) => (
          <button key={s.id} className={`card ${doc.symmetry === s.id ? 'active' : ''}`} onClick={() => choose(s.id)}>
            <span className="card-title">{s.title}</span>
            <span className="card-text">{s.kidText}</span>
            {s.lattice === 'square' && <span className="card-note">Geht nur mit Quadraten.</span>}
          </button>
        ))}
      </div>
      <EdgeLegend />
      {sym.lattice === 'square' && (
        <p className="hint">Im nächsten Schritt kannst du beim Quadrat nur die Größe und die Drehung ändern.</p>
      )}
    </>
  );
}

function EdgeLegend() {
  const { sym } = useStore();
  const groups = new Map<number, string[]>();
  for (const e of sym.edges) groups.set(e.group, [...(groups.get(e.group) ?? []), e.name]);
  return (
    <ul className="legend">
      {[...groups].map(([g, names]) => (
        <li key={g}>
          <span className="legend-swatch" style={{ background: EDGE_COLORS[g % EDGE_COLORS.length] }} />
          {names.length > 1 ? `${names.join(' und ')} gehören zusammen` : `${names[0]} gehört zu sich selbst`}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Step 3

function StepGrid() {
  const { doc, sym, ui } = useStore();
  const current = presetOf(doc.lattice);
  const choose = (id: GridPreset) => store.commit(withLattice(doc, presetLattice(id, doc.lattice)));
  return (
    <>
      <h2>3 · Raster einstellen</h2>
      <p className="hint">Ziehe die roten Punkte a und b. Das ganze Gitter passt sich an.</p>
      <h3>Schnellwahl</h3>
      <div className="seg">
        {GRID_PRESETS.map((p) => (
          <button
            key={p.id}
            className={current === p.id ? 'active' : ''}
            disabled={sym.lattice === 'square' && p.id !== 'square'}
            onClick={() => choose(p.id)}
          >
            {p.title}
          </button>
        ))}
      </div>
      {sym.lattice === 'square' && (
        <p className="hint">Bei „Drehen um die Ecke“ geht nur ein Quadrat. Du kannst es größer, kleiner oder schräg stellen.</p>
      )}
      <label className="check">
        <input type="checkbox" checked={ui.snap} onChange={(e) => store.setUi({ snap: e.target.checked })} /> Punkte am Hilfsgitter einrasten
      </label>
      {isEdited(doc) && <p className="hint">Deine Fliese wird beim Verändern mit verzerrt.</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4

function StepEdit() {
  const { doc, ui, sym } = useStore();
  return (
    <>
      <h2>4 · Fliese bearbeiten</h2>
      <div className="seg big">
        <button className={ui.tool === 'add' ? 'active add' : ''} onClick={() => store.setUi({ tool: 'add' })}>
          ＋ Anbauen
        </button>
        <button className={ui.tool === 'nibble' ? 'active nibble' : ''} onClick={() => store.setUi({ tool: 'nibble' })}>
          － Anknabbern
        </button>
      </div>
      <h3>Wie?</h3>
      <div className="seg">
        {SHAPES.map((s) => (
          <button key={s.id} className={ui.shape === s.id ? 'active' : ''} onClick={() => store.setUi({ shape: s.id })}>
            <span className="ico">{s.icon}</span> {s.title}
          </button>
        ))}
      </div>
      {ui.shape === 'free' ? (
        <p className="hint">
          Male eine geschlossene Form über den Rand der Fliese.{' '}
          {ui.tool === 'add' ? 'Was außen liegt, wird angebaut' : 'Was innen liegt, wird angeknabbert'} – an der passenden Kante passiert
          automatisch das Gegenteil.
        </p>
      ) : (
        <>
          <Slider label="Größe" min={0.06} max={0.5} step={0.01} value={ui.stampSize} onChange={(v) => store.setUi({ stampSize: v })} />
          <p className="hint">Fahre an den Rand der Fliese – die Form rastet ein. Tippen setzt sie.</p>
        </>
      )}
      {sym.id !== 'T' && <p className="hint">Die weißen Punkte sind Drehpunkte. Setze Formen daneben, nicht genau darauf.</p>}
      <label className="check">
        <input type="checkbox" checked={ui.neighbours} onChange={(e) => store.setUi({ neighbours: e.target.checked })} /> Nachbarn zeigen
      </label>
      <button
        className="secondary"
        disabled={!isEdited(doc)}
        onClick={() => confirm('Fliese wirklich zurücksetzen?') && store.commit({ ...doc, tile: baseTileOf(doc), strokes: [] })}
      >
        Alles zurücksetzen
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 5

const FINISH_TABS: { id: FinishTab; title: string }[] = [
  { id: 'design', title: 'Gestalten' },
  { id: 'show', title: 'Anzeigen' },
  { id: 'print', title: 'Drucken' },
];

function StepFinish() {
  const { ui } = useStore();
  return (
    <>
      <h2>5 · Gestalten, anzeigen, drucken</h2>
      <div className="seg tabs">
        {FINISH_TABS.map((t) => (
          <button key={t.id} className={ui.finish === t.id ? 'active' : ''} onClick={() => store.setUi({ finish: t.id })}>
            {t.title}
          </button>
        ))}
      </div>
      {ui.finish === 'design' ? <Design /> : ui.finish === 'show' ? <Show /> : <Print />}
    </>
  );
}

function Design() {
  const { doc, ui } = useStore();
  return (
    <>
      <h3>Farbe der Fliese</h3>
      <Swatches list={FILL_SWATCHES} current={doc.colors[0]} onPick={(c) => store.commit({ ...doc, colors: [c, ...doc.colors.slice(1)] })} />
      <ColorInput label="Eigene Farbe" index={0} />
      <h3>Malen</h3>
      <label className="check">
        <input type="checkbox" checked={ui.brush} onChange={(e) => store.setUi({ brush: e.target.checked })} /> Mit dem Stift in die Fliese
        malen (Augen, Muster …)
      </label>
      <Swatches list={PEN_SWATCHES} current={ui.penColor} onPick={(c) => store.setUi({ penColor: c, brush: true })} />
      <Slider label="Strichstärke" min={0.004} max={0.05} step={0.002} value={ui.penWidth} onChange={(v) => store.setUi({ penWidth: v })} />
      <button className="secondary" disabled={!doc.strokes.length} onClick={() => store.commit({ ...doc, strokes: [] })}>
        Alle Linien löschen
      </button>
    </>
  );
}

function Show() {
  const { doc, ui } = useStore();
  const colorings: { id: Coloring; title: string }[] = [
    { id: 'single', title: 'Alle gleich' },
    { id: 'checker', title: 'Abwechselnd' },
  ];
  if (doc.symmetry !== 'T') colorings.push({ id: 'rotation', title: 'Nach Drehung' });
  const used = doc.coloring === 'single' ? 1 : doc.coloring === 'rotation' && doc.symmetry === 'C4' ? 4 : 2;
  return (
    <>
      <div className="seg">
        {colorings.map((c) => (
          <button key={c.id} className={doc.coloring === c.id ? 'active' : ''} onClick={() => store.commit({ ...doc, coloring: c.id })}>
            {c.title}
          </button>
        ))}
      </div>
      <div className="colors">
        {doc.colors.slice(0, used).map((_, i) => (
          <ColorInput key={i} label={`Farbe ${i + 1}`} index={i} />
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={doc.outlines} onChange={(e) => store.commit({ ...doc, outlines: e.target.checked })} /> Umrisse zeigen
      </label>
      <Slider label="Zoom" min={2} max={14} step={0.5} value={ui.zoom} onChange={(v) => store.setUi({ zoom: v })} />
    </>
  );
}

function Print() {
  const { doc, ui } = useStore();
  const p = ui.print;
  const setPrint = (patch: Partial<typeof p>) => store.setUi({ print: { ...p, ...patch } });
  const size = pieceSizeMm(doc, p);
  const tooBig = size.w > PAGE.w || size.h > PAGE.h - 20;
  const print = () => {
    const pages = [];
    if (p.template) pages.push(templateSvg(doc, p));
    if (p.area) pages.push(areaSvg(doc, p));
    if (!pages.length) store.toast('Wähle aus, was gedruckt werden soll.');
    else printPages(pages);
  };
  return (
    <>
      <label className="number">
        Kantenlänge
        <input
          type="number"
          min={1}
          max={25}
          step={0.5}
          value={p.sideCm}
          onChange={(e) => {
            const v = parseFloat(e.target.value.replace(',', '.'));
            if (v > 0) setPrint({ sideCm: Math.min(25, v) });
          }}
        />
        cm
      </label>
      <p className="hint">
        Das Puzzlestück ist dann {fmt(size.w / 10)} × {fmt(size.h / 10)} cm groß.
        {tooBig && <strong> Es passt nicht auf ein A4-Blatt – nimm eine kleinere Kantenlänge.</strong>}
      </p>
      <h3>Was soll gedruckt werden?</h3>
      <label className="check">
        <input type="checkbox" checked={p.template} onChange={(e) => setPrint({ template: e.target.checked })} /> Schablone zum Ausschneiden
      </label>
      <label className="check indent">
        <input type="checkbox" checked={p.coloredTemplate} onChange={(e) => setPrint({ coloredTemplate: e.target.checked })} /> Schablone
        farbig
      </label>
      <label className="check">
        <input type="checkbox" checked={p.area} onChange={(e) => setPrint({ area: e.target.checked })} /> Gefüllte Fläche
      </label>
      <button className="primary" onClick={print}>
        🖨 Drucken / als PDF speichern
      </button>
      <p className="hint">Im Druckdialog „Tatsächliche Größe“ bzw. 100 % wählen, damit die Maße stimmen.</p>
      <div className="row">
        <button className="secondary" onClick={() => downloadSvg(templateSvg(doc, p), 'escher-schablone.svg')}>
          SVG Schablone
        </button>
        <button className="secondary" onClick={() => downloadSvg(areaSvg(doc, p), 'escher-flaeche.svg')}>
          SVG Fläche
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small controls

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      {props.label}
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(+e.target.value)}
      />
    </label>
  );
}

function Swatches({ list, current, onPick }: { list: string[]; current: string; onPick: (c: string) => void }): ReactNode {
  return (
    <div className="swatches">
      {list.map((c) => (
        <button
          key={c}
          className={`swatch ${c.toLowerCase() === current.toLowerCase() ? 'active' : ''}`}
          style={{ background: c }}
          aria-label={`Farbe ${c}`}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

/** Colour picker that previews live and records one undo step when the picker closes. */
function ColorInput({ label, index }: { label: string; index: number }) {
  const { doc } = useStore();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // React's onChange fires on every move; the native change event marks the end.
    const el = ref.current!;
    const done = () => store.endLive();
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  return (
    <label className="color">
      {label}
      <input
        ref={ref}
        type="color"
        value={doc.colors[index]}
        onChange={(e) => {
          const colors = [...store.doc.colors];
          colors[index] = e.target.value;
          store.live({ ...store.doc, colors });
        }}
      />
    </label>
  );
}
