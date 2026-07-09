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

/**
 * Valide qu'une valeur (URL @image/@lien du tableur, ou chemin local d'une bannière par
 * défaut dans config.js) est bien utilisable dans un `src`, un `href` ou un
 * `background-image` : ni `javascript:`, ni `data:`, ni tout autre schéma ne doit pouvoir
 * s'y glisser. Le chemin est résolu par rapport à la page courante (base) pour accepter
 * aussi bien une URL absolue (http/https) qu'un chemin relatif local (ex:
 * "./assets/img/default/Movie Banner.png").
 * @param {*} value
 * @returns {string} L'URL (absolue, espaces/accents encodés) si valide, sinon une chaîne vide.
 */
export function sanitizeUrl(value) {
    if (!value) return "";
    const trimmed = String(value).trim();
    try {
        const url = new URL(trimmed, window.location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        return url.href;
    } catch {
        return "";
    }
}
