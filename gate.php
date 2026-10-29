<?php
// Point d'entrée unique (.htaccess y redirige toutes les requêtes) :
//   1. refuse les robots ; 2. refuse les visiteurs hors de France ; 3. sert ensuite le fichier demandé.
// Hébergement mutualisé Apache + PHP (testé conceptuellement pour Infomaniak ; aucun module GeoIP requis).

declare(strict_types=1);

require __DIR__ . '/geo/lib.php';

const NOINDEX = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
$cfg = is_file(__DIR__ . '/geo/config.php') ? require __DIR__ . '/geo/config.php' : [];

function navlb_page(int $status, string $title, string $text): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: ' . NOINDEX);
    header('Cache-Control: no-store');
    echo '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'
        . htmlspecialchars($title) . '</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b0c;color:#f5f5f6;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="color:#e30613">'
        . htmlspecialchars($title) . '</h1><p>' . htmlspecialchars($text) . '</p></div></body></html>';
    exit;
}

// ---- chemin demandé -------------------------------------------------------------------------
$script = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/gate.php');
$base = str_ends_with($script, '/gate.php') ? rtrim(dirname($script), '/') : ''; // dossier d'installation (sous-dossier éventuel)
$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
if ($base !== '' && str_starts_with($path, $base)) {
    $path = substr($path, strlen($base));
}
$path = ltrim($path, '/');
if ($path === '' || str_ends_with($path, '/')) {
    $path .= 'index.html';
}
if (str_contains($path, "\0") || str_contains($path, '..') || str_contains($path, '\\')) {
    navlb_page(400, 'Requête invalide', 'Adresse incorrecte.');
}

// Fichiers publics uniquement : le reste (geo/, scripts/, tests/, node_modules/, *.php, .git…) n'est jamais servi.
$publicFiles = ['index.html', 'manifest.webmanifest', 'sw.js', 'robots.txt'];
$publicDirs = ['css', 'js', 'vendor', 'icons', 'data'];
$first = explode('/', $path)[0];
if (!in_array($path, $publicFiles, true) && !in_array($first, $publicDirs, true)) {
    navlb_page(404, 'Introuvable', 'Cette page n\'existe pas.');
}
$file = realpath(__DIR__ . '/' . $path);
$rootReal = realpath(__DIR__);
if ($file === false || !is_file($file) || !str_starts_with($file, $rootReal . DIRECTORY_SEPARATOR)) {
    navlb_page(404, 'Introuvable', 'Cette page n\'existe pas.');
}

// ---- contrôles (sauf robots.txt, que les robots honnêtes doivent pouvoir lire) -------------------
if ($path !== 'robots.txt') {
    if (navlb_is_bot($_SERVER['HTTP_USER_AGENT'] ?? '')) {
        navlb_page(403, 'Accès refusé', 'Les robots ne sont pas autorisés.');
    }

    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (!empty($cfg['trust_forwarded_for']) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ip = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    }
    $ranges = is_file(__DIR__ . '/geo/fr-ranges.php') ? require __DIR__ . '/geo/fr-ranges.php' : null;
    if ($ranges === null) {
        navlb_page(503, 'Configuration incomplète', 'La liste des adresses françaises n\'est pas installée (npm run geo).');
    }
    if (!in_array($ip, $cfg['allow_ips'] ?? [], true) && !navlb_ip_in_ranges($ip, $ranges)) {
        navlb_page(403, 'Service indisponible', 'nav Lyon bus est accessible uniquement depuis la France.');
    }
}

// ---- envoi du fichier -----------------------------------------------------------------------
$types = [
    'html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'js' => 'text/javascript; charset=utf-8',
    'json' => 'application/json; charset=utf-8', 'webmanifest' => 'application/manifest+json; charset=utf-8',
    'txt' => 'text/plain; charset=utf-8', 'png' => 'image/png', 'svg' => 'image/svg+xml', 'ico' => 'image/x-icon',
];
$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
$mtime = (int) filemtime($file);
$size = (int) filesize($file);
$etag = '"' . dechex($mtime) . '-' . dechex($size) . '"';

header('X-Robots-Tag: ' . NOINDEX);
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: geolocation=(self), camera=(), microphone=()');
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('ETag: ' . $etag);
header('Cache-Control: ' . (in_array($path, ['index.html', 'sw.js'], true) ? 'no-cache' : ($first === 'data' ? 'public, max-age=3600' : 'public, max-age=86400')));
header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
if ($path === 'sw.js') {
    header('Service-Worker-Allowed: /');
}
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}
$compressible = in_array($ext, ['html', 'css', 'js', 'json', 'webmanifest', 'txt', 'svg'], true);
if ($compressible && extension_loaded('zlib') && str_contains($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip')) {
    ob_start('ob_gzhandler');
} else {
    header('Content-Length: ' . $size);
}
readfile($file);
