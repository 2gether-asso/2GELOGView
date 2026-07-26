import { CONFIG } from '../config.js';

// Couleurs d'accent réutilisées telles quelles depuis CONFIG.THEMES (pas de nouvelle couleur
// inventée) ; bgTint est propre à ce module (variante très sombre pour le fond radial, pas
// une donnée qui existe déjà ailleurs). Plage inclusive "moisJour" (ex: 1015 = 15 octobre).
export const SEASONS = {
    halloween: { emoji: '🎃', label: 'Halloween', color: CONFIG.THEMES['Event Halloween'].col, bgTint: '#241708', from: 1015, to: 1101 },
    noel: { emoji: '🎄', label: 'Noël', color: CONFIG.THEMES['Event Nowel'].col, bgTint: '#0c1f13', from: 1201, to: 1226 },
    'st-valentin': { emoji: '💖', label: 'St-Valentin', color: CONFIG.THEMES['Event St Valentin'].col, bgTint: '#24101a', from: 210, to: 215 }
};

// 'auto' (repose sur getActiveSeason ci-dessous) | 'none' (désactivé quelle que soit la date) |
// une clé de SEASONS (forcé, quelle que soit la date réelle) - voir #theme-select dans index.html.
const MANUAL_KEY = 'seasonal-theme:manual';

/**
 * Saison active à une date donnée (une seule à la fois, aucune plage ne se chevauche).
 * @param {Date} date
 * @returns {string|null} clé de SEASONS, ou null hors saison
 */
export function getActiveSeason(date = new Date()) {
    const key = (date.getMonth() + 1) * 100 + date.getDate();
    return Object.keys(SEASONS).find(id => key >= SEASONS[id].from && key <= SEASONS[id].to) || null;
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
