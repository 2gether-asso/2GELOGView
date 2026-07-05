Cahier des Charges — État Actuel (V2)

1. Flux de Données et Architecture

Source de Vérité : Google Sheet (format CSV public).
Chargement : Asynchrone via PapaParse dans CSVParser.js.
Normalisation : Chaque ligne est traitée par EventGenerator.js pour transformer les données brutes en objets typés, puis envoyée au dépôt (EventRepository.js).
Architecture modulaire : Utilisation de ES Modules natifs (import/export), permettant une séparation stricte entre :
parsers/ : Logique de transformation des données.
services/ : Logique métier (génération, recherche, statistiques).
repositories/ : Gestion de l'état (données).ui/ : Rendu et interactivité.

2. Fonctionnalités Métier (Règles de Gestion)

Gestion Anti-Doublons (Indispensable) : Tout ajout au dépôt vérifie une clé composite unique (Titre + Date + Heure). Si la signature existe, l'événement est ignoré.
Moteur de Métadonnées "Smart" :
Tags : Extraction automatique de tout #tag.
Propriétés : Support du format @clé:valeur pour les méta-données.
Rétro-compatibilité : Support maintenu de l'ancien format Loc : et des mots-clés annulé/reporté.
Recherche & Indexation : SearchEngine.js génère un index textuel aplati (titre, notes, lieu, tags, type, hôte, plateforme) pour permettre une recherche instantanée multi-champs.
Statistiques V2 : Calcul global des métriques :Temps et nombre de sessions (par catégorie : watch, game).Agrégats par tags, types, hôtes et plateformes.
Compteurs spécifiques (annulations, reports, événements programmés).

3. Interface Utilisateur (UI)
Style : Glassmorphism (bg-glass, backdrop-blur).
Composants :
CalendarView : Pilote FullCalendar. Synchronisation via sync() obligatoire pour mettre à jour la vue (Clear + Add).
ModalView : Affichage détaillé enrichi au clic (tags cliquables, métadonnées, sous-épisodes).
Interactivité :Filtrage dynamique (catégorie + tags).
Recherche textuelle en temps réel (input).
Réinitialisation globale des filtres (btn-clear-filters).

4. Contrats d'Interface (Ce qu'il ne faut pas casser)Pour éviter les régressions, tout futur module doit respecter ces contrats :
ComposantContrat / Contrainte critique
EventRepository.add(evt)Doit retourner false si doublon, true sinon. Ne jamais bypasser cette méthode.CalendarView.sync(inst, list)Appelle removeAllEvents() avant d'ajouter le flux. Toute nouvelle vue doit respecter ce cycle.
MetadataParser.parse(text)Doit toujours retourner { tags: [], meta: {}, content: "" }.
SearchEngineDoit utiliser event.searchIndex pour les performances.

⚠️ Points de vigilance pour l'avenir
Format des Dates : Le parseur de date (DateUtils) est sensible au format DD/MM/YYYY du Google Sheet. Toute modification du format dans le Sheet cassera le calendrier.
Synchronisation : Lors de l'ajout de nouvelles vues (ex: Timeline, Liste), il est impératif d'appeler la fonction de synchronisation dédiée à chaque modification de filtre (via updateUIState).
Gestion des Séries : La priorité de génération définie (1. épisodes explicites > 2. hebdo > 3. unique) ne doit jamais être mélangée sur une même ligne CSV pour éviter les collisions de données.