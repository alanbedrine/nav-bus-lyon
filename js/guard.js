// Accès réservé aux mobiles et tablettes (agent utilisateur + taille d'écran physique).
// Garde-fou côté navigateur : il ne remplace pas un contrôle serveur, mais évite d'utiliser l'appli sur PC.

export function isMobileOrTablet(nav = globalThis.navigator, scr = globalThis.screen) {
  const ua = nav?.userAgent ?? '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|CriOS|FxiOS/i.test(ua);
  // iPadOS se présente comme un Mac : on le reconnaît à son écran tactile multipoint.
  const iPadOS = /Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1;
  const minSide = Math.min(scr?.width ?? 0, scr?.height ?? 0);
  const smallEnough = minSide > 0 && minSide <= 1400; // exclut les écrans de bureau
  return (uaMobile || iPadOS) && smallEnough;
}
