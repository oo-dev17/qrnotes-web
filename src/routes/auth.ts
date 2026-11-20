import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../firebase.js';
import { SESSION_COOKIE, SESSION_MAX_AGE_MS } from '../config.js';

const authRoutes: FastifyPluginAsync = async (app) => {
  // Exchanges a Firebase ID token for an httpOnly session cookie (5 days).
  app.post<{ Body: { idToken?: unknown } }>('/auth/session', async (request, reply) => {
    const idToken = request.body?.idToken;
    if (typeof idToken !== 'string' || idToken.length === 0) {
      return reply.code(400).send({ error: 'idToken missing' });
    }

    try {
      await adminAuth.verifyIdToken(idToken);
      const sessionCookie = await adminAuth.createSessionCookie(idToken, {
        expiresIn: SESSION_MAX_AGE_MS,
      });

      reply.setCookie(SESSION_COOKIE, sessionCookie, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_MAX_AGE_MS / 1000,
      });
      return { ok: true };
    } catch (err) {
      request.log.warn({ err }, 'Session creation failed');
      return reply.code(401).send({ error: 'invalid token' });
    }
  });

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    return { ok: true };
  });
};

export default authRoutes;
