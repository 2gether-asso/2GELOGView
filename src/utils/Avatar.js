import { escapeHtml } from './Html.js';

// Palette de teintes fixe (pas une couleur HSL calculée à la volée) : garantit un résultat
// toujours lisible sur le fond sombre de l'app, quel que soit le nom - une teinte HSL générée
// dynamiquement pourrait tomber sur une luminosité trop proche du fond.
const AVATAR_HUES = [
    '#6366f1', '#818cf8', '#34d399', '#f59e0b', '#f43f5e',
    '#ec4899', '#22d3ee', '#a855f7', '#84cc16', '#fb923c'
];

/** Hash simple (djb2) d'une chaîne -> entier positif, pour choisir une couleur stable par nom. */
function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    return Math.abs(hash);
}

/**
 * Avatar généré à partir d'un nom (V2.2) : pastille colorée + initiales, pour repérer un
 * organisateur d'un coup d'oeil dans une liste plutôt que de devoir lire le nom en entier -
 * couleur stable pour un même nom (hash), pas aléatoire à chaque rendu.
 * @param {string} name
 * @param {string} [sizeClasses] - Classes Tailwind de taille (par défaut "w-6 h-6 text-2xs")
 * @returns {string}
 */
export function renderAvatarInitials(name, sizeClasses = 'w-6 h-6 text-2xs') {
    const trimmed = (name || '').trim();
    if (!trimmed) return '';
    const initials = trimmed
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w[0])
        .join('')
        .toUpperCase();
    const color = AVATAR_HUES[hashString(trimmed.toLowerCase()) % AVATAR_HUES.length];
    return `<span class="inline-flex items-center justify-center rounded-full font-black text-white shrink-0 ${sizeClasses}" style="background:${color}" title="${escapeHtml(trimmed)}" aria-hidden="true">${escapeHtml(initials)}</span>`;
}
