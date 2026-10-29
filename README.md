# nav Lyon bus

Navigation « suivi de ligne » pour les bus TCL (Lyon), en PWA mobile. Rouge et noir.

- Toutes les lignes de bus TCL, **scolaires JD comprises** (hors métro, tramway et funiculaire), aux couleurs des lignes, sans compte. Filtre Toutes / Lignes / Scolaires.
- Arrêts de chaque ligne et **prochain arrêt** pendant la navigation.
- Localisation **obligatoire** : sans elle, un écran bloque l'appli avec un bouton « Redemander la localisation ».
- Recherche par numéro de ligne ou par terminus, choix du terminus de destination, confirmation, puis navigation.
- Le tracé est **fixe** : aucun recalcul. Si le véhicule s'en écarte, la bannière **Délocalisé** s'affiche jusqu'au retour sur le tracé.
- **Retournement** (repart dans l'autre sens) et **Terminer**.
- Vitesse actuelle (GPS) et limitation de vitesse (OpenStreetMap), écran maintenu allumé (Wake Lock).
- Installable (manifest + service worker) : « Ajouter à l'écran d'accueil ».
- **Reprise** : un cookie technique de 3 h (`navlb_session`, ligne + sens, prolongé pendant la navigation, effacé à « Terminer ») relance la navigation si l'on ferme puis rouvre l'appli.
- **Thème clair / sombre** (boutons dans l'accueil et en navigation, mémorisé), fond de carte assorti.
- **Mobiles et tablettes uniquement** : sur PC, une page explicative remplace l'appli (`js/guard.js`, agent utilisateur + taille d'écran).
- **France uniquement, aucun robot, aucun référencement** : voir « Protection » ci-dessous.

## Démarrage

```bash
npm install            # uniquement pour Leaflet (déjà copié dans vendor/)
npm run data           # télécharge les lignes TCL -> data/index.json + data/routes/*.json
npm test               # tests du moteur de navigation et de la normalisation
npm run serve          # http://localhost:8080
```

L'appli est 100 % statique (aucun build). La géolocalisation exige **HTTPS** (ou `localhost`) :
déployez le dossier sur Cloudflare Pages, Netlify, Vercel, etc. (GitHub Pages sur dépôt privé demande un compte payant).

## Hébergement et protection (France uniquement, anti-bots, non référencé)

L'appli est statique ; la protection dépend de l'hébergeur.

### Option A — hébergement mutualisé Apache + PHP 8.1 ou plus (Infomaniak…)

`.htaccess` envoie **toutes** les requêtes à `gate.php`, qui :
1. refuse (403) les robots (agent utilisateur de robot ou vide) ;
2. refuse (403) les adresses IP qui ne sont pas dans les plages **françaises** (`geo/fr-ranges.php`, tiré du registre public RIPE NCC) ;
3. sert ensuite le fichier demandé (seuls `index.html`, `sw.js`, `manifest.webmanifest`, `robots.txt`, `css/ js/ vendor/ icons/ data/` sont accessibles ; `geo/`, `*.php`, `scripts/`, `tests/`… ne le sont jamais), avec `X-Robots-Tag: noindex` et cache `ETag`/`304`.

`robots.txt` reste lisible directement (interdit tout, robots d'IA compris) et `index.html` porte `noindex, nofollow`.

Mise en place :

```bash
npm run geo            # génère geo/fr-ranges.php (téléchargement RIPE NCC) — à relancer de temps en temps
npm run data           # génère data/ (lignes + arrêts)
```

Puis envoyez par FTP/SFTP à la racine du site : `.htaccess`, `gate.php`, `geo-test.php`, `robots.txt`, `index.html`, `sw.js`, `manifest.webmanifest`, `css/`, `js/`, `vendor/`, `icons/`, `data/`, `geo/`.

1. Ouvrez `https://votre-site/geo-test.php` **depuis votre téléphone en 4G/5G** : il affiche l'adresse IP vue par le serveur et « Reconnue en France : OUI ». Si l'IP affichée est celle d'un relais de l'hébergeur et non la vôtre, passez `trust_forwarded_for` à `true` dans `geo/config.php`.
2. **Supprimez `geo-test.php`** une fois le test fait.
3. Mettez en HTTPS (certificat Let's Encrypt gratuit chez l'hébergeur) : la géolocalisation l'exige.

Réglages dans `geo/config.php` : `allow_ips` (adresses toujours autorisées, par exemple pour tester depuis l'étranger).
Sans `geo/fr-ranges.php`, le site répond 503 (il ne s'ouvre jamais « par défaut »).

### Option B — Cloudflare Pages

`functions/_middleware.js` fait le même travail avec le pays fourni par Cloudflare (`ALLOW_ALL=1` pour le développement). `_headers` pose les en-têtes.

### Limites

- Le filtre par plages d'adresses suit le pays d'enregistrement des adresses : un visiteur en France via un VPN étranger est refusé, un VPN français contourne le filtre.
- `robots.txt` n'est respecté que par les robots honnêtes (d'où le blocage par agent utilisateur) ; ne partagez pas l'adresse publiquement.
- Le service worker garde l'appli en cache sur l'appareil : elle reste ouverte hors ligne, même si l'on part à l'étranger.

## Données

Deux jeux publics (sans compte) de data.gouv.fr, tous deux du SYTRAL / TCL :
[tracés des lignes de bus](https://www.data.gouv.fr/datasets/lignes-de-bus-du-reseau-transports-en-commun-lyonnais) et
[points d'arrêt](https://www.data.gouv.fr/datasets/points-darret-du-reseau-transports-en-commun-lyonnais).

```bash
npm run data                                   # télécharge les deux jeux
npm run data -- --lines=lignes.zip --stops=arrets.zip   # ou depuis des fichiers locaux (shapefile .zip ou GeoJSON)
```

`scripts/fetch-data.mjs` reprojette (Lambert-93 -> WGS84), garde les tracés en service aujourd'hui (famille BUS, hors tracés expirés ou pas encore ouverts),
chaîne les morceaux de géométrie, simplifie à 2 m, rattache à chaque tracé les arrêts de la ligne situés à moins de 30 m (dans l'ordre du tracé, bon sens A/R)
et écrit un fichier par ligne (`data/routes/`) plus `data/index.json`. Les couleurs viennent du champ `couleur_he`.

Contenu au 29/10/2026 : 789 lignes, dont 591 scolaires (JD), 1 775 tracés. Les lignes JD n'ont pas de terminus renseigné :
ils sont déduits du nom du tracé (« 345101 ST-APPOLINAIRE>AMPLEPUIS »). Les lignes « BR… » sont les bus relais (métro, tram, funiculaire en panne).

Le workflow `.github/workflows/update-data.yml` régénère et commit les données chaque mois (ou à la demande).

## Fonctionnement de la navigation

`js/nav.js` projette la position sur le tracé (recherche limitée à une fenêtre devant le véhicule, progression jamais en arrière) :

- hors tracé = distance > max(40 m, 1,5 × précision) pendant 3 positions → **Délocalisé** ;
- retour = distance ≤ max(30 m, précision) pendant 2 positions ;
- arrivée à moins de 40 m du terminus.

Limite de vitesse : requêtes Overpass (OSM) autour de la position, avec cache et repli ; valeur « estimée » (pastille pointillée)
quand seule la catégorie de route est connue.

## Limites connues

- Pas d'horaires : l'appli suit le tracé et annonce les arrêts, mais ne dit pas si vous êtes en avance ou en retard.
- iOS Safari : le Wake Lock n'est fiable qu'à partir d'iOS 16.4 / 18.4 en mode « écran d'accueil ».
- Après modification du code, incrémentez `VERSION` dans `sw.js` pour invalider le cache.

Fonds de carte © OpenStreetMap © CARTO. Données lignes : TCL / SYTRAL Mobilités, Grand Lyon (open data).
