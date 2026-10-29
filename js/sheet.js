// Feuilles du bas déplaçables : glisser la poignée (ou l'en-tête) pour agrandir jusqu'en haut ou réduire.
// Trois crans : réduit, moyen, plein écran. Un simple toucher sur la poignée passe au cran suivant.

const PEEK = 150; // px visibles en mode réduit

export function makeSheet(el, { start = 'mid' } = {}) {
  const heights = () => {
    const vh = window.innerHeight;
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0;
    return { peek: PEEK, mid: Math.round(vh * 0.64), full: vh - top - 12 };
  };
  let state = start;
  const apply = (name, animate = true) => {
    state = name;
    el.dataset.size = name;
    el.style.transition = animate ? 'height .25s ease' : 'none';
    el.style.height = `${heights()[name]}px`;
    el.style.maxHeight = 'none';
  };
  apply(state, false);
  addEventListener('resize', () => apply(state, false));

  const handles = [el.querySelector('.grabber'), el.querySelector('header')].filter(Boolean);
  let drag = null;
  const onDown = (e) => {
    if (e.target.closest('button, input, a, select')) return;
    drag = { y: e.clientY, h: el.getBoundingClientRect().height, t: Date.now(), moved: false, y0: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    el.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(e.clientY - drag.y0) > 6) drag.moved = true;
    const H = heights();
    el.style.height = `${Math.max(H.peek, Math.min(H.full, drag.h + dy))}px`;
  };
  const onUp = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const H = heights();
    if (!d.moved) {
      if (e.target.closest?.('.grabber')) apply(state === 'peek' ? 'mid' : state === 'mid' ? 'full' : 'mid');
      else apply(state);
      return;
    }
    const cur = el.getBoundingClientRect().height;
    const v = (d.y0 - e.clientY) / Math.max(1, Date.now() - d.t); // px/ms, >0 = vers le haut
    const target = cur + v * 180; // inertie
    let best = 'mid';
    let bd = Infinity;
    for (const [name, h] of Object.entries(H)) {
      const dist = Math.abs(h - target);
      if (dist < bd) { bd = dist; best = name; }
    }
    apply(best);
  };
  for (const h of handles) {
    h.style.touchAction = 'none';
    h.addEventListener('pointerdown', onDown);
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
    h.addEventListener('pointercancel', onUp);
  }
  // Pendant la saisie, la feuille passe en plein écran pour laisser la place aux résultats.
  for (const input of el.querySelectorAll('input[type=search]')) input.addEventListener('focus', () => apply('full'));
  return { set: apply, get state() { return state; } };
}
