// Chargement d'un jeu de données géographique : URL ou fichier, GeoJSON ou shapefile (.zip), Lambert-93 ou WGS84.
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import * as shapefile from 'shapefile';
import proj4 from 'proj4';

const LAMBERT93 = '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs';

function firstCoord(c) {
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return c;
}
function mapCoords(c, fn) {
  return typeof c[0] === 'number' ? fn(c) : c.map((x) => mapCoords(x, fn));
}

export async function loadFeatureCollection(src) {
  let buf;
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} pour ${src}`);
    buf = new Uint8Array(await res.arrayBuffer());
  } else {
    buf = new Uint8Array(await readFile(src));
  }
  let fc;
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const files = unzipSync(buf);
    const shp = Object.keys(files).find((n) => /\.shp$/i.test(n));
    const dbf = Object.keys(files).find((n) => /\.dbf$/i.test(n));
    if (!shp || !dbf) throw new Error(`Archive sans .shp/.dbf : ${src}`);
    fc = await shapefile.read(files[shp], files[dbf], { encoding: 'windows-1252' });
  } else {
    fc = JSON.parse(new TextDecoder().decode(buf));
  }
  const sample = firstCoord(fc.features.find((f) => f.geometry)?.geometry?.coordinates);
  if (sample && Math.abs(sample[0]) > 180) {
    const tr = proj4(LAMBERT93, 'WGS84');
    for (const f of fc.features) if (f.geometry) f.geometry.coordinates = mapCoords(f.geometry.coordinates, (c) => tr.forward([c[0], c[1]]));
  }
  return fc;
}
