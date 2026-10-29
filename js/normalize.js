// Transforme les données TCL (tracés des lignes de bus + points d'arrêt, open data Grand Lyon)
// en fichiers compacts pour l'appli. Sans DOM : utilisé par scripts/fetch-data.mjs et les tests.

import { simplify, haversine } from './geo.js';
import { Route } from './nav.js';

/** Familles à exclure si le champ « famille » est absent (métro, funiculaire, tram, Rhônexpress). */
const EXCLUDED_ID = /^(A|B|D|F1|F2|FUN\d*|T[1-7]|RX|RHONEXPRESS)$/i;
export const isExcludedLine = (id) => EXCLUDED_ID.test(String(id).trim());

const TAGS = { TVX: 'Travaux', MER: 'Mercredi', EXP: 'Express', NUI: 'Nuit', MAR: 'Marché', ZI: 'Zone industrielle', NAV: 'Navette', SCO: 'Scolaire' };
const STOP_MAX_DIST_M = 30;

function pick(props, names) {
  const lower = Object.fromEntries(Object.keys(props).map((k) => [k.toLowerCase(), props[k]]));
  for (const n of names) {
    const v = lower[n];
    if (v === undefined || v === null) continue;
    const t = String(v).replace(/[\u0000\u00a0]+/g, ' ').trim(); // le dbf remplit les champs de NUL / espaces insécables
    if (t !== '') return t;
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
      chain = chain.concat(best.d < 0.5 ? seg.slice(1) : seg); // évite de dupliquer le point de jonction
    } else {
      chain = (best.d < 0.5 ? seg.slice(0, -1) : seg).concat(chain);
    }
  }
  return chain;
}

const ymd = (s) => (s ? String(s).replace(/\D/g, '').slice(0, 8) : '');

/** Déduit origine/destination du nom du tracé : « 345101 ST-APPOLINAIRE>AMPLEPUIS », « A - B - C »… */
export function namesFromTrace(name) {
  if (!name) return [null, null];
  const clean = name.replace(/^\S*\d\S*\s+(?=\S)/, '').trim(); // retire le code de course en tête
  for (const sep of ['>', ' - ', ' – ', '→']) {
    const parts = clean.split(sep).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts[parts.length - 1]];
  }
  return [clean || null, null];
}

export const safeName = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

/** Index des arrêts par ligne : { ligne -> [{name, lat, lon, pmr, sens:Set}] } */
export function indexStops(stopsFC) {
  const byLine = new Map();
  for (const f of stopsFC?.features ?? []) {
    const p = f.properties ?? {};
    const g = f.geometry;
    if (!g || g.type !== 'Point') continue;
    const name = pick(p, ['nom']);
    const dess = pick(p, ['desserte']);
    if (!name || !dess) continue;
    const [lon, lat] = g.coordinates;
    const pmr = /^(true|1|oui|t)$/i.test(String(p.pmr ?? p.PMR ?? ''));
    const perLine = new Map();
    for (const tok of dess.split(',')) {
      const [line, sens] = tok.trim().split(':');
      if (!line) continue;
      if (!perLine.has(line)) perLine.set(line, new Set());
      if (sens) perLine.get(line).add(sens.toUpperCase());
    }
    for (const [line, sens] of perLine) {
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push({ name, lat, lon, pmr, sens });
    }
  }
  return byLine;
}

/** Arrêts d'une variante, dans l'ordre du tracé. */
export function stopsForVariant(lineId, variant, stopIndex) {
  const cands = stopIndex.get(lineId);
  if (!cands?.length || variant.coords.length < 2) return [];
  const route = new Route(variant.coords);
  const want = variant.sens === 'Aller' ? 'A' : variant.sens === 'Retour' ? 'R' : null;
  const all = [];
  for (const s of cands) {
    const [x, y] = route.proj.toXY(s.lat, s.lon);
    const near = route.nearest(x, y);
    if (near.dist <= STOP_MAX_DIST_M) all.push({ s, along: near.along });
  }
  // On garde le bon sens (A/R) ; si le fichier est incohérent (≈ 9 % des tracés) on retombe sur tous les arrêts proches.
  const sameSens = want ? all.filter(({ s }) => !s.sens.size || s.sens.has(want)) : all;
  const hits = (sameSens.length ? sameSens : all).sort((a, b) => a.along - b.along);
  const out = [];
  for (const { s } of hits) {
    const prev = out.at(-1);
    if (prev && prev[0] === s.name && haversine([prev[1], prev[2]], [s.lat, s.lon]) < 60) continue; // doublon (2 quais)
    out.push([s.name, Math.round(s.lat * 1e5) / 1e5, Math.round(s.lon * 1e5) / 1e5, s.pmr ? 1 : 0]);
  }
  return out;
}

/**
 * @param {object} linesFC GeoJSON des tracés (WGS84)
 * @param {object} [stopsFC] GeoJSON des arrêts (WGS84)
 * @param {{today?: string}} [opts] today = AAAAMMJJ (tracés expirés / futurs ignorés)
 */
export function normalize(linesFC, stopsFC = null, opts = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const stopIndex = stopsFC ? indexStops(stopsFC) : new Map();
  const byLine = new Map();
  const stats = { skipped: 0, expired: 0, future: 0, noGeometry: 0 };

  for (const f of linesFC.features ?? []) {
    const p = f.properties ?? {};
    const id = pick(p, ['ligne', 'code_ligne', 'nom_ligne', 'numero']);
    const family = pick(p, ['famille_tr', 'famille_transport', 'famille']);
    if (!id || (family ? family.toUpperCase() !== 'BUS' : isExcludedLine(id))) {
      stats.skipped++;
      continue;
    }
    const debut = ymd(pick(p, ['date_debut']));
    const fin = ymd(pick(p, ['date_fin']));
    if (fin && fin < today) { stats.expired++; continue; }
    if (debut && debut > today) { stats.future++; continue; }

    const g = f.geometry;
    const parts = g?.type === 'MultiLineString' ? g.coordinates : g?.type === 'LineString' ? [g.coordinates] : [];
    const raw = chainParts(parts);
    if (raw.length < 2) { stats.noGeometry++; continue; }

    const traceName = pick(p, ['nom_trace', 'libelle', 'nom']);
    const [trO, trD] = namesFromTrace(traceName);
    const origin = pick(p, ['nom_origin', 'nom_origine', 'origine_nom']) ?? trO ?? '?';
    const destination = pick(p, ['nom_destin', 'nom_destination', 'destination_nom']) ?? trD ?? origin;
    const sens = pick(p, ['sens']) ?? '';
    const code = pick(p, ['code_trace', 'gid']) ?? `${origin}>${destination}`;
    const tag = TAGS[(pick(p, ['type_trace']) ?? '').toUpperCase()] ?? '';
    const typeName = pick(p, ['nom_type_l', 'nom_type_ligne']) ?? '';
    const coords = simplify(raw, 2).map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);

    if (!byLine.has(id)) byLine.set(id, { id, color: null, scolaire: false, variants: [] });
    const line = byLine.get(id);
    line.color = line.color ?? parseColor(pick(p, ['couleur_he', 'couleur_hex', 'couleur', 'colour']));
    if (/^JD/i.test(id) || /scolaire/i.test(typeName)) line.scolaire = true;
    const dup = line.variants.find((v) => v.key === code);
    if (dup) {
      if (coords.length > dup.coords.length) dup.coords = coords;
    } else {
      line.variants.push({ key: code, tag, origin, destination, sens, coords });
    }
  }

  const index = { generated: new Date().toISOString(), source: 'data.gouv.fr — TCL / SYTRAL Mobilités', lines: [] };
  const routes = {};
  let withStops = 0;
  const all = [...byLine.values()].sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true }));
  for (const line of all) {
    const file = safeName(line.id);
    // variantes « nominales » d'abord
    line.variants.sort((a, b) => Number(!!a.tag) - Number(!!b.tag) || a.key.localeCompare(b.key, 'fr', { numeric: true }));
    for (const v of line.variants) {
      v.stops = stopsForVariant(line.id, v, stopIndex);
      if (v.stops.length) withStops++;
    }
    const terminus = [...new Set(line.variants.flatMap((v) => [v.origin, v.destination]))].filter((t) => t && t !== '?').slice(0, 8);
    index.lines.push({ id: line.id, file, color: line.color, scolaire: line.scolaire, terminus });
    routes[file] = { id: line.id, color: line.color, variants: line.variants };
  }
  const variants = all.reduce((n, l) => n + l.variants.length, 0);
  return { index, routes, stats: { ...stats, lines: index.lines.length, variants, withStops, scolaires: all.filter((l) => l.scolaire).length } };
}
