# Contribuer à nav Lyon bus

Merci ! Tout le monde peut proposer une amélioration. Les modifications sont relues et validées par les mainteneurs (Unidrine) avant d'être publiées.

## Signaler un problème

Ouvrez un ticket : **Issues → New issue** (ou le bouton « Signaler un bug » dans l'appli, menu ⓘ). Choisissez le modèle :

- **Bug** : ligne ou adresse concernée, téléphone et navigateur, ce qui s'est passé / ce qui était attendu, capture d'écran.
- **Idée / amélioration**.
- **Nouveau réseau de transport** : voir [docs/AJOUTER_UN_RESEAU.md](docs/AJOUTER_UN_RESEAU.md).

Ne publiez aucune information personnelle : les tickets sont publics.

## Proposer une modification (Pull Request)

1. Faites un *fork* du dépôt, puis une branche : `git checkout -b fix/ligne-106`.
2. Installez et testez : `npm install` puis `npm test` (aucun outil de build : l'appli est du JavaScript natif).
3. Lancez en local : `npm run serve` et ouvrez sur un téléphone (HTTPS requis pour le GPS, `localhost` suffit sur le même appareil).
4. Gardez les changements ciblés, ajoutez un test quand c'est de la logique (`tests/`), mettez à jour la doc si besoin.
5. Ouvrez la Pull Request en remplissant le modèle. Un mainteneur la relira ; l'intégration continue doit être verte.

### Règles du projet

- Pas de dépendance ni de build supplémentaires sans discussion : l'hébergement est un simple Apache mutualisé.
- Pas de clé d'API dans le code ni dans les captures. Les clés éventuelles vont dans `js/config.js` de **votre** déploiement.
- Les données des lignes (`data/`) sont **générées** : ne les modifiez pas à la main, corrigez `js/normalize.js` ou signalez la source.
- Rédigez les textes affichés en français clair, pour des conducteurs.
- La navigation « ligne TCL » reste à tracé fixe, sans recalcul ; la navigation libre est séparée (`js/freenav.js`).

## Valider et publier (mainteneurs)

Fusionner dans `main` ne met pas en ligne automatiquement. Après validation : récupérer `main`, lancer `npm test`, puis envoyer le dossier
(voir README, « Hébergement ») sur l'hébergement. Augmenter `VERSION` dans `sw.js` à chaque publication pour rafraîchir les téléphones.
