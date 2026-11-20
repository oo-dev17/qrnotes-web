import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { adminAuth } from '../firebase.js';
import { SESSION_COOKIE } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    uid?: string;
    email?: string;
  }
}

// Public: login page, all /auth/* routes and static files
// (without these files the login page cannot load).
function isPublic(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/static/')
  );
}

function unauthenticated(request: FastifyRequest, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  // Redirect HTML requests to the login page, answer API-style requests with 401.
  if (request.headers.accept?.includes('text/html')) {
    return reply.redirect('/login');
  }
  return reply.code(401).send({ error: 'unauthorized' });
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (isPublic(pathname)) return;

    const cookie = request.cookies[SESSION_COOKIE];
    if (!cookie) return unauthenticated(request, reply);

    try {
      // checkRevoked=true: after a revoke in the Firebase Admin, the cookie becomes invalid immediately.
      const decoded = await adminAuth.verifySessionCookie(cookie, true);
      request.uid = decoded.uid;
      request.email = decoded.email;
    } catch {
      return unauthenticated(request, reply);
    }
  });
};

export default fp(authPlugin, { name: 'auth' });
