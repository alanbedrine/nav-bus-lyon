// Caméra de navigation, comme Waze :
//  - « suivi »  : la carte tourne, la flèche pointe toujours vers le haut, zoom serré sur l'itinéraire ;
//  - « nord »   : carte orientée nord, centrée sur le véhicule ;
//  - « libre »  : l'utilisateur déplace la carte (elle ne bouge plus toute seule).
// La rotation se fait en tournant le conteneur de la carte (CSS), sans plugin Leaflet.

export class Camera {
  constructor(map, mapEl, { onMode = () => {} } = {}) {
    this.map = map;
    this.el = mapEl;
    this.onMode = onMode;
    this.active = false;
    this.mode = 'follow';
    this.angle = 0; // angle courant de la carte (° continus)
    this.pos = null;
    this.lastZoomAt = 0;
    this._onResize = () => this.active && this.mode === 'follow' && this._layout();
    addEventListener('resize', this._onResize);
    map.on('dragstart', () => this.active && this.mode !== 'free' && this.setMode('free'));
  }

  get rotated() {
    return this.active && this.mode === 'follow';
  }

  start(mode = 'follow') {
    this.active = true;
    this.angle = 0;
    this.setMode(mode);
  }

  stop() {
    this.active = false;
    this._unrotate();
    this._interactions(true);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'follow') {
      this._interactions(false);
      this._layout();
    } else {
      this._unrotate();
      this._interactions(true);
    }
    this.onMode(mode);
    if (mode !== 'free' && this.pos) this.update(this.pos.latlng, this.pos.heading, this.pos.speed, true);
  }

  /** suivi <-> nord ; depuis « libre » on revient au suivi. */
  cycle() {
    this.setMode(this.mode === 'follow' ? 'north' : 'follow');
  }

  recenter() {
    this.setMode(this.mode === 'free' ? 'follow' : this.mode);
  }

  _interactions(on) {
    for (const h of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom']) {
      const handler = this.map[h];
      if (handler) on ? handler.enable() : handler.disable();
    }
  }

  /** Le conteneur est agrandi pour couvrir l'écran quelle que soit la rotation ; le véhicule est à 62 % de la hauteur. */
  _layout() {
    const w = innerWidth;
    const h = innerHeight;
    const cy = h * 0.62;
    const R = Math.hypot(Math.max(cy, h - cy), w / 2);
    const S = Math.ceil(2 * R + 40);
    const s = this.el.style;
    s.position = 'fixed';
    s.inset = 'auto';
    s.width = `${S}px`;
    s.height = `${S}px`;
    s.left = `${w / 2 - S / 2}px`;
    s.top = `${cy - S / 2}px`;
    s.transformOrigin = '50% 50%';
    s.transition = 'transform .6s linear';
    s.transform = `rotate(${-this.angle}deg)`;
    this.map.invalidateSize({ animate: false });
  }

  _unrotate() {
    const s = this.el.style;
    s.position = s.inset = s.width = s.height = s.left = s.top = s.transform = s.transformOrigin = s.transition = '';
    this.map.invalidateSize({ animate: false });
  }

  /** Niveau de zoom selon la vitesse (plus on roule vite, plus on voit loin). */
  _zoomFor(kmh) {
    if (kmh >= 80) return 16;
    if (kmh >= 50) return 16.5;
    if (kmh >= 25) return 17;
    return 17.5;
  }

  update(latlng, heading, speedKmh, force = false) {
    this.pos = { latlng, heading, speed: speedKmh };
    if (!this.active || this.mode === 'free') return;
    const map = this.map;
    if (this.mode === 'follow') {
      if (heading !== null && heading !== undefined && (speedKmh === null || speedKmh === undefined || speedKmh > 3 || force)) {
        const diff = ((heading - this.angle + 540) % 360) - 180;
        this.angle += Math.abs(diff) > 90 ? diff : diff * 0.6;
        this.el.style.transform = `rotate(${-this.angle}deg)`;
      }
      let z = map.getZoom();
      const want = this._zoomFor(speedKmh ?? 0);
      if (force || (Math.abs(want - z) >= 0.5 && Date.now() - this.lastZoomAt > 8000)) {
        z = want;
        this.lastZoomAt = Date.now();
      }
      map.setView(latlng, z, { animate: !force, duration: 0.9, easeLinearity: 1 });
    } else {
      const z = map.getZoom();
      const p = map.project(latlng, z);
      p.y += map.getSize().y * 0.16; // le véhicule apparaît dans le tiers bas de l'écran
      map.setView(map.unproject(p, z), z, { animate: true, duration: 0.8 });
    }
  }
}
