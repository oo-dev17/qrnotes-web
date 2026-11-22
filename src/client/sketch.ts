import Konva from 'konva';

// Sketch editor: circle, rectangle, freehand, text, selection (move/rotate), color, delete.
// No 'Save' button: every change is saved automatically shortly after.
// The selection layer is separate and not part of the saved data.

type Tool = 'select' | 'circle' | 'rect' | 'free' | 'line' | 'text';
type Drawing =
  | { kind: 'circle'; node: Konva.Circle; startX: number; startY: number }
  | { kind: 'rect'; node: Konva.Rect; startX: number; startY: number }
  | { kind: 'line'; node: Konva.Line; startX: number; startY: number }
  | { kind: 'free'; node: Konva.Line };

const AUTOSAVE_DELAY_MS = 1200;
const RETRY_DELAY_MS = 5000;
const KEEPALIVE_MAX_BYTES = 60_000; // limit for fetch(keepalive) when leaving the page

const stageEl = document.getElementById('sketch-stage') as HTMLDivElement;
const statusEl = document.getElementById('sketch-status') as HTMLSpanElement;
const backLink = document.querySelector<HTMLAnchorElement>('a[data-back]');
const deleteBtn = document.getElementById('sketch-delete') as HTMLButtonElement;
const undoBtn = document.getElementById('sketch-undo') as HTMLButtonElement;
const redoBtn = document.getElementById('sketch-redo') as HTMLButtonElement;
const colorInput = document.getElementById('sketch-color') as HTMLInputElement;
const fillInput = document.getElementById('sketch-fill') as HTMLInputElement;
const fillNoneBtn = document.getElementById('sketch-fill-none') as HTMLButtonElement;
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.js-tool'));
const objectSelect = document.getElementById('sketch-objects') as HTMLSelectElement;

const saveUrl = stageEl.dataset.saveUrl ?? '';
const backHref = stageEl.dataset.backHref ?? '/';

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// ---------- Saving (automatic) ----------

let dirty = false; // there are changes that are not yet on the server
let timer: number | undefined;
let inFlight: Promise<void> | null = null;
let again = false; // a new change came in while a save was running

// After each completed change: record history and save.
function markDirty(): void {
  recordHistory();
  scheduleSave();
}

function scheduleSave(): void {
  dirty = true;
  refreshObjectList();
  setStatus('Unsaved …');
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
  setStatus('Saving …');
  inFlight = (async () => {
    try {
      const res = await fetch(saveUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // Konva's toJSON() already returns a JSON string; do not encode it again.
        body: layer.toJSON(),
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Preview for the detail page. Errors here are not critical: the sketch is already saved.
      await uploadPreview().catch(() => undefined);
      setStatus('Saved');
    } catch {
      dirty = true;
      setStatus('Save failed – retrying …');
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

// Waits until all changes have reached the server (or the attempt fails).
async function flush(): Promise<void> {
  await save();
  while (inFlight) await inFlight;
}

// Sends the preview as a small PNG to the server (without selection frame).
async function uploadPreview(): Promise<void> {
  transformer.visible(false);
  // Render without zoom and pan, so the preview always shows the whole sketch.
  const zoom = stage.scale();
  const offset = stage.position();
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });
  let dataUrl: string;
  try {
    dataUrl = stage.toDataURL({ pixelRatio: 0.5, mimeType: 'image/png' });
  } finally {
    stage.scale(zoom);
    stage.position(offset);
    transformer.visible(true);
    stage.batchDraw();
  }
  const blob = await (await fetch(dataUrl)).blob();
  const res = await fetch(`${saveUrl}/preview`, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: blob,
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`Preview: HTTP ${res.status}`);
}

// ---------- Undo (only changes since opening) ----------

const MAX_HISTORY = 100;
let snapshots: string[] = []; // states of the drawing layer as JSON
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
  updateDraggable();
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

// Drawing layer: gets saved. Load the existing sketch, otherwise empty.
const saved = stageEl.dataset.sketch ?? '';
let layer: Konva.Layer;
try {
  layer = saved ? (Konva.Node.create(saved) as Konva.Layer) : new Konva.Layer();
} catch {
  setStatus('The saved sketch could not be loaded.');
  layer = new Konva.Layer();
}
stage.add(layer);

// Selection layer: frame and handles, not part of the saved data.
const uiLayer = new Konva.Layer();
stage.add(uiLayer);
const transformer = new Konva.Transformer({ rotateEnabled: true, anchorSize: 14, borderStroke: '#a78bfa' });
uiLayer.add(transformer);

let tool: Tool = 'select';
let drawing: Drawing | null = null;
let selected: Konva.Node | null = null;
// Press in selection mode: the object (or null = empty area) that is selected on release.
let pendingClick: { target: Konva.Node | null } | null = null;
const lineHandles: Konva.Circle[] = []; // endpoint handles of the selected straight line
const WIDTHS = [1, 3, 5, 8, 12]; // line widths in px
let currentWidth = 3; // width for new objects and for the selected object (via the width menu)

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
  if (next !== 'select') select(null);
  updateDraggable();
}

// Only the selected object can be moved by dragging. Pressing an unselected object never moves it
// (it is selected on release instead). Outside selection mode nothing moves, so you don't draw over objects.
function updateDraggable(): void {
  layer.getChildren().forEach((node) => node.draggable(tool === 'select' && node === selected));
}

// Straight lines are not scaled with the box transformer (that would stretch them like a rectangle).
// Instead, the two endpoints get handles that can be dragged.
function isStraight(node: Konva.Node | null): node is Konva.Line {
  return node instanceof Konva.Line && node.name() === 'straight';
}

// The selected line that has the enlarged hit area (its whole bounding box, not only the stroke).
let hitLine: Konva.Line | null = null;

function clearLineHandles(): void {
  lineHandles.splice(0).forEach((h) => h.destroy());
  if (hitLine) hitLine.hitStrokeWidth('auto'); // back to the normal stroke hit area
  hitLine = null;
}

// Hit band around the selected line (straight or freehand) in screen pixels: it grabs the line for moving,
// but only close to the stroke. (The earlier whole-bounding-box area blocked clicks on objects inside the box.)
const LINE_HIT_SCREEN_PX = 16;
function setLineHitArea(line: Konva.Line): void {
  clearLineHandles();
  hitLine = line;
  line.hitStrokeWidth(Math.max(line.strokeWidth(), LINE_HIT_SCREEN_PX / stage.scaleX()));
}

function showLineHandles(line: Konva.Line): void {
  setLineHitArea(line);
  for (let i = 0; i < 2; i++) {
    const handle = new Konva.Circle({
      radius: 9,
      fill: '#a78bfa',
      stroke: '#ffffff',
      strokeWidth: 2,
      draggable: true,
    });
    handle.on('dragmove', () => {
      // Handle position (layer coordinates) back into the line's own coordinates.
      const local = line.getTransform().copy().invert().point(handle.position());
      const points = [...line.points()];
      points[i * 2] = local.x;
      points[i * 2 + 1] = local.y;
      line.points(points);
      layer.batchDraw();
      uiLayer.batchDraw();
    });
    uiLayer.add(handle);
    lineHandles.push(handle);
  }
  placeLineHandles(line);
}

function placeLineHandles(line: Konva.Line): void {
  const points = line.points();
  const transform = line.getTransform();
  lineHandles.forEach((handle, i) => {
    handle.position(transform.point({ x: points[i * 2], y: points[i * 2 + 1] }));
  });
  uiLayer.batchDraw();
}

function select(node: Konva.Node | null): void {
  selected = node;
  updateDraggable();
  transformer.nodes(node && !isStraight(node) ? [node] : []);
  if (isStraight(node)) showLineHandles(node);
  else if (node instanceof Konva.Line) setLineHitArea(node);
  else clearLineHandles();
  if (node) colorInput.value = toHex(colorOf(node)) ?? colorInput.value;
  if (node instanceof Konva.Shape) currentWidth = node.strokeWidth();
  if (node && canFill(node)) fillInput.value = toHex((node as Konva.Shape).fill() as string) ?? fillInput.value;
  uiLayer.batchDraw();
  updateSizeLabel();
  refreshObjectList();
}

// ---------- Object list (dropdown below the sketch) ----------

function typeName(node: Konva.Node): string {
  if (node instanceof Konva.Circle) return 'Circle';
  if (node instanceof Konva.Rect) return 'Rect';
  if (node instanceof Konva.Line) return node.name() === 'straight' ? 'Line' : 'Free';
  if (node instanceof Konva.Text) return 'Text';
  return 'Object';
}

// Names are numbered per type in drawing order (Circle1, Circle2, ...). Option value = index in the layer.
function refreshObjectList(): void {
  const nodes = layer.getChildren();
  const counts = new Map<string, number>();
  const options = [new Option('— none —', '')];
  nodes.forEach((node, index) => {
    const type = typeName(node);
    const n = (counts.get(type) ?? 0) + 1;
    counts.set(type, n);
    options.push(new Option(`${type}${n}`, String(index)));
  });
  objectSelect.replaceChildren(...options);
  const index = selected ? nodes.findIndex((node) => node === selected) : -1;
  objectSelect.value = index >= 0 ? String(index) : '';
}

objectSelect.addEventListener('change', () => {
  const node = objectSelect.value === '' ? undefined : layer.getChildren()[Number(objectSelect.value)];
  select(node ?? null);
  uiLayer.batchDraw();
});

// Outer size (including stroke and rotation) of the selected object, shown below the sketch.
const sizeEl = document.getElementById('sketch-size') as HTMLParagraphElement;

function updateSizeLabel(): void {
  if (!selected) {
    sizeEl.textContent = '';
    return;
  }
  const box = selected.getClientRect({ relativeTo: layer });
  sizeEl.textContent = `${Math.round(box.width)} × ${Math.round(box.height)} px`;
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

// Only circles and rectangles have a fill (for text, "fill" is the text color).
function canFill(node: Konva.Node): boolean {
  return node instanceof Konva.Circle || node instanceof Konva.Rect;
}

fillInput.addEventListener('input', () => {
  if (selected && canFill(selected)) {
    (selected as Konva.Shape).fill(fillInput.value);
    layer.batchDraw();
    markDirty();
  }
});

// Empty fill string = no fill (object is only outlined).
fillNoneBtn.addEventListener('click', () => {
  if (selected && canFill(selected)) {
    (selected as Konva.Shape).fill('');
    layer.batchDraw();
    markDirty();
  }
});

// Strokes that are too small (tap without drag) are discarded.
function discardIfTiny(d: Drawing): void {
  const tiny =
    (d.kind === 'circle' && d.node.radius() < 3) ||
    (d.kind === 'rect' && d.node.width() < 3 && d.node.height() < 3) ||
    (d.kind === 'free' && d.node.points().length < 4) ||
    (d.kind === 'line' && Math.hypot(d.node.points()[2] - d.node.points()[0], d.node.points()[3] - d.node.points()[1]) < 3);
  if (tiny) d.node.destroy();
}

stage.on('pointerdown', (e) => {
  const pos = stage.getRelativePointerPosition();
  if (!pos) return;
  // Right mouse button opens the context menu instead of drawing.
  if (e.evt.button === 2) return;
  // Two fingers: pinch-zoom (see below), no drawing or selecting.
  if (touches.size >= 2) return;

  // Click on selection handles: the transformer handles it itself.
  if (e.target.getLayer() === uiLayer) return;

  if (tool === 'select') {
    // Selection changes only on release, never on press or during a drag. Only the selected object can be dragged.
    pendingClick = { target: e.target === stage ? null : e.target };
    return;
  }

  const color = currentColor();

  if (tool === 'text') {
    const text = window.prompt('Enter text');
    if (text) {
      const node = new Konva.Text({ x: pos.x, y: pos.y, text, fontSize: 22, fill: color, draggable: false });
      layer.add(node);
      select(node);
      layer.batchDraw();
      markDirty();
    }
    return;
  }

  if (tool === 'circle') {
    const node = new Konva.Circle({ x: pos.x, y: pos.y, radius: 0, stroke: color, strokeWidth: currentWidth });
    layer.add(node);
    drawing = { kind: 'circle', node, startX: pos.x, startY: pos.y };
  } else if (tool === 'rect') {
    const node = new Konva.Rect({ x: pos.x, y: pos.y, width: 0, height: 0, stroke: color, strokeWidth: currentWidth });
    layer.add(node);
    drawing = { kind: 'rect', node, startX: pos.x, startY: pos.y };
  } else if (tool === 'line') {
    // Straight line: start point is the press, end point follows the pointer.
    const node = new Konva.Line({
      points: [pos.x, pos.y, pos.x, pos.y],
      stroke: color,
      strokeWidth: currentWidth,
      lineCap: 'round',
      name: 'straight',
    });
    layer.add(node);
    drawing = { kind: 'line', node, startX: pos.x, startY: pos.y };
  } else if (tool === 'free') {
    const node = new Konva.Line({
      points: [pos.x, pos.y],
      stroke: color,
      strokeWidth: currentWidth,
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
  const pos = stage.getRelativePointerPosition();
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
  } else if (drawing.kind === 'line') {
    drawing.node.points([drawing.startX, drawing.startY, pos.x, pos.y]);
  } else {
    drawing.node.points([...drawing.node.points(), pos.x, pos.y]);
  }
  layer.batchDraw();
});

function endDrawing(): void {
  if (!drawing) return;
  const node = drawing.node;
  discardIfTiny(drawing);
  drawing = null;
  // A finished object is selected right away (a discarded tiny stroke has no parent any more).
  if (node.getParent()) select(node);
  layer.batchDraw();
  markDirty();
}
stage.on('pointerup', endDrawing);
stage.on('pointerleave', endDrawing);

stage.on('pointerup', () => {
  if (!pendingClick) return;
  const target = pendingClick.target;
  pendingClick = null;
  select(target);
});
stage.on('pointerleave', () => {
  pendingClick = null;
});

// Double click (or double tap) on a text in selection mode opens it for editing, like creating one.
stage.on('dblclick dbltap', (e) => {
  const target = e.target;
  if (tool !== 'select' || !(target instanceof Konva.Text)) return;
  const text = window.prompt('Edit text', target.text());
  if (!text || text === target.text()) return;
  target.text(text);
  select(target);
  layer.batchDraw();
  markDirty();
});

// ---------- Zoom: mouse wheel / trackpad pinch, and two-finger pinch on touch ----------
// The zoom is only a view setting: it is not saved, and the preview is always rendered unzoomed.

const MIN_SCALE = 0.05; // zoom out up to 20x
const MAX_SCALE = 40; // zoom in up to 10x

// Pointer position relative to the stage container (screen pixels, not zoomed).
function containerPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = stageEl.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// Changes the zoom and keeps the content point under `anchor` at the same screen position.
function zoomAt(anchor: { x: number; y: number }, newScale: number): void {
  const oldScale = stage.scaleX();
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
  const contentX = (anchor.x - stage.x()) / oldScale;
  const contentY = (anchor.y - stage.y()) / oldScale;
  stage.scale({ x: scale, y: scale });
  stage.position({ x: anchor.x - contentX * scale, y: anchor.y - contentY * scale });
  stage.batchDraw();
}

// Button: zooms so that all objects fill the view. Without objects: normal view (100 %, no pan).
const fitBtn = document.getElementById('sketch-fit') as HTMLButtonElement;
const FIT_PADDING = 16; // screen pixels around the objects

function fitToObjects(): void {
  if (layer.getChildren().length === 0) {
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    stage.batchDraw();
    return;
  }
  // Bounding box of all objects in layer coordinates (= content coordinates, the layer has no transform).
  const box = layer.getClientRect({ relativeTo: layer });
  const availW = Math.max(1, stage.width() - FIT_PADDING * 2);
  const availH = Math.max(1, stage.height() - FIT_PADDING * 2);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / Math.max(1, box.width), availH / Math.max(1, box.height))));
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  stage.scale({ x: scale, y: scale });
  stage.position({ x: stage.width() / 2 - centerX * scale, y: stage.height() / 2 - centerY * scale });
  stage.batchDraw();
}

fitBtn.addEventListener('click', fitToObjects);

stageEl.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    // Some browsers report wheel steps in lines instead of pixels.
    const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomAt(containerPoint(event.clientX, event.clientY), stage.scaleX() * Math.exp(-deltaY * 0.002));
  },
  { passive: false },
);

// Active touch pointers and the distance/midpoint of the last pinch step.
const touches = new Map<number, { x: number; y: number }>();
let pinchLast: { dist: number; mid: { x: number; y: number } } | null = null;

function pinchMetrics(): { dist: number; mid: { x: number; y: number } } {
  const [a, b] = [...touches.values()];
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

// Capture phase: runs before Konva's handlers, so the second finger never starts a drawing.
stageEl.addEventListener(
  'pointerdown',
  (event) => {
    if (event.pointerType !== 'touch') return;
    touches.set(event.pointerId, containerPoint(event.clientX, event.clientY));
    if (touches.size < 2) return;
    // Second finger: drop the stroke in progress and stop any drag that the first finger started.
    if (drawing) {
      drawing.node.destroy();
      drawing = null;
    }
    layer.getChildren().forEach((node) => {
      if (node.isDragging()) node.stopDrag();
    });
    pinchLast = pinchMetrics();
    layer.batchDraw();
  },
  { capture: true },
);

stageEl.addEventListener('pointermove', (event) => {
  if (!touches.has(event.pointerId)) return;
  touches.set(event.pointerId, containerPoint(event.clientX, event.clientY));
  if (touches.size < 2 || !pinchLast) return;
  const { dist, mid } = pinchMetrics();
  if (pinchLast.dist > 0) zoomAt(pinchLast.mid, stage.scaleX() * (dist / pinchLast.dist));
  // Moving both fingers together pans the view.
  stage.position({ x: stage.x() + mid.x - pinchLast.mid.x, y: stage.y() + mid.y - pinchLast.mid.y });
  pinchLast = { dist, mid };
  stage.batchDraw();
});

const endTouch = (event: PointerEvent): void => {
  touches.delete(event.pointerId);
  pinchLast = touches.size >= 2 ? pinchMetrics() : null;
};
stageEl.addEventListener('pointerup', endTouch);
stageEl.addEventListener('pointercancel', endTouch);

// Moving and rotating via the selection (events bubble up to the stage).
stage.on('dragend transformend', markDirty);
// Moving the whole line: the handles follow. (Handle drags update the line themselves.)
stage.on('dragmove', (e) => {
  if (e.target.getLayer() === uiLayer) return;
  if (isStraight(selected)) placeLineHandles(selected);
});
// Keep the size label in sync while the pointer is down (moving and resizing).
// Reading it once per animation frame ensures it shows the values after Konva has applied the change.
let pointerDown = false;
function syncSizeLabel(): void {
  if (!pointerDown) return;
  updateSizeLabel();
  requestAnimationFrame(syncSizeLabel);
}
// Button of the last press. The context menu opens only for the right button (2);
// a touch long press is button 0. The pointer type is not used: browsers report touchpads and pens differently.
let lastPointerButton = -1;
window.addEventListener('pointerdown', (event) => {
  lastPointerButton = event.button;
  pointerDown = true;
  requestAnimationFrame(syncSizeLabel);
});
const stopSizeSync = (): void => {
  pointerDown = false;
  updateSizeLabel();
};
window.addEventListener('pointerup', stopSizeSync);
window.addEventListener('pointercancel', stopSizeSync);

toolButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTool((btn.dataset.tool ?? 'select') as Tool));
});

// Color: changes the selected object, otherwise the color for new objects.
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

// ---------- Context menu (right click on an object) ----------

const menuEl = document.getElementById('sketch-menu') as HTMLDivElement;

function hideMenu(): void {
  menuEl.hidden = true;
}

function showMenu(clientX: number, clientY: number): void {
  menuEl.hidden = false;
  // Keep the menu inside the screen.
  const x = Math.min(clientX, window.innerWidth - menuEl.offsetWidth - 8);
  const y = Math.min(clientY, window.innerHeight - menuEl.offsetHeight - 8);
  menuEl.style.left = `${Math.max(8, x)}px`;
  menuEl.style.top = `${Math.max(8, y)}px`;
}

function duplicateSelected(): void {
  if (!selected) return;
  const copy = selected.clone({ x: selected.x() + 20, y: selected.y() + 20 });
  layer.add(copy);
  select(copy);
  layer.batchDraw();
  markDirty();
}

stage.on('contextmenu', (e) => {
  e.evt.preventDefault();
  // Touch long press (e.g. right after the text prompt) must not open the menu.
  if (lastPointerButton !== 2) {
    hideMenu();
    return;
  }
  const target = e.target;
  if (target === stage || target.getLayer() !== layer) {
    hideMenu();
    return;
  }
  select(target);
  showMenu(e.evt.clientX, e.evt.clientY);
});

// Layer order = drawing order (the last child is drawn on top).
function changeOrder(to: 'front' | 'back'): void {
  if (!selected) return;
  if (to === 'front') selected.moveToTop();
  else selected.moveToBottom();
  layer.batchDraw();
  markDirty();
}

menuEl.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action;
  if (action === 'front') changeOrder('front');
  if (action === 'back') changeOrder('back');
  if (action === 'duplicate') duplicateSelected();
  if (action === 'delete') deleteSelected();
  hideMenu();
});

// Any click or tap outside the menu closes it. Escape closes it too.
document.addEventListener('pointerdown', (event) => {
  if (!menuEl.contains(event.target as Node)) hideMenu();
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  hideMenu();
  if (tool !== 'select') setTool('select');
});
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

// ---------- Line width menu ----------

const widthBtn = document.getElementById('sketch-width') as HTMLButtonElement;
const widthMenu = document.getElementById('sketch-width-menu') as HTMLDivElement;
const widthWrap = document.getElementById('sketch-width-wrap') as HTMLDivElement;

// Shows the widths as bars so the user can see the thickness before choosing.
const widthList = document.getElementById('sketch-width-list') as HTMLDivElement;
widthList.replaceChildren(
  ...WIDTHS.map((w) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.width = String(w);
    b.title = `${w} px`;
    b.className = 'flex h-9 w-16 items-center justify-center rounded-lg hover:bg-neutral-800';
    const bar = document.createElement('span');
    bar.className = 'w-10 rounded-full bg-neutral-200';
    bar.style.height = `${w}px`;
    b.append(bar);
    return b;
  }),
);

widthBtn.addEventListener('click', () => {
  widthMenu.hidden = !widthMenu.hidden;
});

widthMenu.addEventListener('click', (event) => {
  const value = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.width;
  if (!value) return;
  currentWidth = Number(value);
  // Changes the selected object (text has no stroke width).
  if (selected instanceof Konva.Shape) {
    selected.strokeWidth(currentWidth);
    layer.batchDraw();
    markDirty();
  }
  widthMenu.hidden = true;
});

// Clicking outside the menu or pressing Escape closes it.
document.addEventListener('pointerdown', (event) => {
  if (!widthWrap.contains(event.target as Node)) widthMenu.hidden = true;
});

// ---------- Tab: select next / previous object (list order) ----------

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') widthMenu.hidden = true;
  if (e.key !== 'Tab') return;
  const nodes: Konva.Node[] = [...layer.getChildren()];
  if (nodes.length === 0) return;
  e.preventDefault();
  setTool('select');
  const current = selected ? nodes.indexOf(selected) : -1;
  const step = e.shiftKey ? -1 : 1;
  const next = current < 0 ? (step > 0 ? 0 : nodes.length - 1) : (current + step + nodes.length) % nodes.length;
  select(nodes[next]);
  layer.batchDraw();
});

// ---------- Leaving the page ----------

// Back arrow: save everything first. If that fails, we ask.
backLink?.addEventListener('click', async (event) => {
  if (!dirty && timer === undefined && !inFlight) return;
  event.preventDefault();
  await flush();
  if (dirty || inFlight) {
    if (!window.confirm('The sketch could not be saved. Leave anyway?')) return;
  }
  window.location.assign(backHref);
});

// Switching to another app or tab: save immediately.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void save();
});

// Page is being left (e.g. Back key): still send small sketches via keepalive.
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

// Warn only if something is really still in transit or unsaved.
window.addEventListener('beforeunload', (event) => {
  if (dirty || inFlight) event.preventDefault();
});

// Initial state for undo: the sketch as it was when opened.
snapshots = [layer.toJSON()];
historyIndex = 0;
updateUndoButton();

refreshObjectList();
setTool('select');
