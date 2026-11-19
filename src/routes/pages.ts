import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { render, renderPartial } from '../views.js';
import { ensureLive } from '../services/live.js';
import { listFingerprintFor, parseSort, searchNotes } from '../services/notes.js';

const pageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/login', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return render('login', {
      title: 'Login',
      firebaseConfig: config.firebaseWebConfig,
    });
  });

  app.get<{ Querystring: { sort?: unknown } }>('/', async (request, reply) => {
    const uid = request.uid!;
    ensureLive(uid);
    const sort = parseSort(request.query.sort);
    const notes = await searchNotes(uid, '', sort);
    const liveFp = await listFingerprintFor(uid);
    reply.type('text/html; charset=utf-8');
    return render('home', {
      title: 'QrNotes',
      email: request.email ?? request.uid ?? '',
      sort,
      liveFp,
      listHtml: renderPartial('partials/note-list', { notes }),
    });
  });
};

export default pageRoutes;
