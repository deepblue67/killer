# Dossier Killer — README de reprise et de maintenance

> **À lire avant toute intervention.** Ce document doit être mis à jour à
> chaque modification fonctionnelle, visuelle ou technique de l'application.
> Si tu (humain ou IA) modifies le code sans mettre ce fichier à jour, le
> prochain repreneur du projet perdra du temps à redécouvrir ce qui a changé.

Dernière mise à jour de ce document : correspond à la version d'application
**20260722181500**.

---

## 1. C'est quoi, ce projet ?

Une web app autonome (aucun serveur, aucun compte) qui gère une partie de
**Killer** (jeu d'élimination façon "chacun a une cible secrète à
éliminer") pendant un séjour de vacances entre adultes, avec des arrivées
de joueurs échelonnées dans le temps (ex: 13 joueurs, puis +1, puis +2).

Elle tourne entièrement dans le navigateur : pas de backend, pas de base de
données distante. Toutes les données (roster de joueurs, parties, banque de
défis, thème, code PIN...) sont stockées en **`localStorage`**, propre à
chaque combinaison navigateur + appareil.

### Fichiers du projet (tous à la racine du dépôt GitHub)

| Fichier | Rôle |
|---|---|
| `killer.html` | L'application entière : HTML + CSS + JS, un seul fichier. C'est le fichier à modifier pour 95% des évolutions. |
| `index.html` | Redirection automatique vers `killer.html`, pour que l'URL racine du site (`https://.../`) fonctionne (GitHub Pages sert `index.html` par défaut). |
| `service-worker.js` | Gère le cache offline et la détection de nouvelle version. Contient `CACHE_VERSION`. |
| `manifest.json` | Métadonnées PWA (nom, icônes, couleur) pour l'ajout à l'écran d'accueil iOS/Android. |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `favicon-32.png` | Icônes de l'app (visuel "tampon TOP SECRET"), générées depuis un SVG via `rsvg-convert`. |

**Important** : le nom de fichier `killer.html` est en dur dans
`manifest.json` (`start_url`) et dans `service-worker.js`
(`ASSETS_TO_CACHE` et le fallback offline). Si on renomme à nouveau le
fichier principal, il faut mettre à jour ces deux références (voir section
9 — historique des incidents).

---

## 2. Comment déployer / mettre à jour

1. Le dépôt GitHub héberge ces fichiers via **GitHub Pages**, tous à la
   racine (pas de sous-dossier).
2. Après toute modification, **incrémenter la version** (voir section 3)
   dans `killer.html` (`APP_VERSION`) ET `service-worker.js`
   (`CACHE_VERSION`) — les deux doivent toujours être identiques.
3. Pousser les fichiers modifiés sur GitHub. Vérifier dans Settings →
   Pages que le déploiement a bien un ✅ récent (ça peut prendre 1-2
   minutes après le push).
4. Sur les appareils qui ont déjà l'app ouverte/installée : le service
   worker détecte la nouvelle version et affiche un bandeau
   *"🔄 Nouvelle version disponible"* en bas de l'écran. Un tap dessus
   recharge l'app avec la nouvelle version. Sans ce clic, l'ancienne
   version cachée continue de s'afficher.

### Si la version affichée ne change pas après un déploiement

1. Vérifier que le déploiement GitHub Pages est bien terminé (point 3
   ci-dessus).
2. Un onglet déjà ouvert ne réexécute pas son JS tant qu'il n'est pas
   rechargé : sur iOS, il faut **fermer complètement** l'app depuis le
   sélecteur multitâche (pas juste la mettre en arrière-plan), pas
   seulement y revenir.
3. Le `fetch()` du service worker force `{cache:'no-store'}` (voir
   section 7) et l'enregistrement se fait avec `{updateViaCache:
   'none'}` + un appel explicite à `reg.update()` au chargement et à
   chaque retour au premier plan (`visibilitychange`) — ces deux
   protections ont été ajoutées après un incident où la version restait
   bloquée sur l'ancienne, probablement à cause du cache HTTP du
   navigateur qui court-circuitait la logique "réseau d'abord". Si le
   problème revient malgré tout, c'est probablement encore une histoire
   de cache HTTP/CDN (GitHub Pages ou navigateur) plutôt qu'un bug de
   l'app elle-même.

## 3. Système de version

- Format : `AAAAMMJJHHMMSS` (ex: `20260722181500` = 22 juillet 2026,
  18h15min00s).
- Deux constantes à garder synchronisées à chaque changement :
  - `const APP_VERSION = '...'` en haut du `<script>` dans `killer.html`.
  - `const CACHE_VERSION = '...'` en haut de `service-worker.js`.
- La version s'affiche dans l'app : onglet **Réglages → Version**.
- C'est Claude/l'assistant qui gère cette version à chaque itération —
  l'utilisateur n'a pas à y penser.

## 4. Modèle de données (`state`)

Tout est contenu dans un unique objet JS `state`, sérialisé en JSON dans
`localStorage` sous la clé `killer-montagne-state-v2`.

```js
state = {
  roster: [{id, name}],              // Liste globale des joueurs potentiels
  nextRosterId: 1,
  games: [ Game ],                   // Historique de toutes les parties (jamais purgé sauf suppression manuelle)
  nextGameId: 1,
  nextPlayerSeq: 1,                  // Compteur global d'IDs de joueurs "en partie" (uniques même entre parties)
  currentGameId: null,               // Quelle partie est actuellement "ouverte" dans les onglets
  missionBank: [{id, text, enabled}],// Banque de défis, éditable
  nextMissionId: 0,
  missionBankVersion: 0,             // Sert à migrer automatiquement la banque par défaut (voir section 6)
  theme: 'foret',                    // Clé dans THEMES
  pin: '',                           // Code PIN protégeant l'onglet "Vue d'ensemble"
  lastExportAt: null                 // epoch ms du dernier export réussi
}
```

### Objet `Game`

```js
{
  id, title,
  players: [Player],
  targets: {playerId: targetPlayerId},   // La chaîne d'éliminations en cours
  log: [{text, ts, epoch}],              // Journal humain, plus récent en premier (unshift)
  eliminationCounter: 0,                 // Incrémenté à chaque kill, sert de tiebreak "survécu le plus longtemps"
  eliminationEvents: [{mission, epoch, killerName, victimName}], // Historique structuré pour le Bilan de fin de partie
  lastElimination: {...} | null,         // Snapshot pour permettre "Annuler la dernière élimination"
  started: bool,
  createdAt: epoch
}
```

### Objet `Player` (dans `game.players`)

```js
{
  id, name, alive: bool,
  mission: "texte du défi en cours",
  kills: 0,
  penalties: 0,          // Nombre de fois où ce joueur a changé de défi (coûte 1 point chacun)
  eliminatedAt: N,        // Position dans l'ordre des éliminations (undefined si vivant)
  lastTargetId: id,       // Sauvegardé au moment de la mort, pour le récapitulatif/undo
}
```

### Calcul du score (classement)

`score = (kills || 0) - (penalties || 0)`. Peut être négatif. Trié
décroissant, égalité départagée par la survie la plus longue
(`eliminatedAt` le plus grand, ou vivant = infini).

---

## 4bis. Page compte à rebours ("Poisy Beach 2026")

Un clic sur le 🔒 dans le titre de l'en-tête ouvre un overlay plein écran
(`#countdownOverlay`), pensé comme une page à partager/capturer d'écran
avec les amis avant le séjour :

- Titre "🔒 DOSSIER KILLER" / sous-titre `#cdSub` = **titre réel de la
  partie active** (`currentGame().title`, ou "Aucune partie en cours" si
  aucune n'est ouverte) — remplace l'ancien texte statique "POISY BEACH
  2026".
- Tampon "JOUEURS ENCORE EN VIE" + le nombre réel de joueurs vivants dans
  la partie actuellement active (`gameAlive(currentGame()).length`,
  affiche "—" si aucune partie n'est ouverte).
- Compte à rebours en direct (jours/heures/min/sec) jusqu'à
  `COUNTDOWN_TARGET = new Date(2026, 7, 1, 12, 0, 0)` (samedi 1er août
  2026, midi, heure locale de l'appareil), précédé du texte "Début de la
  Killer Party dans" (`#cdAboveLabel`). Mis à jour chaque seconde via
  `setInterval`, démarré à l'ouverture et arrêté à la fermeture pour ne
  pas tourner inutilement en arrière-plan. **Une fois l'échéance
  dépassée**, `#cdAboveLabel` se masque, les mêmes compteurs repartent
  en comptage croissant (temps écoulé depuis la cible) et le texte sous
  le compteur devient dynamique : *"Killer party commencé il y a X
  jours, Y heures, Z minutes et W secondes."* au lieu de "Que la traque
  commence".
- Couleurs **volontairement figées** (hex en dur : `#16211c`, `#e8dcc4`,
  `#a8342f`, `#c9a227`), indépendantes du thème actuellement sélectionné
  dans Réglages — c'est un visuel de communication fixe, pas un élément
  qui doit changer d'apparence si quelqu'un change le thème de l'appli.
- Fermeture via le bouton ✕ (`#countdownCloseBtn`).

Si la date ou le nom de l'événement changent un jour, modifier
`COUNTDOWN_TARGET` et le texte "POISY BEACH 2026" dans le HTML de
`#countdownOverlay`.

## 5. Tour des onglets (ordre actuel de la nav)

`Parties → Ma mission → Éliminer → Classement → Journal →
Vue d'ensemble → Défis → Réglages`

- **Parties** : créer une partie (titre + sélection dans le roster),
  gérer la partie "active" (ajouter/retirer des joueurs avant lancement,
  lancer, arrêter et recommencer), historique des parties ("Mes parties",
  masqué s'il n'y en a qu'une seule). Une seule partie peut être "en
  cours" (`started && >1 vivant`) à la fois — la création est bloquée
  sinon.
- **Ma mission** : chaque joueur consulte sa cible + son défi en privé
  (masquage auto après 7s). Bouton pour changer de défi (-1 point,
  tirage sans répétition parmi les défis cochés).
- **Défis** : banque de défis, ajout, édition (✎), suppression. Deux
  sous-onglets ("✅ Actifs" / "☐ Non actifs", variable JS `defisSubTab`,
  jamais persistée) filtrent la liste ; cocher/décocher un défi le fait
  disparaître de la liste courante puisqu'il ne correspond plus au
  filtre. Compteur contextuel ("X cochés sur Y" ou "X décochés sur Y")
  au-dessus de la liste affichée.
- **Éliminer** : sélection du chasseur, confirmation, validation de
  l'élimination (avec pop-up de confirmation). Bouton "Annuler la
  dernière élimination" si applicable.
- **Classement** : trié par score (voir section 4). Badge "Dernier
  survivant" séparé. "Bilan de fin de partie" (défi le plus utilisé,
  élimination la plus rapide, survivant le plus discret) pour les
  parties terminées.
- **Journal** : historique horodaté de la partie active, récapitulatif
  complet (qui chassait qui + défi) pour les parties terminées,
  suppression de la partie. Protégé par le même code PIN que "Vue
  d'ensemble" (voir ci-dessous).
- **Vue d'ensemble** : réservé à l'organisateur, protégé par code PIN
  (optionnel, défini dans Réglages). Se reverrouille à chaque fois qu'on
  quitte/rouvre l'onglet (jamais mémorisé). Affiche un schéma circulaire
  de la chaîne (le joueur `orderedPlayers[0]` est toujours en haut,
  sens horaire) + un tableau utilisant **le même ordre**.
- **Réglages** : guide d'utilisation, roster, thème (10 choix), code PIN
  **+ interrupteur "Activer la protection"** (voir ci-dessous),
  synchronisation (export/import JSON avec Web Share API + fallback
  téléchargement), rappel de dernier export, numéro de version, et un
  **résumé statique des règles** (carte "📋 Résumé des règles") destiné à
  être lu/relu par l'organisateur ou montré aux joueurs — contenu texte
  fixe, pas de logique JS associée, à mettre à jour manuellement si les
  règles changent (score, zones interdites, etc.).

### Protection par code PIN (Journal + Vue d'ensemble)

- `state.pin` (string) et `state.pinEnabled` (bool, défaut `true`) sont
  deux champs indépendants. La protection n'est active que si **les
  deux** conditions sont réunies : un code est défini ET l'interrupteur
  est activé. Ça permet de garder un code enregistré tout en désactivant
  temporairement la protection (ex: pendant un débrief où tout le monde
  peut regarder).
- Chaque onglet a son propre verrou **en mémoire uniquement** (jamais
  persisté) : `vueUnlocked` et `journalUnlocked`. Se déverrouiller sur
  l'un ne déverrouille pas l'autre, et les deux se reverrouillent à
  chaque fois qu'on quitte puis rouvre l'onglet correspondant (géré dans
  le gestionnaire de clic de la nav, pas dans `render()`).
- Si un troisième onglet protégé était ajouté un jour, suivre le même
  patron : un flag `xxxUnlocked` dédié, un lock screen dédié dans le
  HTML, et le reset dans le handler de clic de nav.

---

## 6. Règles de jeu importantes à connaître avant de coder dessus

- **Chaîne unique** : tous les joueurs vivants forment un seul cycle
  (A→B→C→...→A). Éliminer quelqu'un = hériter de sa cible ET de son défi
  (`killer.mission = victim.mission`).
- **Insertion des retardataires** : ajouter un joueur en cours de partie
  choisit un joueur vivant au hasard (A→B) et insère le nouveau au milieu
  (A→nouveau→B). Ça marche quel que soit l'état d'avancement de la partie.
- **Défis sans répétition** : `randomMission(excludeTexts)` tire parmi les
  défis cochés, en excluant ceux déjà utilisés dans la partie. Si la
  banque cochée est épuisée, il y a un repli qui autorise la répétition
  (avec un avertissement loggé).
- **Changement de défi (pénalité)** : `swapMission()` exclut à la fois
  les défis des autres joueurs ET le défi actuel du joueur (pour éviter
  de retomber sur le même), puis incrémente `penalties`.
- **Annulation d'élimination** : un seul niveau d'annulation (la toute
  dernière), via `game.lastElimination` (snapshot) et
  `game.eliminationEvents.pop()`.

---

## 7. Détails techniques notables

- **Aucune dépendance externe** hormis les polices Google Fonts
  (`Special Elite` + `Inter`) chargées par `<link>`. Tout le reste est du
  JS vanille, pas de framework.
- **Stockage** : `localStorage`, clé `killer-montagne-state-v2`. Fonction
  `save()` / `load()`. `load()` gère aussi les migrations de la banque de
  défis (voir `missionBankVersion`) et les valeurs par défaut manquantes
  pour les anciens états sauvegardés (rétrocompatibilité).
- **UI de confirmation** : pas de `confirm()`/`alert()` natifs du
  navigateur — remplacés par `showConfirm(message)` (retourne une
  Promise<boolean>, bandeau en bas d'écran) et `showToast(message,
  isError)` (message temporaire auto-disparaissant). Toujours utiliser
  ces deux fonctions pour toute nouvelle confirmation/notification.
- **Rendu** : une seule fonction `render()` centrale qui appelle un
  `renderXxxTab()` par onglet à chaque changement d'état. Pas de
  framework réactif — tout est réécrit en `innerHTML` à chaque appel.
  C'est volontairement simple ; si l'app grossit encore beaucoup, un vrai
  framework deviendrait pertinent, mais ce n'est pas le cas aujourd'hui.
- **Vue d'ensemble / schéma** : `buildChainSVG()` place le joueur
  d'indice 0 du tableau reçu en haut du cercle (angle `-π/2`) et les
  suivants dans le sens horaire. Le tableau de la Vue d'ensemble doit
  toujours recevoir le **même tableau ordonné** (`orderedPlayers`) que le
  schéma, pour rester cohérent visuellement.
- **Export/Import** : `navigator.share()` avec fichier si supporté
  (ouvre la feuille de partage iOS : Mail, Messages, AirDrop...), sinon
  téléchargement classique via lien `<a download>`. L'import **remplace
  entièrement** `state` (pas de fusion), après confirmation explicite.
- **Thèmes** : un objet `THEMES` avec des palettes nommées ; `applyTheme()`
  écrit les CSS custom properties (`--pine`, `--kraft`, etc.) sur
  `documentElement.style`. Ajouter un thème = ajouter une entrée à
  `THEMES` avec les mêmes clés.

---

## 8. Contenu de la banque de défis

- `DEFAULT_MISSIONS` : 93 défis (le socle initial).
- `EXTRA_MISSIONS_V2` : 30 défis ajoutés ensuite.
- `EXTRA_MISSIONS_V3` : 93 défis ajoutés ensuite.
- **Total actuel : 216 défis**, tous cochés par défaut à leur ajout.
- La migration (`load()`) ajoute automatiquement les nouveaux lots aux
  installations existantes, **sans dupliquer** (comparaison par texte
  exact) et sans toucher aux coches/modifications déjà faites par
  l'utilisateur.
- **Défis volontairement exclus** lors de la curation (pour référence si
  on nous redemande d'en ajouter depuis une liste similaire) : demandes
  ciblées par genre (ex: demander un tampon hygiénique), appeler un
  numéro de téléphone au hasard (dérange un inconnu), gifles/claques même
  légères, "se faire insulter", lien vers un site web externe tiers,
  utilisation du nom d'une vraie personnalité publique ou d'un titre de
  chanson/mot sous droits (généricisés à la place, ex: "Patrick
  Sébastien" → "une célébrité", "Baby Shark" → "une chanson entêtante
  pour enfants").
- Si on ajoute un nouveau lot de défis à l'avenir : créer
  `EXTRA_MISSIONS_V4`, l'ajouter au `.concat()` du seed initial dans
  `load()`, ET ajouter un bloc `if((state.missionBankVersion||1) < 4)`
  qui pousse les nouveaux textes non déjà présents, puis mettre
  `missionBankVersion` à jour en conséquence.

---

## 9. Historique des décisions et incidents (pour éviter de refaire les mêmes erreurs)

- **Renommage du fichier principal** : le fichier a été renommé
  `killer_maison_montagne.html` → `killer.html` par l'utilisateur sans
  prévenir l'app. Ça a cassé `manifest.json` (`start_url`) et
  `service-worker.js` (`ASSETS_TO_CACHE` + fallback offline), qui
  pointaient encore vers `index.html`. **Leçon** : si le fichier
  principal est renommé à nouveau, chercher toutes les occurrences du nom
  de fichier dans `manifest.json` et `service-worker.js` et les mettre à
  jour, et vérifier qu'un `index.html` de redirection existe toujours
  pour que l'URL racine fonctionne.
- **Stockage propre à chaque appareil** : `localStorage` n'est pas
  partagé entre iPhone/iPad — d'où la fonctionnalité d'export/import
  manuel (section Réglages). Il n'y a pas de synchronisation automatique
  en temps réel entre appareils, et ce n'est pas prévu (pas de backend).
- **Fonctionnalités proposées mais explicitement refusées par
  l'utilisateur** (ne pas les réintroduire sans qu'il les demande) :
  compteur "Jour X sur 9" / chronomètre de séjour, "Palmarès du séjour"
  agrégeant plusieurs parties. Des idées de gameplay plus poussées
  (rôles secrets, indices au lieu du nom, trêves aléatoires, immunité
  votée, "dernier geste du fantôme", défis à niveaux de difficulté) ont
  été proposées et **aucune n'a été retenue** — c'est le système de
  "changement de défi contre 1 point de pénalité" qui a été implémenté à
  la place.

---

## 10. Idées d'évolutions déjà identifiées mais non implémentées

À ne proposer que si l'utilisateur les redemande explicitement :

- Chrono / repère temporel du séjour (mis de côté par l'utilisateur).
- Palmarès agrégé sur plusieurs parties (mis de côté par l'utilisateur).
- Recherche/filtre dans le roster ou la banque de défis si elle continue
  de grossir.
- Chronomètre intégré pour les défis à contrainte de temps.
- Un deuxième niveau d'annulation (historique complet plutôt qu'un seul
  cran).
- Pouvoir retirer un joueur d'une partie déjà lancée (actuellement
  impossible, seul le retrait avant lancement est permis).

### Pistes de gameplay plus profondes (proposées, pas encore tranchées)

Ces six idées ont été proposées en réponse à "certains joueurs ne
jouent plus assez longtemps" — contrairement aux idées listées en
section 9, elles n'ont pas été explicitement refusées, juste laissées
en réflexion. À ne développer que sur demande explicite, et
idéalement après avoir demandé laquelle (ou lesquelles) l'utilisateur
préfère, plutôt que de toutes les implémenter d'un coup.

1. **Rôles secrets** — en plus de leur mission classique, certains
   joueurs tirés au sort reçoivent un rôle spécial : *Garde du corps*
   (protège discrètement quelqu'un ; si cette personne est éliminée,
   l'assassin est neutralisé à la place), *Traître* (a deux cibles à
   éliminer au lieu d'une), *Espion* (peut voir la cible d'un autre
   joueur une fois dans la partie). Casse la monotonie "un chasseur, une
   cible" et crée des retournements de situation.
2. **Indices au lieu du nom direct** — au lieu d'afficher "Ta cible :
   Julie", l'appli donne un indice ("Elle porte souvent du bleu", "Elle
   est arrivée le 2e jour") et le joueur doit deviner qui c'est avant de
   pouvoir agir. Ajoute une couche d'enquête, pas seulement d'exécution.
3. **Trêves aléatoires** — de temps en temps, l'appli déclare une
   "trêve" surprise d'une heure (in-game event) pendant laquelle
   personne ne peut éliminer. Crée du suspense sans dépendre du
   calendrier réel du séjour.
4. **Immunité votée** — une fois par jour, le groupe vote pour donner
   l'immunité à quelqu'un (façon Koh-Lanta) ; cette personne ne peut pas
   être éliminée jusqu'au prochain vote. Ajoute une dimension
   sociale/stratégique en plus du jeu individuel.
5. **Dernier geste du fantôme** — un joueur éliminé a droit à une
   dernière action avant de "vraiment" sortir du jeu : glisser un faux
   indice à quelqu'un, ou révéler (sans le vouloir) une info sur son
   ancien tueur. Garde les éliminés impliqués un peu plus longtemps.
6. **Défis à niveaux de difficulté** — chaque défi porte une étiquette
   Facile/Moyen/Difficile ; les difficiles rapportent un bonus (par
   exemple, le joueur peut échanger sa mission actuelle contre une plus
   facile une fois dans la partie, façon joker). Se combinerait
   potentiellement avec le système de pénalité de changement de défi
   déjà en place (section 6).

### Réintégrer les joueurs éliminés (proposées, pas encore tranchées)

Proposées face au constat que certains joueurs éliminés tôt décrochent
et ne jouent plus assez longtemps. Par ordre du plus léger au plus
"changement de règle" :

1. **Le sursis** (recommandation la plus simple) — plutôt que de
   réintégrer après la mort, retarder la mort elle-même : la première
   fois qu'on est éliminé, on ne meurt pas vraiment — on "survit de
   justesse" et on récupère un nouveau défi (éventuellement plus dur,
   ou avec un malus de points). La vraie élimination n'arrive qu'à la
   deuxième fois où on se fait attraper. Nécessite juste un compteur de
   "vies" par joueur (1 ou 2) ; presque aucune nouvelle règle à
   expliquer au groupe.
2. **La résurrection par vote** (façon grâce collective, la plus fun
   socialement) — une fois par jour (ou une fois pour tout le séjour),
   le groupe vote pour "gracier" un joueur éliminé de son choix. Il est
   réinséré dans la chaîne exactement comme un nouvel arrivant (même
   mécanique déjà en place — voir `addPlayerToGame`). Crée un vrai
   moment social ("qui va-t-on sauver ce soir ?").
3. **La vengeance ciblée** — un joueur éliminé garde un objectif secret :
   si la personne qui l'a tué se fait éliminer à son tour, il regagne
   quelques points de "vengeance" au classement. Il ne rejoue pas
   activement, mais garde une raison de suivre la partie de près.
4. **L'équipe fantôme** (un jeu à part, pas une résurrection) — les
   joueurs éliminés forment un petit groupe avec son propre
   mini-classement, basé sur des défis "spectateurs" (deviner qui va
   gagner, réaliser un défi comique imposé par le groupe...). Leur donne
   une occupation sans toucher à la partie principale ni à son
   équilibre.
5. **Le contrat sur la tête du tueur** (la plus complexe) — chaque
   joueur éliminé peut secrètement "commanditer" un défi bonus à
   réaliser sur son propre tueur, confié à quelqu'un encore en vie de
   son choix. Si le défi réussit, les deux gagnent un petit bonus.
   Implique les morts dans la suite du jeu sans les faire revivre
   littéralement.

Recommandation donnée à l'utilisateur au moment de la proposition :
l'option 1 (sursis) est la plus simple à greffer sur le modèle de
données actuel (`Player.kills`/`Player.penalties` existent déjà, un
champ `lives` suivrait le même principe) et résout le problème sans
ajouter de couche de règles. L'option 2 (résurrection par vote) est la
plus intéressante si l'utilisateur veut en plus un moment collectif fort
en soirée.

---

## 11. Check-list avant de livrer une modification

1. Vérifier qu'aucun `id` HTML référencé en JS (`getElementById`) n'est
   orphelin (script de vérif utilisé pendant le développement) :
   ```
   ids_used - ids_defined  # doit être vide (hors éléments créés dynamiquement : updateBanner, toastBanner, confirmBanner, confirmYes, confirmNo)
   ```
2. Utiliser `showConfirm()`/`showToast()`, jamais `confirm()`/`alert()`.
3. Incrémenter `APP_VERSION` (killer.html) et `CACHE_VERSION`
   (service-worker.js) à l'identique.
4. Mettre à jour ce README si la modification change le comportement,
   le modèle de données, la structure des fichiers, ou l'organisation
   des onglets.
