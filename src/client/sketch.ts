import Konva from 'konva';

// Skizzen-Editor: Kreis, Rechteck, Freihand, Text, Auswahl (verschieben/drehen), Farbe, Löschen.
// Kein „Speichern“-Knopf: jede Änderung wird kurz danach automatisch gespeichert.
// Die Auswahl-Ebene liegt separat und ist nicht Teil der Speicherung.

type Tool = 'select' | 'circle' | 'rect' | 'free' | 'text';
type Drawing =
  | { kind: 'circle'; node: Konva.Circle; startX: number; startY: number }
  | { kind: 'rect'; node: Konva.Rect; startX: number; startY: number }
  | { kind: 'free'; node: Konva.Line };

const AUTOSAVE_DELAY_MS = 1200;
const RETRY_DELAY_MS = 5000;
const KEEPALIVE_MAX_BYTES = 60_000; // Grenze für fetch(keepalive) beim Verlassen der Seite

const stageEl = document.getElementById('sketch-stage') as HTMLDivElement;
const statusEl = document.getElementById('sketch-status') as HTMLSpanElement;
const backLink = document.querySelector<HTMLAnchorElement>('a[data-back]');
const deleteBtn = document.getElementById('sketch-delete') as HTMLButtonElement;
const undoBtn = document.getElementById('sketch-undo') as HTMLButtonElement;
const redoBtn = document.getElementById('sketch-redo') as HTMLButtonElement;
const colorInput = document.getElementById('sketch-color') as HTMLInputElement;
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.js-tool'));

const saveUrl = stageEl.dataset.saveUrl ?? '';
const backHref = stageEl.dataset.backHref ?? '/';

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// ---------- Speichern (automatisch) ----------

let dirty = false; // es gibt Änderungen, die noch nicht auf dem Server sind
let timer: number | undefined;
let inFlight: Promise<void> | null = null;
let again = false; // während eines Speicherns kam eine neue Änderung

// Nach jeder abgeschlossenen Änderung: Verlauf festhalten und speichern.
function markDirty(): void {
  recordHistory();
  scheduleSave();
}

function scheduleSave(): void {
  dirty = true;
  setStatus('Ungespeichert …');
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
}

async function save(): Promise<void> {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  if (inFlight) {
    again = true;
    return inFlight;
  }
  if (!dirty) return;

  dirty = false;
  setStatus('Speichere …');
  inFlight = (async () => {
    try {
      const res = await fetch(saveUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // Konvas toJSON() liefert bereits einen JSON-String; nicht noch einmal kodieren.
        body: layer.toJSON(),
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Vorschau für die Detailseite. Fehler hier sind nicht kritisch: die Skizze ist schon gespeichert.
      await uploadPreview().catch(() => undefined);
      setStatus('Gespeichert');
    } catch {
      dirty = true;
      setStatus('Speichern fehlgeschlagen – neuer Versuch …');
      timer = window.setTimeout(() => void save(), RETRY_DELAY_MS);
    } finally {
      inFlight = null;
      if (again) {
        again = false;
        void save();
      }
    }
  })();
  return inFlight;
}

// Wartet, bis alle Änderungen beim Server angekommen sind (oder der Versuch fehlschlägt).
async function flush(): Promise<void> {
  await save();
  while (inFlight) await inFlight;
}

// Vorschau als kleines PNG an den Server (ohne Auswahl-Rahmen).
async function uploadPreview(): Promise<void> {
  transformer.visible(false);
  let dataUrl: string;
  try {
    dataUrl = stage.toDataURL({ pixelRatio: 0.5, mimeType: 'image/png' });
  } finally {
    transformer.visible(true);
    uiLayer.batchDraw();
  }
  const blob = await (await fetch(dataUrl)).blob();
  const res = await fetch(`${saveUrl}/preview`, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: blob,
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`Vorschau: HTTP ${res.status}`);
}

// ---------- Rückgängig (nur Änderungen seit dem Öffnen) ----------

const MAX_HISTORY = 100;
let snapshots: string[] = []; // Zustände der Zeichen-Ebene als JSON
let historyIndex = 0;

function recordHistory(): void {
  const json = layer.toJSON();
  if (json === snapshots[historyIndex]) return;
  snapshots = snapshots.slice(0, historyIndex + 1);
  snapshots.push(json);
  if (snapshots.length > MAX_HISTORY) snapshots.shift();
  historyIndex = snapshots.length - 1;
  updateUndoButton();
}

function undo(): void {
  if (historyIndex === 0) return;
  historyIndex -= 1;
  restoreFromJson(snapshots[historyIndex]);
  scheduleSave();
  updateUndoButton();
}

function redo(): void {
  if (historyIndex >= snapshots.length - 1) return;
  historyIndex += 1;
  restoreFromJson(snapshots[historyIndex]);
  scheduleSave();
  updateUndoButton();
}

function restoreFromJson(json: string): void {
  const source = Konva.Node.create(json) as Konva.Layer;
  select(null);
  layer.destroyChildren();
  [...source.getChildren()].forEach((node) => layer.add(node));
  layer.getChildren().forEach((node) => node.draggable(tool === 'select'));
  layer.batchDraw();
}

function updateUndoButton(): void {
  undoBtn.disabled = historyIndex === 0;
  redoBtn.disabled = historyIndex >= snapshots.length - 1;
}

const width = Math.max(260, Math.min(stageEl.clientWidth || 360, 720));
const height = Math.round(width * 1.25);
const stage = new Konva.Stage({ container: stageEl, width, height });
stage.content.style.touchAction = 'none';

// Zeichen-Ebene: wird gespeichert. Vorhandene Skizze laden, sonst leer.
const saved = stageEl.dataset.sketch ?? '';
let layer: Konva.Layer;
try {
  layer = saved ? (Konva.Node.create(saved) as Konva.Layer) : new Konva.Layer();
} catch {
  setStatus('Die gespeicherte Skizze konnte nicht geladen werden.');
  layer = new Konva.Layer();
}
stage.add(layer);

// Auswahl-Ebene: Rahmen und Griffe, nicht Teil der Speicherung.
const uiLayer = new Konva.Layer();
stage.add(uiLayer);
const transformer = new Konva.Transformer({ rotateEnabled: true, anchorSize: 14, borderStroke: '#a78bfa' });
uiLayer.add(transformer);

let tool: Tool = 'select';
let drawing: Drawing | null = null;
let selected: Konva.Node | null = null;

function currentColor(): string {
  return colorInput.value;
}

function setTool(next: Tool): void {
  tool = next;
  toolButtons.forEach((btn) => {
    const active = btn.dataset.tool === next;
    btn.classList.toggle('bg-violet-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-neutral-800', !active);
  });
  // Verschieben nur im Auswahl-Modus, sonst zeichnet man über die Objekte.
  layer.getChildren().forEach((node) => node.draggable(next === 'select'));
  if (next !== 'select') select(null);
}

function select(node: Konva.Node | null): void {
  selected = node;
  transformer.nodes(node ? [node] : []);
  if (node) colorInput.value = toHex(colorOf(node)) ?? colorInput.value;
  uiLayer.batchDraw();
}

function colorOf(node: Konva.Node): string | null {
  if (node instanceof Konva.Text) return node.fill() as string;
  return (node as Konva.Shape).stroke() as string;
}

function toHex(color: string | null): string | null {
  if (!color) return null;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function applyColor(node: Konva.Node, color: string): void {
  if (node instanceof Konva.Text) node.fill(color);
  else (node as Konva.Shape).stroke(color);
}

// Zu kleine Striche (Antippen ohne Ziehen) werden verworfen.
function discardIfTiny(d: Drawing): void {
  const tiny =
    (d.kind === 'circle' && d.node.radius() < 3) ||
    (d.kind === 'rect' && d.node.width() < 3 && d.node.height() < 3) ||
    (d.kind === 'free' && d.node.points().length < 4);
  if (tiny) d.node.destroy();
}

stage.on('pointerdown', (e) => {
  const pos = stage.getPointerPosition();
  if (!pos) return;

  // Klick auf Auswahl-Griffe: der Transformer kümmert sich selbst.
  if (e.target.getLayer() === uiLayer) return;

  if (tool === 'select') {
    select(e.target === stage ? null : e.target);
    return;
  }

  const color = currentColor();

  if (tool === 'text') {
    const text = window.prompt('Text eingeben');
    if (text) {
      layer.add(
        new Konva.Text({ x: pos.x, y: pos.y, text, fontSize: 22, fill: color, draggable: false }),
      );
      layer.batchDraw();
      markDirty();
    }
    return;
  }

  if (tool === 'circle') {
    const node = new Konva.Circle({ x: pos.x, y: pos.y, radius: 0, stroke: color, strokeWidth: 3 });
    layer.add(node);
    drawing = { kind: 'circle', node, startX: pos.x, startY: pos.y };
  } else if (tool === 'rect') {
    const node = new Konva.Rect({ x: pos.x, y: pos.y, width: 0, height: 0, stroke: color, strokeWidth: 3 });
    layer.add(node);
    drawing = { kind: 'rect', node, startX: pos.x, startY: pos.y };
  } else if (tool === 'free') {
    const node = new Konva.Line({
      points: [pos.x, pos.y],
      stroke: color,
      strokeWidth: 3,
      lineCap: 'round',
      lineJoin: 'round',
      tension: 0.4,
    });
    layer.add(node);
    drawing = { kind: 'free', node };
  }
  layer.batchDraw();
});

stage.on('pointermove', () => {
  if (!drawing) return;
  const pos = stage.getPointerPosition();
  if (!pos) return;

  if (drawing.kind === 'circle') {
    drawing.node.radius(Math.hypot(pos.x - drawing.startX, pos.y - drawing.startY));
  } else if (drawing.kind === 'rect') {
    drawing.node.setAttrs({
      x: Math.min(drawing.startX, pos.x),
      y: Math.min(drawing.startY, pos.y),
      width: Math.abs(pos.x - drawing.startX),
      height: Math.abs(pos.y - drawing.startY),
    });
  } else {
    drawing.node.points([...drawing.node.points(), pos.x, pos.y]);
  }
  layer.batchDraw();
});

function endDrawing(): void {
  if (!drawing) return;
  discardIfTiny(drawing);
  drawing = null;
  layer.batchDraw();
  markDirty();
}
stage.on('pointerup', endDrawing);
stage.on('pointerleave', endDrawing);

// Verschieben und Drehen durch die Auswahl (Events steigen bis zur Stage hoch).
stage.on('dragend transformend', markDirty);

toolButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTool((btn.dataset.tool ?? 'select') as Tool));
});

// Farbe: ändert das ausgewählte Objekt, sonst die Farbe für neue Objekte.
colorInput.addEventListener('input', () => {
  if (selected) {
    applyColor(selected, colorInput.value);
    layer.batchDraw();
    markDirty();
  }
});

function deleteSelected(): void {
  if (!selected) return;
  selected.destroy();
  select(null);
  layer.batchDraw();
  markDirty();
}
deleteBtn.addEventListener('click', deleteSelected);
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete') deleteSelected();
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
});

// ---------- Verlassen der Seite ----------

// Zurück-Pfeil: vorher alles speichern. Scheitert das, fragen wir nach.
backLink?.addEventListener('click', async (event) => {
  if (!dirty && timer === undefined && !inFlight) return;
  event.preventDefault();
  await flush();
  if (dirty || inFlight) {
    if (!window.confirm('Die Skizze konnte nicht gespeichert werden. Trotzdem verlassen?')) return;
  }
  window.location.assign(backHref);
});

// Wechsel in eine andere App oder Tab-Wechsel: sofort speichern.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void save();
});

// Seite wird verlassen (z. B. Zurück-Taste): kleine Skizzen per keepalive noch schicken.
window.addEventListener('pagehide', () => {
  if (!dirty) return;
  const body = layer.toJSON();
  if (body.length <= KEEPALIVE_MAX_BYTES) {
    void fetch(saveUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
      credentials: 'same-origin',
      keepalive: true,
    });
  }
});

// Warnung nur, wenn wirklich noch etwas unterwegs oder ungespeichert ist.
window.addEventListener('beforeunload', (event) => {
  if (dirty || inFlight) event.preventDefault();
});

// Ausgangszustand für Rückgängig: die Skizze, wie sie beim Öffnen war.
snapshots = [layer.toJSON()];
historyIndex = 0;
updateUndoButton();

setTool('select');
