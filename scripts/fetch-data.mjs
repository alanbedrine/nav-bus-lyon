#!/usr/bin/env node
// Télécharge les lignes TCL (bus, trolleybus… hors métro/tram/funiculaire) depuis l'open data
// du Grand Lyon et génère data/index.json + data/routes/<ligne>.json.
//
// Usage :
//   node scripts/fetch-data.mjs                 # télécharge via les URL WFS connues
//   node scripts/fetch-data.mjs --url=<url>     # URL GeoJSON personnalisée
//   node scripts/fetch-data.mjs --file=x.geojson# GeoJSON déjà téléchargé

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../js/normalize.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  }),
);

const WFS = (typename) =>
  'https://data.grandlyon.com/geoserver/sytral/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature' +
  `&typename=${encodeURIComponent(typename)}&outputFormat=application/json&SRSNAME=EPSG:4326`;

const CANDIDATES = [
  WFS('sytral:tcl_sytral.tcllignebus'),
  WFS('sytral:tcl_sytral.tcllignebus_2_0_0'),
];

async function load() {
  if (args.file) return JSON.parse(await readFile(args.file, 'utf8'));
  const urls = args.url ? [args.url] : CANDIDATES;
  let lastErr;
  for (const url of urls) {
    try {
      console.log('→', url);
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.features?.length) throw new Error('aucune entité');
      return json;
    } catch (e) {
      lastErr = e;
      console.warn('  échec :', e.message);
    }
  }
  throw new Error(`Impossible de récupérer les données TCL (${lastErr?.message}). Utilisez --url ou --file.`);
}

const fc = await load();
const { index, routes, stats } = normalize(fc);
if (!stats.lines) throw new Error('Aucune ligne exploitable : vérifiez les noms de champs (voir js/normalize.js).');

await rm(join(root, 'data/routes'), { recursive: true, force: true });
await mkdir(join(root, 'data/routes'), { recursive: true });
await writeFile(join(root, 'data/index.json'), JSON.stringify(index));
for (const [file, data] of Object.entries(routes)) {
  await writeFile(join(root, 'data/routes', `${file}.json`), JSON.stringify(data));
}
console.log(`OK : ${stats.lines} lignes (${stats.skipped} entités ignorées : métro/tram/funiculaire ou sans identifiant).`);
for (const l of index.lines.slice(0, 5)) {
  const v = routes[l.file].variants[0];
  console.log(`  ex. ${l.id} ${v.origin} → ${v.destination} : départ ${v.coords[0]} / arrivée ${v.coords.at(-1)}`);
}
