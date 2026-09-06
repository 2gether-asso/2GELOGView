# Guide — Tags & métadonnées dans le tableur Google Sheet

Ce guide explique comment remplir les colonnes du Google Sheet (en particulier **Tags**)
pour que le calendrier affiche automatiquement les bonnes informations (icône, couleur,
épisode, lieu, tags cliquables, statistiques...).

## 1. Les colonnes du tableur

| Colonne | Format attendu | Rôle |
|---|---|---|
| `Nom de l'event` | Texte libre | Titre affiché partout (tuile, modale, recherche) |
| `Type d'event` | Une valeur de la liste ci-dessous | Détermine l'icône, la couleur et la catégorie |
| `Date de début` | `JJ/MM/AAAA` ou `JJ/MM/AAAA HH:MM` | Date (et heure si précisée) de l'événement |
| `Date de fin` | `JJ/MM/AAAA` | Fin de la période (utile pour une série qui s'étale sur plusieurs semaines) |
| `Durée Réelle` | `HH:MM` | Durée effective, utilisée pour les statistiques cumulées |
| `Tags` | Texte multi-lignes | **Tout se passe ici** : tags, métadonnées, épisodes, statut... (voir plus bas) |
| `Notes` | Texte multi-lignes | Commentaire libre uniquement (contexte, casting...), affiché dans la modale |

Une ligne sans `Nom de l'event` est ignorée.

> **Colonnes `Tags` et `Notes`** : le calendrier lit les deux colonnes indifféremment et
> les fusionne (une ligne peut avoir sa structure dans l'une, l'autre, ou les deux) — donc
> rien ne casse si une ancienne ligne a encore tout dans `Notes`. Mais pour les **nouvelles**
> lignes, mettez toute la partie structurée (`#tag`, `@clé:valeur`, épisodes datés, mots-clés
> `hebdo`/`pause`/`partenaire`...) dans **`Tags`**, et gardez `Notes` pour du texte libre
> uniquement (contexte, casting, explication d'une annulation...). Ça sépare clairement
> "ce que la moulinette exploite" de "ce qui n'est que du commentaire humain".

## 2. `Type d'event` : les valeurs reconnues

| Valeur | Catégorie | Effet spécial |
|---|---|---|
| `Soirée Jeux` | 🎮 Gaming | — |
| `Bravery` | 🎮 Gaming | — |
| `JDR` | 🎮 Gaming | — |
| `Soirée Minecraft` | 🎮 Gaming | — |
| `Soirée Film` | 🎬 Visionnage | — |
| `Soirée Série` | 🎬 Visionnage | Numérote automatiquement les épisodes sur la tuile calendrier (`Épisode 1`, `Épisode 2`, ...) |
| `Soirée Spéciale` | 🎬 Visionnage | — |
| `Hors Prog` | 🎬 Visionnage | — |
| `Gazette 2025` / `Gazette 2026` | 🎬 Visionnage | — |
| `Event St Valentin` / `Event Halloween` / `Event Nowel` | 🎬 Visionnage | — |
| `Meet Up` | 🎬 Visionnage | Génère un événement par jour entre `Date de début` et `Date de fin` |

Une valeur non reconnue retombe sur une icône/couleur par défaut, mais reste affichée normalement.

Il n'est **pas nécessaire** d'écrire "Annulé / Reporté", "Partenaire" ou "Sanctuaire" dans
`Type d'event` : ces statuts sont détectés automatiquement via des mots-clés dans `Notes`
(voir § 4) et remplacent le type affiché.

## 3. La colonne `Tags` : tags et métadonnées

Chaque ligne de `Tags` (ou de `Notes`, fusionnées) est interprétée séparément. Une ligne
peut être :

### a. Un tag : `#motclé`

```
#warhammer
#retrogaming
```

- Un `#` par ligne, un seul tag par ligne.
- Les tags apparaissent sous forme de badges cliquables (calendrier, modale, listing de
  recherche) et alimentent la barre "Tags Récurrents" en haut de l'app.
- Cliquer sur un tag relance une recherche filtrée dessus.

### b. Une métadonnée : `@clé:valeur`

```
@host:Helldwin
@plateforme:Twitch
@episode:Saison 2 - Episode 4
@location:Discord Vocal 1
@image:https://image.tmdb.org/t/p/w500/xxxxxxxx.jpg
@lien:https://www.imdb.com/title/xxxxxxxx
```

Clés reconnues actuellement :

| Clé | Effet |
|---|---|
| `@host` ou `@orga` | Affiché comme "👤 Organisé par" dans la modale, agrégé dans les stats/rétrospective admin (les deux orthographes sont équivalentes) — **"Helldwin" par défaut si absent** |
| `@plateforme` | Affiché comme "📺 Plateforme", agrégé dans les stats |
| `@location` | Lieu affiché sur la tuile et dans la modale — **si absent, la valeur par défaut "Discord 2GETHER" est affichée automatiquement** |
| `@episode` ou `@diffusion` | Affiché en priorité sur la tuile et dans la modale ("📌 Episode(s)") — **prime toujours** sur la numérotation automatique des séries et sur le texte des lignes datées (§ 5) |
| `@image` | URL d'une affiche/jaquette (film, série, jeu) : affichée en fond translucide sur la tuile et en grand dans la modale. Doit commencer par `http://` ou `https://`, sinon ignorée. |
| `@url` (ou `@lien`/`@link`) | URL externe (IMDB, Steam, page officielle...) : affichée comme bouton cliquable dans la modale, ouvert dans un nouvel onglet. Les trois orthographes sont équivalentes. |
| `@salon` (ou `@discord`) | Lien direct vers le salon Discord (vocal ou textuel) de l'événement : affiché comme bouton "💬 Rejoindre le salon" dans la modale. |
| `@sondage` (ou `@vote`) | Lien vers un sondage externe (Google Form, sondage Discord...) : affiché comme bouton "🗳️ Voter / Sondage" dans la modale — pratique pour un événement "à définir" (vote du prochain film/jeu). |
| `@clip` | URL YouTube d'un clip marquant de la session — voir § 11 "Highlights". **Répétable** : une ligne `@clip:` par vidéo. |
| `@screen` | URL d'une capture d'écran marquante de la session — voir § 11. **Répétable** : une ligne `@screen:` par image. |

> Le champ "lieu" (📍) n'est donc jamais vide : toutes les sessions sont considérées comme
> se déroulant sur le Discord "2GETHER" sauf précision contraire via `@location` ou l'ancien
> format `Loc :`.

> **`@image` et `@url` ont aussi une valeur par défaut par type d'événement**, configurable
> dans `src/config.js` (champs `image`/`url` de chaque entrée de `THEMES`). Si un événement
> ne précise pas sa propre `@image`/`@url`, celle par défaut du type est utilisée à la place
> (par exemple, une bannière générique pour "Soirée Jeux") ; si le type n'en définit pas non
> plus, rien ne s'affiche. La métadonnée de l'événement prime toujours sur celle du type.

> **Les accents n'ont pas d'importance** : `@episode:` et `@Épisode:` sont strictement
> équivalents. Écrivez comme vous préférez.

Vous pouvez empiler plusieurs métadonnées, une par ligne :

```
@host:Helldwin
@plateforme:Twitch
#warhammer
#42k
```

### c. L'ancien format lieu : `Loc : ...`

Toujours supporté pour compatibilité :

```
Loc : Chez Mati
```

Équivalent à `@location:Chez Mati`. Préférez la nouvelle syntaxe `@` pour les nouvelles lignes.

### d. Texte libre

Toute ligne qui n'est ni un tag, ni une métadonnée `@...`, ni reconnue comme mot-clé
spécial (§ 4) est conservée telle quelle comme **description**, affichée uniquement dans
la modale (📝 Notes complémentaires) — jamais sur les tuiles du calendrier, pour les garder
lisibles. C'est ce type de contenu qui doit rester dans `Notes` (contexte, casting,
explication d'une annulation...), même si techniquement une ligne de texte libre dans `Tags`
fonctionnerait tout autant.

## 4. Mots-clés spéciaux (détectés n'importe où dans `Tags`/`Notes`)

Ces mots sont cherchés dans le texte complet de `Tags` + `Notes` fusionnés, peu importe
la ligne ou la colonne :

| Mot-clé | Effet |
|---|---|
| `annulé` / `annule` | Marque l'événement comme annulé (tuile barrée/grisée, compté dans "Annulations & Reports") |
| `reporté` / `reporte` | Idem annulé + compté séparément dans les "reports" |
| `remplacé` | Le titre affiché devient automatiquement "Contre Soirée" |
| `partenaire` | Le type affiché devient "Partenaire" |
| `sanctuaire` | Le type affiché devient "Sanctuaire" |
| `hebdo` | Force une expansion hebdomadaire (une occurrence chaque semaine entre `Date de début` et `Date de fin` ; sans `Date de fin`, seules les occurrences passées et celle de la semaine prochaine sont générées, pas de "Prévu" spéculatif sur des mois) — inutile de le préciser pour un `Type d'event` = `Soirée Série`, c'est automatique |

## 5. Épisodes datés explicites (pour détailler chaque diffusion)

Pour une série qui ne suit pas un rythme hebdomadaire strict, ou pour préciser le contenu
de chaque diffusion, ajoutez une ligne par date dans `Tags` au format :

```
23/06/2026: Episode 1
24/06/2026 à 20:30: Episodes 2 et 3
25/06/2026 : Episode 4
```

- Format de date obligatoire : `JJ/MM/AAAA`
- L'heure est optionnelle (`à HH:MM` ou juste `HH:MM`) ; si absente, l'heure de
  `Date de début` est reprise.
- Le texte après `:` est libre et s'affiche **à la fois** sur la tuile du calendrier
  (badge 📺) et dans la modale (bloc "Sous-épisode"), quel que soit le `Type d'event`
  (série ou non — par exemple un marathon "Hors Prog" avec plusieurs dates fonctionne
  aussi bien).
- Une ligne = un événement généré ce jour-là. C'est prioritaire sur le mot-clé `hebdo`.

### Durées explicites par épisode (pour une série dont la durée varie trop pour une moyenne)

Par défaut, "Durée Réelle" (durée cumulée de toute la ligne) est répartie à parts égales
entre toutes les occurrences. Si certains épisodes durent nettement plus ou moins longtemps
que d'autres, ajoutez une durée par épisode entre parenthèses, séparées par des virgules,
en toute fin de ligne :

```
15/07/2026 : Episodes 3 à 6 (1h,23min,45min,1h)
```

- Une durée par épisode couvert par la ligne (ici 4 épisodes → 4 durées).
- Formats acceptés : `1h`, `1h30`, `45min`, `90` (minutes nues), ou `HH:MM`.
- La tuile de cette occurrence prend alors fin après la **somme** des durées indiquées
  (ici 1h + 23min + 45min + 1h = 3h08), au lieu de l'estimation moyenne.
- Les autres occurrences de la même ligne (sans cette annotation) se partagent le reste de
  "Durée Réelle" une fois cette somme déduite — pour ne pas compter deux fois le même temps.
- Une parenthèse qui ne contient pas que des durées (ex: `Episode 5 (rediffusion)`) est
  laissée telle quelle et reste affichée normalement : seule une parenthèse où **chaque**
  élément ressemble à une durée est interprétée ainsi.

## 6. Pauses et reprises

Pour une série en expansion hebdomadaire, on peut suspendre temporairement les occurrences :

```
pause 12/08/2026
reprise 02/09/2026
```

Aucune occurrence n'est générée entre ces deux dates (bornes incluses côté pause,
exclue côté reprise).

## 7. Événement "Prévu" (sans date de début connue)

Si `Date de début` est vide mais qu'une date `JJ/MM/AAAA` apparaît quelque part dans
`Tags`/`Notes`, un événement `[PRÉVU] <titre>` est créé à cette date, marqué comme "planifié"
dans les statistiques.

## 8. Points de vigilance

- **Une seule stratégie par ligne** : n'utilisez pas à la fois une liste d'épisodes
  datés (§ 5) et le mot-clé `hebdo` sur la même ligne — la liste explicite est
  toujours prioritaire et le `hebdo` sera ignoré.
- **Une métadonnée par ligne** : `@clé:valeur` doit être seule sur sa ligne, tout comme
  les tags `#tag`.
- **La casse et les accents n'ont pas d'importance** pour les clés `@...` et les mots-clés
  spéciaux (`annulé`/`ANNULE`/`Annulée` fonctionnent tous).
- Le champ `Durée Réelle` (format `HH:MM`) doit être rempli pour que les statistiques
  (temps cumulé, rétrospective annuelle en mode `?admin`) soient correctes — sans lui,
  la session compte 0 minute.

## 9. Exemple complet

| Nom de l'event | Type d'event | Date de début | Date de fin | Durée Réelle | Tags | Notes |
|---|---|---|---|---|---|---|
| Sherlock | Soirée Série | 04/07/2026 20:30 | 25/07/2026 | 00:45 | `@host:Helldwin`<br>`@plateforme:Twitch`<br>`#detective`<br>`#bbc` | Rediffusion de la saison 1 |

→ Génère une occurrence chaque semaine du 04/07 au 25/07, avec numérotation automatique
`Épisode 1`, `Épisode 2`, ... sur les tuiles, organisateur/plateforme dans la modale,
les tags `#detective`/`#bbc` cliquables partout, et "Rediffusion de la saison 1" affiché
comme commentaire libre dans la modale.

## 10. Migration Notes → Tags

Un fichier `tableau_migre_tags.csv` a été généré à la racine du dépôt : c'est votre tableur
actuel avec, pour chaque ligne, tout le contenu structuré (`#tag`, `@clé:valeur`, épisodes
datés, mots-clés `hebdo`/`pause`/`reprise`/`partenaire`/`sanctuaire`/`loc :`) déplacé de
`Notes` vers `Tags`, et uniquement le texte libre (contexte, casting, explications) laissé
dans `Notes`. Vérifié ligne par ligne : le nombre d'occurrences générées est identique
avant/après (aucun comportement ne change), seule la répartition entre les deux colonnes
change. Pour l'appliquer : ouvrez ce fichier (Excel ou `Fichier > Importer` dans Google
Sheets) et remplacez le contenu de votre feuille actuelle par son contenu.

## 11. Highlights (clips YouTube / captures d'écran)

Pour mettre en avant les meilleurs moments d'une session (un fou rire, une scène marquante...),
deux ingrédients dans `Tags` :

1. Le tag `#highlight` sur la ligne, comme n'importe quel autre tag.
2. Une ou plusieurs métadonnées `@clip:` (lien YouTube) et/ou `@screen:` (lien image) —
   ce sont les **deux seules clés `@` répétables** : contrairement aux autres (§ 8, une
   métadonnée par ligne), on peut empiler plusieurs lignes `@clip:`/`@screen:` sur la
   même ligne du tableur pour ajouter plusieurs vidéos/captures.

```
#highlight
@clip:https://www.youtube.com/watch?v=xxxxxxxxxxx
@clip:https://youtu.be/yyyyyyyyyyy
@screen:zevent-2026.png
```

- Sans le tag `#highlight`, des `@clip`/`@screen` renseignés sont ignorés (aucun bloc
  affiché) : le tag est ce qui déclenche l'affichage du bloc "✨ Highlights" dans la modale,
  pas la simple présence de métadonnées.
- `@clip` accepte les formats `youtube.com/watch?v=...`, `youtu.be/...`, `.../shorts/...` et
  `.../embed/...` ; un lien qui n'en fait pas partie est silencieusement ignoré (pas d'iframe
  cassée).
- Les clips sont intégrés via `youtube-nocookie.com` (mode vie privée renforcée de YouTube).

### Où héberger les captures d'écran (`@screen:`)

Évitez les liens Discord CDN (`cdn.discordapp.com/attachments/...`) : ils contiennent une
signature qui **expire**, l'image peut casser quelques semaines après coup.

**Solution recommandée : le dossier `assets/img/highlights/` du repo lui-même** (voir son
`README.md`) — glissez l'image via l'interface web GitHub ("Add file" → "Upload files", pas
besoin de Git en ligne de commande), puis mettez **juste son nom de fichier** dans `@screen:`
(ex: `@screen:zevent-2026.png`) : l'app construit elle-même l'URL complète vers ce dossier.
Aucun risque d'expiration ni de protection anti-hotlink, c'est le même domaine que le site.

Si vous n'avez pas d'accès en écriture au repo, [imgbb.com](https://imgbb.com) est une
alternative fiable : upload anonyme, lien direct **permanent** (contrairement à Discord) — dans
ce cas, collez l'**URL complète** (`https://...`) plutôt qu'un simple nom de fichier.
