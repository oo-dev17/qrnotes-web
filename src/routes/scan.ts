import type { FastifyPluginAsync } from 'fastify';
import { render } from '../views.js';
import { findNoteByQrCode } from '../services/notes.js';

const QR_MAX = 200;

// Erlaubte Rücksprung-Ziele: nur die Notiz-Formulare (Neu / Bearbeiten), keine fremden URLs.
const RETURN_PATH = /^(\/notes\/new|\/notes\/[A-Za-z0-9_-]{1,128}\/edit)$/;

function safeReturn(value: unknown): string {
  return typeof value === 'string' && RETURN_PATH.test(value) ? value : '';
}

const scanRoutes: FastifyPluginAsync = async (app) => {
  // Kamera-Seite. Der Scan-Code läuft im Browser (BarcodeDetector).
  app.get<{ Querystring: { return?: unknown } }>('/scan', async (request, reply) => {
    const returnTo = safeReturn(request.query.return);
    reply.type('text/html; charset=utf-8');
    return render('scan', { title: 'Scannen', returnTo, cancelHref: returnTo || '/' });
  });

  // Ergebnis eines Scans.
  // - mit Rücksprung (Formular): zurück ins Formular, Code wird eingetragen.
  // - ohne: vorhandene Notiz öffnen, sonst neue Notiz mit dem Code anlegen.
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
