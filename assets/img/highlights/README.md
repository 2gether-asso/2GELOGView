# Highlights — captures d'écran

Dossier dédié aux captures d'écran référencées via `@screen:` dans le Google Sheet (voir
`GUIDE_METADONNEES.md`, § 11 "Highlights"). Hébergées directement dans le repo plutôt que sur
un service externe (Discord, Google Drive...) pour éviter les liens qui expirent ou la
protection anti-hotlink de certains hébergeurs — voir le comparatif dans le guide.

## Ajouter une capture

1. Glisser le fichier image ici via l'interface web GitHub ("Add file" → "Upload files"),
   pas besoin de Git en ligne de commande.
2. Dans le Google Sheet, sur la ligne de l'événement concerné (avec le tag `#highlight`, sinon
   rien ne s'affiche), coller **juste le nom du fichier** dans une ligne `@screen:` — ex:
   `@screen:zevent-2026.png`. L'app construit elle-même l'URL complète vers ce dossier
   (voir `ModalView._resolveScreenUrl`), pas besoin de recopier
   `https://planning.2gether-asso.fr/assets/img/highlights/...` à chaque fois.

Formats courants (`.png`/`.jpg`/`.webp`) acceptés, pas de contrainte de taille particulière si
ce n'est de garder des fichiers raisonnables (le site reste 100% statique, chaque image est
téléchargée telle quelle par les visiteurs).
