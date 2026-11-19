import type { FastifyPluginAsync } from 'fastify';
import { render } from '../views.js';
import { NoteNotFoundError } from '../services/notes.js';
import {
  deleteSketch,
  getPreview,
  getSketch,
  InvalidSketchError,
  PREVIEW_MAX_BYTES,
  savePreview,
  saveSketch,
  SKETCH_MAX_BYTES,
} from '../services/sketch.js';

// Die Skizze liegt als Konva-JSON im Storage. Der Editor läuft im Browser (src/client/sketch.ts).
const sketchRoutes: FastifyPluginAsync = async (app) => {
  // PNG-Vorschau kommt als Rohdaten (image/png), nicht als JSON.
  app.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: PREVIEW_MAX_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  // Vorschau-Bild für die Detailseite
  app.get<{ Params: { id: string } }>('/notes/:id/sketch/preview', async (request, reply) => {
    let png: Buffer | null;
    try {
      png = await getPreview(request.uid!, request.params.id);
    } catch (err) {
      if (err instanceof NoteNotFoundError) {
        return reply.code(404).type('text/plain; charset=utf-8').send('Notiz nicht gefunden');
      }
      throw err;
    }
    if (!png) return reply.code(404).type('text/plain; charset=utf-8').send('Keine Vorschau');
    reply.header('Cache-Control', 'private, no-cache');
    return reply.type('image/png').send(png);
  });

  app.put<{ Params: { id: string } }>('/notes/:id/sketch/preview', async (request, reply) => {
    try {
      await savePreview(request.uid!, request.params.id, request.body as Buffer);
    } catch (err) {
      if (err instanceof NoteNotFoundError) {
        return reply.code(404).send({ error: 'Notiz nicht gefunden' });
      }
      if (err instanceof InvalidSketchError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
    return reply.code(204).send();
  });

  // Editor: lädt die vorhandene Skizze (oder eine leere).
  app.get<{ Params: { id: string } }>('/notes/:id/sketch', async (request, reply) => {
    const id = request.params.id;
    let sketch: string | null;
    try {
      sketch = await getSketch(request.uid!, id);
    } catch (err) {
      if (err instanceof NoteNotFoundError) {
        return reply.code(404).type('text/plain; charset=utf-8').send('Notiz nicht gefunden');
      }
      throw err;
    }
    reply.type('text/html; charset=utf-8');
    return render('sketch', {
      title: 'Skizze',
      noteId: id,
      sketch: sketch ?? '',
      backHref: `/notes/${encodeURIComponent(id)}`,
    });
  });

  // Speichern: der Browser schickt das Konva-Layer-JSON.
  app.put<{ Params: { id: string } }>(
    '/notes/:id/sketch',
    { bodyLimit: SKETCH_MAX_BYTES },
    async (request, reply) => {
      try {
        await saveSketch(request.uid!, request.params.id, request.body);
      } catch (err) {
        if (err instanceof NoteNotFoundError) {
          return reply.code(404).send({ error: 'Notiz nicht gefunden' });
        }
        if (err instanceof InvalidSketchError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
      return reply.code(204).send();
    },
  );

  // Löschen (Formular auf der Detailseite)
  app.post<{ Params: { id: string } }>('/notes/:id/sketch/delete', async (request, reply) => {
    const id = request.params.id;
    try {
      await deleteSketch(request.uid!, id);
    } catch (err) {
      if (err instanceof NoteNotFoundError) {
        return reply.code(404).type('text/plain; charset=utf-8').send('Notiz nicht gefunden');
      }
      throw err;
    }
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });
};

export default sketchRoutes;
