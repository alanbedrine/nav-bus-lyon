#!/usr/bin/env node
// Génère data/index.json + data/routes/<ligne>.json à partir des données ouvertes TCL (data.gouv.fr).
//
// Usage :
//   node scripts/fetch-data.mjs                                   # télécharge les deux jeux publics
//   node scripts/fetch-data.mjs --lines=<url|fichier> --stops=<url|fichier>
// Formats acceptés : GeoJSON, ou archive .zip de shapefile (Lambert-93 ou WGS84).

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../js/normalize.js';
import { loadFeatureCollection } from './lib/load.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  }),
);

// Jeux publics (sans compte) : https://www.data.gouv.fr/datasets/lignes-de-bus-du-reseau-transports-en-commun-lyonnais
//                              https://www.data.gouv.fr/datasets/points-darret-du-reseau-transports-en-commun-lyonnais
const LINES = args.lines || 'https://www.data.gouv.fr/api/1/datasets/r/3d5eb646-56fe-47bd-a22c-cc4e976d4722';
const STOPS = args.stops || 'https://www.data.gouv.fr/api/1/datasets/r/8cd06f11-1702-4071-8970-b975bb97c624';

console.log('→ tracés :', LINES);
const lines = await loadFeatureCollection(LINES);
console.log('→ arrêts :', STOPS);
const stops = await loadFeatureCollection(STOPS);

const { index, routes, stats } = normalize(lines, stops);
if (!stats.lines) throw new Error('Aucune ligne exploitable : vérifiez les noms de champs (js/normalize.js).');

await rm(join(root, 'data/routes'), { recursive: true, force: true });
await mkdir(join(root, 'data/routes'), { recursive: true });
await writeFile(join(root, 'data/index.json'), JSON.stringify(index));
for (const [file, data] of Object.entries(routes)) {
  await writeFile(join(root, 'data/routes', `${file}.json`), JSON.stringify(data));
}
console.log(
  `OK : ${stats.lines} lignes (dont ${stats.scolaires} scolaires), ${stats.variants} tracés, ${stats.withStops} avec arrêts.\n` +
    `     ignorés : ${stats.skipped} hors bus, ${stats.expired} expirés, ${stats.future} pas encore en service, ${stats.noGeometry} sans géométrie.`,
);
