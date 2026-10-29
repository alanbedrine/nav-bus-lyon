import test from 'node:test';
import assert from 'node:assert/strict';
import { Route, NavEngine } from '../js/nav.js';
import { normalize, chainParts, isExcludedLine, parseColor } from '../js/normalize.js';
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

test('normalisation : exclusion métro/tram/funiculaire, chaînage, couleur', () => {
  assert.ok(['A', 'B', 'C', 'D', 'F1', 'F2', 'T1', 'T6', 'RX'].every(isExcludedLine));
  assert.ok(!['C3', '4', 'S1', 'ZI3', 'N1'].some(isExcludedLine));
  assert.equal(parseColor('255 0 128'), '#ff0080');
  assert.equal(parseColor('#E30613'), '#e30613');

  // 2 morceaux fournis dans le désordre d'orientation
  const parts = [
    [[4.83, 45.75], [4.84, 45.75]],
    [[4.85, 45.75], [4.84, 45.75]],
  ];
  const chain = chainParts(parts);
  assert.deepEqual(chain.map((c) => c[1]), [4.83, 4.84, 4.85]);

  const fc = {
    features: [
      { properties: { ligne: 'C3', sens: 'Aller', nom_origine: 'Part-Dieu', nom_destination: 'Vaise', couleur: '255 0 0' }, geometry: { type: 'MultiLineString', coordinates: parts } },
      { properties: { ligne: 'C3', sens: 'Retour', nom_origine: 'Vaise', nom_destination: 'Part-Dieu' }, geometry: { type: 'LineString', coordinates: parts[0] } },
      { properties: { ligne: 'T1', sens: 'Aller', nom_origine: 'x', nom_destination: 'y' }, geometry: { type: 'LineString', coordinates: parts[0] } },
    ],
  };
  const { index, routes, stats } = normalize(fc);
  assert.equal(stats.lines, 1);
  assert.equal(index.lines[0].id, 'C3');
  assert.equal(index.lines[0].color, '#ff0000');
  assert.equal(routes.C3.variants.length, 2);
});
