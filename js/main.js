import { Route, NavEngine } from './nav.js';
import { Locator, SpeedLimit, KeepAwake } from './services.js';
import { pathLength } from './geo.js';

const L = window.L;
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
  return `background:${c};color:${lum > 0.62 ? '#111' : '#fff'}`;
}
function badge(line, big = false) {
  const b = el('span', { class: 'badge' + (big ? ' big' : ''), style: badgeStyle(line.color) }, line.id);
  return b;
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

const map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([45.764, 4.8357], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

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

function setMe(lat, lon, heading) {
  if (!meMarker) meMarker = L.marker([lat, lon], { icon: meIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  meMarker.setLatLng([lat, lon]);
  if (heading !== null && heading !== undefined) meHeading = heading;
  const svg = meMarker.getElement()?.querySelector('svg');
  if (svg) svg.style.transform = `rotate(${meHeading}deg)`;
}

function centerOffset(latlng, zoom, shiftRatio = 0.16) {
  const size = map.getSize();
  const p = map.project(latlng, zoom);
  p.y += size.y * shiftRatio; // le véhicule apparaît dans le tiers bas de l'écran
  return map.unproject(p, zoom);
}

/* ---------- État ---------- */

const app = {
  index: null,
  fix: null,
  firstFix: false,
  line: null, // entrée de l'index
  routeData: null, // fichier de la ligne
  nav: null, // { variant, route, engine, follow, avgKmh, last }
};
const locator = new Locator({ onFix: onFix, onStatus: setGate });
const speedLimit = new SpeedLimit();
const keepAwake = new KeepAwake();

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
  } catch {
    status.textContent = 'Données des lignes introuvables. Générez-les avec « npm run data » (voir README).';
  }
}

function renderLines() {
  const q = fold($('q').value.trim());
  const ul = $('lines');
  ul.replaceChildren();
  const lines = app.index.lines
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
          el('span', { class: 'row-text' }, el('strong', {}, l.terminus.slice(0, 2).join(' ⇄ ') || `Ligne ${l.id}`), el('small', {}, l.terminus.length > 2 ? l.terminus.join(' · ') : 'Bus')),
          el('span', { class: 'chev' }, '›'),
        ),
      ),
    );
  }
}
$('q').addEventListener('input', renderLines);

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
          el('span', { class: 'row-text' }, el('strong', {}, `Vers ${v.destination}`), el('small', {}, `depuis ${v.origin} · ${km.toFixed(1).replace('.', ',')} km`)),
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
    const pl = L.polyline(v.coords, { color: '#e30613', weight: on ? 5 : 3, opacity: on ? 0.9 : 0.3 }).addTo(previewLayer);
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
    text: `Ligne ${app.line.id} vers ${variant.destination}`,
    ok: 'Lancer',
  });
  if (ok) startNav(variant);
}

/* ---------- Navigation ---------- */

function startNav(variant) {
  const route = new Route(variant.coords);
  app.nav = { variant, route, engine: new NavEngine(route), follow: true, avgKmh: 18, layers: null };
  previewLayer?.remove();
  previewLayer = null;
  drawRoute();
  $('line').hidden = true;
  $('home').hidden = true;
  $('nav').hidden = false;
  $('nav-badge').replaceWith(Object.assign(badge(app.line), { id: 'nav-badge' }));
  $('nav-dest').textContent = variant.destination;
  keepAwake.enable().then((ok) => {
    if (!ok) toast('Écran : impossible de le garder allumé sur ce navigateur');
  });
  map.setZoom(Math.max(map.getZoom(), 16), { animate: false });
  if (app.fix) onFix(app.fix);
}

function drawRoute() {
  routeLayers.clearLayers();
  const { route } = app.nav;
  const halo = L.polyline(route.coords, { color: '#000', weight: 12, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayers);
  const done = L.polyline([], { color: '#5a1115', weight: 7, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayers);
  const todo = L.polyline(route.coords, { color: '#e30613', weight: 7, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayers);
  const end = L.circleMarker(route.coords.at(-1), { radius: 9, color: '#fff', weight: 3, fillColor: '#e30613', fillOpacity: 1 }).addTo(routeLayers);
  app.nav.layers = { halo, done, todo, end };
}

async function endNav() {
  app.nav = null;
  routeLayers.clearLayers();
  await keepAwake.disable();
  $('nav').hidden = true;
  $('off-banner').hidden = $('arrived-banner').hidden = true;
  $('limit').hidden = true;
  $('home').hidden = false;
  if (app.fix) map.setView([app.fix.lat, app.fix.lon], 14);
}

async function turnAround() {
  const { variant } = app.nav;
  const opposite =
    app.routeData.variants.find((v) => v.origin === variant.destination && v.destination === variant.origin) ??
    { origin: variant.destination, destination: variant.origin, sens: '', key: 'inv', coords: variant.coords.slice().reverse() };
  const ok = await ask({ title: 'Retournement', text: `Repartir vers ${opposite.destination} ?`, ok: 'Retourner' });
  if (!ok) return;
  const route = new Route(opposite.coords);
  Object.assign(app.nav, { variant: opposite, route, engine: new NavEngine(route), follow: true });
  $('nav-dest').textContent = opposite.destination;
  $('arrived-banner').hidden = true;
  drawRoute();
  if (app.fix) onFix(app.fix);
}

function onFix(fix) {
  app.fix = fix;
  if (!app.firstFix) {
    app.firstFix = true;
    if (!app.nav) map.setView([fix.lat, fix.lon], 14);
  }
  if (!app.nav) {
    setMe(fix.lat, fix.lon, fix.heading);
    return;
  }

  const n = app.nav;
  const s = n.engine.update(fix);
  const moving = fix.speedKmh !== null && fix.speedKmh > 3;
  const heading = moving && fix.heading !== null ? fix.heading : s.state === 'off' ? meHeading : s.heading;
  setMe(s.snapped[0], s.snapped[1], heading);

  // Tracé parcouru / restant
  const { done, todo } = n.route.split(s.along);
  n.layers.done.setLatLngs(done);
  n.layers.todo.setLatLngs(todo);

  // Bandeau
  $('nav-remaining').textContent = fmtDist(s.remaining);
  if (fix.speedKmh > 5) n.avgKmh = n.avgKmh * 0.9 + fix.speedKmh * 0.1;
  const eta = new Date(Date.now() + (s.remaining / 1000 / Math.max(n.avgKmh, 12)) * 3600 * 1000);
  $('nav-eta').textContent = s.state === 'arrived' ? 'Arrivé' : `Arrivée ${fmtTime(eta)}`;
  $('nav-progress').style.width = `${Math.round(s.progress * 100)}%`;

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

  // Caméra
  if (n.follow) {
    const z = map.getZoom();
    map.setView(centerOffset(L.latLng(s.snapped), z), z, { animate: true, duration: 0.8 });
  }
}

map.on('dragstart', () => {
  if (app.nav) app.nav.follow = false;
});
$('btn-recenter').addEventListener('click', () => {
  if (!app.nav) return;
  app.nav.follow = true;
  if (app.fix) onFix(app.fix);
});
$('btn-turn').addEventListener('click', () => app.nav && turnAround());
$('btn-end').addEventListener('click', () => app.nav && endNav());

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

/* ---------- Démarrage ---------- */

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
setGate({ status: 'pending' });
locator.start();
loadIndex();
