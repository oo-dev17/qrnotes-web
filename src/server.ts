import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import './firebase.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import pageRoutes from './routes/pages.js';
import notesRoutes from './routes/notes.js';
import scanRoutes from './routes/scan.js';
import liveRoutes from './routes/live.js';
import sketchRoutes from './routes/sketch.js';

const app = Fastify({ logger: true });

await app.register(cookie);
await app.register(formbody);
await app.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});
await app.register(fastifyStatic, {
  root: fileURLToPath(new URL('../public', import.meta.url)),
  prefix: '/static/',
  decorateReply: false,
});

await app.register(authPlugin);
await app.register(authRoutes);
await app.register(pageRoutes);
await app.register(notesRoutes);
await app.register(scanRoutes);
await app.register(liveRoutes);
await app.register(sketchRoutes);

await app.listen({ port: config.port, host: '0.0.0.0' });
