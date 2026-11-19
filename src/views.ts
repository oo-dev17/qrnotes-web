import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import { config } from './config.js';

// views/ liegt im Projektwurzelverzeichnis; die Pfade stimmen für src/ (tsx) und dist/ (build).
const viewsDir = fileURLToPath(new URL('../views', import.meta.url));

const eta = new Eta({ views: viewsDir, cache: config.isProduction });

// Rendert eine Seite in das Layout. Daten werden HTML-escaped, außer im Layout-Body (<%~ %>).
export function render(view: string, data: Record<string, unknown>): string {
  const body = eta.render(view, data);
  return eta.render('layout', { ...data, body });
}

// Rendert nur einen Ausschnitt (htmx-Antwort), ohne Layout.
export function renderPartial(view: string, data: Record<string, unknown>): string {
  return eta.render(view, data);
}
