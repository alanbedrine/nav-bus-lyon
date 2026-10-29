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
  const truck = buildRouteRequest({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { ...DEFAULT_VEHICLE, hazmat: true });
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
