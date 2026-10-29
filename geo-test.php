<?php
// À SUPPRIMER après vérification : affiche l'adresse IP vue par le serveur et si elle est reconnue comme française.
require __DIR__ . '/geo/lib.php';
$ranges = is_file(__DIR__ . '/geo/fr-ranges.php') ? require __DIR__ . '/geo/fr-ranges.php' : null;
header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex');
$ip = $_SERVER['REMOTE_ADDR'] ?? '?';
echo "REMOTE_ADDR      : $ip\n";
echo "X-Forwarded-For  : " . ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '(absent)') . "\n";
echo "Plages chargées  : " . ($ranges ? count($ranges['v4']) . ' IPv4, ' . count($ranges['v6']) . ' IPv6 (' . ($ranges['generated'] ?? '?') . ')' : 'NON (lancez npm run geo)') . "\n";
echo "Reconnue en France : " . ($ranges ? (navlb_ip_in_ranges($ip, $ranges) ? 'OUI' : 'NON') : '?') . "\n";
