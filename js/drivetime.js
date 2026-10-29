// Temps de conduite et de pause (indicatif, ne remplace pas le chronotachygraphe). Sans DOM : testable sous Node.
// Règles RSE : règlement (CE) n° 561/2006. Les seuils RSN sont MODIFIABLES et pré-remplis avec ceux du RSE (à confirmer).

const MIN = 60000;
const H = 3600000;

/** Seuils du règlement (CE) 561/2006 (RSE). */
export const RSE_LIMITS = {
  cont: 4.5 * H, // conduite continue maximale
  breakFull: 45 * MIN, // pause complète
  breakA: 15 * MIN, // pause fractionnée : 15 min puis...
  breakB: 30 * MIN, // ... 30 min
  day: 9 * H,
  dayExt: 10 * H, // 2 fois par semaine
  extPerWeek: 2,
  week: 56 * H,
  fortnight: 90 * H,
  restDay: 11 * H,
  restDayReduced: 9 * H,
  reducedPerWeek: 3,
};

export const REGIMES = {
  RSE: { label: 'RSE (règlement européen)', official: true },
  RSN: { label: 'RSN (réglementation nationale)', official: false },
};

/** Lundi 00:00 (heure locale) de la semaine de `ms`, sous forme AAAA-MM-JJ. */
export function weekKey(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function prevWeekKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return weekKey(new Date(y, m - 1, d - 7).getTime());
}

export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

const MOVING_KMH = 3;
const FRESH = () => ({
  v: 1,
  regime: 'RSE',
  limits: { ...RSE_LIMITS },
  autoPauseMs: 2 * MIN,
  service: false, // service ouvert
  last: null, // dernier instant traité
  mode: 'off', // off | drive | pause
  manual: false, // pause demandée par le conducteur
  pendingStop: 0, // arrêt récent non encore classé (feu rouge ou pause ?)
  cont: 0,
  split: false,
  pauseCur: 0,
  day: { drive: 0, started: null, ended: null },
  weeks: {}, // { 'AAAA-MM-JJ' (lundi): { drive, ext, reduced } }
});

export class DriveTime {
  constructor(saved = null) {
    this.s = FRESH();
    if (saved && saved.v === 1) {
      Object.assign(this.s, saved);
      this.s.limits = { ...RSE_LIMITS, ...saved.limits };
      this.s.day = { ...FRESH().day, ...saved.day };
    }
  }

  toJSON() {
    // On ne garde que les 3 dernières semaines.
    const keys = Object.keys(this.s.weeks).sort().slice(-3);
    return { ...this.s, weeks: Object.fromEntries(keys.map((k) => [k, this.s.weeks[k]])) };
  }

  get regime() {
    return this.s.regime;
  }

  setRegime(r, now) {
    this.advance(now);
    this.s.regime = r === 'RSN' ? 'RSN' : 'RSE';
    if (r === 'RSE') this.s.limits = { ...RSE_LIMITS };
  }

  setLimits(partial) {
    this.s.limits = { ...this.s.limits, ...partial };
  }

  _week(now) {
    const k = weekKey(now);
    return (this.s.weeks[k] ??= { drive: 0, ext: 0, reduced: 0 });
  }

  /** Ouvre le service (carte insérée). Renvoie un éventuel avertissement sur le repos précédent. */
  startService(now) {
    const s = this.s;
    if (s.service) return null;
    let warning = null;
    const L = s.limits;
    const rest = s.day.ended ? now - s.day.ended : Infinity;
    if (s.day.started && rest < L.restDayReduced) {
      // Repos trop court pour ouvrir une nouvelle journée : la journée précédente continue.
      s.day.ended = null;
      warning = `Repos de ${fmtDuration(rest)} seulement (moins de ${fmtDuration(L.restDayReduced)}) : la journée de conduite précédente continue.`;
    } else {
      if (s.day.started && rest < L.restDay) {
        const w = this._week(now);
        w.reduced += 1;
        warning = `Repos journalier réduit (${fmtDuration(rest)}). ${w.reduced} réduit(s) cette semaine, ${L.reducedPerWeek} autorisés entre deux repos hebdomadaires.`;
      }
      s.day = { drive: 0, started: now, ended: null };
      s.cont = 0;
      s.split = false;
      s.pauseCur = 0;
    }
    s.service = true;
    s.last = now;
    s.mode = 'pause';
    s.manual = false;
    s.pendingStop = 0;
    return warning;
  }

  endService(now) {
    this.advance(now);
    const s = this.s;
    if (!s.service) return;
    this._flushPending(false);
    s.service = false;
    s.mode = 'off';
    s.manual = false;
    s.day.ended = now;
    s.last = null;
  }

  setManualPause(on, now) {
    this.update(now, null, on);
  }

  /** Fait avancer l'horloge avec le dernier mode connu. */
  advance(now) {
    const s = this.s;
    if (!s.service || s.last === null) return;
    const dt = Math.max(0, now - s.last);
    s.last = now;
    if (!dt) return;
    if (s.mode === 'drive') this._addDrive(dt, now);
    else if (s.mode === 'pause') s.pauseCur += dt;
    else if (s.mode === 'stop') s.pendingStop += dt;
  }

  /**
   * @param speedKmh vitesse courante (null si inconnue : on garde le mode actuel)
   * @param manual   état de la pause manuelle (undefined : inchangé)
   */
  update(now, speedKmh, manual) {
    const s = this.s;
    if (!s.service) return;
    this.advance(now);
    const wasManual = s.manual;
    if (manual !== undefined) s.manual = !!manual;
    const known = speedKmh !== null && speedKmh !== undefined;
    const moving = known && speedKmh >= MOVING_KMH;

    let next = s.mode;
    if (s.manual) next = 'pause';
    else if (wasManual) next = moving ? 'drive' : 'stop'; // fin de pause manuelle
    else if (known) next = moving ? 'drive' : s.mode === 'drive' ? 'stop' : s.mode;

    if (next !== s.mode) {
      if (s.mode === 'pause') this._endPause();
      if (s.mode === 'stop' && next === 'drive') this._flushPending(true); // simple arrêt : compté comme conduite
      if (s.mode === 'stop' && next === 'pause') {
        s.pauseCur = s.pendingStop;
        s.pendingStop = 0;
      }
      if (next === 'stop') s.pendingStop = 0;
      s.mode = next;
    }
    // Un arrêt assez long devient une pause (rétroactivement : l'arrêt compte dans la pause)
    if (s.mode === 'stop' && s.pendingStop >= s.autoPauseMs) {
      s.pauseCur = s.pendingStop;
      s.pendingStop = 0;
      s.mode = 'pause';
    }
  }

  _addDrive(ms, now) {
    const s = this.s;
    s.cont += ms;
    s.day.drive += ms;
    const w = this._week(now);
    w.drive += ms;
    if (s.day.drive > s.limits.day && !s.day.extCounted) {
      w.ext += 1; // journée prolongée au-delà de 9 h
      s.day.extCounted = true;
    }
  }

  /** Arrêt court (feu, embouteillage) : compté comme du temps de conduite, prudence oblige. */
  _flushPending(asDrive) {
    const s = this.s;
    if (asDrive && s.pendingStop > 0) this._addDrive(s.pendingStop, s.last ?? Date.now());
    s.pendingStop = 0;
  }

  /** Fin d'une pause : applique la règle de coupure. */
  _endPause() {
    const s = this.s;
    const L = s.limits;
    const p = s.pauseCur;
    if (p >= L.breakFull) {
      s.cont = 0;
      s.split = false;
    } else if (s.split && p >= L.breakB) {
      s.cont = 0;
      s.split = false;
    } else if (!s.split && p >= L.breakA) {
      s.split = true;
    }
    s.pauseCur = 0;
  }

  /** Photographie à l'instant `now`, avec alertes. */
  snapshot(now) {
    this.advance(now);
    const s = this.s;
    const L = s.limits;
    const live = s.mode === 'stop' ? s.pendingStop : 0; // arrêt en cours, pas encore classé
    let cont = s.cont + live;
    let split = s.split;
    // Pause en cours : montre ce qui serait validé si on repartait maintenant
    let breakDone = false;
    if (s.mode === 'pause') {
      if (s.pauseCur >= L.breakFull || (s.split && s.pauseCur >= L.breakB)) {
        cont = 0;
        split = false;
        breakDone = true;
      } else if (!s.split && s.pauseCur >= L.breakA) split = true;
    }
    const w = this._week(now);
    const prev = this.s.weeks[prevWeekKey(weekKey(now))]?.drive ?? 0;
    const dayDrive = s.day.drive + live;
    const weekDrive = w.drive + live;
    const extLeft = Math.max(0, L.extPerWeek - w.ext + (s.day.extCounted ? 1 : 0)); // avant la journée en cours
    const dayCap = s.day.extCounted || w.ext < L.extPerWeek ? L.dayExt : L.day;

    const need = split ? L.breakB : L.breakFull; // pause à effectuer maintenant
    const pauseNow = s.mode === 'pause' ? s.pauseCur : 0;
    const snap = {
      service: s.service,
      mode: s.mode,
      manual: s.manual,
      regime: s.regime,
      cont,
      contLeft: Math.max(0, L.cont - cont),
      split,
      breakNeeded: need,
      breakElapsed: pauseNow,
      breakDone,
      dayDrive,
      dayLeft: Math.max(0, dayCap - dayDrive),
      dayCap,
      extUsed: w.ext,
      extLeft,
      weekDrive,
      weekLeft: Math.max(0, L.week - weekDrive),
      fortnightDrive: weekDrive + prev,
      fortnightLeft: Math.max(0, L.fortnight - (weekDrive + prev)),
      reduced: w.reduced,
      alerts: [],
    };
    if (s.service) snap.alerts = this._alerts(snap, L);
    // Limite la plus proche (compte à rebours) : temps de conduite restant avant de la dépasser (négatif = dépassée)
    const cands = [
      { id: 'day', label: 'conduite journalière', left: dayCap - dayDrive },
      { id: 'week', label: 'conduite hebdomadaire', left: L.week - weekDrive },
      { id: 'fort', label: 'conduite sur deux semaines', left: L.fortnight - snap.fortnightDrive },
    ];
    if (s.mode !== 'pause' || !snap.breakDone) cands.push({ id: 'cont', label: 'conduite continue', left: L.cont - cont });
    if (s.mode === 'pause' && !snap.breakDone) cands.pop(); // en pause incomplète, la conduite continue ne décompte pas
    snap.limit = cands.reduce((m, c) => (c.left < m.left ? c : m));
    return snap;
  }

  _alerts(x, L) {
    const a = [];
    const add = (id, level, text) => a.push({ id, level, text });
    const label = x.regime;
    // Conduite continue
    if (x.cont >= L.cont) add('cont-stop', 'stop', `${label} : ${fmtDuration(L.cont)} de conduite atteintes. Pause de ${fmtDuration(x.split ? L.breakB : L.breakFull)} obligatoire.`);
    else if (x.contLeft <= 15 * MIN) add('cont-15', 'warn', `${label} : plus que ${fmtDuration(x.contLeft)} avant la pause obligatoire.`);
    else if (x.contLeft <= 30 * MIN) add('cont-30', 'info', `${label} : pause à prévoir dans ${fmtDuration(x.contLeft)}.`);
    // Journée
    if (x.dayDrive >= x.dayCap) add('day-stop', 'stop', `${label} : durée de conduite journalière atteinte (${fmtDuration(x.dayCap)}).`);
    else if (x.dayDrive >= L.day) add('day-ext', 'warn', `${label} : ${fmtDuration(L.day)} de conduite dépassées. Jusqu'à ${fmtDuration(L.dayExt)} autorisées ${L.extPerWeek} fois par semaine (${x.extUsed}/${L.extPerWeek} utilisée(s)).`);
    else if (x.dayLeft <= 30 * MIN) add('day-30', 'info', `${label} : plus que ${fmtDuration(x.dayLeft)} de conduite aujourd'hui.`);
    // Semaine / quinzaine
    if (x.weekDrive >= L.week) add('week-stop', 'stop', `${label} : durée de conduite hebdomadaire atteinte (${fmtDuration(L.week)}).`);
    else if (x.weekLeft <= 2 * H) add('week-2h', 'warn', `${label} : plus que ${fmtDuration(x.weekLeft)} de conduite cette semaine.`);
    if (x.fortnightDrive >= L.fortnight) add('fort-stop', 'stop', `${label} : durée de conduite sur deux semaines atteinte (${fmtDuration(L.fortnight)}).`);
    else if (x.fortnightLeft <= 2 * H) add('fort-2h', 'warn', `${label} : plus que ${fmtDuration(x.fortnightLeft)} sur deux semaines.`);
    return a;
  }
}
