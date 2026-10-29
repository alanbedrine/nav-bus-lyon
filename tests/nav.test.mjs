import test from 'node:test';
import assert from 'node:assert/strict';
import { Route, NavEngine } from '../js/nav.js';
import { normalize, chainParts, isExcludedLine, parseColor, namesFromTrace } from '../js/normalize.js';
import { makeProjector } from '../js/geo.js';

// Tracé synthétique : 1 km vers l'est, puis 1 km vers le nord (autour de Lyon Bellecour).
const O = [45.7578, 4.832];
const pr = makeProjector(O);
const ll = (x, y) => pr.toLatLon(x, y);
const coords = [ll(0, 0), ll(500, 0), ll(1000, 0), ll(1000, 500), ll(1000, 1000)];
const fix = (x, y, accuracy = 10) => {
  const [lat, lon] = ll(x, y);
  return { lat, lon, accuracy };
};

test('longueur du tracé ≈ 2 km', () => {
  const r = new Route(coords);
  assert.ok(Math.abs(r.length - 2000) < 5);
});

test('suivi nominal puis arrivée', () => {
  const nav = new NavEngine(new Route(coords));
  let s = nav.update(fix(10, 5));
  assert.equal(s.state, 'on');
  s = nav.update(fix(700, 3));
  assert.equal(s.state, 'on');
  assert.ok(Math.abs(s.along - 700) < 10);
  s = nav.update(fix(1002, 600));
  assert.ok(Math.abs(s.remaining - 400) < 10);
  s = nav.update(fix(1000, 990));
  assert.equal(s.state, 'arrived');
});

test('écart > seuil : délocalisé après 3 positions, retour après 2 positions sur le tracé', () => {
  const nav = new NavEngine(new Route(coords));
  nav.update(fix(100, 0));
  assert.equal(nav.update(fix(200, 120)).state, 'on'); // 1er écart
  assert.equal(nav.update(fix(250, 130)).state, 'on'); // 2e écart
  const off = nav.update(fix(300, 140));
  assert.equal(off.state, 'off');
  assert.ok(off.offDistance > 100);
  assert.equal(nav.update(fix(400, 5)).state, 'off'); // 1re position correcte
  assert.equal(nav.update(fix(420, 5)).state, 'on'); // 2e : retour
});

test("pas de recalcul : l'abscisse ne recule jamais", () => {
  const nav = new NavEngine(new Route(coords));
  nav.update(fix(100, 0));
  nav.update(fix(600, 0));
  const s = nav.update(fix(550, 0)); // bruit GPS vers l'arrière
  assert.ok(s.along >= 595);
});

test('départ loin du tracé : délocalisé', () => {
  const nav = new NavEngine(new Route(coords));
  assert.equal(nav.update(fix(-800, -800)).state, 'off');
});

test('retournement : le tracé inversé démarre à la position courante', () => {
  const r = new Route(coords);
  const back = r.reversed();
  const nav = new NavEngine(back);
  const s = nav.update(fix(1000, 900));
  assert.equal(s.state, 'on');
  assert.ok(s.along < 150);
});

test('normalisation : famille BUS, couleurs, scolaires JD, dates, arrêts', () => {
  assert.ok(['A', 'B', 'D', 'F1', 'F2', 'T1', 'T6', 'RX'].every(isExcludedLine));
  assert.ok(!['C1', 'C13', '4', '32', 'JD345', 'T36', 'TB11', 'N181'].some(isExcludedLine));
  assert.equal(parseColor('255 0 128'), '#ff0080');
  assert.equal(parseColor('#E30613'), '#e30613');

  // 2 morceaux fournis avec des orientations différentes
  const parts = [
    [[4.83, 45.75], [4.84, 45.75]],
    [[4.85, 45.75], [4.84, 45.75]],
  ];
  const chain = chainParts(parts);
  assert.deepEqual(chain.map((c) => c[1]), [4.83, 4.84, 4.85]);

  // nom des terminus déduit du nom du tracé (lignes scolaires sans origine/destination)
  assert.deepEqual(namesFromTrace('345101 ST-APPOLINAIRE>AMPLEPUIS'), ['ST-APPOLINAIRE', 'AMPLEPUIS']);
  assert.deepEqual(namesFromTrace('Mermoz - Pinel - Parilly Universite Hippodrome'), ['Mermoz', 'Parilly Universite Hippodrome']);

  const f = (props, coordinates) => ({ properties: props, geometry: { type: 'LineString', coordinates } });
  const line = [[4.83, 45.75], [4.835, 45.75], [4.84, 45.75], [4.845, 45.75], [4.85, 45.75]];
  const linesFC = {
    features: [
      f({ ligne: 'C3', code_trace: 'C3-1', sens: 'Aller', nom_origin: 'Part-Dieu', nom_destin: 'Vaise', famille_tr: 'BUS', couleur_he: '#E30613', date_debut: '20190909', date_fin: '' }, line),
      f({ ligne: 'C3', code_trace: 'C3-2', sens: 'Retour', nom_origin: 'Vaise', nom_destin: 'Part-Dieu', famille_tr: 'BUS', couleur_he: '#E30613' }, line.slice().reverse()),
      f({ ligne: 'JD345', code_trace: '345101 ST-APP>AMPLEPUIS', nom_trace: '345101 ST-APP>AMPLEPUIS', famille_tr: 'BUS', couleur_he: '#17297b' }, line),
      f({ ligne: 'T1', famille_tr: 'TRAM', nom_origin: 'x', nom_destin: 'y' }, line), // hors bus
      f({ ligne: '99', code_trace: '99-1', famille_tr: 'BUS', date_fin: '20200101' }, line), // expirée
      f({ ligne: '98', code_trace: '98-1', famille_tr: 'BUS', date_debut: '20300101' }, line), // pas encore en service
    ],
  };
  const pt = (nom, lon, desserte) => ({ properties: { nom, desserte, pmr: true }, geometry: { type: 'Point', coordinates: [lon, 45.7501] } });
  const stopsFC = {
    features: [
      pt('Milieu', 4.84, 'C3:A,C3:R'),
      pt('Début', 4.8302, 'C3:A,JD345:A'),
      pt('Autre ligne', 4.845, '77:A'),
      pt('Loin', 4.84, 'C3:A'), // à 11 m du tracé : gardé ; modifié ci-dessous
      { properties: { nom: 'Trop loin', desserte: 'C3:A' }, geometry: { type: 'Point', coordinates: [4.84, 45.76] } },
    ],
  };
  const { index, routes, stats } = normalize(linesFC, stopsFC, { today: '20261029' });
  assert.equal(stats.lines, 2);
  assert.equal(stats.scolaires, 1);
  assert.equal(stats.expired, 1);
  assert.equal(stats.future, 1);
  assert.equal(index.lines[0].id, 'C3');
  assert.equal(index.lines[0].color, '#e30613');
  assert.equal(index.lines.find((l) => l.id === 'JD345').scolaire, true);
  assert.equal(routes.JD345.variants[0].origin, 'ST-APP');
  const aller = routes.C3.variants.find((v) => v.key === 'C3-1');
  // arrêts de C3 sens Aller, dans l'ordre du tracé ; « Trop loin » et l'arrêt d'une autre ligne exclus
  assert.deepEqual(aller.stops.map((x) => x[0]), ['Début', 'Milieu', 'Loin']);
  const retour = routes.C3.variants.find((v) => v.key === 'C3-2');
  assert.deepEqual(retour.stops.map((x) => x[0]), ['Milieu']);
});

import { isMobileOrTablet } from '../js/guard.js';

test('garde mobile / tablette : agent + taille d\'écran', () => {
  const phone = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', maxTouchPoints: 5 };
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', maxTouchPoints: 5 };
  const ipadOS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15', maxTouchPoints: 5 };
  const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15', maxTouchPoints: 0 };
  const win = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', maxTouchPoints: 0 };
  assert.equal(isMobileOrTablet(phone, { width: 412, height: 915 }), true);
  assert.equal(isMobileOrTablet(iphone, { width: 390, height: 844 }), true);
  assert.equal(isMobileOrTablet(ipadOS, { width: 820, height: 1180 }), true);
  assert.equal(isMobileOrTablet(mac, { width: 1440, height: 900 }), false);
  assert.equal(isMobileOrTablet(win, { width: 1920, height: 1080 }), false);
  assert.equal(isMobileOrTablet(phone, { width: 1920, height: 1920 }), false); // UA mobile usurpé sur grand écran
});
