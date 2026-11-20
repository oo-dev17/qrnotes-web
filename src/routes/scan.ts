import type { FastifyPluginAsync } from 'fastify';
import { render } from '../views.js';
import { findNoteByQrCode } from '../services/notes.js';

const QR_MAX = 200;

// Allowed return targets: only the note forms (new / edit), no foreign URLs.
const RETURN_PATH = /^(\/notes\/new|\/notes\/[A-Za-z0-9_-]{1,128}\/edit)$/;

function safeReturn(value: unknown): string {
  return typeof value === 'string' && RETURN_PATH.test(value) ? value : '';
}

const scanRoutes: FastifyPluginAsync = async (app) => {
  // Camera page. The scan code runs in the browser (BarcodeDetector).
  app.get<{ Querystring: { return?: unknown } }>('/scan', async (request, reply) => {
    const returnTo = safeReturn(request.query.return);
    reply.type('text/html; charset=utf-8');
    return render('scan', { title: 'Scannen', returnTo, cancelHref: returnTo || '/' });
  });

  // Result of a scan.
  // - with return (form): back to the form, code is filled in.
  // - without: open the existing note, otherwise create a new note with the code.
  app.get<{ Querystring: { code?: unknown; return?: unknown } }>('/scan/result', async (request, reply) => {
    const code = typeof request.query.code === 'string' ? request.query.code.trim() : '';
    if (!code || code.length > QR_MAX) {
      return reply.code(400).type('text/plain; charset=utf-8').send('Ungültiger Code');
    }
    const returnTo = safeReturn(request.query.return);
    if (returnTo) {
      return reply.code(303).redirect(`${returnTo}?qrCode=${encodeURIComponent(code)}`);
    }
    const note = await findNoteByQrCode(request.uid!, code);
    if (note) {
      return reply.code(303).redirect(`/notes/${encodeURIComponent(note.id)}`);
    }
    return reply.code(303).redirect(`/notes/new?qrCode=${encodeURIComponent(code)}`);
  });
};

export default scanRoutes;
