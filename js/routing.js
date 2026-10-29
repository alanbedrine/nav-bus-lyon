// Navigation libre : géocodage (API de l'État), itinéraire poids lourd / bus (Valhalla), décodage de la réponse.
// Sans DOM (testable sous Node). `fetchImpl` est injectable pour les tests.

import { CONFIG } from './config.js';

/* ---------- Gabarits ---------- */

export const PTAC_OPTIONS = [3.5, 7.5, 12, 19, 26, 32, 40, 44];

export const BUS_PRESETS = {
  standard: { label: 'Autobus standard 12 m', weight: 19, height: 3.3, width: 2.55, length: 12 },
  articule: { label: 'Autobus articulé 18 m', weight: 28, height: 3.3, width: 2.55, length: 18 },
  autocar: { label: 'Autocar 13 m', weight: 19, height: 3.7, width: 2.55, length: 13 },
  minibus: { label: 'Minibus / midibus', weight: 7.5, height: 2.9, width: 2.3, length: 8 },
};

/** Gabarit indicatif d'un camion selon son PTAC (modifiable par le conducteur). */
export function truckDefaults(ptac) {
  const t = [
    [3.5, { height: 2.8, width: 2.1, length: 6 }],
    [7.5, { height: 3.4, width: 2.5, length: 8 }],
    [12, { height: 3.6, width: 2.5, length: 9.5 }],
    [19, { height: 3.8, width: 2.55, length: 10.5 }],
    [26, { height: 4, width: 2.55, length: 12 }],
    [32, { height: 4, width: 2.55, length: 12 }],
    [40, { height: 4, width: 2.55, length: 16.5 }],
    [44, { height: 4, width: 2.55, length: 18.75 }],
  ].find(([max]) => ptac <= max)?.[1] ?? { height: 4, width: 2.55, length: 18.75 };
  return { ...t, weight: ptac, axle: Math.min(12, Math.max(1.8, Math.round(ptac * 0.45 * 10) / 10)) };
}

// Par défaut : autocar (les utilisateurs sont des conducteurs de bus/car). Modifiable dans « Mon véhicule ».
export const DEFAULT_VEHICLE = { kind: 'bus', busPreset: 'autocar', ...BUS_PRESETS.autocar, axle: 10, hazmat: false, avoidTolls: false };

export function vehicleTitle(v) {
  return v.kind === 'bus' ? `Bus / autocar · ${fmt(v.weight)} t` : `Camion · ${fmt(v.weight)} t`;
}
export function vehicleSubtitle(v) {
  return `H ${fmt(v.height)} m · l ${fmt(v.width)} m · L ${fmt(v.length)} m${v.kind === 'truck' ? ` · essieu ${fmt(v.axle)} t` : ''}${v.hazmat ? ' · matières dangereuses' : ''}`;
}
const fmt = (n) => String(Number(n)).replace('.', ',');

/* ---------- Géocodage (Géoplateforme) ---------- */

export async function geocode(q, { near = null, limit = 6, fetchImpl = fetch, signal } = {}) {
  const url = new URL(CONFIG.geocodeUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  if (near) {
    url.searchParams.set('lat', String(near.lat));
    url.searchParams.set('lon', String(near.lon));
  }
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`Adresse : service indisponible (${res.status})`);
  const json = await res.json();
  return (json.features ?? [])
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => {
      const p = f.properties ?? {};
      const [lon, lat] = f.geometry.coordinates;
      return { label: p.label ?? p.name ?? q, city: [p.postcode, p.city].filter(Boolean).join(' '), type: p.type ?? '', lat, lon };
    });
}

/* ---------- Itinéraire (Valhalla) ---------- */

export function buildRouteRequest(from, to, vehicle) {
  const costing = vehicle.kind === 'bus' ? 'bus' : 'truck';
  const opts = {
    height: round(vehicle.height),
    width: round(vehicle.width),
    length: round(vehicle.length),
    weight: round(vehicle.weight),
    use_tolls: vehicle.avoidTolls ? 0 : 0.5,
  };
  if (costing === 'truck') {
    opts.axle_load = round(vehicle.axle);
    opts.hazmat = !!vehicle.hazmat;
  }
  return {
    locations: [
      { lat: from.lat, lon: from.lon, type: 'break' },
      { lat: to.lat, lon: to.lon, type: 'break' },
    ],
    costing,
    costing_options: { [costing]: opts },
    directions_options: { units: 'kilometers', language: 'fr-FR' },
    id: 'nav-lyon-bus',
  };
}
const round = (n) => Math.round(Number(n) * 100) / 100;

/** Polyligne encodée (algorithme Google, précision 1e6 pour Valhalla) -> [[lat, lon], ...] */
export function decodePolyline(str, precision = 6) {
  const f = 10 ** precision;
  let i = 0;
  let lat = 0;
  let lon = 0;
  const out = [];
  const next = () => {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push([lat / f, lon / f]);
  }
  return out;
}

export class RouteError extends Error {}

/** Panneau de sortie / bretelle : « Sortie 12 · A7 · Direction Marseille ». */
export function signText(sign) {
  if (!sign) return '';
  const j = (arr) => (arr ?? []).map((e) => e.text).filter(Boolean).join(', ');
  const num = j(sign.exit_number_elements);
  const branch = j(sign.exit_branch_elements);
  const toward = j(sign.exit_toward_elements);
  const name = j(sign.exit_name_elements);
  return [num && `Sortie ${num}`, branch, toward && `Direction ${toward}`, name].filter(Boolean).join(' · ');
}

export function parseRoute(resp) {
  if (!resp || resp.error || !resp.trip) {
    const code = resp?.error_code;
    const noPath = code === 442 || code === 171 || code === 170 || /no path|no suitable edges/i.test(String(resp?.error ?? ''));
    throw new RouteError(
      noPath
        ? 'Aucun itinéraire compatible avec ce gabarit entre ces deux points (restrictions de tonnage, hauteur ou accès). Vérifiez le gabarit ou la destination.'
        : `Itinéraire indisponible${resp?.error ? ` : ${resp.error}` : ''}`,
    );
  }
  const coords = [];
  const maneuvers = [];
  for (const leg of resp.trip.legs ?? []) {
    const shape = decodePolyline(leg.shape);
    const offset = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? shape.slice(1) : shape));
    for (const m of leg.maneuvers ?? []) {
      maneuvers.push({
        text: m.instruction ?? '',
        verbal: m.verbal_pre_transition_instruction ?? m.instruction ?? '',
        alert: m.verbal_transition_alert_instruction ?? '',
        type: m.type ?? 0,
        exitCount: m.roundabout_exit_count ?? null,
        sign: signText(m.sign),
        begin: (m.begin_shape_index ?? 0) + offset,
        end: (m.end_shape_index ?? 0) + offset,
        length: (m.length ?? 0) * 1000,
        time: m.time ?? 0,
        street: m.street_names?.[0] ?? '',
      });
    }
  }
  if (coords.length < 2) throw new RouteError('Itinéraire vide');
  const s = resp.trip.summary ?? {};
  return {
    coords,
    maneuvers,
    length: (s.length ?? 0) * 1000,
    time: s.time ?? 0,
    warnings: (resp.trip.warnings ?? []).map((w) => w.text ?? String(w)),
  };
}

export async function fetchRoute(from, to, vehicle, { fetchImpl = fetch, signal } = {}) {
  const url = new URL(CONFIG.routeUrl);
  // GET avec ?json= : requête « simple », sans pré-vérification CORS.
  url.searchParams.set('json', JSON.stringify(buildRouteRequest(from, to, vehicle)));
  let res;
  try {
    res = await fetchImpl(url, { signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new RouteError('Service d\'itinéraire injoignable (réseau ou blocage navigateur).');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {}
  if (!res.ok && !json?.error) throw new RouteError(`Service d'itinéraire indisponible (${res.status})`);
  return parseRoute(json);
}

/** Symbole de flèche pour un type de manœuvre Valhalla. */
export function maneuverGlyph(type) {
  const t = Number(type);
  if ([4, 5, 6].includes(t)) return '⚑';
  if ([9, 16, 17, 22].includes(t) && t !== 17 && t !== 22) return t === 9 ? '↗' : '↖';
  if ([10, 2, 18, 20, 23, 37].includes(t)) return '↱';
  if ([15, 3, 19, 21, 24, 38].includes(t)) return '↰';
  if (t === 11) return '↘';
  if (t === 14) return '↙';
  if ([12, 13].includes(t)) return '↶';
  if ([26, 27].includes(t)) return '⟳';
  if ([28, 29].includes(t)) return '⛴';
  return '↑';
}
