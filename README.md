# nav-tcl

Navigation « suivi de ligne » pour les bus TCL (Lyon), en PWA mobile. Rouge et noir.

- Toutes les lignes TCL **hors métro, tramway et funiculaire** (bus, trolleybus…), sans compte.
- Localisation **obligatoire** : sans elle, un écran bloque l'appli avec un bouton « Redemander la localisation ».
- Recherche par numéro de ligne ou par terminus, choix du terminus de destination, confirmation, puis navigation.
- Le tracé est **fixe** : aucun recalcul. Si le véhicule s'en écarte, la bannière **Délocalisé** s'affiche jusqu'au retour sur le tracé.
- **Retournement** (repart dans l'autre sens) et **Terminer**.
- Vitesse actuelle (GPS) et limitation de vitesse (OpenStreetMap), écran maintenu allumé (Wake Lock).
- Installable (manifest + service worker) : « Ajouter à l'écran d'accueil ».

## Démarrage

```bash
npm install            # uniquement pour Leaflet (déjà copié dans vendor/)
npm run data           # télécharge les lignes TCL -> data/index.json + data/routes/*.json
npm test               # tests du moteur de navigation et de la normalisation
npm run serve          # http://localhost:8080
```

L'appli est 100 % statique (aucun build). La géolocalisation exige **HTTPS** (ou `localhost`) :
déployez le dossier sur Cloudflare Pages, Netlify, Vercel, etc. (GitHub Pages sur dépôt privé demande un compte payant).

## Données

`scripts/fetch-data.mjs` interroge le WFS du Grand Lyon (couche `sytral:tcl_sytral.tcllignebus`), exclut A/B/C/D, F1/F2, T*, RX,
chaîne les morceaux de géométrie, simplifie à 2 m et écrit un fichier par ligne.

> ⚠️ Ce script n'a pas pu être exécuté sur les vraies données lors de la création du projet (réseau bloqué).
> Au premier lancement, vérifiez :
> 1. que le nombre de lignes est plausible (le script affiche des exemples) ;
> 2. que le sens `Aller`/`Retour` correspond bien au sens de dessin du tracé (départ = origine) ;
> 3. que les noms de champs (`ligne`, `sens`, `nom_origine`, `nom_destination`, `couleur`) sont ceux de la couche
>    (adaptez `js/normalize.js` si besoin). Vous pouvez aussi passer `--url=` ou `--file=`.

Le workflow `.github/workflows/update-data.yml` régénère et commit les données chaque mois (ou à la demande).

## Fonctionnement de la navigation

`js/nav.js` projette la position sur le tracé (recherche limitée à une fenêtre devant le véhicule, progression jamais en arrière) :

- hors tracé = distance > max(40 m, 1,5 × précision) pendant 3 positions → **Délocalisé** ;
- retour = distance ≤ max(30 m, précision) pendant 2 positions ;
- arrivée à moins de 40 m du terminus.

Limite de vitesse : requêtes Overpass (OSM) autour de la position, avec cache et repli ; valeur « estimée » (pastille pointillée)
quand seule la catégorie de route est connue.

## Limites connues

- Pas d'arrêts ni d'horaires (couche de tracés uniquement) : l'appli suit le tracé, elle n'annonce pas les arrêts.
- iOS Safari : le Wake Lock n'est fiable qu'à partir d'iOS 16.4 / 18.4 en mode « écran d'accueil ».
- Après modification du code, incrémentez `VERSION` dans `sw.js` pour invalider le cache.

Fonds de carte © OpenStreetMap © CARTO. Données lignes : TCL / SYTRAL Mobilités, Grand Lyon (open data).
