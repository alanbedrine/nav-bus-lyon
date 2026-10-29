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
- **Aucun robot, aucun référencement** (`.htaccess`, `robots.txt`, `noindex`).

## Démarrage

```bash
npm install            # uniquement pour Leaflet (déjà copié dans vendor/)
npm run data           # (facultatif) met à jour data/ depuis data.gouv.fr
npm test               # tests du moteur de navigation et de la normalisation
npm run serve          # http://localhost:8080
```

L'appli est 100 % statique (aucun build). La géolocalisation exige **HTTPS** (ou `localhost`) :
déployez le dossier sur Cloudflare Pages, Netlify, Vercel, etc. (GitHub Pages sur dépôt privé demande un compte payant).

## Hébergement (Apache mutualisé, ex. Infomaniak)

Aucun npm, aucun PHP : **envoyez simplement les fichiers par FTP/SFTP à la racine du site** (le dossier `data/` contient déjà les lignes et les arrêts) :
`.htaccess`, `robots.txt`, `index.html`, `sw.js`, `manifest.webmanifest`, `css/`, `js/`, `vendor/`, `icons/`, `data/`.
Les dossiers `scripts/`, `tests/`, `node_modules/`, `.git`, `.github` et les fichiers `package*.json`, `README.md` n'ont pas besoin d'être envoyés (et sont de toute façon refusés par `.htaccess`).

Activez le **HTTPS** (certificat gratuit chez l'hébergeur) : la géolocalisation ne fonctionne pas sans.

Protection (`.htaccess` + `robots.txt`) :
- les robots et outils automatiques (agent utilisateur vide ou connu : moteurs de recherche, IA, outils de téléchargement) reçoivent un 403 ;
- `robots.txt` interdit tout, robots d'IA compris ; `index.html` porte `noindex, nofollow` et chaque réponse `X-Robots-Tag: noindex…` ;
- en-têtes de sécurité (`nosniff`, `no-referrer`, géolocalisation limitée au site).

Limites : `robots.txt` n'est respecté que par les robots honnêtes, et un robot qui se fait passer pour un navigateur n'est pas détecté ; ne partagez pas l'adresse publiquement.
Il n'y a **pas de restriction par pays**.

## Données

Deux jeux publics (sans compte) de data.gouv.fr, tous deux du SYTRAL / TCL :
[tracés des lignes de bus](https://www.data.gouv.fr/datasets/lignes-de-bus-du-reseau-transports-en-commun-lyonnais) et
[points d'arrêt](https://www.data.gouv.fr/datasets/points-darret-du-reseau-transports-en-commun-lyonnais).

Les données sont **déjà générées** dans `data/` (état au 29/10/2026). Pour les mettre à jour (facultatif, nécessite Node.js) :

```bash
npm run data                                            # télécharge les deux jeux
npm run data -- --lines=lignes.zip --stops=arrets.zip   # ou depuis des fichiers locaux (shapefile .zip ou GeoJSON)
```

`scripts/fetch-data.mjs` reprojette (Lambert-93 -> WGS84), garde les tracés en service aujourd'hui (famille BUS, hors tracés expirés ou pas encore ouverts),
chaîne les morceaux de géométrie, simplifie à 2 m, rattache à chaque tracé les arrêts de la ligne situés à moins de 30 m (dans l'ordre du tracé, bon sens A/R)
et écrit un fichier par ligne (`data/routes/`) plus `data/index.json`. Les couleurs viennent du champ `couleur_he`.

Contenu : 789 lignes, dont 591 scolaires (JD), 1 775 tracés. Les lignes JD n'ont pas de terminus renseigné :
ils sont déduits du nom du tracé (« 345101 ST-APPOLINAIRE>AMPLEPUIS »). Les lignes « BR… » sont les bus relais (métro, tram, funiculaire en panne).

Le workflow `.github/workflows/update-data.yml` régénère et commit les données chaque mois (ou à la demande), sans rien exécuter chez vous.

## Fonctionnement de la navigation

`js/nav.js` projette la position sur le tracé (recherche limitée à une fenêtre devant le véhicule, progression jamais en arrière) :

- hors tracé = distance > max(40 m, 1,5 × précision) pendant 3 positions → **Délocalisé** ;
- retour = distance ≤ max(30 m, précision) pendant 2 positions ;
- arrivée à moins de 40 m du terminus.

Limite de vitesse : requêtes Overpass (OSM) autour de la position, avec cache et repli ; valeur « estimée » (pastille pointillée)
quand seule la catégorie de route est connue.

## Navigation libre (poids lourd / bus)

Onglet « Navigation libre » de l'accueil. **Réservé à la navigation libre : rien de tout cela n'existe dans le suivi de ligne TCL**, qui garde son tracé fixe sans recalcul.

- **Adresse** : API de géocodage de l'État (Géoplateforme IGN, `data.geopf.fr/geocodage`), avec recherche à partir de 3 caractères, biaisée vers votre position.
- **Véhicule** : camion (PTAC 3,5 à 44 t ou valeur libre) ou bus / autocar (modèles types), hauteur, largeur, longueur, charge à l'essieu, matières dangereuses, péages. Enregistré sur l'appareil (localStorage). Les gabarits proposés sont indicatifs : le conducteur saisit ceux de son véhicule.
- **Itinéraire** : moteur Valhalla (profils `truck` / `bus`) qui évite les voies interdites au gabarit saisi (restrictions OpenStreetMap : poids, hauteur, largeur, longueur, essieu, accès poids lourds). Recalcul automatique si vous sortez de l'itinéraire (après 8 s).
- **Avertissements** : message « téléphone au volant » avant tout lancement de navigation (TCL et libre) ; en navigation libre, rappel que les panneaux prévalent et que les données peuvent être erronées, affiché dans l'aperçu et avant le départ. ZFE / Crit'Air, arrêtés temporaires et horaires de livraison ne sont **pas** pris en compte.
- **Temps de conduite** : choix RSE ou RSN, bouton « Début / Fin de service » (équivalent d'insertion de la carte), pause détectée automatiquement après 2 min à l'arrêt (0 km/h) ou bouton « Pause conduite ». Les arrêts de moins de 2 min (feux, embouteillages) comptent comme de la conduite, par prudence. Alertes (bandeau + vibration) 30 min et 15 min avant la limite, puis à la limite.
  - **RSE** : règlement (CE) 561/2006 : 4 h 30 → pause de 45 min (ou 15 puis 30 min), 9 h par jour (10 h deux fois par semaine), 56 h par semaine, 90 h sur deux semaines, repos journalier 11 h (réduit 9 h, 3 fois max).
  - **RSN** : seuils **modifiables**, pré-remplis avec ceux du RSE. Ils n'ont pas été vérifiés : à adapter à votre convention et à votre type de service.
  - Non suivis : repos hebdomadaire, repos fractionné 3 h + 9 h, compensations. Indicatif seulement : ne remplace pas le chronotachygraphe.
- Les compteurs sont calculés sur ce téléphone avec le GPS ; ils s'arrêtent si l'appli est fermée (elle suppose que le dernier état continue).

### Services externes (à vérifier avant mise en production)

Modifiez `js/config.js` pour changer d'API :

- `geocodeUrl` : géocodage Géoplateforme (gratuit, sans clé).
- `routeUrl` : par défaut l'instance publique Valhalla de FOSSGIS (`valhalla1.openstreetmap.de`), **sans garantie de disponibilité ni d'usage intensif**. Pour une vraie exploitation, installez votre propre Valhalla (ou un hébergeur d'itinéraires) et autorisez CORS pour votre domaine. Ces deux services n'ont pas pu être testés en conditions réelles depuis l'environnement de développement (tests avec réponses simulées).
- Les adresses saisies, votre position de départ et la destination sont envoyées à ces services. Rien n'est envoyé à nav Lyon bus lui-même.
- La limitation de vitesse affichée est celle des véhicules légers (pas de limite poids lourd).

## Limites connues

- Pas d'horaires : l'appli suit le tracé et annonce les arrêts, mais ne dit pas si vous êtes en avance ou en retard.
- iOS Safari : le Wake Lock n'est fiable qu'à partir d'iOS 16.4 / 18.4 en mode « écran d'accueil ».
- Après modification du code, incrémentez `VERSION` dans `sw.js` pour invalider le cache.

Fonds de carte © OpenStreetMap © CARTO. Données lignes : TCL / SYTRAL Mobilités, Grand Lyon (open data).
