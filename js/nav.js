// Moteur de suivi d'itinéraire : le tracé est FIXE, aucun recalcul.
// Si le véhicule s'écarte du tracé, l'état passe à "off" (délocalisé) jusqu'au retour sur le tracé.

import { bearing, makeProjector, pointSegment } from './geo.js';

export class Route {
  /** @param {Array<[number, number]>} coords polyligne [lat, lon] */
  constructor(coords) {
    if (!coords || coords.length < 2) throw new Error('Tracé invalide');
    this.coords = coords;
    this.proj = makeProjector(coords[0]);
    this.xy = coords.map((c) => this.proj.toXY(c[0], c[1]));
    this.cum = [0];
    for (let i = 1; i < this.xy.length; i++) {
      this.cum.push(
        this.cum[i - 1] + Math.hypot(this.xy[i][0] - this.xy[i - 1][0], this.xy[i][1] - this.xy[i - 1][1]),
      );
    }
    this.length = this.cum[this.cum.length - 1];
    this.segments = this.xy.length - 1;
  }

  /** Index du segment contenant l'abscisse curviligne `along`. */
  segmentAt(along) {
    if (along <= 0) return 0;
    if (along >= this.length) return this.segments - 1;
    let lo = 0;
    let hi = this.segments - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= along) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Point le plus proche du tracé, recherché entre les segments from..to inclus. */
  nearest(x, y, from = 0, to = this.segments - 1) {
    let best = null;
    for (let i = Math.max(0, from); i <= Math.min(this.segments - 1, to); i++) {
      const a = this.xy[i];
      const b = this.xy[i + 1];
      const { dist, t } = pointSegment(x, y, a[0], a[1], b[0], b[1]);
      if (!best || dist < best.dist) {
        best = { dist, seg: i, t, along: this.cum[i] + t * (this.cum[i + 1] - this.cum[i]) };
      }
    }
    return best;
  }

  /** Coordonnées [lat, lon] du point à l'abscisse `along`. */
  pointAt(along) {
    const i = this.segmentAt(along);
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, (along - this.cum[i]) / segLen));
    const x = this.xy[i][0] + t * (this.xy[i + 1][0] - this.xy[i][0]);
    const y = this.xy[i][1] + t * (this.xy[i + 1][1] - this.xy[i][1]);
    return this.proj.toLatLon(x, y);
  }

  /** Partie du tracé déjà parcourue / restante à partir de `along`. */
  split(along) {
    const i = this.segmentAt(along);
    const p = this.pointAt(along);
    return {
      done: [...this.coords.slice(0, i + 1), p],
      todo: [p, ...this.coords.slice(i + 1)],
    };
  }

  reversed() {
    return new Route(this.coords.slice().reverse());
  }
}

const LOOKAHEAD_M = 1500; // fenêtre de recherche devant le véhicule
const LOOKBEHIND_M = 80;
const OFF_AFTER_FIXES = 3; // positions consécutives hors tracé avant "délocalisé"
const BACK_AFTER_FIXES = 2; // positions consécutives sur le tracé avant "retour"
const ARRIVAL_M = 40;

export class NavEngine {
  /** @param {Route} route */
  constructor(route) {
    this.route = route;
    this.state = 'init'; // init | on | off | arrived
    this.along = 0;
    this.badCount = 0;
    this.goodCount = 0;
    this.lastSnap = route.coords[0];
  }

  /** @returns {{state:string, along:number, remaining:number, progress:number, offDistance:number, snapped:[number,number], heading:number}} */
  update(fix) {
    const r = this.route;
    const [x, y] = r.proj.toXY(fix.lat, fix.lon);
    const acc = Math.min(Math.max(fix.accuracy ?? 20, 5), 120);
    const offThreshold = Math.max(40, acc * 1.5);
    const backThreshold = Math.max(30, acc);

    const searchGlobal = this.state === 'init' || this.state === 'off';
    const cand = searchGlobal
      ? r.nearest(x, y)
      : r.nearest(
          x,
          y,
          r.segmentAt(this.along - LOOKBEHIND_M),
          r.segmentAt(this.along + LOOKAHEAD_M),
        );

    if (this.state === 'init') {
      this.state = cand.dist <= backThreshold ? 'on' : 'off';
      if (this.state === 'on') this.along = cand.along;
    } else if (this.state === 'on' || this.state === 'arrived') {
      if (cand.dist > offThreshold) {
        this.badCount++;
        if (this.badCount >= OFF_AFTER_FIXES) {
          this.state = 'off';
          this.goodCount = 0;
        }
      } else {
        this.badCount = 0;
        this.along = Math.max(this.along, cand.along); // on n'avance jamais en arrière
      }
    } else if (this.state === 'off') {
      if (cand.dist <= backThreshold) {
        this.goodCount++;
        if (this.goodCount >= BACK_AFTER_FIXES) {
          this.state = 'on';
          this.badCount = 0;
          this.along = cand.along;
        }
      } else {
        this.goodCount = 0;
      }
    }

    const remaining = Math.max(0, r.length - this.along);
    if (this.state === 'on' && this.along > r.length * 0.5 && remaining <= ARRIVAL_M) {
      this.state = 'arrived';
    }

    const snapped = r.pointAt(this.along);
    if (this.state !== 'off') this.lastSnap = snapped;
    const seg = r.segmentAt(this.along);
    return {
      state: this.state,
      along: this.along,
      remaining,
      progress: r.length === 0 ? 0 : this.along / r.length,
      offDistance: this.state === 'off' ? cand.dist : 0,
      snapped: this.state === 'off' ? [fix.lat, fix.lon] : snapped,
      heading: bearing(r.coords[seg], r.coords[seg + 1]),
    };
  }
}
