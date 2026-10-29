// Cloudflare Pages Functions : s'exécute avant chaque requête.
//  - accès réservé à la France (pays déterminé par Cloudflare à partir de l'adresse IP) ;
//  - blocage des robots (agent utilisateur) : aucun référencement, aucune indexation ;
//  - robots.txt reste lisible pour que les robots respectueux voient l'interdiction.
//
// Variable d'environnement optionnelle : ALLOW_ALL=1 (développement local, désactive le filtre pays/robots).

const BOT_UA =
  /bot|crawl|spider|slurp|archive|preview|fetch|scrap|headless|phantom|selenium|puppeteer|playwright|python|curl|wget|httpclient|okhttp|java\/|go-http|libwww|axios|node-fetch|gptbot|claude|anthropic|ccbot|bytespider|petalbot|ahrefs|semrush|mj12|dotbot|yandex|baidu|duckduck|applebot|perplexity|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|discord|google-extended|googleother/i;

const NOINDEX = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

const page = (title, text, status) =>
  new Response(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b0c;color:#f5f5f6;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="color:#e30613">${title}</h1><p>${text}</p></div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': NOINDEX, 'cache-control': 'no-store' } },
  );

export async function onRequest({ request, next, env }) {
  const { pathname } = new URL(request.url);

  if (pathname === '/robots.txt') return next();
  if (env?.ALLOW_ALL === '1') return next();

  const ua = request.headers.get('user-agent') ?? '';
  if (!ua || BOT_UA.test(ua)) return page('Accès refusé', 'Les robots ne sont pas autorisés.', 403);

  const country = request.cf?.country; // code ISO 3166-1 (ex. « FR »), « T1 » pour Tor
  if (country !== 'FR') {
    return page('Service indisponible', 'nav Lyon bus est accessible uniquement depuis la France.', 403);
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', NOINDEX);
  return out;
}
