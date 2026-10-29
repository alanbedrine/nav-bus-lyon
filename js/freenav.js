// Navigation libre (poids lourd / bus) : adresse -> itinéraire adapté au gabarit -> guidage avec recalcul,
// et compteurs de temps de conduite RSE / RSN. Totalement séparé de la navigation « ligne TCL ».

import { DriveTime, RSE_LIMITS, fmtDuration } from './drivetime.js';
import {
  geocode, fetchRoute, RouteError, PTAC_OPTIONS, BUS_PRESETS, truckDefaults, DEFAULT_VEHICLE,
  vehicleTitle, vehicleSubtitle, maneuverGlyph,
} from './routing.js';
import { Route, NavEngine } from './nav.js';

export const DRIVE_WARNING =
  '⚠ Ne manipulez pas votre téléphone en conduisant. Fixez-le sur un support, saisissez ou modifiez tout à l’arrêt, et gardez les yeux sur la route.\nVous restez seul responsable de la conduite et du respect du code de la route.';

export const SIGN_WARNING =
  'Les panneaux et la signalisation sur place prévalent TOUJOURS sur l’itinéraire. Les données (OpenStreetMap) peuvent être erronées ou incomplètes : respectez les interdictions de poids, de hauteur et d’accès que vous rencontrez.';

const VEHICLE_KEY = 'nav-lyon-bus:vehicle';
const DRIVE_KEY = 'nav-lyon-bus:drive';
const $ = (id) => document.getElementById(id);
const num = (v) => Number(String(v).trim().replace(',', '.'));
const fmtN = (n) => String(Number(n)).replace('.', ',');

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function initFree(ctx) {
  const { map, ask, toast, keepAwake, speedLimit, setMe, camera, app, fmtDist, fmtTime, getTheme, demo = null, net = {} } = ctx;
  const layers = L.layerGroup().addTo(map);

  const state = {
    active: false,
    vehicle: { ...DEFAULT_VEHICLE, ...(load(VEHICLE_KEY) ?? {}) },
    dest: null,
    plan: null, // itinéraire en aperçu
    nav: null, // { route, engine, mans, follow, avgKmh, offSince, rerouting, lastTry }
  };
  const dt = new DriveTime(load(DRIVE_KEY));

  /* ---------- Onglets ---------- */

  function setTab(free) {
    $('tab-tcl').classList.toggle('on', !free);
    $('tab-free').classList.toggle('on', free);
    $('tab-tcl').setAttribute('aria-selected', String(!free));
    $('tab-free').setAttribute('aria-selected', String(free));
    $('tcl-panel').hidden = free;
    $('free-panel').hidden = !free;
    if (free) renderCards();
  }
  $('tab-tcl').addEventListener('click', () => setTab(false));
  $('tab-free').addEventListener('click', () => setTab(true));

  function renderCards() {
    $('fv-title').textContent = vehicleTitle(state.vehicle);
    $('fv-sub').textContent = vehicleSubtitle(state.vehicle);
    $('fd-title').textContent = `Temps de conduite · ${dt.regime}`;
    $('fd-sub').textContent = dt.s.service ? 'Service ouvert' : 'Service fermé';
  }

  /* ---------- Véhicule ---------- */

  const vh = { kind: 'truck' };
  function fillVehicleForm() {
    const v = state.vehicle;
    vh.kind = v.kind;
    $('vh-weight').value = fmtN(v.weight);
    $('vh-height').value = fmtN(v.height);
    $('vh-width').value = fmtN(v.width);
    $('vh-length').value = fmtN(v.length);
    $('vh-axle').value = fmtN(v.axle ?? truckDefaults(v.weight).axle);
    $('vh-hazmat').checked = !!v.hazmat;
    $('vh-tolls').checked = !!v.avoidTolls;
    $('vh-preset').value = v.busPreset ?? 'standard';
    syncKind();
  }
  function syncKind() {
    document.querySelectorAll('#vehicle [data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === vh.kind));
    $('vh-preset-row').hidden = vh.kind !== 'bus';
    $('vh-axle-row').hidden = vh.kind === 'bus';
    $('vh-hazmat-row').hidden = vh.kind === 'bus';
  }
  function applyDims(d) {
    $('vh-height').value = fmtN(d.height);
    $('vh-width').value = fmtN(d.width);
    $('vh-length').value = fmtN(d.length);
    if (d.axle !== undefined) $('vh-axle').value = fmtN(d.axle);
  }
  for (const [k, p] of Object.entries(BUS_PRESETS)) $('vh-preset').append(new Option(p.label, k));
  for (const p of PTAC_OPTIONS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = `${fmtN(p)} t`;
    b.addEventListener('click', () => {
      $('vh-weight').value = fmtN(p);
      if (vh.kind === 'truck') applyDims(truckDefaults(p));
    });
    $('vh-ptac').append(b);
  }
  document.querySelectorAll('#vehicle [data-kind]').forEach((b) =>
    b.addEventListener('click', () => {
      vh.kind = b.dataset.kind;
      syncKind();
      if (vh.kind === 'bus') {
        const p = BUS_PRESETS[$('vh-preset').value];
        $('vh-weight').value = fmtN(p.weight);
        applyDims(p);
      } else {
        const w = num($('vh-weight').value) || 19;
        applyDims(truckDefaults(w));
      }
    }),
  );
  $('vh-preset').addEventListener('change', () => {
    const p = BUS_PRESETS[$('vh-preset').value];
    $('vh-weight').value = fmtN(p.weight);
    applyDims(p);
  });
  $('fv-card').addEventListener('click', () => {
    fillVehicleForm();
    $('vh-error').hidden = true;
    $('home').hidden = true;
    $('vehicle').hidden = false;
  });
  $('vh-back').addEventListener('click', () => {
    $('vehicle').hidden = true;
    $('home').hidden = false;
  });
  $('vh-save').addEventListener('click', () => {
    const v = {
      kind: vh.kind,
      busPreset: $('vh-preset').value,
      weight: num($('vh-weight').value),
      height: num($('vh-height').value),
      width: num($('vh-width').value),
      length: num($('vh-length').value),
      axle: num($('vh-axle').value),
      hazmat: vh.kind === 'truck' && $('vh-hazmat').checked,
      avoidTolls: $('vh-tolls').checked,
    };
    const checks = [
      ['poids', v.weight, 1, 60],
      ['hauteur', v.height, 1.5, 4.8],
      ['largeur', v.width, 1.5, 3],
      ['longueur', v.length, 3, 25],
    ];
    if (vh.kind === 'truck') checks.push(['charge à l’essieu', v.axle, 0.5, 13]);
    const bad = checks.find(([, x, lo, hi]) => !Number.isFinite(x) || x < lo || x > hi);
    if (bad) {
      $('vh-error').textContent = `Valeur incorrecte : ${bad[0]} (entre ${fmtN(bad[2])} et ${fmtN(bad[3])}).`;
      $('vh-error').hidden = false;
      return;
    }
    if (vh.kind === 'bus') v.axle = state.vehicle.axle;
    state.vehicle = v;
    save(VEHICLE_KEY, v);
    renderCards();
    $('vehicle').hidden = true;
    $('home').hidden = false;
    toast('Véhicule enregistré');
  });

  /* ---------- Recherche d'adresse (API de l'État) ---------- */

  let searchTimer;
  let searchAbort;
  $('fq').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = $('fq').value.trim();
    if (q.length < 3) {
      $('fres').replaceChildren();
      $('fq-status').textContent = q ? 'Continuez à saisir l’adresse…' : '';
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 350);
  });

  async function runSearch(q) {
    searchAbort?.abort();
    searchAbort = new AbortController();
    $('fq-status').textContent = 'Recherche…';
    try {
      const res = await geocode(q, { near: app.fix ? { lat: app.fix.lat, lon: app.fix.lon } : null, signal: searchAbort.signal, fetchImpl: net.fetch });
      $('fq-status').textContent = res.length ? '' : 'Aucune adresse trouvée';
      $('fres').replaceChildren(
        ...res.map((r) => {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.innerHTML = '<span class="res-ico"><svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg></span><span class="row-text"><strong></strong><small></small></span><span class="chev">›</span>';
          b.querySelector('strong').textContent = r.label;
          b.querySelector('small').textContent = r.city;
          b.addEventListener('click', () => planTo(r));
          li.append(b);
          return li;
        }),
      );
    } catch (e) {
      if (e.name === 'AbortError') return;
      $('fq-status').textContent = 'Recherche d’adresse indisponible. Vérifiez votre connexion.';
    }
  }

  /* ---------- Aperçu de l'itinéraire ---------- */

  async function planTo(dest) {
    if (!app.fix) return toast('Position GPS en attente…');
    document.activeElement?.blur?.();
    toast('Calcul de l’itinéraire adapté à votre véhicule…', 20000);
    try {
      const data = await fetchRoute({ lat: app.fix.lat, lon: app.fix.lon }, dest, state.vehicle, { fetchImpl: net.fetch });
      $('toast').hidden = true;
      state.dest = dest;
      state.plan = data;
      showPreview();
    } catch (e) {
      $('toast').hidden = true;
      await ask({
        title: 'Itinéraire impossible',
        text: e instanceof RouteError ? e.message : 'Une erreur est survenue lors du calcul.',
        ok: 'OK',
        cancel: null,
      });
    }
  }

  function showPreview() {
    const { plan, dest, vehicle } = state;
    $('home').hidden = true;
    $('route-prev').hidden = false;
    $('rp-dest').textContent = dest.label;
    $('rp-dist').textContent = fmtDist(plan.length);
    $('rp-time').textContent = fmtDuration(plan.time * 1000);
    $('rp-eta').textContent = `Arrivée ${fmtTime(new Date(Date.now() + plan.time * 1000))}`;
    $('rp-veh').textContent = `${vehicleTitle(vehicle)} · ${vehicleSubtitle(vehicle)}`;
    const items = [
      [SIGN_WARNING, true],
      ['ZFE / Crit’Air, restrictions temporaires (travaux, arrêtés municipaux) et horaires de livraison ne sont pas pris en compte.', false],
      ...plan.warnings.map((w) => [w, false]),
    ];
    $('rp-warn').replaceChildren(
      ...items.map(([text, red]) => {
        const li = document.createElement('li');
        li.textContent = text;
        if (red) li.className = 'red';
        return li;
      }),
    );
    layers.clearLayers();
    const halo = L.polyline(plan.coords, { color: getTheme() === 'dark' ? '#000' : '#fff', weight: 12, opacity: 0.85 }).addTo(layers);
    L.polyline(plan.coords, { color: '#e30613', weight: 7, lineCap: 'round', lineJoin: 'round' }).addTo(layers);
    L.circleMarker(plan.coords.at(-1), { radius: 9, color: '#fff', weight: 3, fillColor: '#e30613', fillOpacity: 1 }).addTo(layers);
    map.fitBounds(halo.getBounds(), { paddingTopLeft: [24, 40], paddingBottomRight: [24, window.innerHeight * 0.5] });
  }

  $('rp-back').addEventListener('click', () => {
    layers.clearLayers();
    state.plan = null;
    $('route-prev').hidden = true;
    $('home').hidden = false;
    if (app.fix) map.setView([app.fix.lat, app.fix.lon], 14);
  });

  $('rp-go').addEventListener('click', async () => {
    const ok = await ask({
      title: 'Avant de partir',
      text: `${DRIVE_WARNING}\n\n${SIGN_WARNING}`,
      ok: 'J’ai compris, lancer',
    });
    if (ok) start();
  });

  /* ---------- Guidage ---------- */

  function mkNav(plan) {
    const route = new Route(plan.coords);
    const mans = plan.maneuvers.map((m) => ({ ...m, at: route.cum[Math.min(m.begin, route.cum.length - 1)] }));
    return { route, engine: new NavEngine(route), mans };
  }

  function start() {
    const g = mkNav(state.plan);
    state.nav = { ...g, avgKmh: 45, offSince: null, rerouting: false, lastTry: 0 };
    state.active = true;
    $('route-prev').hidden = true;
    $('fnav').hidden = false;
    $('fn-dt').hidden = false;
    $('fn-banner').hidden = true;
    drawRoute();
    keepAwake.enable().then((ok) => {
      if (!ok) toast('Écran : impossible de le garder allumé sur ce navigateur');
    });
    camera.start('follow');
    demo?.follow(state.plan.coords);
    refreshDriveUi(true);
    if (app.fix) onFix(app.fix);
  }

  function drawRoute() {
    layers.clearLayers();
    if (!state.nav) return;
    const { route } = state.nav;
    const halo = L.polyline(route.coords, { color: getTheme() === 'dark' ? '#000' : '#fff', weight: 12, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(layers);
    const done = L.polyline([], { color: '#e30613', weight: 7, opacity: 0.3, lineCap: 'round', lineJoin: 'round' }).addTo(layers);
    const todo = L.polyline(route.coords, { color: '#e30613', weight: 7, lineCap: 'round', lineJoin: 'round' }).addTo(layers);
    L.circleMarker(route.coords.at(-1), { radius: 9, color: '#fff', weight: 3, fillColor: '#e30613', fillOpacity: 1 }).addTo(layers);
    state.nav.layers = { halo, done, todo };
  }

  async function end() {
    state.active = false;
    state.nav = null;
    layers.clearLayers();
    camera.stop();
    demo?.halt();
    await keepAwake.disable();
    $('fnav').hidden = true;
    $('fn-limit').hidden = true;
    $('home').hidden = false;
    renderCards();
    if (app.fix) map.setView([app.fix.lat, app.fix.lon], 14);
  }

  function currentManeuver(n, along) {
    return n.mans.find((m) => m.at >= along - 8 || (m.begin === 0 && along < 40));
  }

  function onFix(fix) {
    const n = state.nav;
    if (!n) return;
    const s = n.engine.update(fix);
    const moving = fix.speedKmh !== null && fix.speedKmh > 3;
    const heading = moving && fix.heading !== null ? fix.heading : s.state === 'off' ? undefined : s.heading;
    const pos = s.state === 'off' ? [fix.lat, fix.lon] : s.snapped;

    const { done, todo } = n.route.split(s.along);
    n.layers.done.setLatLngs(done);
    n.layers.todo.setLatLngs(todo);

    // Prochaine manœuvre
    const arrived = s.state === 'arrived';
    const m = arrived ? null : currentManeuver(n, s.along);
    if (arrived || !m) {
      $('fn-icon').textContent = '⚑';
      $('fn-dist').textContent = 'Arrivée';
      $('fn-text').textContent = arrived ? 'Vous êtes arrivé' : 'Destination';
      $('fn-street').textContent = state.dest?.label ?? '';
    } else {
      $('fn-icon').textContent = maneuverGlyph(m.type);
      $('fn-dist').textContent = m.begin === 0 && s.along < 40 ? 'Départ' : fmtDist(Math.max(0, m.at - s.along));
      $('fn-text').textContent = m.text;
      $('fn-street').textContent = m.street;
    }
    $('fn-remaining').textContent = fmtDist(s.remaining);
    if (fix.speedKmh > 5) n.avgKmh = n.avgKmh * 0.9 + fix.speedKmh * 0.1;
    $('fn-eta').textContent = arrived ? 'Arrivé' : `Arrivée ${fmtTime(new Date(Date.now() + (s.remaining / 1000 / Math.max(n.avgKmh, 15)) * 3600000))}`;
    $('fn-progress').style.width = `${Math.round(s.progress * 100)}%`;

    // Hors itinéraire : recalcul automatique (contrairement au suivi de ligne TCL)
    if (s.state === 'off') {
      n.offSince ??= Date.now();
      $('fn-banner').hidden = false;
      $('fn-banner-title').textContent = n.rerouting ? 'Recalcul de l’itinéraire…' : 'Hors itinéraire';
      $('fn-banner-text').textContent = `À ${fmtDist(s.offDistance)} de l’itinéraire prévu`;
      if (!n.rerouting && Date.now() - n.offSince > 8000 && Date.now() - n.lastTry > 15000) reroute(fix);
    } else {
      n.offSince = null;
      if (!n.rerouting) $('fn-banner').hidden = true;
    }

    // Vitesse + limite
    const kmh = fix.speedKmh === null ? 0 : Math.round(fix.speedKmh);
    $('fn-speed').textContent = kmh;
    speedLimit.update(fix.lat, fix.lon).then((lim) => {
      if (!state.active) return;
      $('fn-limit').hidden = !lim;
      if (lim) {
        $('fn-limit-val').textContent = lim.kmh;
        $('fn-limit').classList.toggle('est', lim.estimated);
        $('fn-limit').title = lim.estimated ? 'Limitation estimée (véhicules légers)' : 'Limitation de vitesse (véhicules légers)';
        document.querySelector('#fnav .speed').classList.toggle('over', kmh > lim.kmh + 2);
      }
    });

    camera.update(L.latLng(pos), s.state === 'off' ? fix.heading : s.heading, fix.speedKmh);
    setMe(pos[0], pos[1], heading ?? null);
  }

  async function reroute(fix) {
    const n = state.nav;
    n.rerouting = true;
    n.lastTry = Date.now();
    $('fn-banner-title').textContent = 'Recalcul de l’itinéraire…';
    try {
      const plan = await fetchRoute({ lat: fix.lat, lon: fix.lon }, state.dest, state.vehicle, { fetchImpl: net.fetch });
      if (state.nav !== n) return;
      state.plan = plan;
      Object.assign(n, mkNav(plan), { offSince: null });
      drawRoute();
      demo?.follow(plan.coords, true);
      $('fn-banner').hidden = true;
      toast('Nouvel itinéraire calculé');
    } catch {
      if (state.nav === n) {
        $('fn-banner-title').textContent = 'Recalcul impossible';
        $('fn-banner-text').textContent = 'Nouvel essai dans quelques secondes';
      }
    } finally {
      n.rerouting = false;
    }
  }

  $('fn-recenter').addEventListener('click', () => {
    if (!state.nav) return;
    if (camera.mode === 'free') camera.recenter();
    else camera.cycle();
    if (app.fix) onFix(app.fix);
  });
  $('fn-end').addEventListener('click', async () => {
    if (await ask({ title: 'Terminer la navigation ?', text: 'Le guidage vers cette destination sera arrêté.', ok: 'Terminer' })) end();
  });

  /* ---------- Temps de conduite RSE / RSN ---------- */

  const announced = new Set();
  let bannerUntil = 0;
  let lastSave = 0;
  const persist = () => save(DRIVE_KEY, dt);

  function feed(fix) {
    if (dt.s.service) dt.update(Date.now(), fix.speedKmh);
  }

  const LEVEL_RANK = { info: 0, warn: 1, stop: 2 };
  function tick() {
    const now = Date.now();
    if (!dt.s.service) return;
    const snap = dt.snapshot(now);
    if (now - lastSave > 10000) {
      persist();
      lastSave = now;
    }
    // Nouvelles alertes
    const ids = new Set(snap.alerts.map((a) => a.id));
    for (const id of [...announced]) if (!ids.has(id)) announced.delete(id);
    for (const a of snap.alerts) {
      if (announced.has(a.id)) continue;
      announced.add(a.id);
      announce(a);
    }
    refreshDriveUi(false, snap);
  }

  function announce(a) {
    try {
      navigator.vibrate?.(a.level === 'stop' ? [400, 150, 400, 150, 400] : [250, 100, 250]);
    } catch {}
    if (state.active) {
      $('fn-alert').hidden = false;
      $('fn-alert').classList.toggle('stop', a.level === 'stop');
      $('fn-alert-title').textContent = a.level === 'stop' ? 'Pause / limite atteinte' : 'Temps de conduite';
      $('fn-alert-text').textContent = a.text;
      bannerUntil = a.level === 'stop' ? Infinity : Date.now() + 15000;
    } else {
      toast(a.text, 8000);
    }
  }

  function refreshDriveUi(force, snap = dt.snapshot(Date.now())) {
    renderCards();
    if (state.active) {
      const pill = $('fn-dt');
      pill.classList.remove('warn', 'stop', 'pause');
      const top = snap.alerts.reduce((m, a) => Math.max(m, LEVEL_RANK[a.level]), -1);
      if (!snap.service) {
        $('fn-dt-label').textContent = 'Temps de conduite';
        $('fn-dt-val').textContent = 'Service fermé';
      } else if (snap.mode === 'pause') {
        pill.classList.add('pause');
        $('fn-dt-label').textContent = snap.manual ? 'Pause conduite' : 'Pause détectée';
        $('fn-dt-val').textContent = `${fmtDuration(snap.breakElapsed)}${snap.breakDone ? ' ✓' : ` / ${fmtDuration(snap.breakNeeded)}`}`;
      } else {
        $('fn-dt-label').textContent = `Conduite continue · reste ${fmtDuration(snap.contLeft)}`;
        $('fn-dt-val').textContent = fmtDuration(snap.cont);
        if (top >= 2) pill.classList.add('stop');
        else if (top === 1) pill.classList.add('warn');
      }
      $('fn-pause').hidden = !snap.service;
      $('fn-pause').textContent = snap.manual ? 'Reprendre la conduite' : 'Pause conduite';
      if (!$('fn-alert').hidden && Date.now() > bannerUntil && !snap.alerts.some((a) => a.level === 'stop')) $('fn-alert').hidden = true;
      if (!snap.alerts.some((a) => a.level === 'stop') && bannerUntil === Infinity) bannerUntil = 0;
    }
    if (!$('dt').hidden) renderDt(snap);
  }
  setInterval(tick, 1000);

  function renderDt(snap) {
    const L2 = dt.s.limits;
    document.querySelectorAll('#dt [data-regime]').forEach((b) => b.classList.toggle('on', b.dataset.regime === dt.regime));
    $('dt-regime-note').textContent =
      dt.regime === 'RSE'
        ? 'Règlement (CE) 561/2006 : 4 h 30 de conduite, puis 45 min de pause (ou 15 min puis 30 min). 9 h par jour (10 h deux fois par semaine), 56 h par semaine, 90 h sur deux semaines.'
        : 'Réglementation nationale : seuils non officiels, modifiables ci-dessous. Valeurs initiales identiques au RSE, à vérifier selon votre convention et votre type de service.';
    $('dt-limits').hidden = dt.regime !== 'RSN';
    const box = (label, value, sub, level) => {
      const d = document.createElement('div');
      d.className = `stat ${level ?? ''}`;
      d.innerHTML = '<small></small><strong></strong><small class="sub"></small>';
      d.children[0].textContent = label;
      d.children[1].textContent = value;
      d.children[2].textContent = sub;
      return d;
    };
    const lvl = (x, cap) => (x >= cap ? 'stop' : x >= cap - 30 * 60000 ? 'warn' : '');
    const modeText = !snap.service ? 'Service fermé' : snap.mode === 'pause' ? (snap.manual ? 'Pause conduite (manuelle)' : 'Pause détectée (arrêt)') : snap.mode === 'stop' ? 'Arrêt en cours' : 'En conduite';
    $('dt-stats').replaceChildren(
      Object.assign(box('État', modeText, snap.service && snap.mode === 'pause' ? `Pause : ${fmtDuration(snap.breakElapsed)} / ${fmtDuration(snap.breakNeeded)}${snap.breakDone ? ' ✓' : ''}` : ''), { className: 'stat wide2' }),
      box('Conduite continue', fmtDuration(snap.cont), `max ${fmtDuration(L2.cont)}`, snap.service ? lvl(snap.cont, L2.cont) : ''),
      box('Aujourd’hui', fmtDuration(snap.dayDrive), `max ${fmtDuration(snap.dayCap)}`, snap.service ? lvl(snap.dayDrive, snap.dayCap) : ''),
      box('Cette semaine', fmtDuration(snap.weekDrive), `max ${fmtDuration(L2.week)}`, lvl(snap.weekDrive, L2.week)),
      box('2 semaines', fmtDuration(snap.fortnightDrive), `max ${fmtDuration(L2.fortnight)}`, lvl(snap.fortnightDrive, L2.fortnight)),
    );
    $('dt-alerts').replaceChildren(
      ...snap.alerts.map((a) => {
        const d = document.createElement('div');
        d.className = `alert-item ${a.level}`;
        d.textContent = a.text;
        return d;
      }),
    );
    $('dt-service').textContent = snap.service ? 'Fin de service' : 'Début de service';
    $('dt-service').className = `btn ${snap.service ? 'danger' : 'primary'}`;
    $('dt-pause').disabled = !snap.service;
    $('dt-pause').style.opacity = snap.service ? 1 : 0.5;
    $('dt-pause').textContent = snap.manual ? 'Reprendre la conduite' : 'Pause conduite';
  }

  let dtFrom = 'home';
  function openDt() {
    dtFrom = state.active ? 'fnav' : 'home';
    if (dtFrom === 'home') $('home').hidden = true;
    $('dt').hidden = false;
    fillLimits();
    renderDt(dt.snapshot(Date.now()));
  }
  function fillLimits() {
    const l = dt.s.limits;
    $('lm-cont').value = fmtN(l.cont / 3600000);
    $('lm-break').value = fmtN(l.breakFull / 60000);
    $('lm-day').value = fmtN(l.day / 3600000);
    $('lm-week').value = fmtN(l.week / 3600000);
  }
  $('fd-card').addEventListener('click', openDt);
  $('fn-dt').addEventListener('click', openDt);
  $('dt-back').addEventListener('click', () => {
    $('dt').hidden = true;
    if (dtFrom === 'home') $('home').hidden = false;
    renderCards();
  });
  document.querySelectorAll('#dt [data-regime]').forEach((b) =>
    b.addEventListener('click', () => {
      dt.setRegime(b.dataset.regime, Date.now());
      persist();
      fillLimits();
      announced.clear();
      renderDt(dt.snapshot(Date.now()));
    }),
  );
  $('lm-save').addEventListener('click', () => {
    const c = num($('lm-cont').value), b = num($('lm-break').value), d = num($('lm-day').value), w = num($('lm-week').value);
    if (![c, b, d, w].every((x) => Number.isFinite(x) && x > 0 && x < 200)) return toast('Valeurs incorrectes');
    dt.setLimits({ cont: c * 3600000, breakFull: b * 60000, day: d * 3600000, dayExt: Math.max(d, 10) * 3600000, week: w * 3600000 });
    persist();
    announced.clear();
    toast('Seuils RSN enregistrés');
    renderDt(dt.snapshot(Date.now()));
  });
  $('dt-service').addEventListener('click', async () => {
    const now = Date.now();
    if (dt.s.service) {
      dt.endService(now);
      announced.clear();
      $('fn-alert').hidden = true;
    } else {
      const w = dt.startService(now);
      if (w) await ask({ title: 'Repos précédent', text: w, ok: 'OK', cancel: null });
    }
    persist();
    refreshDriveUi(true);
  });
  function togglePause() {
    if (!dt.s.service) return toast('Ouvrez d’abord le service');
    dt.setManualPause(!dt.s.manual, Date.now());
    persist();
    refreshDriveUi(true);
  }
  $('dt-pause').addEventListener('click', togglePause);
  $('fn-pause').addEventListener('click', togglePause);
  $('dt-reset').addEventListener('click', async () => {
    if (!(await ask({ title: 'Réinitialiser ?', text: 'Tous les compteurs (jour, semaine, quinzaine) seront remis à zéro.', ok: 'Réinitialiser' }))) return;
    const regime = dt.regime;
    dt.s = new DriveTime().s;
    dt.s.regime = regime;
    announced.clear();
    persist();
    refreshDriveUi(true);
  });
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => document.hidden && persist());

  renderCards();
  fillVehicleForm();

  return {
    get active() {
      return state.active;
    },
    feed,
    onFix,
    redraw() {
      if (state.nav) {
        drawRoute();
        if (app.fix) onFix(app.fix);
      } else if (state.plan && !$('route-prev').hidden) showPreview();
    },
    _state: state,
    _dt: dt,
  };
}
