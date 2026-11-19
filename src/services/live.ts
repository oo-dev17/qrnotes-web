import { fingerprint, listFingerprint } from './fingerprint.js';
import { invalidateNote, notesCollection } from './notes.js';

// Ein Firestore-Listener pro aktivem Nutzer. Er erkennt Änderungen aus beiden Apps
// (Web und Android) an Notizdokumenten und räumt die Caches auf.
// Bilder und PDFs liegen nur in Storage; die prüft die Detailseite selbst (siehe routes/live.ts).

interface LiveState {
  ready: boolean; // erste Snapshot-Antwort da
  fps: Map<string, string>; // Notiz-ID -> Fingerprint
  unsubscribe: () => void;
  lastSeen: number;
}

const IDLE_MS = 10 * 60 * 1000;
const IGNORED_DOC_IDS = new Set(['allDocuments']);
const states = new Map<string, LiveState>();

// Startet den Listener bei Bedarf und merkt sich, dass der Nutzer aktiv ist.
export function ensureLive(uid: string): void {
  const existing = states.get(uid);
  if (existing) {
    existing.lastSeen = Date.now();
    return;
  }

  const state: LiveState = {
    ready: false,
    fps: new Map(),
    unsubscribe: () => {},
    lastSeen: Date.now(),
  };
  states.set(uid, state);

  let first = true;
  state.unsubscribe = notesCollection(uid).onSnapshot(
    (snap) => {
      if (first) {
        first = false;
        for (const doc of snap.docs) {
          if (!IGNORED_DOC_IDS.has(doc.id)) state.fps.set(doc.id, fingerprint(doc.data()));
        }
        state.ready = true;
        return;
      }
      for (const change of snap.docChanges()) {
        const id = change.doc.id;
        if (IGNORED_DOC_IDS.has(id)) continue;
        if (change.type === 'removed') {
          state.fps.delete(id);
        } else {
          state.fps.set(id, fingerprint(change.doc.data()));
        }
        invalidateNote(uid, id);
      }
    },
    (err) => {
      console.error('Live-Listener beendet:', err);
      state.unsubscribe();
      states.delete(uid);
    },
  );
}

// Fingerprint der Liste, wie sie der Listener gerade kennt. ready=false: noch kein Stand.
export function liveListState(uid: string): { ready: boolean; fp: string } {
  ensureLive(uid);
  const state = states.get(uid)!;
  if (!state.ready) return { ready: false, fp: '' };
  return { ready: true, fp: listFingerprint([...state.fps.entries()]) };
}

// Fingerprint einer einzelnen Notiz. fp=null: Notiz existiert nicht (mehr).
export function liveNoteState(uid: string, id: string): { ready: boolean; fp: string | null } {
  ensureLive(uid);
  const state = states.get(uid)!;
  if (!state.ready) return { ready: false, fp: null };
  return { ready: true, fp: state.fps.get(id) ?? null };
}

// Beendet Listener von Nutzern, die länger als IDLE_MS nicht mehr aktiv waren.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [uid, state] of states) {
    if (now - state.lastSeen > IDLE_MS) {
      state.unsubscribe();
      states.delete(uid);
    }
  }
}, 60 * 1000);
sweep.unref();
