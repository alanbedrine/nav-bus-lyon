// Services navigateur : géolocalisation, vitesse, limitation (OSM), écran allumé.

import { haversine, makeProjector, pointSegment } from './geo.js';

/* ---------- Géolocalisation ---------- */

export class Locator {
  /**
   * @param {{onFix:(fix:object)=>void, onStatus:(s:{status:'pending'|'ok'|'denied'|'unavailable'|'insecure'|'unsupported', message?:string})=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.watchId = null;
    this.prev = null;
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
    let speed = Number.isFinite(c.speed) && c.speed !== null ? c.speed : null; // m/s
    if (speed === null && this.prev) {
      const dt = (t - this.prev.t) / 1000;
      if (dt > 0.5) speed = haversine([this.prev.lat, this.prev.lon], [c.latitude, c.longitude]) / dt;
    }
    const fix = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: c.accuracy,
      heading: Number.isFinite(c.heading) ? c.heading : null,
      speedKmh: speed === null ? null : Math.max(0, speed * 3.6),
      t,
    };
    this.prev = { lat: fix.lat, lon: fix.lon, t };
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
