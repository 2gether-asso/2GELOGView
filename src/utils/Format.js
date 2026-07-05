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
