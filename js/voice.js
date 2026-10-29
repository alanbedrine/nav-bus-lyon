// Guidage vocal (synthèse vocale du navigateur, en français) pour la navigation libre.

const KEY = 'nav-lyon-bus:voice';

/** « Dans 300 mètres », « Dans 1,5 kilomètre ». */
export function spokenDistance(m) {
  if (m < 950) {
    const r = m < 150 ? Math.max(20, Math.round(m / 10) * 10) : Math.round(m / 50) * 50;
    return `Dans ${r} mètres`;
  }
  const km = Math.round(m / 100) / 10;
  return `Dans ${String(km).replace('.', ',')} ${km >= 2 ? 'kilomètres' : 'kilomètre'}`;
}

export class Voice {
  constructor() {
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem(KEY) !== 'off';
    } catch {}
    this.supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    this.voice = null;
    if (this.supported) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find((v) => /^fr[-_]FR/i.test(v.lang)) ?? vs.find((v) => /^fr/i.test(v.lang)) ?? null;
      };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  set(on) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {}
    if (!on && this.supported) speechSynthesis.cancel();
  }

  say(text, { urgent = false } = {}) {
    if (!this.enabled || !this.supported || !text) return false;
    try {
      if (urgent) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.02;
      speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  }
}
