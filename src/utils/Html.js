/**
 * Échappe les caractères HTML spéciaux. À utiliser systématiquement autour de toute
 * donnée provenant du Google Sheet (titre, notes, tags, lieu, métadonnées...) avant
 * de l'injecter dans un template `innerHTML` : le tableur est public/collaboratif,
 * une cellule mal intentionnée ne doit jamais pouvoir exécuter du code chez les visiteurs.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Racine du dépôt (dossier contenant assets/), calculée depuis l'URL de CE module plutôt que
// depuis window.location.href : un chemin relatif comme "./assets/img/default/Movie
// Banner.png" (config.js) doit toujours pointer vers assets/ à la racine, que la page qui
// affiche la carte soit index.html (racine) ou une page dans un sous-dossier (ex: widget/).
const REPO_ROOT_URL = new URL('../..', import.meta.url).href;

/**
 * Valide qu'une valeur (URL @image/@lien du tableur, ou chemin local d'une bannière par
 * défaut dans config.js) est bien utilisable dans un `src`, un `href` ou un
 * `background-image` : ni `javascript:`, ni `data:`, ni tout autre schéma ne doit pouvoir
 * s'y glisser. Un chemin relatif local (ex: "./assets/img/default/Movie Banner.png") est
 * résolu par rapport à la racine du dépôt (voir REPO_ROOT_URL) ; une URL absolue (http/https)
 * est acceptée telle quelle, quelle que soit la page qui l'affiche.
 * @param {*} value
 * @returns {string} L'URL (absolue, espaces/accents encodés) si valide, sinon une chaîne vide.
 */
export function sanitizeUrl(value) {
    if (!value) return "";
    const trimmed = String(value).trim();
    try {
        const url = new URL(trimmed, REPO_ROOT_URL);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        return url.href;
    } catch {
        return "";
    }
}
