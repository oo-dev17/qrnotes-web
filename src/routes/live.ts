import type { FastifyPluginAsync } from 'fastify';
import { liveListState, liveNoteState } from '../services/live.js';
import { listFileKeys } from '../services/notes.js';

// Polling-Endpunkte für die Änderungsanzeige (siehe src/client/live.ts).
const liveRoutes: FastifyPluginAsync = async (app) => {
  // Liste: Fingerprint aller Notizen (Firestore-Listener, kein Firestore-Read).
  app.get('/live/list', async (request) => {
    return liveListState(request.uid!);
  });

  // Detailseite: Fingerprint der Notiz plus Dateiliste aus Storage.
  // Storage wird nur gelesen, wenn der Listener bestätigt, dass die Notiz dem Nutzer gehört.
  app.get<{ Params: { id: string } }>('/notes/:id/live', async (request) => {
    const uid = request.uid!;
    const id = request.params.id;
    const state = liveNoteState(uid, id);
    if (!state.ready) return { ready: false, fp: null, files: [] };
    if (state.fp === null) return { ready: true, fp: null, files: [] };
    const files = await listFileKeys(id);
    return { ready: true, fp: state.fp, files };
  });
};

export default liveRoutes;
