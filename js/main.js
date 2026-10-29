import { Route, NavEngine } from './nav.js';
import { initFree, DRIVE_WARNING } from './freenav.js';
import { Camera } from './camera.js';
import { CONFIG, APP_VERSION } from './config.js';
import { makeSheet } from './sheet.js';
import { isDemo, DemoLocator, demoNet } from './demo.js';
import { Locator, SpeedLimit, KeepAwake } from './services.js';
import { pathLength } from './geo.js';

const L = window.L;
let free = null; // navigation libre (initialisée plus bas)
const $ = (id) => document.getElementById(id);

/* ---------- Utilitaires ---------- */

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) n.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
  return n;
}
const fold = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const fmtTime = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function badgeStyle(color) {
  const c = color || '#e30613';
  const n = parseInt(c.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return `background:${c};color:${lum > 0.62 ? '#111' : '#fff'};box-shadow:inset 0 0 0 1px rgba(128,128,128,.4)`;
}
function badge(line, big = false) {
  const b = el('span', { class: 'badge' + (big ? ' big' : ''), style: badgeStyle(line.color) }, line.id);
  return b;
}

/** Couleur de la ligne pour le tracé, remplacée par le rouge si elle est illisible sur le fond de carte. */
function routeColor(hex, th = theme) {
  if (!hex) return '#e30613';
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  if (th === 'dark' && lum < 0.2) return '#e30613';
  if (th === 'light' && lum > 0.7) return '#e30613';
  return hex;
}
const destLabel = (v) => (v.destination && v.destination !== '?' ? v.destination : `Tracé ${v.key}`);

/** Variante dans l'autre sens : tracé réel du fichier si on le trouve, sinon le même tracé parcouru à l'envers. */
function oppositeVariant(variant, variants) {
  if (variant.baseKey) return variants.find((v) => v.key === variant.baseKey) ?? null;
  const swapped = variant.key.replace(/(\D)([12])$/, (_, a, d) => a + (d === '1' ? '2' : '1'));
  const byNames = variants.filter((v) => v !== variant && v.origin === variant.destination && v.destination === variant.origin);
  const real =
    (swapped !== variant.key && variants.find((v) => v.key === swapped)) ||
    byNames.find((v) => v.tag === variant.tag) ||
    byNames[0];
  return real ?? reversedVariant(variant);
}
function reversedVariant(v) {
  return {
    key: v.key + '~inv', baseKey: v.key, tag: v.tag, sens: '', origin: v.destination, destination: v.origin,
    coords: v.coords.slice().reverse(), stops: (v.stops ?? []).slice().reverse(),
  };
}

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function ask({ title, text, ok = 'OK', cancel = 'Annuler' }) {
  return new Promise((resolve) => {
    $('dlg-title').textContent = title;
    $('dlg-text').textContent = text;
    $('dlg-ok').textContent = ok;
    $('dlg-cancel').textContent = cancel;
    $('dlg-cancel').hidden = cancel === null;
    $('dialog').hidden = false;
    const done = (v) => {
      $('dialog').hidden = true;
      $('dlg-ok').onclick = $('dlg-cancel').onclick = null;
      resolve(v);
    };
    $('dlg-ok').onclick = () => done(true);
    $('dlg-cancel').onclick = () => done(false);
  });
}

/* ---------- Carte ---------- */

const map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: true, zoomSnap: 0.5 }).setView([45.764, 4.8357], 13);
const tileLayer = L.tileLayer(CONFIG.tileUrl, { subdomains: CONFIG.tileSubdomains, maxZoom: CONFIG.tileMaxZoom, crossOrigin: false }).addTo(map);
const tileLayerDark = CONFIG.tileUrlDark ? L.tileLayer(CONFIG.tileUrlDark, { subdomains: CONFIG.tileSubdomains, maxZoom: CONFIG.tileMaxZoom }) : null;
// Attribution hors de la carte (la carte peut tourner en mode suivi) : obligatoire pour OpenStreetMap.
$('attrib').innerHTML = `${CONFIG.tileAttribution} · <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>`;

const meIcon = L.divIcon({
  className: 'me',
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  html: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="#e30613" fill-opacity=".22"/><path d="M22 6 33 35 22 28.5 11 35Z" fill="#e30613" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>',
});
let meMarker = null;
let meHeading = 0;
const routeLayers = L.layerGroup().addTo(map);
let previewLayer = null;
const camera = new Camera(map, $('map'), { onMode: (m) => setCamButtons(m) });
function setCamButtons(mode) {
  for (const id of ['btn-recenter', 'fn-recenter']) {
    const b = $(id);
    if (!b) continue;
    b.dataset.mode = mode;
    b.setAttribute('aria-label', mode === 'follow' ? 'Mode suivi : passer en nord en haut' : mode === 'north' ? 'Nord en haut : passer en mode suivi' : 'Recentrer sur ma position');
  }
}

function setMe(lat, lon, heading) {
  if (!meMarker) meMarker = L.marker([lat, lon], { icon: meIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  meMarker.setLatLng([lat, lon]);
  if (heading !== null && heading !== undefined) meHeading = heading;
  if (camera.rotated) meHeading = camera.angle; // la carte tourne : la flèche reste vers le haut
  const svg = meMarker.getElement()?.querySelector('svg');
  if (svg) svg.style.transform = `rotate(${meHeading}deg)`;
}

/* ---------- Thème clair / sombre ---------- */

const THEME_KEY = 'nav-lyon-bus:theme';
const THEME_COLORS = {
  dark: { halo: '#000', done: '#5a1115', bar: '#0b0b0c' },
  light: { halo: '#fff', done: '#f0b3b7', bar: '#f4f4f6' },
};
let theme = 'dark';
try {
  theme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
} catch {}

function applyTheme(next) {
  theme = next;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme].bar);
  if (tileLayerDark) {
    if (theme === 'dark') { map.removeLayer(tileLayer); tileLayerDark.addTo(map); } else { map.removeLayer(tileLayerDark); tileLayer.addTo(map); }
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  if (app.nav) {
    drawRoute();
    if (app.fix) onFix(app.fix);
  }
  free?.redraw();
}
const toggleTheme = () => applyTheme(theme === 'dark' ? 'light' : 'dark');

/* ---------- État ---------- */

const app = {
  index: null,
  fix: null,
  firstFix: false,
  line: null, // entrée de l'index
  routeData: null, // fichier de la ligne
  filter: 'all',
  nav: null, // { variant, route, engine, follow, avgKmh, last }
};
applyTheme(theme);
const DEMO = isDemo();
const locator = DEMO ? new DemoLocator({ onFix: onFix, onStatus: setGate }) : new Locator({ onFix: onFix, onStatus: setGate });
const speedLimit = new SpeedLimit();
const keepAwake = new KeepAwake();

/* ---------- Cookie technique : reprise de la navigation (3 h) ---------- */

const SESSION_COOKIE = 'navlb_session';
const SESSION_TTL_S = 3 * 3600;
let lastSessionSave = 0;

function writeCookie(value, maxAge) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SESSION_COOKIE}=${value}; max-age=${maxAge}; path=/; SameSite=Lax${secure}`;
}
function saveSession() {
  if (!app.nav || !app.line) return;
  const v = { f: app.line.file, k: app.nav.variant.key };
  writeCookie(encodeURIComponent(JSON.stringify(v)), SESSION_TTL_S);
  lastSessionSave = Date.now();
}
function clearSession() {
  writeCookie('', 0);
}
function readSession() {
  const m = document.cookie.split('; ').find((c) => c.startsWith(SESSION_COOKIE + '='));
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m.slice(SESSION_COOKIE.length + 1)));
  } catch {
    return null;
  }
}

async function resumeSession() {
  const s = readSession();
  if (!s || !app.index || app.nav) return;
  const entry = app.index.lines.find((l) => l.file === s.f);
  if (!entry) return clearSession();
  try {
    const res = await fetch(`data/routes/${entry.file}.json`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const inv = String(s.k).endsWith('~inv');
    const base = data.variants.find((v) => v.key === (inv ? s.k.slice(0, -4) : s.k));
    const variant = base && (inv ? reversedVariant(base) : base);
    if (!variant) return clearSession();
    app.line = entry;
    app.routeData = data;
    startNav(variant);
    toast('Navigation reprise');
  } catch {
    // hors ligne ou données absentes : on garde le cookie, l'utilisateur peut réessayer
  }
}

/* ---------- Localisation obligatoire ---------- */

const GATE = {
  pending: ['Autorisez la localisation', 'Acceptez la demande de votre navigateur pour continuer.', null, false],
  denied: [
    'Localisation refusée',
    'Sans votre position, nav Lyon bus ne fonctionnera pas : impossible de suivre la ligne ni de savoir si vous êtes délocalisé.',
    'Autorisez la localisation pour ce site dans les réglages du navigateur, puis appuyez sur le bouton.',
    true,
  ],
  unavailable: ['Position indisponible', 'Le signal GPS est introuvable pour le moment. Vérifiez que la localisation est activée.', null, true],
  insecure: ['Connexion non sécurisée', 'La localisation n’est disponible qu’en HTTPS. Ouvrez nav Lyon bus via une adresse https://.', null, true],
  unsupported: ['Navigateur non compatible', 'Ce navigateur ne gère pas la géolocalisation.', null, false],
};

function setGate({ status }) {
  const gate = $('gate');
  if (status === 'ok') {
    gate.hidden = true;
    return;
  }
  const [title, text, help, retry] = GATE[status] ?? GATE.unavailable;
  $('gate-title').textContent = title;
  $('gate-text').textContent = text;
  $('gate-help').textContent = help ?? '';
  $('gate-help').hidden = !help;
  $('btn-retry').hidden = !retry;
  gate.hidden = false;
}
$('btn-retry').addEventListener('click', () => locator.start());

/* ---------- Données ---------- */

async function loadIndex() {
  const status = $('data-status');
  try {
    const res = await fetch('data/index.json');
    if (!res.ok) throw new Error(res.status);
    app.index = await res.json();
    if (!app.index.lines?.length) throw new Error('vide');
    status.textContent = `${app.index.lines.length} lignes`;
    renderLines();
    resumeSession();
  } catch {
    status.textContent = 'Données des lignes introuvables. Générez-les avec « npm run data » (voir README).';
  }
}

function renderLines() {
  const q = fold($('q').value.trim());
  const ul = $('lines');
  ul.replaceChildren();
  const lines = app.index.lines
    .filter((l) => app.filter === 'all' || (app.filter === 'sco' ? l.scolaire : !l.scolaire))
    .map((l) => {
      if (!q) return { l, score: 0 };
      const id = fold(l.id);
      if (id === q) return { l, score: 3 };
      if (id.startsWith(q)) return { l, score: 2 };
      if (l.terminus.some((t) => fold(t).includes(q))) return { l, score: 1 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  $('data-status').textContent = lines.length ? `${lines.length} ligne${lines.length > 1 ? 's' : ''}` : '';
  if (!lines.length) ul.append(el('li', { class: 'muted' }, 'Aucune ligne trouvée'));
  for (const { l } of lines) {
    ul.append(
      el(
        'li',
        {},
        el(
          'button',
          { onclick: () => openLine(l) },
          badge(l),
          el('span', { class: 'row-text' }, el('strong', {}, l.terminus.slice(0, 2).join(' ⇄ ') || `Ligne ${l.id}`), el('small', {}, l.scolaire ? 'Scolaire' : l.terminus.length > 2 ? l.terminus.join(' · ') : 'Bus')),
          el('span', { class: 'chev' }, '›'),
        ),
      ),
    );
  }
}
$('q').addEventListener('input', renderLines);
document.querySelectorAll('.chips .chip').forEach((b) =>
  b.addEventListener('click', () => {
    app.filter = b.dataset.f;
    document.querySelectorAll('.chips .chip').forEach((x) => x.classList.toggle('on', x === b));
    if (app.index) renderLines();
  }),
);

async function openLine(entry) {
  try {
    const res = await fetch(`data/routes/${entry.file}.json`);
    if (!res.ok) throw new Error(res.status);
    app.routeData = await res.json();
  } catch {
    toast('Impossible de charger cette ligne (hors ligne ?)');
    return;
  }
  app.line = entry;
  $('line-badge').replaceWith(Object.assign(badge(entry, true), { id: 'line-badge' }));
  $('line-title').textContent = `Ligne ${entry.id}`;
  const ul = $('directions');
  ul.replaceChildren();
  for (const v of app.routeData.variants) {
    const km = pathLength(v.coords) / 1000;
    ul.append(
      el(
        'li',
        {},
        el(
          'button',
          { onclick: () => chooseDirection(v) },
          el('span', { class: 'row-text' }, el('strong', {}, v.destination && v.destination !== '?' ? `Vers ${v.destination}` : destLabel(v)),
            el('small', {}, `${v.origin && v.origin !== '?' && v.origin !== v.destination ? `depuis ${v.origin} · ` : ''}${v.tag ? `${v.tag} · ` : ''}${km.toFixed(1).replace('.', ',')} km${v.stops?.length ? ` · ${v.stops.length} arrêts` : ''}`)),
          el('span', { class: 'chev' }, '›'),
        ),
      ),
    );
  }
  showPreview(app.routeData.variants);
  $('home').hidden = true;
  $('line').hidden = false;
}

function showPreview(variants, highlight = null) {
  previewLayer?.remove();
  previewLayer = L.layerGroup().addTo(map);
  let bounds = null;
  for (const v of variants) {
    const on = highlight ? v === highlight : true;
    const pl = L.polyline(v.coords, { color: routeColor(app.line?.color), weight: on ? 5 : 3, opacity: on ? 0.9 : 0.3 }).addTo(previewLayer);
    bounds = bounds ? bounds.extend(pl.getBounds()) : pl.getBounds();
  }
  if (bounds) map.fitBounds(bounds, { paddingTopLeft: [20, 20], paddingBottomRight: [20, window.innerHeight * 0.66] });
}

$('btn-back').addEventListener('click', () => {
  previewLayer?.remove();
  previewLayer = null;
  $('line').hidden = true;
  $('home').hidden = false;
  if (app.fix) map.setView([app.fix.lat, app.fix.lon], 14);
});

async function chooseDirection(variant) {
  showPreview(app.routeData.variants, variant);
  const ok = await ask({
    title: 'Lancer la navigation ?',
    text: `Ligne ${app.line.id} vers ${destLabel(variant)}\n\n${DRIVE_WARNING}`,
    ok: 'J’ai compris, lancer',
  });
  if (ok) startNav(variant);
}

/* ---------- Navigation ---------- */

function startNav(variant) {
  const route = new Route(variant.coords);
  app.nav = { variant, route, engine: new NavEngine(route), avgKmh: 18, layers: null, stops: computeStops(variant, route), nextIdx: -2 };
  previewLayer?.remove();
  previewLayer = null;
  drawRoute();
  $('line').hidden = true;
  $('home').hidden = true;
  $('nav').hidden = false;
  $('nav-badge').replaceWith(Object.assign(badge(app.line), { id: 'nav-badge' }));
  $('nav-dest').textContent = destLabel(variant);
  keepAwake.enable().then((ok) => {
    if (!ok) toast('Écran : impossible de le garder allumé sur ce navigateur');
  });
  camera.start('follow');
  saveSession();
  if (DEMO) locator.follow(variant.coords);
  if (app.fix) onFix(app.fix);
}

/** Arrêts de la variante, placés sur le tracé (abscisse curviligne) pour annoncer le prochain. */
function computeStops(variant, route) {
  return (variant.stops ?? [])
    .map(([name, lat, lon, pmr]) => {
      const [x, y] = route.proj.toXY(lat, lon);
      return { name, pmr, latlng: [lat, lon], along: route.nearest(x, y).along };
    })
    .sort((a, b) => a.along - b.along);
}

function drawRoute() {
  routeLayers.clearLayers();
  const { route } = app.nav;
  const tc = THEME_COLORS[theme];
  const col = routeColor(app.line?.color);
  const halo = L.polyline(route.coords, { color: tc.halo, weight: 12, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayers);
  const done = L.polyline([], { color: col, weight: 7, opacity: 0.3, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayers);
  const todo = L.polyline(route.coords, { color: col, weight: 7, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayers);
  for (const st of app.nav.stops) {
    L.circleMarker(st.latlng, { radius: 5, color: col, weight: 3, fillColor: theme === 'dark' ? '#0b0b0c' : '#fff', fillOpacity: 1 })
      .bindTooltip(st.name, { direction: 'top', offset: [0, -4] })
      .addTo(routeLayers);
  }
  const end = L.circleMarker(route.coords.at(-1), { radius: 9, color: '#fff', weight: 3, fillColor: col, fillOpacity: 1 }).addTo(routeLayers);
  app.nav.layers = { halo, done, todo, end };
}

async function endNav() {
  clearSession();
  app.nav = null;
  routeLayers.clearLayers();
  camera.stop();
  if (DEMO) locator.halt();
  $('progress').hidden = true;
  await keepAwake.disable();
  $('nav').hidden = true;
  $('off-banner').hidden = $('arrived-banner').hidden = true;
  $('limit').hidden = true;
  $('home').hidden = false;
  if (app.fix) map.setView([app.fix.lat, app.fix.lon], 14);
}

async function turnAround() {
  const { variant } = app.nav;
  const opposite = oppositeVariant(variant, app.routeData.variants);
  const ok = await ask({ title: 'Retournement', text: `Repartir vers ${destLabel(opposite)} ?`, ok: 'Retourner' });
  if (!ok) return;
  const route = new Route(opposite.coords);
  Object.assign(app.nav, { variant: opposite, route, engine: new NavEngine(route), stops: computeStops(opposite, route), nextIdx: -2 });
  $('nav-dest').textContent = destLabel(opposite);
  if (camera.mode === 'free') camera.recenter();
  $('arrived-banner').hidden = true;
  drawRoute();
  saveSession();
  if (DEMO) locator.follow(opposite.coords);
  if (app.fix) onFix(app.fix);
}

function onFix(fix) {
  app.fix = fix;
  if (!app.firstFix) {
    app.firstFix = true;
    if (!app.nav) map.setView([fix.lat, fix.lon], 14);
  }
  free?.feed(fix); // compteurs de conduite (si un service est ouvert)
  if (free?.active) {
    free.onFix(fix);
    return;
  }
  if (!app.nav) {
    setMe(fix.lat, fix.lon, fix.heading);
    return;
  }

  const n = app.nav;
  if (Date.now() - lastSessionSave > 60000) saveSession(); // prolonge le cookie de 3 h
  const s = n.engine.update(fix);
  const moving = fix.speedKmh !== null && fix.speedKmh > 3;
  const heading = moving && fix.heading !== null ? fix.heading : s.state === 'off' ? meHeading : s.heading;
  setMe(s.snapped[0], s.snapped[1], heading);

  // Tracé parcouru / restant
  const { done, todo } = n.route.split(s.along);
  n.layers.done.setLatLngs(done);
  n.layers.todo.setLatLngs(todo);

  // Bandeau : prochains arrêts en grand, terminus en petit
  if (fix.speedKmh > 5) n.avgKmh = n.avgKmh * 0.9 + fix.speedKmh * 0.1;
  const eta = new Date(Date.now() + (s.remaining / 1000 / Math.max(n.avgKmh, 12)) * 3600 * 1000);
  $('nav-eta').textContent = s.state === 'arrived' ? 'Arrivé' : `${fmtDist(s.remaining)} · ${fmtTime(eta)}`;
  $('nav-progress').style.width = `${Math.round(s.progress * 100)}%`;
  const upcoming = s.state === 'off' ? [] : n.stops.filter((st) => st.along > s.along + 15);
  if (s.state === 'arrived') {
    $('nav-stop').textContent = 'Terminus';
    $('nav-stopdist').textContent = '';
    $('nav-then').textContent = '';
  } else if (s.state === 'off') {
    $('nav-stop').textContent = 'Délocalisé';
    $('nav-stopdist').textContent = fmtDist(s.offDistance);
    $('nav-then').textContent = '';
  } else if (upcoming.length) {
    $('nav-stop').textContent = upcoming[0].name;
    $('nav-stopdist').textContent = fmtDist(upcoming[0].along - s.along);
    $('nav-then').textContent = upcoming.length > 1 ? `Ensuite : ${upcoming.slice(1, 3).map((x) => x.name).join(' · ')}` : 'Dernier arrêt';
  } else {
    $('nav-stop').textContent = n.stops.length ? 'Dernier arrêt passé' : 'Suivez la ligne';
    $('nav-stopdist').textContent = fmtDist(s.remaining);
    $('nav-then').textContent = '';
  }
  n.along = s.along;
  n.state = s.state;
  updateProgress();

  const off = s.state === 'off';
  $('off-banner').hidden = !off;
  if (off) $('off-text').textContent = `À ${fmtDist(s.offDistance)} du tracé · rejoignez la ligne`;
  $('arrived-banner').hidden = s.state !== 'arrived';

  // Vitesse + limite
  const kmh = fix.speedKmh === null ? 0 : Math.round(fix.speedKmh);
  $('speed').textContent = kmh;
  speedLimit.update(fix.lat, fix.lon).then((lim) => {
    if (!app.nav) return;
    $('limit').hidden = !lim;
    if (lim) {
      $('limit-val').textContent = lim.kmh;
      $('limit').classList.toggle('est', lim.estimated);
      $('limit').title = lim.estimated ? 'Limitation estimée' : 'Limitation de vitesse';
      document.querySelector('.speed').classList.toggle('over', kmh > lim.kmh + 2);
    }
  });

  // Caméra : suivi (carte qui tourne), nord en haut, ou carte libre
  camera.update(L.latLng(s.snapped), moving || s.state !== 'off' ? s.heading : fix.heading, fix.speedKmh);
  setMe(s.snapped[0], s.snapped[1], heading);
}

$('btn-recenter').addEventListener('click', () => {
  if (!app.nav) return;
  if (camera.mode === 'free') camera.recenter();
  else camera.cycle();
  if (app.fix) onFix(app.fix);
});

/* ---------- Ma position sur la ligne ---------- */

let pgKey = '';
function openProgress() {
  if (!app.nav) return;
  pgKey = '';
  $('progress').hidden = false;
  updateProgress(true);
}
function updateProgress(scroll = false) {
  const n = app.nav;
  if (!n || $('progress').hidden) return;
  const idx = n.stops.findIndex((st) => st.along > (n.along ?? 0) + 15);
  const key = `${n.variant.key}|${idx}|${n.state}`;
  const color = routeColor(app.line?.color, theme);
  $('pg-list').style.setProperty('--c', color);
  $('pg-badge').replaceWith(Object.assign(badge(app.line), { id: 'pg-badge', className: 'badge big' }));
  $('pg-title').textContent = `Ligne ${app.line.id}`;
  const remaining = n.route.length - (n.along ?? 0);
  $('pg-sub').textContent = `Vers ${destLabel(n.variant)} · reste ${fmtDist(remaining)}`;
  if (key === pgKey) {
    // seules les distances changent
    n.stops.forEach((st, i) => {
      const d = document.querySelector(`#pg-list li[data-i="${i}"] small`);
      if (d && i >= idx && idx !== -1) d.textContent = fmtDist(st.along - n.along);
    });
    return;
  }
  pgKey = key;
  const items = [];
  n.stops.forEach((st, i) => {
    if (i === (idx === -1 ? n.stops.length : idx)) items.push(el('li', { class: 'me' }, el('span', {}, el('i'), el('em', {}, n.state === 'off' ? 'Délocalisé' : 'Vous êtes ici'))));
    const li = el('li', { class: i < (idx === -1 ? n.stops.length : idx) ? 'passed' : i === idx ? 'next' : '', 'data-i': String(i) }, st.name, st.pmr ? el('span', { class: 'pmr', title: 'Accessible PMR' }, '♿') : '', el('small', {}, i >= idx && idx !== -1 ? fmtDist(st.along - (n.along ?? 0)) : ''));
    items.push(li);
  });
  if (idx === -1 && n.stops.length) items.push(el('li', { class: 'me' }, el('span', {}, el('i'), el('em', {}, 'Vous êtes ici'))));
  if (!n.stops.length) items.push(el('li', {}, 'Aucun arrêt disponible pour ce tracé'));
  $('pg-list').replaceChildren(...items);
  if (scroll || true) {
    const target = $('pg-list').querySelector('li.next') ?? $('pg-list').querySelector('li.me');
    target?.scrollIntoView({ block: 'center' });
  }
}
$('btn-stops').addEventListener('click', openProgress);
$('pg-back').addEventListener('click', () => ($('progress').hidden = true));

$('btn-turn').addEventListener('click', () => app.nav && turnAround());
$('btn-end').addEventListener('click', () => app.nav && endNav());
$('btn-theme').addEventListener('click', toggleTheme);
$('btn-theme-nav').addEventListener('click', toggleTheme);

/* ---------- Installation (raccourci écran d’accueil) ---------- */

let installEvent = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('btn-install').hidden = false;
});
window.addEventListener('appinstalled', () => {
  $('btn-install').hidden = true;
  toast('nav Lyon bus ajouté à l’écran d’accueil');
});
if (isIOS && !standalone) $('btn-install').hidden = false;

$('btn-install').addEventListener('click', async () => {
  if (installEvent) {
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    $('btn-install').hidden = true;
  } else {
    await ask({
      title: 'Ajouter à l’écran d’accueil',
      text: 'Touchez le bouton Partager de Safari, puis « Sur l’écran d’accueil ».',
      ok: 'Compris',
      cancel: null,
    });
  }
});

/* ---------- Bandeau d'information (disparaît après acceptation) ---------- */

const INFO_KEY = 'nav-lyon-bus:info-ok';
let infoSeen = false;
try { infoSeen = localStorage.getItem(INFO_KEY) === '1'; } catch {}
if (!infoSeen) $('info').hidden = false;
$('info-ok').addEventListener('click', () => {
  $('info').hidden = true;
  try { localStorage.setItem(INFO_KEY, '1'); } catch {}
});

/* ---------- Feuilles déplaçables + À propos ---------- */

for (const id of ['home', 'line', 'route-prev']) makeSheet($(id), { start: 'mid' });
for (const id of ['progress', 'vehicle', 'dt', 'about']) makeSheet($(id), { start: 'full' });

$('ab-version').textContent = `v${APP_VERSION}`;
const gh = CONFIG.repoUrl.replace(/\/$/, '');
$('ab-bug').href = `${gh}/issues/new?template=bug.yml`;
$('ab-idea').href = `${gh}/issues/new?template=idee.yml`;
$('ab-net').href = `${gh}/issues/new?template=reseau.yml`;
$('ab-repo').href = gh;
$('btn-about').addEventListener('click', () => {
  $('home').hidden = true;
  $('about').hidden = false;
});
$('ab-back').addEventListener('click', () => {
  $('about').hidden = true;
  $('home').hidden = false;
});

/* ---------- Navigation libre (poids lourd / bus) ---------- */

free = initFree({ map, ask, toast, keepAwake, speedLimit, setMe, camera, app, fmtDist, fmtTime, getTheme: () => theme, demo: DEMO ? locator : null, net: DEMO ? demoNet : {} });

/* ---------- Démarrage ---------- */

if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
setGate({ status: 'pending' });
locator.start();
loadIndex();
