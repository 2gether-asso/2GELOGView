import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { extractYouTubeId, fetchYouTubeTitle } from '../utils/YouTube.js';

/**
 * Highlights (V2.6) : clips/shorts YouTube (@clip:/@short:) et captures d'écran (@screen:) d'un
 * événement, réservés à ceux qui portent le tag #highlight - voir GUIDE_METADONNEES.md §11.
 * Module partagé entre toutes les vues qui les affichent (modale d'événement, "Aujourd'hui sur
 * 2GETHER"...) : un seul rendu de vignette, un seul lecteur plein écran partagé
 * (#highlight-lightbox), pour que le format/comportement reste identique partout plutôt que
 * réinventé à chaque nouvel endroit.
 */

const PLAY_ICON = '<svg viewBox="0 0 24 24" class="w-4 h-4 text-white translate-x-[1px]" aria-hidden="true"><polygon points="8 5 19 12 8 19" fill="currentColor" stroke="none"></polygon></svg>';
const EXPAND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 text-white" aria-hidden="true"><path d="M9 4H4v5"></path><path d="M15 4h5v5"></path><path d="M9 20H4v-5"></path><path d="M15 20h5v-5"></path></svg>';

// 'normal' (modale, plus de place) vs 'compact' (nichée sous une carte événement plus étroite,
// voir TodayView.js) - même mise en forme, juste des vignettes plus petites.
const TILE_WIDTH = {
    normal: { video: 'w-40', short: 'w-24', screen: 'w-40' },
    compact: { video: 'w-28', short: 'w-20', screen: 'w-28' }
};

export function hasHighlightTag(event) {
    return (event.tags || []).includes('highlight');
}

/**
 * Une valeur `@screen:` sans schéma (juste un nom de fichier, ex: "zevent-2026.png") est
 * résolue dans assets/img/highlights/ (voir son README.md et GUIDE_METADONNEES.md §11) - pour
 * ne pas obliger à coller une URL complète à chaque capture uploadée dans le repo. Une URL
 * http(s) complète (ex: imgbb, pour qui n'a pas accès en écriture au repo) reste utilisable
 * telle quelle.
 */
export function resolveScreenUrl(value) {
    if (!value) return '';
    const trimmed = String(value).trim();
    return /^https?:\/\//i.test(trimmed) ? sanitizeUrl(trimmed) : sanitizeUrl(`./assets/img/highlights/${trimmed}`);
}

/**
 * @clip (16:9) et @short (9:16, Shorts YouTube) partagent la même extraction d'id (un Short
 * reste une vidéo YouTube comme une autre) mais gardent leur format d'origine (voir
 * openLightboxClip) - distingué dès ici plutôt que deviné a posteriori depuis l'URL.
 * @param {Object} event
 * @returns {{ clipItems: Array<{id: string, format: 'video'|'short'}>, screenUrls: string[] }}
 */
export function getHighlightItems(event) {
    if (!hasHighlightTag(event)) return { clipItems: [], screenUrls: [] };
    const toItems = (values, format) => (values || [])
        .map(v => ({ id: extractYouTubeId(v), format }))
        .filter(item => item.id);
    return {
        clipItems: [...toItems(event.clips, 'video'), ...toItems(event.shorts, 'short')],
        screenUrls: (event.screens || []).map(resolveScreenUrl).filter(Boolean)
    };
}

/** Est-ce qu'il y a quoi que ce soit à afficher pour cet événement ? Utilisé aussi bien pour
 * décider d'appeler renderHighlightsRow que pour un simple badge indicateur sur une carte
 * (voir EventCardTemplate.renderHighlightBadge). */
export function hasHighlights(event) {
    const { clipItems, screenUrls } = getHighlightItems(event);
    return clipItems.length > 0 || screenUrls.length > 0;
}

function renderClipTile(id, format, sizeClass) {
    const isShort = format === 'short';
    return `
        <button data-clip-id="${id}" data-clip-format="${format}" class="${sizeClass} shrink-0 snap-start text-left group" aria-label="Voir ${isShort ? 'le short' : 'le clip'} en plein écran">
            <div class="relative ${isShort ? 'aspect-[9/16]' : 'aspect-video'} rounded-lg overflow-hidden border border-white/10 bg-black">
                <img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/25 group-hover:bg-black/10 flex items-center justify-center transition-all">
                    <div class="w-8 h-8 rounded-full bg-rose-600/90 flex items-center justify-center shadow-lg">${PLAY_ICON}</div>
                </div>
            </div>
            <div data-clip-title="${id}" class="text-2xs text-slate-400 font-semibold mt-1 line-clamp-2">${isShort ? 'Short' : 'Clip vidéo'}</div>
        </button>`;
}

function renderScreenTile(url, sizeClass) {
    return `
        <button data-screen-url="${escapeHtml(url)}" class="${sizeClass} shrink-0 snap-start text-left group" aria-label="Voir la capture en plein écran">
            <div class="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-black/20">
                <img src="${escapeHtml(url)}" alt="Capture d'écran" class="w-full h-full object-cover" loading="lazy">
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                    <div class="w-7 h-7 rounded-full bg-black/70 flex items-center justify-center">${EXPAND_ICON}</div>
                </div>
            </div>
            <div class="text-2xs text-slate-400 font-semibold mt-1">Capture</div>
        </button>`;
}

/**
 * Rangée de vignettes cliquables (clips/shorts/captures) pour UN événement - clips/shorts et
 * captures mélangés dans un même défilement horizontal plutôt qu'en sections séparées (V2.6.1,
 * plus compact, surtout utile dans la modale où l'espace vertical est limité - voir historique
 * "ça coupe la modale"). Chaîne vide si l'événement n'a rien à montrer (pas de tag #highlight,
 * ou aucun @clip/@short/@screen valide).
 * @param {Object} event
 * @param {{size?: 'normal'|'compact'}} [opts]
 * @returns {string}
 */
export function renderHighlightsRow(event, { size = 'normal' } = {}) {
    const { clipItems, screenUrls } = getHighlightItems(event);
    if (clipItems.length === 0 && screenUrls.length === 0) return '';
    const w = TILE_WIDTH[size] || TILE_WIDTH.normal;

    const tilesHtml = [
        ...clipItems.map(({ id, format }) => renderClipTile(id, format, w[format])),
        ...screenUrls.map(url => renderScreenTile(url, w.screen))
    ].join('');

    return `<div class="flex gap-2 overflow-x-auto custom-scroll snap-x snap-mandatory pb-1">${tilesHtml}</div>`;
}

/**
 * Titre réel des clips affiché en second temps (oEmbed YouTube, voir fetchYouTubeTitle) : le
 * placeholder générique de renderClipTile s'affiche immédiatement, jamais bloqué par ce fetch
 * optionnel. À appeler une fois après avoir injecté le HTML de renderHighlightsRow dans le DOM
 * (voir ModalView._renderHighlights / TodayView.js).
 * @param {HTMLElement} root - Conteneur (ou ancêtre) dans lequel chercher les vignettes de clips.
 */
export function enhanceHighlightTitles(root) {
    root.querySelectorAll('[data-clip-title]').forEach(el => {
        const id = el.dataset.clipTitle;
        fetchYouTubeTitle(id).then(title => {
            if (title) el.textContent = title;
        });
    });
}

// --- Visionneuse plein écran partagée (#highlight-lightbox, voir index.html) ---

let lightboxInitialized = false;

/**
 * Écouteurs du lecteur plein écran partagé - idempotent (peut être appelé plusieurs fois sans
 * dupliquer les listeners), à appeler une fois au démarrage de l'app (voir main.js). Un seul
 * écouteur de clic DÉLÉGUÉ sur `document` plutôt qu'un par vue qui affiche des vignettes : ouvre
 * la visionneuse pour n'importe quel `[data-clip-id]`/`[data-screen-url]` cliqué où que ce soit
 * dans la page, sans qu'un nouvel appelant (TodayView, futur autre) ait besoin de rebrancher son
 * propre écouteur.
 */
export function initHighlightLightbox() {
    if (lightboxInitialized) return;
    lightboxInitialized = true;

    const overlay = document.getElementById('highlight-lightbox');
    document.getElementById('btn-close-highlight-lightbox').addEventListener('click', () => closeLightbox());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLightbox(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isLightboxOpen()) closeLightbox();
    });

    document.addEventListener('click', (e) => {
        const clipBtn = e.target.closest('[data-clip-id]');
        if (clipBtn) { openLightboxClip(clipBtn.dataset.clipId, clipBtn.dataset.clipFormat); return; }
        const screenBtn = e.target.closest('[data-screen-url]');
        if (screenBtn) openLightboxImage(screenBtn.dataset.screenUrl);
    });
}

export function isLightboxOpen() {
    return !document.getElementById('highlight-lightbox').classList.contains('hidden');
}

/**
 * @param {string} format - 'video' (16:9, @clip:) ou 'short' (9:16, @short:). Embed natif
 * YouTube (youtube.com, pas youtube-nocookie.com) sur les deux formats.
 */
export function openLightboxClip(id, format = 'video') {
    const isShort = format === 'short';
    const wrapperClass = isShort ? 'w-full max-w-xs mx-auto aspect-[9/16]' : 'w-full aspect-video';
    document.getElementById('highlight-lightbox-content').innerHTML = `
        <div class="${wrapperClass}">
            <iframe class="w-full h-full rounded-xl" src="https://www.youtube.com/embed/${id}?autoplay=1" title="${isShort ? 'Short' : 'Clip'} YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>`;
    showLightbox();
}

export function openLightboxImage(url) {
    document.getElementById('highlight-lightbox-content').innerHTML =
        `<img src="${escapeHtml(url)}" alt="Capture d'écran" class="max-w-full max-h-[85vh] object-contain rounded-xl">`;
    showLightbox();
}

function showLightbox() {
    const overlay = document.getElementById('highlight-lightbox');
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
}

export function closeLightbox() {
    const overlay = document.getElementById('highlight-lightbox');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    // Décharge le contenu (iframe/img) pour couper net une éventuelle lecture vidéo, plutôt que
    // de la laisser tourner en arrière-plan derrière la modale/vue rouverte.
    document.getElementById('highlight-lightbox-content').innerHTML = '';
}
