// Services externes de la navigation libre (poids lourd / bus).
// Les adresses saisies partent vers la Géoplateforme (IGN) ; le départ et la destination vers le serveur d'itinéraires.
export const CONFIG = {
  // API de géocodage de l'État (Géoplateforme, IGN) : https://data.geopf.fr/geocodage
  geocodeUrl: 'https://data.geopf.fr/geocodage/search',
  // Moteur d'itinéraires Valhalla. Instance publique de FOSSGIS (usage léger, sans garantie) :
  // pour un usage soutenu, installez votre propre Valhalla ou utilisez un hébergeur, et changez cette adresse.
  routeUrl: 'https://valhalla1.openstreetmap.de/route',
};
