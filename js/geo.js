// Outils géométriques (sans DOM : utilisables côté navigateur et Node).

const RAD = Math.PI / 180;
const EARTH = 6371008.8;

/** Distance haversine en mètres entre deux points [lat, lon]. */
export function haversine(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cap (0-360°) du point a vers le point b. */
export function bearing(a, b) {
  const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
  const x =
    Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) -
    Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Projection équirectangulaire locale (mètres) autour d'une origine [lat, lon]. */
export function makeProjector(origin) {
  const kx = 111320 * Math.cos(origin[0] * RAD);
  const ky = 110540;
  return {
    toXY: (lat, lon) => [(lon - origin[1]) * kx, (lat - origin[0]) * ky],
    toLatLon: (x, y) => [origin[0] + y / ky, origin[1] + x / kx],
  };
}

/** Distance d'un point (px,py) au segment [a,b] ; renvoie {dist, t}. */
export function pointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

/** Simplification Douglas-Peucker (tolérance en mètres) d'une liste de [lat, lon]. */
export function simplify(coords, tolerance = 2) {
  if (coords.length < 3) return coords.slice();
  const pr = makeProjector(coords[0]);
  const pts = coords.map((c) => pr.toXY(c[0], c[1]));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const { dist } = pointSegment(pts[i][0], pts[i][1], pts[s][0], pts[s][1], pts[e][0], pts[e][1]);
      if (dist > maxD) {
        maxD = dist;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Longueur d'une polyligne [lat, lon] en mètres. */
export function pathLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}
