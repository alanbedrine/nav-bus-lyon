<?php
// Fonctions du filtre « France uniquement » (sans module GeoIP : liste de plages d'adresses IP).

/** Vrai si l'IP appartient à l'une des plages [début, fin] (triées). */
function navlb_ip_in_ranges(string $ip, array $ranges): bool
{
    $packed = @inet_pton($ip);
    if ($packed === false) {
        return false;
    }
    if (strlen($packed) === 16 && substr($packed, 0, 12) === "\0\0\0\0\0\0\0\0\0\0\xff\xff") {
        $packed = substr($packed, 12); // IPv4 présentée en IPv6 (::ffff:a.b.c.d)
    }
    if (strlen($packed) === 4) {
        $list = $ranges['v4'] ?? [];
        $key = unpack('N', $packed)[1]; // entier non signé sur PHP 64 bits
    } else {
        $list = $ranges['v6'] ?? [];
        $key = bin2hex($packed);
    }
    $lo = 0;
    $hi = count($list) - 1;
    while ($lo <= $hi) {
        $mid = ($lo + $hi) >> 1;
        [$start, $end] = $list[$mid];
        if ($key < $start) {
            $hi = $mid - 1;
        } elseif ($key > $end) {
            $lo = $mid + 1;
        } else {
            return true;
        }
    }
    return false;
}

/** Agents utilisateurs de robots (ou absents). */
function navlb_is_bot(string $ua): bool
{
    if ($ua === '') {
        return true;
    }
    return (bool) preg_match(
        '/bot|crawl|spider|slurp|archive|preview|fetch|scrap|headless|phantom|selenium|puppeteer|playwright|python|curl|wget|httpclient|okhttp|java\/|go-http|libwww|axios|node-fetch|gptbot|claude|anthropic|ccbot|bytespider|petalbot|ahrefs|semrush|mj12|dotbot|yandex|baidu|duckduck|applebot|perplexity|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|discord|google-extended|googleother/i',
        $ua
    );
}
