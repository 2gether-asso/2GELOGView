/**
 * Formate une durée en minutes en "XhYY" (ex: 90 -> "1h30") ou "Y min" en dessous
 * d'une heure. Partagé par le tableau de bord, la recherche et la rétrospective
 * admin pour n'avoir qu'un seul format de durée dans toute l'application.
 * @param {number} totalMinutes
 * @returns {string}
 */
export function formatMinutes(totalMinutes) {
    if (!totalMinutes) return "0 min";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes} min`;
}

/**
 * Classe un objet { clé: minutes } et garde les n plus grandes valeurs, en excluant les
 * clés "aucun(e)" (valeur par défaut de StatsService quand la métadonnée n'est pas
 * renseignée) : partagé par la rétrospective admin et le panneau de statistiques.
 * @param {Object<string, number>} obj
 * @param {number} n
 * @returns {Array<[string, number]>}
 */
export function topN(obj, n = 5) {
    return Object.entries(obj)
        .filter(([key]) => key && key !== "aucun" && key !== "aucune")
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}

// Libellés lisibles pour quelques catégories courtes (config.js THEMES[...].cat) qui ne se
// prêtent pas bien à une simple capitalisation ("irl" -> "IRL" plutôt que "Irl").
const CATEGORY_LABEL_OVERRIDES = { irl: "IRL", jdr: "JDR" };

/**
 * Formate une catégorie (config.js THEMES[...].cat) en libellé lisible. Partagé par la
 * barre de filtres, le tableau de bord et la rétrospective annuelle.
 * @param {string} cat
 * @returns {string}
 */
export function formatCategoryLabel(cat) {
    if (CATEGORY_LABEL_OVERRIDES[cat]) return CATEGORY_LABEL_OVERRIDES[cat];
    return cat.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convertit des minutes en "XjYh" au-delà d'une journée (ex: 780 -> "13j"), ou délègue à
 * formatMinutes en dessous — pour un gros total cumulé (rétrospective annuelle) plus
 * parlant qu'un simple compteur d'heures à trois chiffres.
 * @param {number} totalMinutes
 * @returns {string}
 */
export function formatDurationLong(totalMinutes) {
    if (!totalMinutes) return "0 min";
    const days = Math.floor(totalMinutes / 1440);
    if (days === 0) return formatMinutes(totalMinutes);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    return hours > 0 ? `${days}j ${hours}h` : `${days}j`;
}
