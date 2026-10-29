// Réglages de l'application et des services externes. Modifiez ce fichier pour changer de fournisseur.
export const APP_VERSION = '0.4.0';

export const CONFIG = {
  // Dépôt GitHub public du projet (signalement de bugs, contributions). À remplacer par l'adresse réelle.
  repoUrl: 'https://github.com/alanbedrine/nav-bus-lyon',

  // Fond de carte (tuiles raster). Par défaut : tuiles standard d'OpenStreetMap, sans clé.
  // Politique d'usage : https://operations.osmfoundation.org/policies/tiles/ (usage interactif raisonnable, pas de préchargement,
  // sans garantie). Pour une forte audience, prenez un fournisseur dédié (avec ou sans clé) et remplacez l'URL ci-dessous, par ex. :
  //   MapTiler : 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=VOTRE_CLE'
  //   Stadia   : 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key=VOTRE_CLE'
  //   Thunderforest : 'https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=VOTRE_CLE'
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileSubdomains: 'abc',
  tileMaxZoom: 19,
  // Mode sombre : si tileUrlDark est vide, les tuiles claires sont assombries par un filtre CSS.
  tileUrlDark: '',
  tileAttribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">contributeurs OpenStreetMap</a>',

  // API de géocodage de l'État (Géoplateforme, IGN) : https://data.geopf.fr/geocodage
  geocodeUrl: 'https://data.geopf.fr/geocodage/search',

  // Moteur d'itinéraires Valhalla (navigation libre). Instance publique FOSSGIS : usage léger, sans garantie.
  // Pour une exploitation soutenue, hébergez votre propre Valhalla et changez cette adresse.
  routeUrl: 'https://valhalla1.openstreetmap.de/route',
};
