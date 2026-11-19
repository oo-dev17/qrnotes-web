import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { render, renderPartial } from '../views.js';
import { ensureLive } from '../services/live.js';
import {
  fileKeys,
  findNoteByQrCode,
  getNoteDetail,
  NoteNotFoundError,
  parseSort,
  requireNoteRef,
  searchNotes,
} from '../services/notes.js';
import {
  clearStaleGalleryPic,
  createNote,
  deleteDocument,
  deleteImage,
  deleteNote,
  InvalidInputError,
  NoteFields,
  setGalleryPic,
  updateNote,
  uploadDocument,
  uploadImage,
} from '../services/writes.js';
import { getThumb } from '../services/images.js';
import { linkifyText } from '../text.js';

const TITLE_MAX = 200;
const QR_MAX = 200;
const CONTENT_MAX = 50_000;

function formString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : '';
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

// Zeilenenden und äußere Leerzeichen angleichen, bevor Texte verglichen werden.
const normalizeText = (s: string): string => s.replace(/\r\n/g, '\n').trim();

// Gibt die Felder zurück oder eine Fehlermeldung.
function parseNoteFields(body: unknown): { fields: NoteFields; error?: string } {
  const fields: NoteFields = {
    title: formString(body, 'title').trim(),
    qrCode: formString(body, 'qrCode').trim(),
    content: formString(body, 'content').replace(/\r\n/g, '\n'),
  };
  if (!fields.title) return { fields, error: 'Bitte einen Titel eingeben.' };
  if (fields.title.length > TITLE_MAX) return { fields, error: 'Titel ist zu lang.' };
  if (fields.qrCode.length > QR_MAX) return { fields, error: 'QR-Code ist zu lang.' };
  if (fields.content.length > CONTENT_MAX) return { fields, error: 'Text ist zu lang.' };
  return { fields };
}

// Fehler beim Hochladen zurück auf die Detailseite, dort als Meldung anzeigen.
function uploadError(reply: FastifyReply, id: string, err: unknown) {
  if (err instanceof InvalidInputError) {
    return reply
      .code(303)
      .redirect(`/notes/${encodeURIComponent(id)}?fehler=${encodeURIComponent(err.message)}`);
  }
  return sendError(reply, err);
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof NoteNotFoundError) {
    return reply.code(404).type('text/plain; charset=utf-8').send('Notiz nicht gefunden');
  }
  if (err instanceof InvalidInputError) {
    return reply.code(400).type('text/plain; charset=utf-8').send(err.message);
  }
  throw err;
}

const notesRoutes: FastifyPluginAsync = async (app) => {
  // htmx-Endpunkt: liefert nur die Notizliste für das Suchfeld.
  app.get<{ Querystring: { q?: unknown; sort?: unknown } }>('/notes', async (request, reply) => {
    const q = typeof request.query.q === 'string' ? request.query.q : '';
    const notes = await searchNotes(request.uid!, q, parseSort(request.query.sort));
    reply.type('text/html; charset=utf-8');
    return renderPartial('partials/note-list', { notes });
  });

  // Anlegen
  // ?qrCode=… kommt vom Scanner, wenn zu dem Code noch keine Notiz existiert.
  app.get<{ Querystring: { qrCode?: unknown } }>('/notes/new', async (request, reply) => {
    const qrCode = typeof request.query.qrCode === 'string' ? request.query.qrCode.slice(0, 200) : '';
    const hit = qrCode ? await findNoteByQrCode(request.uid!, qrCode) : null;
    reply.type('text/html; charset=utf-8');
    return render('note-form', {
      title: 'Neue Notiz',
      heading: 'Neue Notiz',
      action: '/notes',
      backHref: '/',
      values: { title: '', qrCode, content: '' },
      duplicate: hit ? { id: hit.id, title: hit.title, discardHref: '/notes/new' } : null,
      error: '',
    });
  });

  app.post('/notes', async (request, reply) => {
    const { fields, error } = parseNoteFields(request.body);
    if (error) {
      reply.code(400).type('text/html; charset=utf-8');
      return render('note-form', {
        title: 'Neue Notiz',
        heading: 'Neue Notiz',
        action: '/notes',
        backHref: '/',
        values: fields,
        error,
      });
    }
    const id = await createNote(request.uid!, fields);
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });

  // Thumbnail eines Bildes (klein, gecacht). Vollbild lädt die Lightbox über die Signed URL.
  app.get<{ Params: { id: string; name: string } }>('/notes/:id/thumb/:name', async (request, reply) => {
    try {
      const img = await getThumb(request.uid!, request.params.id, request.params.name);
      // Eigene URL pro Bild, daher darf der Browser sie einen Tag lang behalten.
      reply.header('Cache-Control', 'private, max-age=86400');
      return reply.type(img.contentType).send(img.body);
    } catch (err) {
      if (err instanceof NoteNotFoundError || (err as { code?: number }).code === 404) {
        return reply.code(404).type('text/plain; charset=utf-8').send('Bild nicht gefunden');
      }
      throw err;
    }
  });

  // Detailseite: Text, Bildergalerie, PDFs.
  app.get<{ Params: { id: string }; Querystring: { fehler?: unknown } }>(
    '/notes/:id',
    async (request, reply) => {
      ensureLive(request.uid!);
      const note = await getNoteDetail(request.uid!, request.params.id);
      if (!note) {
        return reply.code(404).type('text/plain; charset=utf-8').send('Notiz nicht gefunden');
      }
      reply.type('text/html; charset=utf-8');
      return render('note', {
        title: note.title || 'Notiz',
        note,
        contentHtml: linkifyText(note.content),
        liveFiles: fileKeys(note.images, note.documents, note.hasSketch),
        error: str(request.query.fehler).slice(0, 300),
      });
    },
  );

  // Bearbeiten
  // ?qrCode=… kommt vom Scanner („Scannen“ im Formular): der gescannte Code ersetzt den Wert im Feld.
  app.get<{ Params: { id: string }; Querystring: { qrCode?: unknown } }>(
    '/notes/:id/edit',
    async (request, reply) => {
      const note = await getNoteDetail(request.uid!, request.params.id);
      if (!note) {
        return reply.code(404).type('text/plain; charset=utf-8').send('Notiz nicht gefunden');
      }
      const scanned = str(request.query.qrCode).trim().slice(0, 200);
      // Gehört der gescannte Code schon einer anderen Notiz? Dann wird deren Name genannt.
      const hit =
        scanned && scanned !== note.qrCode
          ? await findNoteByQrCode(request.uid!, scanned, note.id)
          : null;
      reply.type('text/html; charset=utf-8');
      return render('note-form', {
        title: 'Bearbeiten',
        heading: 'Notiz bearbeiten',
        action: `/notes/${encodeURIComponent(note.id)}/edit`,
        backHref: `/notes/${encodeURIComponent(note.id)}`,
        values: {
          title: note.title,
          qrCode: scanned || note.qrCode,
          content: note.content,
        },
        original: { title: note.title, qrCode: note.qrCode, content: note.content },
        current: null,
        duplicate: hit
          ? { id: hit.id, title: hit.title, discardHref: `/notes/${encodeURIComponent(note.id)}/edit` }
          : null,
        error: '',
      });
    },
  );

  app.post<{ Params: { id: string } }>('/notes/:id/edit', async (request, reply) => {
    const id = request.params.id;
    const { fields, error } = parseNoteFields(request.body);
    if (error) {
      reply.code(400).type('text/html; charset=utf-8');
      return render('note-form', {
        title: 'Bearbeiten',
        heading: 'Notiz bearbeiten',
        action: `/notes/${encodeURIComponent(id)}/edit`,
        backHref: `/notes/${encodeURIComponent(id)}`,
        values: fields,
        original: {
          title: formString(request.body, 'origTitle'),
          qrCode: formString(request.body, 'origQrCode'),
          content: formString(request.body, 'origContent'),
        },
        error,
      });
    }
    // Konflikt-Check: Hat sich die Notiz seit dem Laden des Formulars geändert (z. B. in der Android-App)?
    const body = request.body as Record<string, unknown> | undefined;
    if (body && body.origTitle !== undefined) {
      let stored: NoteFields;
      try {
        const ref = await requireNoteRef(request.uid!, id);
        const data = (await ref.get()).data() ?? {};
        stored = {
          title: str(data.title),
          qrCode: str(data.qrCode),
          content: str(data.content),
        };
      } catch (err) {
        return sendError(reply, err);
      }
      const original: NoteFields = {
        title: str(body.origTitle),
        qrCode: str(body.origQrCode),
        content: str(body.origContent),
      };
      const changed = (['title', 'qrCode', 'content'] as const).some(
        (k) => normalizeText(original[k]) !== normalizeText(stored[k]),
      );
      if (changed) {
        reply.code(409).type('text/html; charset=utf-8');
        return render('note-form', {
          title: 'Bearbeiten',
          heading: 'Notiz bearbeiten',
          action: `/notes/${encodeURIComponent(id)}/edit`,
          backHref: `/notes/${encodeURIComponent(id)}`,
          values: fields,
          original: stored,
          current: stored,
          error:
            'Die Notiz wurde inzwischen geändert (z. B. in der Android-App). Deine Fassung steht unten. ' +
            'Mit „Speichern“ übernimmst du deine Fassung; der aktuelle Stand steht darunter.',
        });
      }
    }

    try {
      await updateNote(request.uid!, id, fields);
    } catch (err) {
      return sendError(reply, err);
    }
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });

  // Löschen
  app.post<{ Params: { id: string } }>('/notes/:id/delete', async (request, reply) => {
    try {
      await deleteNote(request.uid!, request.params.id);
    } catch (err) {
      return sendError(reply, err);
    }
    return reply.code(303).redirect('/');
  });

  // Bilder hochladen (ein oder mehrere Dateien)
  app.post<{ Params: { id: string } }>('/notes/:id/images', async (request, reply) => {
    const id = request.params.id;
    try {
      for await (const part of request.parts()) {
        if (part.type !== 'file') continue;
        await uploadImage(request.uid!, id, part.file, part.mimetype);
      }
    } catch (err) {
      return uploadError(reply, id, err);
    }
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });

  // Bild löschen
  app.post<{ Params: { id: string } }>('/notes/:id/images/delete', async (request, reply) => {
    const id = request.params.id;
    try {
      await deleteImage(request.uid!, id, formString(request.body, 'name'));
    } catch (err) {
      return sendError(reply, err);
    }
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });

  // Titelbild (galleryPic) setzen
  app.post<{ Params: { id: string } }>('/notes/:id/images/cover', async (request, reply) => {
    const id = request.params.id;
    try {
      await setGalleryPic(request.uid!, id, formString(request.body, 'name'));
    } catch (err) {
      return sendError(reply, err);
    }
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });

  // Kaputten Titelbild-Verweis entfernen (Antwort auf die Rückfrage in der Detailseite)
  app.post<{ Params: { id: string } }>('/notes/:id/cover/clear', async (request, reply) => {
    const id = request.params.id;
    try {
      await clearStaleGalleryPic(request.uid!, id, formString(request.body, 'name'));
    } catch (err) {
      return sendError(reply, err);
    }
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });

  // PDFs hochladen
  app.post<{ Params: { id: string } }>('/notes/:id/documents', async (request, reply) => {
    const id = request.params.id;
    const log = request.log.child({ upload: 'pdf', noteId: id });
    log.info({ contentType: request.headers['content-type'] }, 'PDF-Upload: Anfrage empfangen');
    let files = 0;
    try {
      for await (const part of request.parts()) {
        log.info(
          { type: part.type, field: part.fieldname, filename: part.type === 'file' ? part.filename : undefined,
            mimetype: part.type === 'file' ? part.mimetype : undefined },
          'PDF-Upload: Teil empfangen',
        );
        if (part.type !== 'file') continue;
        files++;
        await uploadDocument(request.uid!, id, part.file, part.mimetype, part.filename);
        log.info({ filename: part.filename }, 'PDF-Upload: gespeichert');
      }
      log.info({ files }, 'PDF-Upload: fertig');
    } catch (err) {
      log.warn({ err, files }, 'PDF-Upload: fehlgeschlagen');
      return uploadError(reply, id, err);
    }
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });

  // PDF löschen
  app.post<{ Params: { id: string } }>('/notes/:id/documents/delete', async (request, reply) => {
    const id = request.params.id;
    try {
      await deleteDocument(request.uid!, id, formString(request.body, 'name'));
    } catch (err) {
      return sendError(reply, err);
    }
    return reply.code(303).redirect(`/notes/${encodeURIComponent(id)}`);
  });
};

export default notesRoutes;
