import { fingerprint, listFingerprint } from './fingerprint.js';
import { invalidateNote, notesCollection } from './notes.js';

// One Firestore listener per active user. It detects changes from both apps
// (web and Android) in note documents and cleans up the caches.
// Images and PDFs live only in Storage; the detail page checks those itself (see routes/live.ts).

interface LiveState {
  ready: boolean; // first snapshot response received
  fps: Map<string, string>; // note ID -> fingerprint
  unsubscribe: () => void;
  lastSeen: number;
}

const IDLE_MS = 10 * 60 * 1000;
const IGNORED_DOC_IDS = new Set(['allDocuments']);
const states = new Map<string, LiveState>();

// Starts the listener when needed and records that the user is active.
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

// Fingerprint of the list as the listener currently knows it. ready=false: no state yet.
export function liveListState(uid: string): { ready: boolean; fp: string } {
  ensureLive(uid);
  const state = states.get(uid)!;
  if (!state.ready) return { ready: false, fp: '' };
  return { ready: true, fp: listFingerprint([...state.fps.entries()]) };
}

// Fingerprint of a single note. fp=null: note does not exist (anymore).
export function liveNoteState(uid: string, id: string): { ready: boolean; fp: string | null } {
  ensureLive(uid);
  const state = states.get(uid)!;
  if (!state.ready) return { ready: false, fp: null };
  return { ready: true, fp: state.fps.get(id) ?? null };
}

// Stops listeners of users who have been inactive for longer than IDLE_MS.
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
