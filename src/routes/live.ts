import type { FastifyPluginAsync } from 'fastify';
import { liveListState, liveNoteState } from '../services/live.js';
import { listFileKeys } from '../services/notes.js';

// Polling endpoints for the change notification (see src/client/live.ts).
const liveRoutes: FastifyPluginAsync = async (app) => {
  // List: fingerprint of all notes (Firestore listener, no Firestore read).
  app.get('/live/list', async (request) => {
    return liveListState(request.uid!);
  });

  // Detail page: fingerprint of the note plus file list from Storage.
  // Storage is only read if the listener confirms that the note belongs to the user.
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
