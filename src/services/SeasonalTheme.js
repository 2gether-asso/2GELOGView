import { CONFIG } from '../config.js';

// Couleurs d'accent réutilisées telles quelles depuis CONFIG.THEMES quand une saison correspond
// déjà à un type d'événement existant (pas de nouvelle couleur inventée pour celles-là) ; bgTint
// est propre à ce module (variante très sombre pour le fond radial, pas une donnée qui existe
// déjà ailleurs). Plage inclusive "moisJour" (ex: 1015 = 15 octobre) - voir getActiveSeason pour
// le cas d'une plage qui chevauche le 31 décembre -> 1er janvier (ex: "hiver").
//
// Ordre volontaire (V2.2, "couvrir un maximum de jours") : les occasions ciblées (Nouvel An,
// St-Valentin, Rentrée, Halloween, Noël, Fin d'année) sont listées EN PREMIER et gagnent sur les
// 4 saisons météo au sens large qui suivent, même quand leurs propres plages se chevauchent -
// getActiveSeason() renvoie le premier identifiant qui correspond, dans l'ordre de cet objet.
// Résultat : chaque jour de l'année a une saison active (jamais "rien"), avec une occasion
// précise mise en avant quand il y en a une, et une teinte météo douce en toile de fond sinon.
// `note` : phrase courte affichée dans l'infobulle du badge d'en-tête et dans le toast annonçant
// un changement de saison (voir refreshSeasonalTheme dans main.js).
// `particle` (V2.2) : emoji flottant discret propre à la saison (voir setupSeasonalParticles
// dans main.js), ou null pour une saison qui n'en a pas besoin (Été, Rentrée) - toutes n'ont pas
// vocation à avoir un effet, seulement celles où une pluie d'emoji est immédiatement reconnaissable
// (neige à Noël/en hiver, feuilles en automne, pétales au printemps, coeurs à la Saint-Valentin,
// confettis pour les fêtes de fin d'année) plutôt qu'un ajout systématique qui finirait par lasser.
export const SEASONS = {
    'nouvel-an': { emoji: '🎉', label: 'Nouvel An', color: '#f5c451', bgTint: '#241d08', from: 101, to: 106, note: 'On célèbre la nouvelle année ensemble !', particle: '✨' },
    'st-valentin': { emoji: '💖', label: 'St-Valentin', color: CONFIG.THEMES['Event St Valentin'].col, bgTint: '#24101a', from: 210, to: 215, note: 'La Saint-Valentin approche 💕', particle: '💕' },
    rentree: { emoji: '🎒', label: 'Rentrée', color: '#e08a3c', bgTint: '#231508', from: 901, to: 915, note: "C'est la rentrée : plein de nouvelles sessions à venir !", particle: null },
    halloween: { emoji: '🎃', label: 'Halloween', color: CONFIG.THEMES['Event Halloween'].col, bgTint: '#241708', from: 1015, to: 1101, note: "Ambiance Halloween jusqu'au 1er novembre 👻", particle: '🦇' },
    noel: { emoji: '🎄', label: 'Noël', color: CONFIG.THEMES['Event Nowel'].col, bgTint: '#0c1f13', from: 1201, to: 1226, note: 'Joyeuses fêtes de fin d\'année 🎁', particle: '❄️' },
    'fin-annee': { emoji: '✨', label: "Fin d'année", color: '#f5c451', bgTint: '#1c1808', from: 1227, to: 1231, note: 'Encore quelques jours avant la nouvelle année !', particle: '✨' },
    printemps: { emoji: '🌸', label: 'Printemps', color: '#f2a3c4', bgTint: '#1c1016', from: 320, to: 620, note: 'Le printemps est là 🌷', particle: '🌸' },
    ete: { emoji: '☀️', label: 'Été', color: '#f5d76e', bgTint: '#1f1c0a', from: 621, to: 921, note: "C'est l'été, profitez-en !", particle: null },
    automne: { emoji: '🍂', label: 'Automne', color: '#d97a3d', bgTint: '#1e1309', from: 922, to: 1130, note: "L'automne s'installe doucement 🍁", particle: '🍂' },
    hiver: { emoji: '❄️', label: 'Hiver', color: '#8ec6e6', bgTint: '#0c161f', from: 1220, to: 319, note: 'Il fait froid dehors, restons ensemble au chaud ❄️', particle: '❄️' }
};

// 'auto' (repose sur getActiveSeason ci-dessous) | 'none' (désactivé quelle que soit la date) |
// une clé de SEASONS (forcé, quelle que soit la date réelle) - voir #theme-select dans index.html.
const MANUAL_KEY = 'seasonal-theme:manual';

/**
 * Saison active à une date donnée (une seule à la fois - la première de SEASONS, dans son ordre
 * de déclaration, dont la plage contient cette date). Gère les plages qui chevauchent le 31
 * décembre -> 1er janvier (ex: "hiver", from > to) : dans ce cas la date correspond si elle est
 * après `from` OU avant `to`, plutôt qu'entre les deux.
 * @param {Date} date
 * @returns {string|null} clé de SEASONS - toujours non-null en pratique désormais (les saisons
 *   météo au sens large couvrent toute l'année), mais le type reste nullable par prudence.
 */
export function getActiveSeason(date = new Date()) {
    const key = (date.getMonth() + 1) * 100 + date.getDate();
    return Object.keys(SEASONS).find(id => {
        const { from, to } = SEASONS[id];
        return from <= to ? (key >= from && key <= to) : (key >= from || key <= to);
    }) || null;
}

/** @returns {'auto'|'none'|string} La préférence manuelle enregistrée, 'auto' par défaut. */
export function getManualOverride() {
    return localStorage.getItem(MANUAL_KEY) || 'auto';
}

/** @param {'auto'|'none'|string} value */
export function setManualOverride(value) {
    if (value === 'auto') localStorage.removeItem(MANUAL_KEY);
    else localStorage.setItem(MANUAL_KEY, value);
}

/**
 * Saison à réellement appliquer, en tenant compte d'un éventuel choix manuel (voir
 * #theme-select) : 'none' désactive tout, une clé de SEASONS force ce thème toute l'année,
 * 'auto' (par défaut) retombe sur la date réelle via getActiveSeason().
 * @param {Date} date
 * @returns {string|null}
 */
export function resolveActiveSeason(date = new Date()) {
    const manual = getManualOverride();
    if (manual === 'none') return null;
    if (manual !== 'auto') return SEASONS[manual] ? manual : null;
    return getActiveSeason(date);
}

/**
 * Applique (ou retire) le tint saisonnier sur <html> via des variables CSS (voir index.html :
 * html[data-season] ...) : purement cosmétique, ne modifie aucune donnée ni comportement.
 * @param {string|null} season
 * @returns {Object|null} la config de la saison appliquée (pour construire le badge UI), ou null
 */
export function applySeasonalTheme(season) {
    const root = document.documentElement;
    if (!season) {
        root.removeAttribute('data-season');
        return null;
    }
    const cfg = SEASONS[season];
    root.setAttribute('data-season', season);
    root.style.setProperty('--season-color', cfg.color);
    root.style.setProperty('--season-bg-tint', cfg.bgTint);
    return cfg;
}
