#!/usr/bin/env node
// Génère geo/fr-ranges.php : plages d'adresses IP attribuées à la France (registre RIPE NCC, public).
// Usage : node scripts/update-fr-ranges.mjs [--file=delegated-ripencc-extended-latest]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest';

const ipv6ToBig = (s) => {
  const [head, tail = ''] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g || '0', 16)), 0n);
};

/** Extrait { v4: [[début, fin]], v6: [[hexDébut, hexFin]] } d'un fichier « delegated » du RIPE. */
export function parseDelegated(text, country = 'FR') {
  const v4 = [];
  const v6 = [];
  for (const line of text.split('\n')) {
    const f = line.split('|');
    if (f.length < 7 || f[1] !== country || !['allocated', 'assigned'].includes(f[6].trim())) continue;
    if (f[2] === 'ipv4') {
      const [a, b, c, d] = f[3].split('.').map(Number);
      const start = ((a * 256 + b) * 256 + c) * 256 + d;
      v4.push([start, start + Number(f[4]) - 1]);
    } else if (f[2] === 'ipv6') {
      const start = ipv6ToBig(f[3]);
      const end = start + (1n << BigInt(128 - Number(f[4]))) - 1n;
      v6.push([start, end]);
    }
  }
  const merge = (list) => {
    list.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    const out = [];
    for (const r of list) {
      const last = out.at(-1);
      if (last && r[0] <= last[1] + (typeof r[0] === 'bigint' ? 1n : 1)) {
        if (r[1] > last[1]) last[1] = r[1];
      } else out.push([...r]);
    }
    return out;
  };
  const hex = (n) => n.toString(16).padStart(32, '0');
  return { v4: merge(v4), v6: merge(v6).map(([s, e]) => [hex(s), hex(e)]) };
}

export function toPhp({ v4, v6 }) {
  return (
    '<?php\n// Généré par scripts/update-fr-ranges.mjs (source : RIPE NCC). Ne pas modifier à la main.\nreturn [\n' +
    `  'generated' => '${new Date().toISOString()}',\n` +
    `  'v4' => [${v4.map(([s, e]) => `[${s},${e}]`).join(',')}],\n` +
    `  'v6' => [${v6.map(([s, e]) => `['${s}','${e}']`).join(',')}],\n];\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv.find((a) => a.startsWith('--file='));
  const text = arg ? await readFile(arg.slice(7), 'utf8') : await (await fetch(SOURCE)).text();
  const ranges = parseDelegated(text);
  if (ranges.v4.length < 500) throw new Error(`Liste suspecte (${ranges.v4.length} plages IPv4) : fichier incomplet ?`);
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'geo', 'fr-ranges.php');
  await writeFile(out, toPhp(ranges));
  console.log(`OK : ${ranges.v4.length} plages IPv4, ${ranges.v6.length} plages IPv6 -> geo/fr-ranges.php`);
}
