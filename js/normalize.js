// Transforme le GeoJSON TCL (Grand Lyon open data) en fichiers compacts pour l'appli.
// Sans DOM : utilisé par scripts/fetch-data.mjs (Node) et testable seul.

import { simplify } from './geo.js';
import { haversine } from './geo.js';

/** Lignes à exclure : métro (A-D), funiculaires (F1, F2), tramways (T*), Rhônexpress. */
const EXCLUDED = /^(A|B|C|D|F1|F2|FUN\d*|T\d+[A-Z]?|RX|RHONEXPRESS)$/i;
export const isExcludedLine = (id) => EXCLUDED.test(String(id).trim());

function pick(props, names) {
  const lower = Object.fromEntries(Object.keys(props).map((k) => [k.toLowerCase(), props[k]]));
  for (const n of names) {
    const v = lower[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

export function parseColor(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^#?([0-9a-f]{6})$/i);
  if (m) return '#' + m[1].toLowerCase();
  m = s.match(/(\d{1,3})\D+(\d{1,3})\D+(\d{1,3})/);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

/** Chaîne les morceaux d'une MultiLineString ([lon, lat]) en une seule polyligne [lat, lon]. */
export function chainParts(parts) {
  const ps = parts.filter((p) => p && p.length > 1).map((p) => p.map(([lon, lat]) => [lat, lon]));
  if (!ps.length) return [];
  let chain = ps.shift();
  while (ps.length) {
    const head = chain[0];
    const tail = chain[chain.length - 1];
    let best = null;
    ps.forEach((p, i) => {
      const cands = [
        { i, d: haversine(tail, p[0]), where: 'tail', rev: false },
        { i, d: haversine(tail, p[p.length - 1]), where: 'tail', rev: true },
        { i, d: haversine(head, p[p.length - 1]), where: 'head', rev: false },
        { i, d: haversine(head, p[0]), where: 'head', rev: true },
      ];
      for (const c of cands) if (!best || c.d < best.d) best = c;
    });
    const [part] = ps.splice(best.i, 1);
    const seg = best.rev ? part.slice().reverse() : part;
    if (best.where === 'tail') {
      // évite de dupliquer le point de jonction
      chain = chain.concat(best.d < 0.5 ? seg.slice(1) : seg);
    } else {
      chain = (best.d < 0.5 ? seg.slice(0, -1) : seg).concat(chain);
    }
  }
  return chain;
}

function splitTrace(name) {
  if (!name) return [null, null];
  const parts = name.split(/\s+(?:-|–|→|>|\/)\s+/);
  return parts.length >= 2 ? [parts[0].trim(), parts[parts.length - 1].trim()] : [null, null];
}

/**
 * @param {object} fc GeoJSON FeatureCollection (WGS84)
 * @returns {{index: object, routes: Record<string, object>, stats: object}}
 */
export function normalize(fc) {
  const byLine = new Map();
  let skipped = 0;

  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    const id = pick(p, ['ligne', 'code_ligne', 'nom_ligne', 'numero', 'li_nom']);
    if (!id || isExcludedLine(id)) {
      skipped++;
      continue;
    }
    const g = f.geometry;
    if (!g) continue;
    const parts = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
    const raw = chainParts(parts);
    if (raw.length < 2) continue;

    const [trO, trD] = splitTrace(pick(p, ['nom_trace', 'libelle', 'nom']));
    const origin = pick(p, ['nom_origine', 'origine']) ?? trO ?? '?';
    const destination = pick(p, ['nom_destination', 'destination']) ?? trD ?? '?';
    const sens = pick(p, ['sens']) ?? '';
    const coords = simplify(raw, 2).map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);

    if (!byLine.has(id)) byLine.set(id, { id, color: null, variants: [] });
    const line = byLine.get(id);
    line.color = line.color ?? parseColor(pick(p, ['couleur', 'couleur_ligne', 'rgb', 'colour']));
    const key = `${origin}→${destination}|${sens}`;
    const dup = line.variants.find((v) => v.key === key);
    if (dup) {
      if (coords.length > dup.coords.length) dup.coords = coords; // garde la variante la plus détaillée
    } else {
      line.variants.push({ key, origin, destination, sens, coords });
    }
  }

  const index = { generated: new Date().toISOString(), source: 'data.grandlyon.com (TCL / SYTRAL)', lines: [] };
  const routes = {};
  for (const line of [...byLine.values()].sort(naturalCompare)) {
    const file = safeName(line.id);
    const terminus = [...new Set(line.variants.flatMap((v) => [v.origin, v.destination]))].filter((t) => t !== '?');
    index.lines.push({ id: line.id, file, color: line.color, terminus });
    routes[file] = { id: line.id, color: line.color, variants: line.variants };
  }
  return { index, routes, stats: { lines: index.lines.length, skipped } };
}

export const safeName = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

function naturalCompare(a, b) {
  return a.id.localeCompare(b.id, 'fr', { numeric: true });
}
