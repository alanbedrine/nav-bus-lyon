import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveTime, weekKey, RSE_LIMITS } from '../js/drivetime.js';
import { decodePolyline, buildRouteRequest, parseRoute, geocode, fetchRoute, RouteError, truckDefaults, DEFAULT_VEHICLE } from '../js/routing.js';

const MIN = 60000;
const H = 3600000;
// Lundi 2026-10-26 08:00 (heure locale)
const T0 = new Date(2026, 9, 26, 8, 0, 0).getTime();

/** Simule `ms` de conduite à 50 km/h avec un point toutes les 10 s. */
function drive(dt, t, ms, kmh = 50) {
  for (let e = 0; e < ms; e += 10000) {
    t += 10000;
    dt.update(t, kmh);
  }
  return t;
}

test('semaine : le lundi est le début', () => {
  assert.equal(weekKey(new Date(2026, 9, 29).getTime()), '2026-10-26'); // jeudi
  assert.equal(weekKey(new Date(2026, 10, 1, 23, 59).getTime()), '2026-10-26'); // dimanche
  assert.equal(weekKey(new Date(2026, 10, 2).getTime()), '2026-11-02');
});

test('RSE : alerte avant 4 h 30 puis pause obligatoire', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  let t = drive(dt, T0, 4 * H + 5 * MIN);
  let s = dt.snapshot(t);
  assert.ok(s.alerts.some((a) => a.id === 'cont-30'), '30 min avant');
  assert.ok(!s.alerts.some((a) => a.id === 'cont-stop'));
  t = drive(dt, t, 26 * MIN);
  s = dt.snapshot(t);
  assert.ok(s.alerts.some((a) => a.id === 'cont-stop'));
  assert.equal(s.breakNeeded, 45 * MIN);
});

test('pause automatique à l’arrêt (0 km/h) : 45 min remettent le compteur à zéro', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  let t = drive(dt, T0, 3 * H);
  // Arrêt court (1 min) : compté en conduite
  t = drive(dt, t, 60000, 0);
  assert.equal(dt.snapshot(t).mode, 'stop');
  t = drive(dt, t, 60000, 50);
  assert.ok(Math.abs(dt.snapshot(t).cont - (3 * H + 2 * MIN)) < 30000);
  // Arrêt long : pause détectée, puis 45 min
  t = drive(dt, t, 46 * MIN, 0);
  let s = dt.snapshot(t);
  assert.equal(s.mode, 'pause');
  assert.ok(s.breakDone);
  assert.equal(s.cont, 0);
  t = drive(dt, t, 10000, 40);
  s = dt.snapshot(t);
  assert.equal(s.mode, 'drive');
  assert.ok(s.cont < MIN);
  // Le temps d'arrêt n'est pas compté dans la journée
  assert.ok(s.dayDrive < 3 * H + 5 * MIN);
});

test('pause fractionnée 15 puis 30 min', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  let t = drive(dt, T0, 2 * H);
  t = drive(dt, t, 16 * MIN, 0); // 15 min validées
  t = drive(dt, t, 20000, 30);
  let s = dt.snapshot(t);
  assert.equal(s.split, true);
  assert.equal(s.breakNeeded, 30 * MIN);
  assert.ok(s.cont > 2 * H);
  t = drive(dt, t, 2 * H, 50);
  t = drive(dt, t, 31 * MIN, 0); // 30 min -> coupure complète
  s = dt.snapshot(t);
  assert.equal(s.cont, 0);
});

test('une pause de 10 min ne compte pas', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  let t = drive(dt, T0, 2 * H);
  t = drive(dt, t, 10 * MIN, 0);
  t = drive(dt, t, 20000, 30);
  const s = dt.snapshot(t);
  assert.ok(s.cont > 2 * H);
  assert.equal(s.split, false);
});

test('bouton pause conduite : manuel, même en roulant à 0 puis reprise', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  let t = drive(dt, T0, H);
  dt.setManualPause(true, t);
  t += 46 * MIN;
  let s = dt.snapshot(t);
  assert.equal(s.mode, 'pause');
  assert.equal(s.manual, true);
  assert.ok(s.breakDone);
  dt.setManualPause(false, t);
  t = drive(dt, t, 60000, 40);
  s = dt.snapshot(t);
  assert.equal(s.mode, 'drive');
  assert.ok(s.cont < 2 * MIN);
});

test('journée : 9 h puis prolongation à 10 h (2 fois par semaine)', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  let t = T0;
  for (let i = 0; i < 4; i++) t = drive(dt, drive(dt, t, 2 * H + 15 * MIN), 50 * MIN, 0); // 4 x (2h15 + pause)
  let s = dt.snapshot(t);
  assert.ok(Math.abs(s.dayDrive - 9 * H) < 5 * MIN);
  t = drive(dt, t, 10000 + 10 * MIN);
  s = dt.snapshot(t);
  assert.ok(s.alerts.some((a) => a.id === 'day-ext'));
  assert.equal(s.extUsed, 1);
  assert.equal(s.dayCap, 10 * H);
});

test('repos journalier : réduit, insuffisant', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  let t = drive(dt, T0, H);
  dt.endService(t);
  const w1 = dt.startService(t + 12 * H);
  assert.equal(w1, null);
  let u = drive(dt, t + 12 * H, H);
  dt.endService(u);
  const w2 = dt.startService(u + 10 * H); // 10 h : réduit
  assert.match(w2, /réduit/);
  u = drive(dt, u + 10 * H, H);
  dt.endService(u);
  const w3 = dt.startService(u + 5 * H); // 5 h : même journée
  assert.match(w3, /continue/);
  assert.ok(dt.snapshot(u + 5 * H).dayDrive >= H - MIN);
});

test('RSN : seuils modifiables', () => {
  const dt = new DriveTime();
  dt.setRegime('RSN', T0);
  dt.setLimits({ cont: 5 * H });
  dt.startService(T0);
  const t = drive(dt, T0, 4 * H + 40 * MIN);
  const s = dt.snapshot(t);
  assert.equal(s.regime, 'RSN');
  assert.ok(!s.alerts.some((a) => a.id === 'cont-stop'));
  assert.ok(s.alerts.some((a) => a.id.startsWith('cont-')));
});

test('sauvegarde / restauration', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  const t = drive(dt, T0, 2 * H);
  const copy = new DriveTime(JSON.parse(JSON.stringify(dt)));
  assert.equal(Math.round(copy.snapshot(t).cont / MIN), Math.round(dt.snapshot(t).cont / MIN));
  assert.equal(copy.snapshot(t).service, true);
  assert.equal(RSE_LIMITS.cont, 4.5 * H);
});

/* ---------- Routage ---------- */

test('polyligne : décodage précision 5 et 6', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  const enc6 = '_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI'; // 3 points précision 6 (Valhalla)
  const pts = decodePolyline(enc6);
  assert.equal(pts.length, 3);
  assert.ok(Math.abs(pts[0][0] - 38.5) < 1e-6);
});

test('gabarits : camion et bus', () => {
  const t = truckDefaults(26);
  assert.equal(t.weight, 26);
  const truck = buildRouteRequest({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { ...DEFAULT_VEHICLE, kind: 'truck', hazmat: true });
  assert.equal(truck.costing, 'truck');
  assert.equal(truck.costing_options.truck.hazmat, true);
  assert.equal(truck.directions_options.language, 'fr-FR');
  const bus = buildRouteRequest({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { ...DEFAULT_VEHICLE, kind: 'bus', avoidTolls: true });
  assert.equal(bus.costing, 'bus');
  assert.equal(bus.costing_options.bus.use_tolls, 0);
  assert.equal(bus.costing_options.bus.hazmat, undefined);
});

const fakeTrip = {
  trip: {
    summary: { length: 1.2, time: 180 },
    legs: [
      {
        shape: '_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI',
        maneuvers: [
          { type: 1, instruction: 'Dirigez-vous vers le nord.', begin_shape_index: 0, end_shape_index: 1, length: 0.5, time: 60, street_names: ['Rue A'] },
          { type: 4, instruction: 'Vous êtes arrivé.', begin_shape_index: 2, end_shape_index: 2, length: 0, time: 0 },
        ],
      },
    ],
  },
};

test('réponse Valhalla : parcours, manœuvres, erreurs', () => {
  const r = parseRoute(fakeTrip);
  assert.equal(r.coords.length, 3);
  assert.equal(r.length, 1200);
  assert.equal(r.maneuvers.length, 2);
  assert.equal(r.maneuvers[0].street, 'Rue A');
  assert.throws(() => parseRoute({ error_code: 442, error: 'No path could be found for input' }), (e) => e instanceof RouteError && /gabarit/.test(e.message));
  assert.throws(() => parseRoute({ error: 'boom' }), RouteError);
});

test('appels réseau simulés : géocodage et itinéraire', async () => {
  const seen = [];
  const geo = await geocode('10 rue de la Paix lyon', {
    near: { lat: 45.7, lon: 4.8 },
    fetchImpl: async (u) => {
      seen.push(String(u));
      return { ok: true, json: async () => ({ features: [{ geometry: { type: 'Point', coordinates: [4.83, 45.76] }, properties: { label: '10 Rue de la Paix 69002 Lyon', postcode: '69002', city: 'Lyon', type: 'housenumber' } }] }) };
    },
  });
  assert.match(seen[0], /q=10\+rue|q=10%20rue/);
  assert.match(seen[0], /lat=45.7/);
  assert.equal(geo[0].lat, 45.76);
  assert.equal(geo[0].city, '69002 Lyon');
  const r = await fetchRoute({ lat: 45.7, lon: 4.8 }, { lat: 45.8, lon: 4.9 }, DEFAULT_VEHICLE, { fetchImpl: async () => ({ ok: true, json: async () => fakeTrip }) });
  assert.equal(r.coords.length, 3);
  await assert.rejects(fetchRoute({ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, DEFAULT_VEHICLE, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), /injoignable/);
  await assert.rejects(fetchRoute({ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, DEFAULT_VEHICLE, { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error_code: 442, error: 'No path could be found' }) }) }), /gabarit/);
});

/* ---------- Filtre de mouvement GPS ---------- */
import { MotionFilter } from '../js/services.js';
import { chainParts, cleanLineId } from '../js/normalize.js';

test('GPS à l’arrêt : la dérive ne donne ni vitesse ni déplacement', () => {
  const f = new MotionFilter();
  let last;
  for (let i = 0; i < 60; i++) {
    // dérive de ±4 m, vitesse « Doppler » bruitée à 1 m/s
    last = f.push({ lat: 45.76 + Math.sin(i) * 0.00003, lon: 4.83 + Math.cos(i * 2) * 0.00003, accuracy: 12, speed: 0.4 + (i % 3) * 0.3, t: i * 1000 });
  }
  assert.equal(last.speedKmh, 0);
  assert.equal(last.stationary, true);
  assert.equal(last.heading, null);
});

test('GPS sans vitesse capteur : vitesse calculée, puis arrêt', () => {
  const f = new MotionFilter();
  let last;
  for (let i = 0; i < 20; i++) last = f.push({ lat: 45.76 + i * 0.00014, lon: 4.83, accuracy: 6, speed: null, t: i * 1000 }); // ~15,5 m/s
  assert.ok(last.speedKmh > 45 && last.speedKmh < 65, `vitesse ${last.speedKmh}`);
  for (let i = 20; i < 35; i++) last = f.push({ lat: 45.76 + 20 * 0.00014, lon: 4.83, accuracy: 6, speed: null, t: i * 1000 });
  assert.equal(last.speedKmh, 0);
});

test('mauvais fix (précision > 80 m) ignoré', () => {
  const f = new MotionFilter();
  for (let i = 0; i < 5; i++) f.push({ lat: 45.76 + i * 0.0001, lon: 4.83, accuracy: 5, speed: 10, heading: 0, t: i * 1000 });
  const bad = f.push({ lat: 45.9, lon: 4.9, accuracy: 300, speed: 40, t: 6000 });
  assert.ok(Math.abs(bad.lat - 45.7604) < 0.001);
  assert.ok(bad.speedKmh > 20 && bad.speedKmh < 40);
});

/* ---------- Tracés : boucles / antennes (ligne 106) ---------- */

test('chaînage : boucle fermée et antenne isolée écartées, identifiant « 106. » corrigé', () => {
  const lonlat = (lat, lon) => [lon, lat];
  const main = Array.from({ length: 40 }, (_, i) => lonlat(45.74 + i * 0.001, 4.80 + i * 0.0003));
  const loop = Array.from({ length: 9 }, (_, i) => lonlat(45.7625 + 0.0004 * Math.sin((i / 8) * 2 * Math.PI), 4.8118 + 0.0004 * Math.cos((i / 8) * 2 * Math.PI)));
  loop.push(loop[0]);
  const spur = [lonlat(45.7625, 4.8118), lonlat(45.7645, 4.8135)]; // ~270 m, loin des extrémités
  const chain = chainParts([loop, spur, main]);
  assert.equal(chain.length, main.length);
  assert.equal(chain[0][0], 45.74);
  assert.equal(cleanLineId('106.', '106E-1'), '106E');
  assert.equal(cleanLineId('106', '106-3'), '106');
  assert.equal(cleanLineId('12.', 'xx'), '12');
});

test('chaînage : une boucle accrochée au tracé devient un détour (arrêts de la Cadière, ligne 106)', () => {
  const lonlat = (lat, lon) => [lon, lat];
  const main = Array.from({ length: 40 }, (_, i) => lonlat(45.74 + i * 0.001, 4.8));
  const spur = Array.from({ length: 6 }, (_, i) => lonlat(45.7595 - i * 0.0004, 4.8 + i * 0.0002)); // part de la ligne vers l'est
  const loopStart = spur.at(-1);
  const loop = Array.from({ length: 9 }, (_, i) => [loopStart[0] + 0.0004 * Math.sin((i / 8) * 2 * Math.PI), loopStart[1] + 0.0004 * (1 - Math.cos((i / 8) * 2 * Math.PI))]);
  loop.push(loop[0]);
  const stats = {};
  const chain = chainParts([main, spur, loop], stats);
  assert.equal(stats.detours, 1);
  assert.ok(chain.length > main.length + 10);
  assert.equal(chain[0][0], 45.74);
  assert.equal(chain.at(-1)[0], 45.779);
});

test('compte à rebours de la limite la plus proche, puis dépassement', () => {
  const dt = new DriveTime();
  dt.startService(T0);
  let t = drive(dt, T0, 4 * H + 10 * MIN);
  let s = dt.snapshot(t);
  assert.equal(s.limit.id, 'cont');
  assert.ok(Math.abs(s.limit.left - 20 * MIN) < 30000);
  t = drive(dt, t, 25 * MIN);
  s = dt.snapshot(t);
  assert.ok(s.limit.left < 0, 'dépassée');
  assert.ok(Math.abs(s.limit.left + 5 * MIN) < 30000);
  t = drive(dt, t, 46 * MIN, 0); // pause complète : plus de dépassement de conduite continue
  s = dt.snapshot(t);
  assert.notEqual(s.limit.id, 'cont');
  assert.ok(s.limit.left > 0);
});
