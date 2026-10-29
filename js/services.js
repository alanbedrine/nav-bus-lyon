// Services navigateur : géolocalisation, vitesse, limitation (OSM), écran allumé.

import { haversine, makeProjector, pointSegment } from './geo.js';

/* ---------- Filtre de mouvement : vitesse fiable, pas de micro-déplacements ---------- */

/**
 * Le GPS « bouge » même à l'arrêt (dérive de quelques mètres) : sans filtre on affichait 3-8 km/h et la flèche tremblait.
 *  - vitesse du capteur (Doppler) si elle existe, sinon calculée sur ≥ 2 s et au-delà de l'incertitude du GPS ;
 *  - sous 2,5 km/h, on considère le véhicule à l'arrêt : vitesse 0 et position figée ;
 *  - lissage léger, puis cap ignoré en dessous de 4 km/h (il est faux à basse vitesse).
 */
export class MotionFilter {
  constructor() {
    this.anchor = null; // dernier point réellement « validé » {lat, lon}
    this.win = []; // positions brutes des ~6 dernières secondes
    this.kmh = 0;
    this.zeros = 0;
    this.outliers = 0;
    this.lastHeading = null;
  }

  push({ lat, lon, accuracy = 10, speed = null, heading = null, t }) {
    this.win.push({ lat, lon, t });
    while (this.win.length > 2 && t - this.win[0].t > 6000) this.win.shift();
    if (!this.anchor) {
      this.anchor = { lat, lon };
      return { lat, lon, speedKmh: speed !== null ? this._clean(speed * 3.6) : 0, heading: null, stationary: speed === null || speed * 3.6 < 2.5 };
    }
    const a = this.anchor;
    if (accuracy > 80) {
      // fix trop imprécis : on garde l'état précédent
      return { lat: a.lat, lon: a.lon, speedKmh: this.kmh, heading: this.lastHeading, stationary: this.kmh === 0, poor: true };
    }
    const noise = Math.max(8, 1.5 * accuracy);
    const distAnchor = haversine([a.lat, a.lon], [lat, lon]);
    let v = 0; // m/s
    if (speed !== null && Number.isFinite(speed)) {
      v = speed;
      if (distAnchor < noise * 0.5 && v < 1.5) v = 0; // le capteur invente un petit mouvement alors que la position n'a pas bougé
    } else {
      const w0 = this.win[0];
      const dt = (t - w0.t) / 1000;
      const d = haversine([w0.lat, w0.lon], [lat, lon]);
      if (dt >= 2 && d > noise) v = d / dt;
    }
    let kmh = v * 3.6;
    if (kmh > 220) {
      // saut de position (reprise du GPS après un tunnel…) : ignoré, sauf s'il se répète (le véhicule a vraiment bougé)
      if (++this.outliers < 3) return { lat: a.lat, lon: a.lon, speedKmh: this.kmh, heading: this.lastHeading, stationary: this.kmh === 0, poor: true };
      this.outliers = 0;
      this.anchor = { lat, lon };
      this.win = [{ lat, lon, t }];
      return { lat, lon, speedKmh: this.kmh, heading: this.lastHeading, stationary: this.kmh === 0 };
    }
    this.outliers = 0;
    if (kmh < 2.5) kmh = 0;
    // Lissage : montée progressive, arrêt confirmé sur 2 mesures
    if (kmh === 0) {
      this.zeros++;
      this.kmh = this.zeros >= 2 ? 0 : this.kmh * 0.5;
    } else {
      this.zeros = 0;
      this.kmh = this.kmh === 0 ? kmh : this.kmh * 0.4 + kmh * 0.6;
    }
    const moving = this.kmh >= 2.5;
    if (moving) this.anchor = { lat, lon };
    if (moving && heading !== null && Number.isFinite(heading) && this.kmh >= 4) this.lastHeading = heading;
    return {
      lat: moving ? lat : a.lat,
      lon: moving ? lon : a.lon,
      speedKmh: moving ? this.kmh : 0,
      heading: moving ? this.lastHeading : null,
      stationary: !moving,
    };
  }

  _clean(kmh) {
    return kmh < 2.5 ? 0 : kmh;
  }
}

/* ---------- Géolocalisation ---------- */

export class Locator {
  /**
   * @param {{onFix:(fix:object)=>void, onStatus:(s:{status:'pending'|'ok'|'denied'|'unavailable'|'insecure'|'unsupported', message?:string})=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.watchId = null;
    this.filter = new MotionFilter();
    this.hasFix = false;
  }

  start() {
    this.stop();
    if (!('geolocation' in navigator)) return this.cb.onStatus({ status: 'unsupported' });
    if (!window.isSecureContext) return this.cb.onStatus({ status: 'insecure' });
    this.cb.onStatus({ status: 'pending' });
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handle(pos),
      (err) => this.fail(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    // Si l'utilisateur change l'autorisation dans les réglages, on repart automatiquement.
    navigator.permissions?.query({ name: 'geolocation' }).then((p) => {
      p.onchange = () => {
        if (p.state === 'granted' && !this.hasFix) this.start();
        if (p.state === 'denied') this.cb.onStatus({ status: 'denied' });
      };
    }).catch(() => {});
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  handle(pos) {
    const c = pos.coords;
    const t = pos.timestamp || Date.now();
    const m = this.filter.push({
      lat: c.latitude,
      lon: c.longitude,
      accuracy: Number.isFinite(c.accuracy) ? c.accuracy : 10,
      speed: Number.isFinite(c.speed) && c.speed !== null ? c.speed : null,
      heading: Number.isFinite(c.heading) ? c.heading : null,
      t,
    });
    const fix = {
      lat: m.lat,
      lon: m.lon,
      accuracy: c.accuracy,
      heading: m.heading,
      speedKmh: m.speedKmh,
      stationary: m.stationary,
      t,
    };
    this.hasFix = true;
    this.cb.onStatus({ status: 'ok' });
    this.cb.onFix(fix);
  }

  fail(err) {
    if (err.code === err.PERMISSION_DENIED) {
      this.hasFix = false;
      this.cb.onStatus({ status: 'denied' });
    } else {
      this.cb.onStatus({ status: this.hasFix ? 'ok' : 'unavailable', message: err.message });
    }
  }
}

/* ---------- Limitation de vitesse (OpenStreetMap / Overpass) ---------- */

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const INFERRED = { residential: 50, tertiary: 50, secondary: 50, primary: 50, unclassified: 50, living_street: 20, service: 30 };

export function parseMaxspeed(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const kmh = s.match(/^(\d+)\s*km\/h$/);
  if (kmh) return Number(kmh[1]);
  if (s.includes('urban')) return 50;
  if (s.includes('living_street')) return 20;
  return null; // mph, rural, etc. : ignoré
}

export class SpeedLimit {
  constructor() {
    this.cache = new Map();
    this.last = { t: 0, lat: 0, lon: 0 };
    this.inflight = false;
    this.failures = 0;
    this.value = null; // { kmh, estimated }
  }

  /** À appeler à chaque position ; renvoie la dernière valeur connue. */
  async update(lat, lon) {
    const now = Date.now();
    const moved = haversine([this.last.lat, this.last.lon], [lat, lon]);
    const backoff = Math.min(60000, 4000 * 2 ** this.failures);
    if (this.inflight || (now - this.last.t < backoff && moved < 60)) return this.value;
    if (now - this.last.t < 3000) return this.value;

    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (!this.cache.has(key)) {
      this.inflight = true;
      this.last = { t: now, lat, lon };
      try {
        const ways = await this.query(lat, lon);
        this.cache.set(key, ways);
        this.failures = 0;
      } catch {
        this.failures++;
      } finally {
        this.inflight = false;
      }
    }
    const ways = this.cache.get(key);
    if (ways) this.value = this.nearest(ways, lat, lon);
    return this.value;
  }

  async query(lat, lon) {
    // Zone d'environ 150 m : on met les routes en cache par cellule de ~100 m.
    const q = `[out:json][timeout:8];way(around:150,${lat},${lon})["highway"];out tags geom;`;
    let err;
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(q),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        return (json.elements ?? []).filter((e) => e.geometry?.length > 1);
      } catch (e) {
        err = e;
      }
    }
    throw err;
  }

  nearest(ways, lat, lon) {
    const pr = makeProjector([lat, lon]);
    let best = null;
    for (const w of ways) {
      const pts = w.geometry.map((g) => pr.toXY(g.lat, g.lon));
      let d = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        d = Math.min(d, pointSegment(0, 0, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]).dist);
      }
      if (d > 35) continue;
      const explicit = parseMaxspeed(w.tags?.maxspeed);
      const kmh = explicit ?? INFERRED[w.tags?.highway] ?? null;
      if (kmh === null) continue;
      // priorité : voie la plus proche, à égalité (≈) une limite explicite
      const score = d - (explicit !== null ? 5 : 0);
      if (!best || score < best.score) best = { score, kmh, estimated: explicit === null };
    }
    return best ? { kmh: best.kmh, estimated: best.estimated } : null;
  }
}

/* ---------- Écran allumé ---------- */

export class KeepAwake {
  constructor() {
    this.sentinel = null;
    this.wanted = false;
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') this.acquire();
    });
  }

  get supported() {
    return 'wakeLock' in navigator;
  }

  async enable() {
    this.wanted = true;
    return this.acquire();
  }

  async acquire() {
    if (!this.supported) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => (this.sentinel = null));
      return true;
    } catch {
      return false; // refusé (économie d'énergie, onglet masqué…)
    }
  }

  async disable() {
    this.wanted = false;
    try {
      await this.sentinel?.release();
    } catch {}
    this.sentinel = null;
  }
}
