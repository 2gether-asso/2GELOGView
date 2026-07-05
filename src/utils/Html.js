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
 * Valide qu'une valeur fournie par le tableur (@image, @lien) est bien une URL
 * http(s) avant de l'utiliser dans un `src`, un `href` ou un `background-image` :
 * ni `javascript:`, ni `data:`, ni tout autre schéma ne doit pouvoir s'y glisser.
 * @param {*} value
 * @returns {string} L'URL si valide, sinon une chaîne vide.
 */
export function sanitizeUrl(value) {
    if (!value) return "";
    const trimmed = String(value).trim();
    try {
        const url = new URL(trimmed);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        return url.href;
    } catch {
        return "";
    }
}
