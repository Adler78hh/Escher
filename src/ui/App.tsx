import { useEffect, useState } from 'react';
import { Panel } from './Panel';
import { Stage } from './Stage';
import { STEPS, store, useStore } from './store';

export function App() {
  const s = useStore();
  const { ui, history } = s;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        store.redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Escher-Parkett</div>
        <nav id="steps" aria-label="Schritte">
          {STEPS.map((title, i) => (
            <button key={title} className={`step ${ui.step === i + 1 ? 'active' : ''} ${ui.step > i + 1 ? 'done' : ''}`} onClick={() => store.setUi({ step: i + 1 })}>
              <span className="num">{i + 1}</span>
              <span className="label">{title}</span>
            </button>
          ))}
        </nav>
        <div className="history">
          <button title="Rückgängig (Strg+Z)" aria-label="Rückgängig" disabled={!history.canUndo} onClick={() => store.undo()}>
            ↶
          </button>
          <button title="Wiederholen (Strg+Y)" aria-label="Wiederholen" disabled={!history.canRedo} onClick={() => store.redo()}>
            ↷
          </button>
        </div>
      </header>
      <main className="layout">
        <section className="stage">
          <Stage />
          <Toast />
        </section>
        <Panel />
      </main>
    </div>
  );
}

function Toast() {
  const { toastText, toastId } = useStore();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toastId) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4500);
    return () => clearTimeout(t);
  }, [toastId]);
  return (
    <div id="toast" role="status" aria-live="polite" className={visible ? 'show' : ''}>
      {toastText}
    </div>
  );
}
