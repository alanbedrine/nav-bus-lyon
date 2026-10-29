// Mode démo (?demo) : GPS simulé qui roule le long de l'itinéraire, pour tester sans bouger (sur un PC, dans un aperçu…).
// Aucune donnée réelle n'est utilisée en navigation libre : adresses et itinéraire sont simulés et signalés comme tels.

import { haversine, bearing } from './geo.js';

export const isDemo = () => globalThis.__DEMO__ === true || new URLSearchParams(location.search).has('demo');

const START = [45.7578, 4.832]; // Lyon, Bellecour

export class DemoLocator {
  constructor(cb) {
    this.cb = cb;
    this.pos = START.slice();
    this.heading = null;
    this.speed = 0;
    this.kmh = 40;
    this.coords = null;
    this.along = 0;
    this.playing = true;
    this.shift = 0; // décalage latéral en mètres (simule une sortie de tracé)
    this.timer = null;
    this.ui();
  }

  start() {
    this.cb.onStatus({ status: 'pending' });
    setTimeout(() => {
      this.cb.onStatus({ status: 'ok' });
      this.emit();
    }, 400);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Démarre un parcours le long de `coords` ([lat, lon]) depuis son début. */
  follow(coords, reset = false) {
    if (reset) {
      this.shift = 0; // le recalcul part de la position (décalée) : on revient sur le tracé simulé
      const b = document.getElementById('demo-off');
      if (b) b.textContent = 'Sortir du tracé';
    }
    this.coords = coords;
    this.cum = [0];
    for (let i = 1; i < coords.length; i++) this.cum.push(this.cum[i - 1] + haversine(coords[i - 1], coords[i]));
    this.along = 0;
    this.pos = coords[0].slice();
    this.playing = true;
    this.updateUi();
    this.emit();
  }

  halt() {
    this.coords = null;
    this.speed = 0;
    this.updateUi();
  }

  at(d) {
    const c = this.coords;
    if (d >= this.cum.at(-1)) return { p: c.at(-1), h: this.heading };
    let i = 1;
    while (this.cum[i] < d) i++;
    const f = (d - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    return { p: [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f], h: bearing(c[i - 1], c[i]) };
  }

  tick() {
    if (this.coords && this.playing && this.along < this.cum.at(-1)) {
      this.along = Math.min(this.cum.at(-1), this.along + (this.kmh / 3.6) * 1);
      const { p, h } = this.at(this.along);
      this.pos = p;
      this.heading = h;
      this.speed = this.along >= this.cum.at(-1) ? 0 : this.kmh;
    } else {
      this.speed = 0;
    }
    this.emit();
  }

  emit() {
    const dLon = this.shift ? this.shift / (111320 * Math.cos((this.pos[0] * Math.PI) / 180)) : 0;
    this.cb.onFix({
      lat: this.pos[0],
      lon: this.pos[1] + dLon,
      accuracy: 6,
      heading: this.speed > 0 ? this.heading : null,
      speedKmh: this.speed,
      stationary: this.speed === 0,
      t: Date.now(),
    });
  }

  ui() {
    const bar = document.createElement('div');
    bar.id = 'demo-bar';
    bar.innerHTML =
      '<strong>DÉMO</strong><button id="demo-play" aria-label="Pause">⏸</button>' +
      '<select id="demo-speed" aria-label="Vitesse simulée"><option value="20">20 km/h</option><option value="40" selected>40 km/h</option><option value="70">70 km/h</option><option value="110">110 km/h</option></select>' +
      '<button id="demo-off">Sortir du tracé</button>';
    document.body.append(bar);
    bar.querySelector('#demo-play').onclick = () => {
      this.playing = !this.playing;
      this.updateUi();
    };
    bar.querySelector('#demo-speed').onchange = (e) => (this.kmh = Number(e.target.value));
    bar.querySelector('#demo-off').onclick = () => {
      this.shift = this.shift ? 0 : 120;
      bar.querySelector('#demo-off').textContent = this.shift ? 'Revenir sur le tracé' : 'Sortir du tracé';
    };
  }

  updateUi() {
    const b = document.getElementById('demo-play');
    if (b) b.textContent = this.playing ? '⏸' : '▶';
  }
}

/* ---------- Faux services d'adresse et d'itinéraire (démo uniquement) ---------- */

function enc6(coords) {
  let out = '';
  let pl = 0;
  let po = 0;
  const w = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [la, lo] of coords) {
    const a = Math.round(la * 1e6);
    const b = Math.round(lo * 1e6);
    w(a - pl);
    w(b - po);
    pl = a;
    po = b;
  }
  return out;
}

const PLACES = [
  { label: '(démo) Gare de Lyon Part-Dieu, 69003 Lyon', lat: 45.7606, lon: 4.8594 },
  { label: '(démo) Place Bellecour, 69002 Lyon', lat: 45.7578, lon: 4.832 },
  { label: '(démo) Gare d’Oullins, 69600 Oullins', lat: 45.7165, lon: 4.8145 },
];

export const demoNet = {
  fetch: async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('geocodage')) {
      const q = (u.searchParams.get('q') ?? '').toLowerCase();
      const feats = PLACES.map((p) => ({ geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { label: p.label, city: 'Lyon', type: 'démo' } }));
      return { ok: true, json: async () => ({ features: q ? feats : [] }) };
    }
    const req = JSON.parse(u.searchParams.get('json'));
    const [a, b] = req.locations;
    // trajet simulé : d'abord vers l'est/ouest, puis vers le nord/sud (pas un vrai calcul d'itinéraire)
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push([a.lat, a.lon + ((b.lon - a.lon) * i) / 12]);
    for (let i = 1; i <= 12; i++) pts.push([a.lat + ((b.lat - a.lat) * i) / 12, b.lon]);
    const len = pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);
    const turn = b.lat >= a.lat ? 'gauche' : 'droite';
    return {
      ok: true,
      json: async () => ({
        trip: {
          summary: { length: len / 1000, time: len / 8 },
          warnings: [{ text: 'DÉMO : itinéraire simulé, il ne tient pas compte du gabarit ni des routes réelles.' }],
          legs: [{
            shape: enc6(pts),
            maneuvers: [
              { type: 1, instruction: 'Dirigez-vous vers l’est (démo).', begin_shape_index: 0, end_shape_index: 12, length: len / 2000, time: len / 16, street_names: ['Rue de la Démo'] },
              { type: turn === 'gauche' ? 15 : 10, instruction: `Tournez à ${turn} (démo).`, begin_shape_index: 12, end_shape_index: 24, length: len / 2000, time: len / 16, street_names: ['Avenue de l’Essai'] },
              { type: 4, instruction: 'Vous êtes arrivé (démo).', begin_shape_index: 24, end_shape_index: 24, length: 0, time: 0 },
            ],
          }],
        },
      }),
    };
  },
};
