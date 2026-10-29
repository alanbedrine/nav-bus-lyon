// Pictogrammes de manœuvre (style panneau de guidage), en SVG qui prend la couleur du texte (currentColor).
// `type` = types de manœuvre Valhalla.

const svg = (inner) => `<svg viewBox="0 0 48 48" aria-hidden="true">${inner}</svg>`;
const line = (d, w = 5) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const fill = (d) => `<path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`;
const f = (n) => n.toFixed(1);

/** Flèche qui arrive par le bas puis part dans la direction `deg` (0 = tout droit, + = droite, - = gauche). */
function arrow(deg, { stem = 14, seg = 15 } = {}) {
  const a = (deg * Math.PI) / 180;
  const sx = 24;
  const sy = 44 - stem - 8; // fin de la tige verticale
  const ex = sx + Math.sin(a) * seg;
  const ey = sy - Math.cos(a) * seg;
  // pointe orientée selon a
  const d = [Math.sin(a), -Math.cos(a)]; // direction
  const n = [Math.cos(a), Math.sin(a)]; // normale
  const tip = [ex + d[0] * 8, ey + d[1] * 8];
  const b1 = [ex - d[0] * 3 + n[0] * 10, ey - d[1] * 3 + n[1] * 10];
  const b2 = [ex - d[0] * 3 - n[0] * 10, ey - d[1] * 3 - n[1] * 10];
  const bend = deg === 0 ? '' : `Q${sx} ${f(sy - 3)} ${f(sx + Math.sin(a) * 6)} ${f(sy - Math.cos(a) * 6)}`;
  return (
    line(`M24 44V${f(sy)}${bend}L${f(ex)} ${f(ey)}`) +
    fill(`M${f(tip[0])} ${f(tip[1])}L${f(b1[0])} ${f(b1[1])}L${f(b2[0])} ${f(b2[1])}Z`)
  );
}

const ANGLES = { 8: 0, 7: 0, 22: 0, 9: 40, 10: 90, 11: 140, 16: -40, 15: -90, 14: -140, 23: 25, 24: -25, 2: 90, 3: -90, 1: 0 };

export function maneuverSvg(type, exitCount = null) {
  const t = Number(type);
  if (t === 4 || t === 5 || t === 6) return svg(line('M14 43V8') + fill('M16 9h22l-5 8 5 8H16Z')); // arrivée
  if (t === 12) return svg(line('M14 44V20a9 9 0 0 1 18 0v12') + fill('M24 30l8 12 8-12Z')); // demi-tour (droite)
  if (t === 13) return svg(line('M34 44V20a9 9 0 0 0-18 0v12') + fill('M8 30l8 12 8-12Z')); // demi-tour (gauche)
  if (t === 26 || t === 27) {
    const n = exitCount ? `<text x="24" y="21" text-anchor="middle" font-size="13" font-weight="800" fill="currentColor">${exitCount}</text>` : '';
    return svg(`<circle cx="24" cy="19" r="10" fill="none" stroke="currentColor" stroke-width="4"/>${n}` + line('M24 46V30', 4) + fill('M32 6l9 6-10 4Z')); // rond-point
  }
  if (t === 20 || t === 18 || t === 17) return svg(line('M16 44V12') + line('M16 32Q16 24 30 17', 4) + fill('M28 8l14 8-14 10Z')); // sortie / bretelle à droite
  if (t === 21 || t === 19) return svg(line('M32 44V12') + line('M32 32Q32 24 18 17', 4) + fill('M20 8L6 16l14 10Z')); // à gauche
  if (t === 37 || t === 38 || t === 25) return svg(line('M12 44V34Q12 24 24 16', 4) + line('M36 44V34Q36 24 24 16', 4) + line('M24 16V8') + fill('M16 12l8-9 8 9Z')); // insertion
  return svg(arrow(ANGLES[t] ?? 0));
}
