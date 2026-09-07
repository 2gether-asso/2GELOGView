import { CONFIG } from '../config.js';

/**
 * Fiches TMDB (V2.7) pour les événements Film/Série (catégorie "visionnage" - Soirée Film,
 * Soirée Série, Hors Prog qui couvre aussi pas mal de séries/films en pratique, voir
 * config.js). Passe TOUJOURS par le proxy n8n (voir CONFIG.TMDB_LOOKUP_URL) plutôt que
 * d'appeler l'API TMDB directement : ce site est 100% statique (GitHub Pages), une clé API
 * mise dans le code serait committée en clair dans le repo public - le proxy la garde
 * côté serveur. Comme PollService : ne rejette jamais (résout `null` sur tout échec/absence
 * de résultat), une panne de ce service ne doit jamais bloquer le reste de l'app.
 *
 * `imageUrl` (pas "posterUrl") : le proxy renvoie volontairement le backdrop TMDB (image
 * horizontale/16:9), pas le poster (vertical/2:3) - les tuiles/cartes de cette app sont toutes
 * pensées en fond horizontal (bg-cover sur une carte large), un poster vertical y serait
 * recadré n'importe comment (visages coupés...).
 *
 * Le proxy n8n gère 3 actions (voir `action` dans le corps de chaque requête, GUIDE_METADONNEES
 * .md §12) : "search" (titre -> meilleure correspondance Film/Série), "details" (id TMDB connu
 * -> sa fiche directement, voir @tmdb: en §12.b) et "season" (id + numéro de saison -> la liste
 * des épisodes de cette saison, voir fetchTmdbSeason/§12.c pour les vignettes d'épisode).
 */

const CACHE_KEY = 'tmdb:cache:v1';
const SEASON_CACHE_KEY = 'tmdb:season-cache:v1';
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000; // 30 jours - une affiche/fiche TMDB change rarement.

function readCache(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function writeCache(key, cache) {
    try { localStorage.setItem(key, JSON.stringify(cache)); } catch { /* quota plein, stockage désactivé... tant pis, juste pas de cache persistant */ }
}

/**
 * Retire un ou plusieurs suffixes de saison/partie en fin de titre ("S1", "S3-S4", "S1 & S2",
 * "S12 - Part 2"...) avant de chercher sur TMDB : le titre affiché ("AHS S13") ne correspond à
 * aucune fiche TMDB, contrairement à son titre de base ("AHS"/"American Horror Story"). Même
 * regex validée empiriquement sur les ~1070 titres réels du CSV de prod (voir session V2.6).
 */
function stripSeasonSuffix(title) {
    const stripped = title.replace(/\s+S\d+(\s*[-&+]\s*S?\d+)*(\s*-\s*(Part|Partie)\s*\d+)?\s*$/i, '').trim();
    return stripped || title;
}

/**
 * Numéro de saison porté par le titre ("AHS S13" -> 13, "Breaking Bad S1" -> 1) - utilisé pour
 * retrouver les épisodes de LA BONNE saison sur TMDB (voir fetchTmdbSeason). `null` si le titre
 * ne porte aucun suffixe "S<N>" (film, ou série sans saison précisée dans le titre).
 * @param {string} title
 * @returns {number|null}
 */
export function parseSeasonNumber(title) {
    const m = title.match(/\bS(\d+)\b/i);
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Numéro(s) d'épisode couverts par une annotation libre ("Épisode 4" -> [4], "Episodes 1 à 3"
 * -> [1,2,3], "Épisodes 7 et 8" -> [7,8]) - même logique que
 * EventGenerator._countEpisodesInText, mais renvoie les numéros eux-mêmes (pas juste un compte)
 * pour aller chercher CES épisodes précis sur TMDB (voir fetchTmdbSeason).
 * @param {string} text
 * @returns {number[]}
 */
export function parseEpisodeNumbers(text) {
    if (!text) return [];
    const rangeMatch = text.match(/(\d+)\s*(?:à|-)\s*(\d+)/i);
    if (rangeMatch) {
        const from = parseInt(rangeMatch[1], 10);
        const to = parseInt(rangeMatch[2], 10);
        if (!isNaN(from) && !isNaN(to) && to >= from && to - from < 50) {
            return Array.from({ length: to - from + 1 }, (_, i) => from + i);
        }
    }
    const numbers = text.match(/\d+/g);
    return numbers ? numbers.map(n => parseInt(n, 10)) : [];
}

// Marqueur d'épisode accepté après le numéro de saison (voir parseSeasonEpisode) : "E13",
// "Ep13", "Ep 13", "Episode 13", "Épisode 13", "Episodes 13" - toutes des façons plausibles
// d'écrire "épisode" avant son numéro. Sans ce degré de tolérance, un format aussi courant
// qu'"Ep13" (le "E" n'est PAS immédiatement suivi du chiffre) ne matchait pas du tout et
// retombait sur un repli bien plus grossier (parseEpisodeNumbers, qui attrape alors N'IMPORTE
// QUEL chiffre du texte - y compris celui du "S3" juste avant, d'où le "S1 E3+E13" observé au
// lieu de "S3 E13").
const EP_MARKER = "(?:É|E)p?(?:isode)?s?\\.?\\s*";

/**
 * Forme combinée "S<N> E<M>" (ex: "S3 E13", "S3 Ep13", "S3 Épisode 13", "S3 E13-E15",
 * "S2 Ep 4 à 6" - le marqueur n'a pas besoin d'être répété avant le second numéro d'une plage)
 * directement dans le texte "Episode(s)" - prioritaire sur parseSeasonNumber(titre)/
 * parseEpisodeNumbers(texte) séparés quand elle est présente : plus précise, et surtout la
 * SEULE option pour un événement dont le TITRE ne porte pas la saison (ex: "Road to AHS 13", un
 * format "teasing" dont le titre ne suit pas la convention "... S<N>") - l'organisateur précise
 * alors saison+épisode directement ici. Sans numéro de saison du tout (ex: juste "Ep 1 à 9"),
 * cette fonction renvoie `null` : c'est alors le repli parseSeasonNumber(titre) +
 * parseEpisodeNumbers(texte) qui prend le relais (voir ModalView._renderEpisodeThumbnails).
 * @param {string} text
 * @returns {{season: number, episodes: number[]}|null}
 */
export function parseSeasonEpisode(text) {
    if (!text) return null;
    // Le marqueur ("Ep"/"Episode"/...) devant le second numéro d'une plage est OPTIONNEL - le
    // groupe entier doit être rendu optionnel via `(?:...)?`, pas juste son dernier caractère
    // (`${EP_MARKER}?` collé au bout de la chaîne interpolée ne rendrait "facultatif" que le
    // dernier `\s*` de EP_MARKER, pas le marqueur dans son ensemble).
    const regex = new RegExp(`\\bS(\\d+)\\s*${EP_MARKER}(\\d+)(?:\\s*(?:-|à|et)\\s*(?:${EP_MARKER})?(\\d+))?\\b`, 'i');
    const m = text.match(regex);
    if (!m) return null;
    const season = parseInt(m[1], 10);
    const from = parseInt(m[2], 10);
    const to = m[3] ? parseInt(m[3], 10) : from;
    const episodes = to >= from && to - from < 50
        ? Array.from({ length: to - from + 1 }, (_, i) => from + i)
        : [from];
    return { season, episodes };
}

/**
 * `@tmdb:` (§12.b du guide) : une fiche TMDB collée à la main quand la recherche automatique se
 * trompe ou ne trouve rien - accepte l'URL telle quelle copiée depuis themoviedb.org
 * ("https://www.themoviedb.org/tv/2734-loki") ou la forme courte "tv:2734"/"movie:11".
 * @param {string} value
 * @returns {{mediaType: 'movie'|'tv', id: string}|null}
 */
export function parseTmdbRef(value) {
    if (!value) return null;
    const urlMatch = value.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
    if (urlMatch) return { mediaType: urlMatch[1].toLowerCase(), id: urlMatch[2] };
    const shortMatch = value.trim().match(/^(movie|tv)[:/](\d+)$/i);
    if (shortMatch) return { mediaType: shortMatch[1].toLowerCase(), id: shortMatch[2] };
    return null;
}

const normalizeKey = title => stripSeasonSuffix(title).trim().toLowerCase();

// Catégories concernées par une fiche TMDB (Film/Série) : "visionnage" (Soirée Film/Série) ET
// "hors prog" - en pratique, une bonne partie des séries réelles du tableur (ex: "AHS S13",
// "Silo S4") sont typées "Hors Prog" plutôt que "Soirée Série" (fourre-tout historique du
// tableur), donc s'en tenir à la seule catégorie "visionnage" les aurait toutes ratées.
const TMDB_ELIGIBLE_CATEGORIES = new Set(['visionnage', 'hors prog']);

/** Un événement est-il concerné par une fiche TMDB (Film/Série) ? Partagé entre ModalView
 * (_renderTmdbInfo) et le pré-chargement en arrière-plan (prefetchTmdbImages dans main.js). */
export function isTmdbEligible(event) {
    return TMDB_ELIGIBLE_CATEGORIES.has(event.category);
}

function freshEntry(entry) {
    return entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

/**
 * Lecture SYNCHRONE (jamais de réseau) d'une image déjà en cache - utilisée par le rendu des
 * tuiles/cartes (voir resolveEventImage dans EventCardTemplate.js), qui ne peut pas attendre un
 * aller-retour réseau au moment de construire le HTML. Ne renvoie quelque chose qu'une fois
 * qu'un fetchTmdbInfo() précédent (modale déjà ouverte pour ce titre, ou pré-chargement en
 * arrière-plan - voir prefetchTmdbImages dans main.js) a rempli le cache.
 * @param {string} title
 * @returns {string|null}
 */
export function getCachedImageUrl(title) {
    const entry = readCache(CACHE_KEY)[normalizeKey(title)];
    return freshEntry(entry) && entry.found ? (entry.imageUrl || null) : null;
}

/** Idem getCachedImageUrl, mais renvoie la fiche complète (lien TMDB, résumé, note, id...) -
 * utilisée par ModalView pour l'enrichissement affiché dans la modale (voir _renderTmdbInfo). */
export function getCachedTmdbInfo(title) {
    const entry = readCache(CACHE_KEY)[normalizeKey(title)];
    return freshEntry(entry) && entry.found ? entry : null;
}

/** Un titre a-t-il déjà une entrée fraîche en cache, trouvée OU PAS (voir prefetchTmdbImages
 * dans main.js) ? Contrairement à getCachedTmdbInfo/getCachedImageUrl (qui ne renvoient
 * quelque chose que si une fiche a été TROUVÉE), sert ici à éviter de re-interroger en boucle
 * un titre déjà su "sans fiche TMDB" - fetchTmdbInfo le ferait déjà tout seul (cache interne),
 * mais un appelant qui boucle sur plusieurs titres avec un throttle entre chaque veut le savoir
 * à l'avance pour ne pas gâcher un créneau du throttle sur un titre déjà résolu. */
export function hasFreshCacheEntry(title) {
    return freshEntry(readCache(CACHE_KEY)[normalizeKey(title)]);
}

/**
 * Interroge le proxy n8n pour la fiche Film/Série d'un événement (timeout 6s, comme
 * PollService). `@tmdb:` (event.meta.tmdb, voir parseTmdbRef) prime toujours sur la recherche
 * par titre quand il est présent et valide - une fiche collée à la main, prioritaire sur une
 * recherche automatique qui peut se tromper. Résultat mis en cache - un succès COMME un "pas
 * trouvé" (`found:false`), pour ne pas re-interroger en boucle à chaque rendu un titre qui n'a
 * simplement aucune fiche sur TMDB.
 * @param {Object} event
 * @returns {Promise<{id: string, mediaType: string, imageUrl: string|null, tmdbUrl: string, overview: string, rating: number}|null>}
 *   `null` si pas de fiche trouvée ou si le service est indisponible - jamais de rejet.
 */
export async function fetchTmdbInfo(event) {
    const key = normalizeKey(event.title);
    const cached = readCache(CACHE_KEY)[key];
    if (freshEntry(cached)) return cached.found ? cached : null;

    const override = parseTmdbRef(event.meta?.tmdb);
    const body = override
        ? { action: 'details', mediaType: override.mediaType, id: override.id }
        : { action: 'search', title: stripSeasonSuffix(event.title) };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(CONFIG.TMDB_LOOKUP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        const data = await res.json();

        const cache = readCache(CACHE_KEY);
        cache[key] = { ...data, fetchedAt: Date.now() };
        writeCache(CACHE_KEY, cache);
        return data.found ? cache[key] : null;
    } catch {
        return null;
    }
}

/**
 * Lecture SYNCHRONE (jamais de réseau) des épisodes d'une saison déjà en cache - même logique
 * que getCachedImageUrl. Clé = série + saison (une même série a plusieurs saisons, donc pas
 * suffisant de ne clé que sur l'id TMDB).
 * @param {string} tmdbId
 * @param {number} season
 * @returns {Array<{episodeNumber: number, name: string, stillUrl: string|null}>|null}
 */
export function getCachedSeasonEpisodes(tmdbId, season) {
    const entry = readCache(SEASON_CACHE_KEY)[`${tmdbId}:${season}`];
    return freshEntry(entry) && entry.found ? entry.episodes : null;
}

/**
 * Interroge le proxy n8n pour la liste des épisodes d'UNE saison d'une série TMDB (timeout 6s) -
 * un seul appel par saison (pas un par épisode), le résultat couvre alors TOUTES les occurrences
 * de cette saison quel que soit l'épisode précis affiché (voir _renderEpisodeThumbnails dans
 * ModalView.js, qui pioche dedans les numéros pertinents pour CETTE occurrence).
 * @param {string} tmdbId
 * @param {number} season
 * @returns {Promise<Array<{episodeNumber: number, name: string, stillUrl: string|null}>|null>}
 */
export async function fetchTmdbSeason(tmdbId, season) {
    const key = `${tmdbId}:${season}`;
    const cached = readCache(SEASON_CACHE_KEY)[key];
    if (freshEntry(cached)) return cached.found ? cached.episodes : null;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(CONFIG.TMDB_LOOKUP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'season', tmdbId, season }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        const data = await res.json();

        const cache = readCache(SEASON_CACHE_KEY);
        cache[key] = { ...data, fetchedAt: Date.now() };
        writeCache(SEASON_CACHE_KEY, cache);
        return data.found ? data.episodes : null;
    } catch {
        return null;
    }
}
