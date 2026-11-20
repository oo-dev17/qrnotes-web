import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import { config } from './config.js';

// views/ lives in the project root; the paths work for src/ (tsx) and dist/ (build).
const viewsDir = fileURLToPath(new URL('../views', import.meta.url));

const eta = new Eta({ views: viewsDir, cache: config.isProduction });

// Renders a page into the layout. Data is HTML-escaped, except in the layout body (<%~ %>).
export function render(view: string, data: Record<string, unknown>): string {
  const body = eta.render(view, data);
  return eta.render('layout', { ...data, body });
}

// Renders only a fragment (htmx response), without layout.
export function renderPartial(view: string, data: Record<string, unknown>): string {
  return eta.render(view, data);
}
