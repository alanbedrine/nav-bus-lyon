# Mettre le dépôt en ligne et le configurer (mainteneurs)

Objectif : dépôt **public** (tout le monde peut télécharger, signaler, proposer), mais **rien n'est fusionné sans votre validation**.

## 1. Créer le dépôt et envoyer le code

1. Sur GitHub : **New repository** → nom `nav-lyon-bus`, propriétaire = votre compte ou l'organisation Unidrine, **Public**, sans README ni licence (ils existent déjà).
2. Dans le dossier du projet (celui qui contient `.git`) :
   ```bash
   git remote add origin https://github.com/VOTRE-COMPTE/nav-lyon-bus.git
   git branch -M main
   git push -u origin main
   ```
   (avec l'outil `gh` : `gh repo create VOTRE-COMPTE/nav-lyon-bus --public --source=. --push`)
3. Remplacez `OWNER` par votre compte/organisation dans **trois** fichiers, puis poussez :
   - `js/config.js` : `repoUrl` (utilisé par les liens « Signaler un bug » de l'appli) ;
   - `.github/CODEOWNERS` : `* @votre-compte` (ou `@organisation/equipe`) ;
   - `.github/ISSUE_TEMPLATE/config.yml` : lien des signalements de sécurité.

   Avant de rendre public, vérifiez qu'aucun secret n'est dans le dépôt (il n'y en a pas : pas de clé d'API, pas de mot de passe FTP).

## 2. Protéger la branche principale (validation obligatoire)

**Settings → Rules → Rulesets → New branch ruleset** (ou *Branches → Add classic branch protection rule*) sur `main` :

- Require a pull request before merging, **1 approbation minimum**, *Require review from Code Owners* ;
- Require status checks to pass : sélectionnez **Tests** (workflow `ci.yml`, il apparaît après un premier lancement) ;
- Block force pushes, Restrict deletions ;
- (facultatif) *Do not allow bypassing* si vous voulez vous appliquer les mêmes règles.

## 3. Réglages utiles

- **Settings → Actions → General** : *Fork pull request workflows* → « Require approval for first-time contributors » ; *Workflow permissions* → « Read repository contents » par défaut ; cochez *Allow GitHub Actions to create and approve pull requests* (pour la mise à jour mensuelle des données).
- **Settings → General → Features** : activer *Issues* (obligatoire pour les signalements) ; *Discussions* si vous voulez un espace de questions.
- **Settings → Code security** : activer *Private vulnerability reporting* et *Dependabot alerts*.
- **Labels** : créez `bug`, `enhancement`, `réseau`, `good first issue` (les modèles les appliquent s'ils existent).
- **Settings → General → Social/About** : description, site, sujets (`pwa`, `transport`, `lyon`, `gps`).

## 4. Publier une nouvelle version sur le site

La fusion dans `main` ne déploie rien. Pour mettre à jour le site (Infomaniak) :

1. `git pull` sur `main`, `npm ci && npm test`.
2. Augmentez `VERSION` dans `sw.js` (et `APP_VERSION` dans `js/config.js`) pour rafraîchir les téléphones.
3. Envoyez par FTP : `.htaccess`, `robots.txt`, `index.html`, `sw.js`, `manifest.webmanifest`, `css/`, `js/`, `vendor/`, `icons/`, `data/`.

(Un déploiement automatique par FTP depuis GitHub Actions est possible, avec les identifiants stockés dans *Settings → Secrets*, jamais dans le code.)

## 5. Données

Le workflow *Mise à jour des données TCL* tourne le 1er de chaque mois et ouvre une Pull Request si les tracés ou les arrêts ont changé : relisez-la (nombre de lignes, tracés étranges) avant de fusionner. Il peut aussi être lancé à la main (*Actions → Mise à jour des données → Run workflow*).

## 6. Licence

Le code est sous **MIT** : tout le monde, y compris une autre entreprise, peut le réutiliser, même commercialement, en conservant la mention de licence.
Si vous préférez qu'une version modifiée exploitée en ligne doive aussi publier ses modifications, remplacez `LICENSE` par l'**AGPL-3.0** ; si vous voulez interdire l'usage commercial par des tiers, une licence « source disponible » non commerciale convient mieux, mais le dépôt n'est alors plus « open source » au sens strict.
Les contributeurs acceptent que leur code soit publié sous la licence du dépôt (mentionné dans la Pull Request).
