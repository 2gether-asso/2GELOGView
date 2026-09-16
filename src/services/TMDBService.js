import { CONFIG } from '../config.js';
import { AdminIssuesService } from './AdminIssuesService.js';

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
 *
 * V2.10 - depuis que ce proxy n8n peut lui-même s'appuyer sur un cache PARTAGÉ (Grist, voir
 * GUIDE_METADONNEES.md §12), un "miss" du cache LOCAL (ce fichier) ne coûte plus un aller-retour
 * TMDB complet à chaque fois - juste une lecture Grist rapide côté serveur. Le cache local a donc
 * été repensé en conséquence (voir FRESH_TTL_MS/STALE_MAX_AGE_MS ci-dessous) : fraîcheur courte
 * avec revalidation en tâche de fond (stale-while-revalidate) plutôt qu'un unique TTL de 30 jours
 * qui pouvait laisser un visiteur avec une fiche périmée bien après une correction du tableur.
 */

// Un peu d'historique sur ces deux TTL distincts (V2.10) : avant, un SEUL TTL (30 jours) servait
// à la fois à décider "on retape le réseau" ET "on peut encore afficher ça en attendant mieux" -
// logique quand chaque miss coûtait un aller-retour TMDB complet (mieux vaut garder une vieille
// fiche que de spammer TMDB). Le proxy n8n servant désormais depuis Grist en premier, un miss
// local est presque gratuit côté serveur : FRESH_TTL_MS (court) déclenche une revalidation bien
// plus souvent, tout en gardant STALE_MAX_AGE_MS (toujours 30 jours) comme filet de sécurité -
// une entrée entre les deux reste affichée TOUT DE SUITE (stale-while-revalidate, voir
// isFresh/isUsable) pendant qu'une revalidation part en tâche de fond, sans jamais bloquer le
// rendu sur ce réseau.
const FRESH_TTL_MS = 4 * 24 * 3600 * 1000; // 4 jours avant de revalider en arrière-plan.
const STALE_MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 jours avant de considérer l'entrée illisible.

// Bump (V2.10) dès qu'une évolution change la FORME des entrées mises en cache (ex: l'ajout des
// champs enrichis genres/cast/trailerKey/providers/certification plus tôt cette session) : sans
// ça, une entrée mise en cache AVANT cet ajout reste "fraîche" jusqu'à 30 jours tout en manquant
// silencieusement ces champs - obligeant un visiteur à vider lui-même son localStorage pour les
// voir apparaître (vécu concrètement cette session, voir le "problème de cache" Scooby Doo). Une
// entrée dont `schemaVersion` ne correspond plus est traitée comme absente (voir isUsable).
const TMDB_CACHE_SCHEMA_VERSION = 2;

const FICHE_PREFIX = 'tmdb:cache:v1:';
const SEASON_PREFIX = 'tmdb:season-cache:v1:';

// Miroir en mémoire du contenu déjà lu de chaque entrée (une clé par titre/saison plutôt qu'un
// seul gros blob JSON, voir getEntry/setEntry ci-dessous) : évite un JSON.parse() répété au
// rendu de chaque tuile/carte (voir resolveEventImage dans EventCardTemplate.js). Le module est
// le seul à écrire ces clés, donc ce miroir ne peut pas devenir périmé tant que l'onglet reste
// ouvert.
const memFiches = new Map();
const memSeasons = new Map();

/**
 * Stockage par entrée (V2.10, une clé localStorage par titre/saison) plutôt qu'un unique blob
 * JSON pour tout le cache (comme avant) : ce dernier obligeait à ré-sérialiser la TOTALITÉ du
 * cache (JSON.stringify) à chaque mise à jour d'UNE SEULE entrée - de plus en plus coûteux à
 * mesure que le cache grossit (plusieurs centaines de fiches, chacune bien plus lourde depuis
 * l'ajout du casting/genres/bande-annonce/fournisseurs). Ici, une écriture ne touche que sa
 * propre clé.
 */
function getEntry(mem, prefix, key) {
    if (mem.has(key)) return mem.get(key);
    let entry = null;
    try { entry = JSON.parse(localStorage.getItem(prefix + key)); } catch { entry = null; }
    mem.set(key, entry);
    return entry;
}
function setEntry(mem, prefix, key, entry) {
    mem.set(key, entry);
    try { localStorage.setItem(prefix + key, JSON.stringify(entry)); } catch { /* quota plein, stockage désactivé... tant pis, juste pas de cache persistant */ }
}
function deleteEntry(mem, prefix, key) {
    mem.delete(key);
    try { localStorage.removeItem(prefix + key); } catch { /* tant pis */ }
}
/** Énumère les clés (suffixes, sans le préfixe) actuellement stockées sous un préfixe donné -
 * utilisé par pruneTmdbCache, qui doit visiter CHAQUE entrée pour vérifier sa fraîcheur (une
 * lecture par clé localStorage n'expose pas de "liste toutes les clés commençant par X" native,
 * d'où ce petit scan de localStorage.key(i) une fois par jour maximum, voir PRUNE_INTERVAL_MS). */
function listEntryKeys(prefix) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k.slice(prefix.length));
    }
    return keys;
}

const getFicheEntry = key => getEntry(memFiches, FICHE_PREFIX, key);
const setFicheEntry = (key, entry) => setEntry(memFiches, FICHE_PREFIX, key, entry);
const deleteFicheEntry = key => deleteEntry(memFiches, FICHE_PREFIX, key);
const getSeasonEntry = key => getEntry(memSeasons, SEASON_PREFIX, key);
const setSeasonEntry = (key, entry) => setEntry(memSeasons, SEASON_PREFIX, key, entry);

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

/** Entrée encore montrable telle quelle (V2.10) - pas totalement périmée, ni d'une forme trop
 * ancienne (voir TMDB_CACHE_SCHEMA_VERSION). Base des lectures SYNCHRONES (getCachedImageUrl,
 * getCachedTmdbInfo, getCachedSeasonEpisodes) : un rendu de tuile/modale ne doit jamais attendre
 * le réseau, une entrée un peu âgée reste largement préférable à rien du tout. */
function isUsable(entry) {
    return Boolean(entry) && entry.schemaVersion === TMDB_CACHE_SCHEMA_VERSION && (Date.now() - entry.fetchedAt) < STALE_MAX_AGE_MS;
}
/** Entrée assez récente pour qu'aucune revalidation ne soit nécessaire (voir FRESH_TTL_MS) -
 * sous-ensemble strict de isUsable. */
function isFresh(entry) {
    return isUsable(entry) && (Date.now() - entry.fetchedAt) < FRESH_TTL_MS;
}

/**
 * Lecture SYNCHRONE (jamais de réseau) d'une image déjà en cache - utilisée par le rendu des
 * tuiles/cartes (voir resolveEventImage dans EventCardTemplate.js), qui ne peut pas attendre un
 * aller-retour réseau au moment de construire le HTML. Ne renvoie quelque chose qu'une fois
 * qu'un fetchTmdbInfo() précédent (modale déjà ouverte pour ce titre, ou pré-chargement en
 * arrière-plan - voir prefetchTmdbImages dans main.js) a rempli le cache. Renvoie une entrée
 * STALE (au-delà de FRESH_TTL_MS mais encore utilisable, voir isUsable) telle quelle - une
 * revalidation en tâche de fond peut être en cours ailleurs (voir fetchTmdbInfo), un prochain
 * rendu en profitera automatiquement sans câblage supplémentaire.
 * @param {string} title
 * @returns {string|null}
 */
export function getCachedImageUrl(title) {
    const entry = getFicheEntry(normalizeKey(title));
    return isUsable(entry) && entry.found ? (entry.imageUrl || null) : null;
}

/** Idem getCachedImageUrl, mais renvoie la fiche complète (lien TMDB, résumé, note, id...) -
 * utilisée par ModalView pour l'enrichissement affiché dans la modale (voir _renderTmdbInfo). */
export function getCachedTmdbInfo(title) {
    const entry = getFicheEntry(normalizeKey(title));
    return isUsable(entry) && entry.found ? entry : null;
}

/** Un titre a-t-il déjà une entrée FRAÎCHE en cache (pas juste utilisable, voir isFresh),
 * trouvée OU PAS (voir prefetchTmdbImages dans main.js) ? Contrairement à getCachedTmdbInfo/
 * getCachedImageUrl (qui acceptent une entrée simplement stale), sert ici à décider si un titre
 * a besoin d'être (re)visité par le pré-chargement en arrière-plan - une entrée stale (au-delà de
 * FRESH_TTL_MS) doit au contraire y RESTER candidate, pour que sa revalidation ait une chance de
 * se déclencher (voir fetchTmdbInfo). */
export function hasFreshCacheEntry(title) {
    return isFresh(getFicheEntry(normalizeKey(title)));
}

/**
 * Un seul appel POST au proxy n8n, avec une petite retentative (V2.10) avant d'abandonner : un
 * timeout isolé est désormais plus probablement un blip transitoire qu'une vraie panne, le proxy
 * n8n répondant en général vite (lecture Grist) plutôt que d'attendre TMDB à chaque appel. Le
 * second essai utilise un timeout plus court : pas la peine d'attendre à nouveau 6s en plein
 * échec réseau franc.
 * @param {Object} body
 * @returns {Promise<Object|null>} Le JSON de la réponse, ou `null` si les deux tentatives échouent.
 */
async function requestTmdbOnce(body, timeoutMs) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(CONFIG.TMDB_LOOKUP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}
async function requestTmdb(body) {
    const first = await requestTmdbOnce(body, 6000);
    if (first) { trackTmdbSource(first); return first; }
    const retry = await requestTmdbOnce(body, 3000);
    if (retry) trackTmdbSource(retry);
    return retry;
}

// Compteur Grist-hit vs vrai-appel-TMDB (V2.10, voir getTmdbSourceStats/mountTmdbCachePanel dans
// AdminView.js) : purement indicatif, réinitialisé à chaque rechargement de page. Repose sur un
// champ `_source` optionnel ("grist"|"tmdb") que le proxy n8n peut renvoyer dans sa réponse - tant
// que le workflow n8n n'est pas étendu pour l'exposer, tout retombe simplement dans "unknown"
// (dégradation silencieuse, comme le reste de l'intégration TMDB).
const sourceStats = { grist: 0, tmdb: 0, unknown: 0 };
function trackTmdbSource(data) {
    if (data._source === 'grist') sourceStats.grist++;
    else if (data._source === 'tmdb') sourceStats.tmdb++;
    else sourceStats.unknown++;
}
/** @returns {{grist: number, tmdb: number, unknown: number}} */
export function getTmdbSourceStats() {
    return { ...sourceStats };
}

/**
 * Interroge le proxy n8n pour la fiche Film/Série d'un événement. `@tmdb:` (event.meta.tmdb,
 * voir parseTmdbRef) prime toujours sur la recherche par titre quand il est présent et valide -
 * une fiche collée à la main, prioritaire sur une recherche automatique qui peut se tromper.
 * Repli automatique (V2.9) si cette fiche forcée ne répond plus (id supprimé/faute de frappe
 * dans l'URL @tmdb:) : retente une recherche par titre plutôt que d'abandonner - toujours mieux
 * qu'aucune fiche du tout, même si ce n'est alors qu'une approximation (voir
 * reportTmdbLookupIssue, qui distingue encore les deux cas dans le Mode Admin).
 *
 * Stale-while-revalidate (V2.10) : une entrée fraîche (isFresh) est renvoyée sans réseau, comme
 * avant. Une entrée simplement UTILISABLE mais périmée (isUsable, au-delà de FRESH_TTL_MS) est
 * elle aussi renvoyée IMMÉDIATEMENT (jamais d'attente réseau visible), mais déclenche en plus une
 * revalidation en tâche de fond (déduplique via ficheRevalidating pour ne jamais empiler deux
 * revalidations du même titre en parallèle) - un futur rendu profitera de la version à jour une
 * fois arrivée, sans que CET appel n'ait eu à attendre quoi que ce soit.
 * @param {Object} event
 * @param {{force?: boolean}} [options] - `force: true` (voir forceRewarmTmdbCache dans
 *   AdminView.js) ignore fraîcheur ET utilisabilité, toujours un aller-retour réseau bloquant.
 * @returns {Promise<{id: string, mediaType: string, imageUrl: string|null, tmdbUrl: string, overview: string, rating: number, genres?: string[], runtime?: number, cast?: Array, trailerKey?: string, providers?: Array, certification?: string, alternates?: Array}|null>}
 *   `null` si pas de fiche trouvée ou si le service est indisponible - jamais de rejet. Les
 *   champs au-delà de `rating` sont optionnels : absents tant que le proxy n8n n'est pas étendu
 *   pour les renvoyer (voir GUIDE_METADONNEES.md §12), l'app s'en passe silencieusement.
 */
export async function fetchTmdbInfo(event, { force = false } = {}) {
    const key = normalizeKey(event.title);
    const cached = getFicheEntry(key);

    if (!force && isFresh(cached)) return cached.found ? cached : null;

    if (!force && isUsable(cached)) {
        if (!ficheRevalidating.has(key)) {
            ficheRevalidating.add(key);
            doFetchTmdbInfo(event, key).finally(() => ficheRevalidating.delete(key));
        }
        return cached.found ? cached : null;
    }

    return doFetchTmdbInfo(event, key);
}
const ficheRevalidating = new Set();

async function doFetchTmdbInfo(event, key) {
    const override = parseTmdbRef(event.meta?.tmdb);
    const body = override
        ? { action: 'details', mediaType: override.mediaType, id: override.id }
        : { action: 'search', title: stripSeasonSuffix(event.title) };

    let data = await requestTmdb(body);
    if (!data) return null;

    let overrideBroken = false;
    if (override && !data.found) {
        const fallback = await requestTmdb({ action: 'search', title: stripSeasonSuffix(event.title) });
        if (fallback) data = fallback;
        overrideBroken = true;
    }

    // Garde-fou (V2.9) : le proxy n8n a renvoyé à une occasion un `id` sous forme d'URL complète
    // ("https://www.themoviedb.org/tv/97645") au lieu de l'identifiant numérique brut attendu
    // partout côté client (ex: fetchTmdbSeason(tmdbId, ...) construit alors une URL TMDB cassée,
    // "/tv/https://.../season/..."). Ne corrige pas la cause côté n8n, mais évite qu'un id mal
    // formé ne se propage silencieusement dans le cache local ET dans Grist via l'écriture n8n.
    if (data.id) data.id = String(data.id).match(/(\d+)\s*$/)?.[1] || data.id;

    const entry = { ...data, fetchedAt: Date.now(), schemaVersion: TMDB_CACHE_SCHEMA_VERSION };
    setFicheEntry(key, entry);
    reportTmdbLookupIssue(event, key, override, data, overrideBroken);
    return data.found ? entry : null;
}

/**
 * Journal Admin (V2.8, voir AdminIssuesService.js) : signale les recherches TMDB qui posent
 * problème, pour qu'un organisateur les remarque dans le Mode Admin sans avoir à deviner
 * lesquels de ses événements Film/Série n'ont (probablement) pas la bonne fiche. `alternates`
 * n'existe pas encore dans la réponse actuelle du proxy n8n (qui ne renvoie aujourd'hui que LA
 * meilleure correspondance côté serveur) - ce champ est lu ici en prévision, prêt à être exploité
 * dès que le workflow n8n sera étendu pour l'exposer, sans changement client supplémentaire.
 * `overrideBroken` (V2.9) : la fiche forcée (@tmdb:) ne répondait plus et un repli par titre a
 * été tenté (voir fetchTmdbInfo) - signalé MÊME si ce repli a fini par trouver quelque chose, car
 * ce n'est alors qu'une approximation automatique à vérifier, pas la fiche choisie à la main.
 */
function reportTmdbLookupIssue(event, key, override, data, overrideBroken = false) {
    if (overrideBroken) {
        const message = data.found
            ? `Fiche TMDB forcée (@tmdb:) introuvable pour "${event.title}" - une recherche automatique de secours a trouvé une fiche approximative, vérifiez qu'il s'agit bien de la bonne ou corrigez @tmdb:.`
            : `Fiche TMDB forcée (@tmdb:) introuvable pour "${event.title}" - vérifier le lien/l'identifiant.`;
        AdminIssuesService.report('tmdb-not-found', key, message);
        return;
    }
    if (!data.found) {
        AdminIssuesService.report('tmdb-not-found', key, `Aucune fiche TMDB trouvée pour "${event.title}" - possible de forcer avec @tmdb: si elle existe sous un autre titre.`);
        return;
    }
    AdminIssuesService.resolve('tmdb-not-found', key);
    if (Array.isArray(data.alternates) && data.alternates.length > 0) {
        AdminIssuesService.report('tmdb-ambiguous', key, `Plusieurs fiches TMDB possibles pour "${event.title}" - vérifier qu'il s'agit bien de la bonne, forcer avec @tmdb: sinon.`);
    } else {
        AdminIssuesService.resolve('tmdb-ambiguous', key);
    }
}

/**
 * Registre séparé (V2.10) du dernier `@tmdb:` connu pour chaque titre déjà vu, pour détecter
 * quand un organisateur AJOUTE/CORRIGE/RETIRE ce tag sur une ligne du tableur - la clé de cache
 * d'une fiche (normalizeKey) ne dépend que du TITRE, pas de son override, donc sans ce registre
 * un tel changement resterait invisible du cache local jusqu'à son expiration naturelle (jusqu'à
 * STALE_MAX_AGE_MS, vécu concrètement cette session). Distinct du cache fiche lui-même : ce n'est
 * qu'un petit journal de signatures, jamais lu pour l'affichage.
 * @param {Array<Object>} events - Tous les événements du dépôt (non filtrés).
 */
export function syncTmdbOverrideSignatures(events) {
    let signatures;
    try { signatures = JSON.parse(localStorage.getItem(OVERRIDE_SIGNATURES_KEY)) || {}; } catch { signatures = {}; }

    const seenTitles = new Set();
    let changed = false;

    events.filter(isTmdbEligible).forEach(e => {
        if (seenTitles.has(e.title)) return;
        seenTitles.add(e.title);
        const key = normalizeKey(e.title);
        const signature = e.meta?.tmdb || '';
        if (signatures[key] !== undefined && signatures[key] !== signature) {
            // Le @tmdb: de ce titre a changé depuis le dernier chargement connu (ajouté, corrigé
            // ou retiré) : la fiche déjà en cache correspond à l'ANCIEN override, à jeter.
            deleteFicheEntry(key);
            changed = true;
        }
        if (signatures[key] !== signature) { signatures[key] = signature; changed = true; }
    });

    if (changed) {
        try { localStorage.setItem(OVERRIDE_SIGNATURES_KEY, JSON.stringify(signatures)); } catch { /* tant pis */ }
    }
}
const OVERRIDE_SIGNATURES_KEY = 'tmdb:overrideSignatures:v1';

/**
 * Lecture SYNCHRONE (jamais de réseau) des épisodes d'une saison déjà en cache - même logique
 * que getCachedImageUrl (accepte une entrée stale-mais-utilisable, voir isUsable). Clé = série +
 * saison (une même série a plusieurs saisons, donc pas suffisant de ne clé que sur l'id TMDB).
 * @param {string} tmdbId
 * @param {number} season
 * @returns {Array<{episodeNumber: number, name: string, stillUrl: string|null}>|null}
 */
export function getCachedSeasonEpisodes(tmdbId, season) {
    const entry = getSeasonEntry(`${tmdbId}:${season}`);
    return isUsable(entry) && entry.found ? entry.episodes : null;
}

/**
 * Interroge le proxy n8n pour la liste des épisodes d'UNE saison d'une série TMDB - un seul appel
 * par saison (pas un par épisode), le résultat couvre alors TOUTES les occurrences de cette
 * saison quel que soit l'épisode précis affiché (voir _renderEpisodeThumbnails dans ModalView.js,
 * qui pioche dedans les numéros pertinents pour CETTE occurrence). Même stale-while-revalidate
 * que fetchTmdbInfo (V2.10, voir sa JSDoc pour le détail du mécanisme).
 * @param {string} tmdbId
 * @param {number} season
 * @param {{force?: boolean}} [options]
 * @returns {Promise<Array<{episodeNumber: number, name: string, stillUrl: string|null}>|null>}
 */
export async function fetchTmdbSeason(tmdbId, season, { force = false } = {}) {
    const key = `${tmdbId}:${season}`;
    const cached = getSeasonEntry(key);

    if (!force && isFresh(cached)) return cached.found ? cached.episodes : null;

    if (!force && isUsable(cached)) {
        if (!seasonRevalidating.has(key)) {
            seasonRevalidating.add(key);
            doFetchTmdbSeason(tmdbId, season, key).finally(() => seasonRevalidating.delete(key));
        }
        return cached.found ? cached.episodes : null;
    }

    return doFetchTmdbSeason(tmdbId, season, key);
}
const seasonRevalidating = new Set();

async function doFetchTmdbSeason(tmdbId, season, key) {
    const data = await requestTmdb({ action: 'season', tmdbId, season });
    if (!data) return null;

    const entry = { ...data, fetchedAt: Date.now(), schemaVersion: TMDB_CACHE_SCHEMA_VERSION };
    setSeasonEntry(key, entry);
    return data.found ? data.episodes : null;
}

const PRUNE_LAST_RUN_KEY = 'tmdb:cache:lastPrunedAt';
const PRUNE_INTERVAL_MS = 24 * 3600 * 1000; // Le TTL "utilisable" est de 30 jours - une fois par jour suffit largement.
const LEGACY_BLOB_MIGRATED_KEY = 'tmdb:cache:migratedV2';

/**
 * Purge les entrées expirées des deux caches (fiches + épisodes de saison) - sans ça, une entrée
 * ("trouvée" ou "pas trouvée") pour un titre qui ne revient jamais dans le planning s'accumule
 * indéfiniment dans localStorage, jamais retirée. À appeler une fois au démarrage (voir main.js) -
 * pas besoin à chaque chargement de page, un repère dans localStorage borne l'exécution réelle à
 * une fois par jour maximum. Profite du passage pour supprimer, une seule fois (V2.10), les deux
 * anciens blobs JSON pré-migration (`tmdb:cache:v1`/`tmdb:season-cache:v1`, un seul gros objet
 * pour tout le cache) devenus orphelins depuis le passage à une clé par entrée ci-dessus - sans
 * ça ils restent inertes dans localStorage indéfiniment.
 */
export function pruneTmdbCache() {
    try {
        if (!localStorage.getItem(LEGACY_BLOB_MIGRATED_KEY)) {
            localStorage.removeItem('tmdb:cache:v1');
            localStorage.removeItem('tmdb:season-cache:v1');
            localStorage.setItem(LEGACY_BLOB_MIGRATED_KEY, '1');
        }
    } catch { /* stockage indisponible - tant pis */ }

    try {
        const last = parseInt(localStorage.getItem(PRUNE_LAST_RUN_KEY) || '0', 10);
        if (Date.now() - last < PRUNE_INTERVAL_MS) return;
    } catch { /* repère illisible - on tente quand même la purge ci-dessous */ }

    [
        { mem: memFiches, prefix: FICHE_PREFIX },
        { mem: memSeasons, prefix: SEASON_PREFIX }
    ].forEach(({ mem, prefix }) => {
        listEntryKeys(prefix).forEach(key => {
            const entry = getEntry(mem, prefix, key);
            if (!isUsable(entry)) deleteEntry(mem, prefix, key);
        });
    });

    try { localStorage.setItem(PRUNE_LAST_RUN_KEY, Date.now().toString()); } catch { /* stockage indisponible - tant pis */ }
}

const FORCE_REWARM_DELAY_MS = 400;

/** Même repli que ModalView._renderEpisodeThumbnails pour déduire un numéro de saison : celui du
 * titre ("AHS S13") en priorité, sinon celui du texte d'épisode le plus récent ("S13 E10"). */
function guessSeasonNumber(event) {
    const episodeText = event.meta?.episode || event.meta?.diffusion || event.sub || event.episode || "";
    return parseSeasonNumber(event.title) ?? parseSeasonEpisode(episodeText)?.season ?? null;
}

/**
 * Action Admin (V2.9, voir mountTmdbCachePanel dans AdminView.js) : force un aller-retour réseau
 * pour les fiches et/ou saisons Film-Série éligibles du planning, même si le cache local est
 * encore utilisable - contrairement à prefetchTmdbImages (main.js), qui saute volontairement tout
 * ce qui est déjà frais et se limite à un petit lot. Utile pour peupler le cache PARTAGÉ côté n8n/
 * Grist juste après sa mise en place (sans ça, il ne se remplit qu'organiquement au fil des
 * visites), ou pour rafraîchir en masse après une correction côté n8n/tableur.
 * `scope` (V2.9) : une fois les FICHES déjà correctes en cache (Grist et local), inutile de
 * retaper une recherche TMDB par titre pour ne rafraîchir QUE les épisodes de saison (ex: après
 * un correctif touchant uniquement l'action "season" côté n8n) - `'seasons'` réutilise alors les
 * fiches déjà en cache LOCAL (getCachedTmdbInfo, aucun réseau) pour retrouver les tmdbId/saisons
 * concernés, sans consommer de nouveaux appels "search"/"details". Symétriquement, `'fiches'`
 * laisse les saisons intactes (utile pour ne pas rouvrir inutilement des saisons déjà bonnes le
 * temps de corriger uniquement les fiches).
 * Espacé (FORCE_REWARM_DELAY_MS) comme le prefetch, pour ne pas saturer le proxy n8n/TMDB - sur
 * plusieurs centaines de titres, l'opération complète peut prendre plusieurs minutes.
 * @param {Array<Object>} events - Tous les événements du dépôt (non filtrés).
 * @param {(progress: {phase: 'fiches'|'seasons', done: number, total: number}) => void} [onProgress]
 * @param {{scope?: 'all'|'fiches'|'seasons'}} [options]
 * @returns {Promise<{fichesTotal: number, fichesFound: number, seasonsTotal: number, seasonsFound: number, seasonsSkippedNoFiche: number}>}
 */
export async function forceRewarmTmdbCache(events, onProgress, { scope = 'all' } = {}) {
    const byTitle = new Map();
    events
        .filter(e => !e.isCanceled && isTmdbEligible(e))
        .forEach(e => { if (!byTitle.has(e.title)) byTitle.set(e.title, e); });
    const ficheEvents = [...byTitle.values()];

    const seasonKeys = new Map(); // `${tmdbId}:${season}` -> { tmdbId, season }
    let fichesFound = 0;
    let seasonsSkippedNoFiche = 0;

    if (scope === 'all' || scope === 'fiches') {
        for (let i = 0; i < ficheEvents.length; i++) {
            const event = ficheEvents[i];
            const info = await fetchTmdbInfo(event, { force: true });
            if (info) {
                fichesFound++;
                if (scope === 'all' && info.mediaType === 'tv') {
                    const season = guessSeasonNumber(event);
                    if (season != null) seasonKeys.set(`${info.id}:${season}`, { tmdbId: info.id, season });
                }
            }
            onProgress?.({ phase: 'fiches', done: i + 1, total: ficheEvents.length });
            await new Promise(r => setTimeout(r, FORCE_REWARM_DELAY_MS));
        }
    } else if (scope === 'seasons') {
        // Pas de réseau ici : on ne veut QUE les saisons, les fiches déjà en cache local suffisent
        // à retrouver tmdbId/mediaType (les mêmes que ce que prefetch/fetchTmdbInfo y ont déjà mis).
        for (const event of ficheEvents) {
            const info = getCachedTmdbInfo(event.title);
            if (!info) { seasonsSkippedNoFiche++; continue; }
            if (info.mediaType === 'tv') {
                const season = guessSeasonNumber(event);
                if (season != null) seasonKeys.set(`${info.id}:${season}`, { tmdbId: info.id, season });
            }
        }
    }

    const seasonList = scope === 'fiches' ? [] : [...seasonKeys.values()];
    let seasonsFound = 0;

    for (let i = 0; i < seasonList.length; i++) {
        const { tmdbId, season } = seasonList[i];
        const episodes = await fetchTmdbSeason(tmdbId, season, { force: true });
        if (episodes) seasonsFound++;
        onProgress?.({ phase: 'seasons', done: i + 1, total: seasonList.length });
        await new Promise(r => setTimeout(r, FORCE_REWARM_DELAY_MS));
    }

    return {
        fichesTotal: scope === 'seasons' ? 0 : ficheEvents.length,
        fichesFound,
        seasonsTotal: seasonList.length,
        seasonsFound,
        seasonsSkippedNoFiche
    };
}
