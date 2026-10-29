# Ajouter un réseau de transport

Aujourd'hui l'appli ne charge que le réseau TCL (Lyon), mais les données sont simples et ouvertes, donc un autre réseau peut être ajouté.

## Format attendu

`data/index.json` :

```json
{ "lines": [ { "id": "106", "file": "106", "color": "#312783", "scolaire": false, "terminus": ["Ste-Foy Place Saint Luc", "Gare d'Oullins"] } ] }
```

`data/routes/<file>.json` :

```json
{ "id": "106", "color": "#312783", "variants": [ {
  "key": "106-3", "tag": "", "origin": "Ste-Foy Place Saint Luc", "destination": "Gare d'Oullins", "sens": "Aller",
  "coords": [[45.7488, 4.8008], [45.7487, 4.8010]],
  "stops": [["Ste-Foy Place Saint Luc", 45.7488, 4.8008, 1]] } ] }
```

- `coords` : tracé en `[latitude, longitude]` dans l'ordre de parcours ; `stops` : `[nom, latitude, longitude, accessible PMR 0/1]`, dans l'ordre.
- Un tracé par sens (aller et retour sont deux variantes).

## Comment faire

1. Trouvez les données ouvertes du réseau : tracés des lignes et arrêts (GTFS `shapes.txt` / `stops.txt`, ou shapefile / GeoJSON open data).
2. Adaptez `js/normalize.js` et `scripts/fetch-data.mjs` (ils transforment actuellement le shapefile TCL) ou écrivez un script équivalent qui produit le format ci-dessus.
3. Ouvrez un ticket « Nouveau réseau » avec le lien des données et leur licence. Une Pull Request est la bienvenue.
4. Tant que l'appli ne gère qu'un réseau à la fois, un nouveau réseau demandera aussi un sélecteur de réseau dans l'interface : à discuter dans le ticket.

Vérifiez toujours que la licence des données autorise la réutilisation et indiquez la source dans `NOTICE.md`.
