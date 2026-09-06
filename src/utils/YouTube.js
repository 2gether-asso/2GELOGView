/**
 * Extrait l'identifiant vidéo d'une URL YouTube (watch, youtu.be, shorts, embed...), pour
 * construire soi-même l'URL d'embed plutôt que de faire confiance à l'URL brute du tableur
 * dans un `src` d'iframe. L'id capturé n'est composé QUE de [A-Za-z0-9_-] (charset propre à
 * YouTube) : pas besoin d'échapper le HTML avant de l'interpoler, il ne peut pas casser hors
 * de l'attribut. Une URL qui ne correspond à aucun format connu retourne `null` (le clip est
 * alors ignoré plutôt que d'afficher une iframe cassée, voir ModalView._renderHighlights).
 * @param {string} url
 * @returns {string|null}
 */
export function extractYouTubeId(url) {
    if (!url) return null;
    const match = String(url).trim().match(
        /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([A-Za-z0-9_-]{6,15})/
    );
    return match ? match[1] : null;
}

/**
 * Titre réel d'une vidéo YouTube via l'oEmbed public (pas de clé API, CORS ouvert, conçu
 * précisément pour ce genre d'aperçu) - affiché sous la miniature du clip dans le bloc
 * Highlights (voir ModalView._renderHighlights). Comme PollService : ne bloque jamais le
 * rendu (la miniature/le bouton s'affichent immédiatement avec un titre générique), tolère
 * silencieusement l'échec (hors-ligne, vidéo supprimée, timeout) en renvoyant `null` plutôt
 * que de rejeter - l'appelant garde alors le titre générique déjà affiché.
 * @param {string} id
 * @returns {Promise<string|null>}
 */
export async function fetchYouTubeTitle(id) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(
            `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
            { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        const data = await res.json();
        return data.title || null;
    } catch {
        return null;
    }
}
