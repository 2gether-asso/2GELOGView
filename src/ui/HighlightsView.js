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
 * URL de la meilleure miniature YouTube disponible pour `id`, avec repli automatique via
 * `onerror` (V2.8) - `maxresdefault` (1280x720) n'existe que pour les vidéos qui ont vraiment un
 * thumbnail haute résolution ; sinon YouTube répond une 404 (vérifié empiriquement : contrairement
 * à une idée reçue, ce n'est PAS un succès HTTP avec un simple filler, donc `onerror` se déclenche
 * bien) - `hqdefault` (480x360, quasi toujours disponible) sert alors de repli. Utilisé pour les
 * vignettes réellement affichées en grand (rangée + cartes du carrousel) ; le fond flouté du
 * carrousel (voir updateGalleryBackdrop) garde `hqdefault` directement - inutile de payer le coût
 * d'une image plus lourde pour un calque qui sera de toute façon flouté à gros grain.
 * @param {string} id
 * @returns {{ src: string, fallback: string }}
 */
function youtubeThumbUrls(id) {
    return {
        src: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        fallback: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    };
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

/**
 * Vignette + bouton lecture pour UN identifiant YouTube isolé (V2.9), en dehors du système
 * Highlights (#highlight + @clip:/@short:/@screen:) - utilisée quand un lien YouTube est trouvé
 * TEL QUEL dans les Notes complémentaires libres d'un événement, souvent une rediffusion collée
 * là sans passer par la métadonnée @clip: dédiée (voir ModalView._renderNotesVideo). Volontairement
 * distinct du lecteur plein écran partagé (#highlight-lightbox) : cet événement n'est pas
 * forcément taggé #highlight, la vidéo se lit directement sur place dans la modale déjà ouverte,
 * pas besoin d'un second niveau de superposition. Clic géré par initInlineYouTubePlayers.
 * @param {string} id
 * @returns {string}
 */
export function renderInlineYouTubePlayer(id) {
    const thumb = youtubeThumbUrls(id);
    return `
        <button type="button" data-inline-yt-id="${id}" class="relative block w-full aspect-video rounded-lg overflow-hidden border border-white/10 bg-black group" aria-label="Lire la vidéo YouTube">
            <img src="${thumb.src}" onerror="this.onerror=null;this.src='${thumb.fallback}'" alt="" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-black/25 group-hover:bg-black/10 flex items-center justify-center transition-all">
                <div class="w-10 h-10 rounded-full bg-rose-600/90 flex items-center justify-center shadow-lg">${PLAY_ICON}</div>
            </div>
        </button>`;
}

let inlineYtInitialized = false;

/** Écouteur délégué (idempotent, comme initHighlightLightbox) pour les vignettes posées par
 * renderInlineYouTubePlayer - un seul appel à faire une fois au démarrage (voir main.js), quel
 * que soit le nombre de fois où la modale (ré)affiche une telle vignette. */
export function initInlineYouTubePlayers() {
    if (inlineYtInitialized) return;
    inlineYtInitialized = true;
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-inline-yt-id]');
        if (!btn) return;
        const id = btn.dataset.inlineYtId;
        btn.outerHTML = `<div class="relative w-full aspect-video rounded-lg overflow-hidden border border-white/10 bg-black"><iframe class="w-full h-full" src="https://www.youtube.com/embed/${id}?autoplay=1" title="Vidéo YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    });
}

function renderClipTile(id, format, sizeClass, index) {
    const isShort = format === 'short';
    const thumb = youtubeThumbUrls(id);
    return `
        <button data-highlight-index="${index}" data-clip-id="${id}" data-clip-format="${format}" class="${sizeClass} shrink-0 snap-start text-left group" aria-label="Voir ${isShort ? 'le short' : 'le clip'} en plein écran">
            <div class="relative ${isShort ? 'aspect-[9/16]' : 'aspect-video'} rounded-lg overflow-hidden border border-white/10 bg-black">
                <img src="${thumb.src}" onerror="this.onerror=null;this.src='${thumb.fallback}'" alt="" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/25 group-hover:bg-black/10 flex items-center justify-center transition-all">
                    <div class="w-8 h-8 rounded-full bg-rose-600/90 flex items-center justify-center shadow-lg">${PLAY_ICON}</div>
                </div>
            </div>
            <div data-clip-title="${id}" class="text-2xs text-slate-400 font-semibold mt-1 line-clamp-2">${isShort ? 'Short' : 'Clip vidéo'}</div>
        </button>`;
}

function renderScreenTile(url, sizeClass, index) {
    return `
        <button data-highlight-index="${index}" data-screen-url="${escapeHtml(url)}" class="${sizeClass} shrink-0 snap-start text-left group" aria-label="Voir la capture en plein écran">
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

    // data-highlight-index numérote CHAQUE vignette de la rangée (clips puis captures, même
    // ordre que ci-dessous) : au clic, le lecteur plein écran relit toute la rangée via
    // data-highlights-row pour construire le carrousel (voir initHighlightLightbox) plutôt que de
    // ne connaître que l'unique vignette cliquée.
    let index = 0;
    const tilesHtml = [
        ...clipItems.map(({ id, format }) => renderClipTile(id, format, w[format], index++)),
        ...screenUrls.map(url => renderScreenTile(url, w.screen, index++))
    ].join('');

    return `<div data-highlights-row class="flex gap-2 overflow-x-auto custom-scroll snap-x snap-mandatory pb-1">${tilesHtml}</div>`;
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
//
// V2.8 : carrousel façon Instagram plutôt qu'un visionneur mono-élément - la carte active est au
// centre en pleine taille, les cartes voisines apparaissent réduites/estompées de part et
// d'autre (pagination par points + flèches). `galleryItems`/`galleryIndex` tiennent l'état du
// carrousel actuellement ouvert (un seul à la fois, cohérent avec le lecteur partagé unique).

let lightboxInitialized = false;
let galleryItems = [];
let galleryIndex = 0;
// Éléments DOM PERSISTANTS d'une carte à l'autre (indexés comme galleryItems), construits une
// seule fois par openLightboxGallery puis seulement repositionnés/restylés à la navigation - pas
// régénérés à chaque clic. Nécessaire pour que les transitions CSS (transform/opacity) animent
// réellement : un élément recréé de zéro à chaque clic (ancienne implémentation, `track.innerHTML
// = ...` à chaque navigation) apparaît directement dans sa position finale, aucune transition ne
// peut s'appliquer entre deux nœuds DOM différents.
let galleryCardEls = [];
let galleryActiveIndex = null; // Dernier index dont la carte a reçu le contenu "actif" (lecteur/plein format) - pour ne retirer ce contenu QUE de cette carte-là lors d'un saut, pas de toutes.
let backdropCurrentIsA = true;

/**
 * Écouteurs du lecteur plein écran partagé - idempotent (peut être appelé plusieurs fois sans
 * dupliquer les listeners), à appeler une fois au démarrage de l'app (voir main.js). Un seul
 * écouteur de clic DÉLÉGUÉ sur `document` plutôt qu'un par vue qui affiche des vignettes : ouvre
 * le carrousel pour n'importe quelle rangée `[data-highlights-row]` cliquée où que ce soit
 * dans la page, sans qu'un nouvel appelant (TodayView, futur autre) ait besoin de rebrancher son
 * propre écouteur.
 */
export function initHighlightLightbox() {
    if (lightboxInitialized) return;
    lightboxInitialized = true;

    const overlay = document.getElementById('highlight-lightbox');
    document.getElementById('btn-close-highlight-lightbox').addEventListener('click', () => closeLightbox());
    document.getElementById('highlight-lightbox-stage').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeLightbox();
    });
    document.getElementById('btn-lightbox-prev').addEventListener('click', () => goToGalleryIndex(galleryIndex - 1));
    document.getElementById('btn-lightbox-next').addEventListener('click', () => goToGalleryIndex(galleryIndex + 1));
    document.addEventListener('keydown', (e) => {
        if (!isLightboxOpen()) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') goToGalleryIndex(galleryIndex - 1);
        else if (e.key === 'ArrowRight') goToGalleryIndex(galleryIndex + 1);
    });
    attachGallerySwipeHandlers();

    document.addEventListener('click', (e) => {
        // Carte voisine (réduite) ou point de pagination cliqué dans le carrousel déjà ouvert :
        // saute directement à cet élément plutôt que de re-parcourir prev/next un pas à la fois.
        const goBtn = e.target.closest('[data-gallery-go]');
        if (goBtn) { goToGalleryIndex(Number(goBtn.dataset.galleryGo)); return; }

        const tile = e.target.closest('[data-highlight-index]');
        if (!tile) return;
        const row = tile.closest('[data-highlights-row]');
        const items = row ? itemsFromRow(row) : [tileToItem(tile)];
        openLightboxGallery(items, Number(tile.dataset.highlightIndex));
    });
}

// Seuil de déclenchement (V2.8) : assez grand pour ne jamais confondre un simple tap (ouvrir la
// carte active en plein écran, cf. lecteur vidéo) avec un glisser, assez petit pour rester
// naturel au pouce. Le ratio horizontal/vertical évite de déclencher une navigation sur un
// scroll vertical accidentel (le carrousel lui-même ne défile pas verticalement, mais le doigt
// peut légèrement dériver pendant un swipe).
const SWIPE_THRESHOLD_PX = 50;
const SWIPE_DIRECTION_RATIO = 1.5;

/** Glisser tactile gauche/droite sur le carrousel (V2.8) - en plus des flèches/clavier/points
 * déjà en place, plus naturel au doigt sur mobile (contexte principal d'usage de ce carrousel).
 * `touchstart`/`touchend` plutôt que Pointer Events : seul le doigt (pas la souris/trackpad, où
 * cliquer les cartes/flèches reste le geste naturel) doit déclencher un swipe ici. */
function attachGallerySwipeHandlers() {
    const track = document.getElementById('highlight-lightbox-track');
    let startX = null;
    let startY = null;

    track.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { startX = null; return; }
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    track.addEventListener('touchend', (e) => {
        if (startX === null) return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        startX = null;
        startY = null;
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTION_RATIO) return;
        goToGalleryIndex(galleryIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
}

function tileToItem(tile) {
    return tile.dataset.clipId
        ? { type: 'clip', id: tile.dataset.clipId, format: tile.dataset.clipFormat }
        : { type: 'screen', url: tile.dataset.screenUrl };
}

function itemsFromRow(row) {
    return Array.from(row.querySelectorAll('[data-highlight-index]')).map(tileToItem);
}

export function isLightboxOpen() {
    return !document.getElementById('highlight-lightbox').classList.contains('hidden');
}

/**
 * Ouvre le carrousel sur `items` (voir tileToItem pour la forme de chaque élément), centré sur
 * `startIndex`. Une rangée d'un seul élément fonctionne aussi (flèches/points simplement absents).
 * @param {Array<{type: 'clip', id: string, format: 'video'|'short'}|{type: 'screen', url: string}>} items
 * @param {number} startIndex
 */
export function openLightboxGallery(items, startIndex = 0) {
    galleryItems = items;
    galleryIndex = Math.max(0, Math.min(items.length - 1, startIndex));
    galleryActiveIndex = null;
    buildGalleryTrack();
    renderGalleryDots();
    updateGalleryBackdrop(true);
    updateGalleryLiveRegion();
    showLightbox();
}

/** Rétro-compatibilité : ouvre le carrousel avec un seul clip (pas de voisins). */
export function openLightboxClip(id, format = 'video') {
    openLightboxGallery([{ type: 'clip', id, format }], 0);
}

/** Rétro-compatibilité : ouvre le carrousel avec une seule capture (pas de voisins). */
export function openLightboxImage(url) {
    openLightboxGallery([{ type: 'screen', url }], 0);
}

function goToGalleryIndex(index) {
    if (galleryItems.length === 0) return;
    galleryIndex = (index + galleryItems.length) % galleryItems.length;
    updateGalleryPositions();
    renderGalleryDots();
    updateGalleryBackdrop();
    updateGalleryLiveRegion();
}

/** Annonce "Élément X sur Y" aux lecteurs d'écran (V2.8, voir #highlight-lightbox-live dans
 * index.html) à chaque ouverture/navigation - le déplacement des cartes (transform CSS) n'est
 * sinon perceptible que visuellement. Rien à annoncer pour une rangée d'un seul élément (pas de
 * navigation possible, ce serait juste du bruit). */
function updateGalleryLiveRegion() {
    const live = document.getElementById('highlight-lightbox-live');
    if (!live) return;
    live.textContent = galleryItems.length > 1 ? `Élément ${galleryIndex + 1} sur ${galleryItems.length}` : '';
}

function galleryThumbUrl(item) {
    return item.type === 'clip' ? `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` : item.url;
}

/** Gabarit (taille + ratio) de la carte, adapté au type/format de l'élément plutôt qu'un
 * cadre 16:9 unique imposé à tout : un short (9:16) reste vertical et étroit, un clip/capture
 * (16:9) reste large - chacun garde son format naturel, comme dans la rangée de vignettes
 * (voir TILE_WIDTH) plutôt que d'être forcé dans un cadre paysage commun. */
function galleryCardFrameClass(item) {
    if (item.type === 'clip' && item.format === 'short') return 'w-[min(42vw,340px)] aspect-[9/16]';
    return 'w-[min(70vw,620px)] aspect-video';
}

/** Contenu d'une carte : lecteur vidéo/image plein format pour la carte active, simple vignette
 * statique pour les cartes voisines (pas d'iframe YouTube chargée en arrière-plan). */
function renderGalleryCardInner(item, isActive) {
    if (item.type === 'clip') {
        if (isActive) {
            return `<iframe class="w-full h-full" src="https://www.youtube.com/embed/${item.id}?autoplay=1" title="${item.format === 'short' ? 'Short' : 'Clip'} YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        }
        const thumb = youtubeThumbUrls(item.id);
        return `
            <img src="${thumb.src}" onerror="this.onerror=null;this.src='${thumb.fallback}'" alt="" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-black/35 flex items-center justify-center">
                <div class="w-10 h-10 rounded-full bg-rose-600/90 flex items-center justify-center shadow-lg">${PLAY_ICON}</div>
            </div>`;
    }
    return `<img src="${escapeHtml(item.url)}" alt="Capture d'écran" class="w-full h-full ${isActive ? 'object-contain' : 'object-cover'}">`;
}

/** Position/échelle/opacité d'une carte selon sa distance à la carte active (0 = active, centrée
 * plein format ; ±1 = les deux voisines immédiates, rapprochées/réduites/estompées de part et
 * d'autre façon coverflow, en partie CACHÉES derrière la carte active - comme la référence
 * Instagram, plutôt que largement séparées ; au-delà, la carte reste hors champ). */
function galleryCardTransform(offset) {
    if (offset === 0) return { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, zIndex: 30 };
    const dir = offset > 0 ? 1 : -1;
    // Le -50% recentre la carte (positionnée en left:50%/top:50%) ; le décalage de "pic" est
    // exprimé en vw (relatif à la largeur de la fenêtre), pas en % (relatif à la largeur de LA
    // CARTE ELLE-MÊME - mélangé au recentrage -50%, ce dernier donnait un résultat imprévisible
    // selon le signe). 16vw suffit à faire "peek" une carte partiellement cachée derrière la
    // carte active sans la rendre inaccessible au clic (sa portion visible, hors du recouvrement,
    // reste cliquable - vérifié à la fois en desktop et en mobile ~390px).
    if (Math.abs(offset) > 1) {
        return { transform: `translate(calc(-50% + ${dir * 16}vw), -50%) scale(0.72)`, opacity: 0, zIndex: 10 };
    }
    return { transform: `translate(calc(-50% + ${dir * 16}vw), -50%) scale(0.72)`, opacity: 0.5, zIndex: 20 };
}

function applyGalleryCardStyle(el, offset) {
    const isActive = offset === 0;
    const t = galleryCardTransform(offset);
    el.style.transform = t.transform;
    el.style.opacity = String(t.opacity);
    el.style.zIndex = String(t.zIndex);
    el.style.pointerEvents = Math.abs(offset) > 1 ? 'none' : 'auto';
    el.classList.toggle('border-white/15', isActive);
    el.classList.toggle('border-white/5', !isActive);
    el.classList.toggle('cursor-pointer', !isActive);
    if (isActive) el.removeAttribute('data-gallery-go');
    else el.setAttribute('data-gallery-go', el.dataset.galleryIndex);
}

/** Construit les cartes UNE FOIS pour le carrousel qui vient de s'ouvrir (voir
 * openLightboxGallery) - positionnées sans transition pour ce premier rendu (rien à animer
 * depuis un état précédent), la transition de la classe ne s'appliquant qu'aux navigations
 * suivantes (voir updateGalleryPositions/goToGalleryIndex). */
function buildGalleryTrack() {
    const track = document.getElementById('highlight-lightbox-track');
    if (!track) return;
    track.innerHTML = '';
    galleryCardEls = galleryItems.map((item, i) => {
        const isActive = i === galleryIndex;
        const el = document.createElement('div');
        el.dataset.galleryIndex = String(i);
        el.className = `absolute left-1/2 top-1/2 ${galleryCardFrameClass(item)} rounded-2xl overflow-hidden bg-black shadow-2xl border transition-[transform,opacity] duration-300 ease-out`;
        el.style.transition = 'none';
        // Contenu initial posé directement ici (vignette, ou lecteur plein format pour la carte de
        // départ) - applyGalleryCardStyle ne touche qu'au positionnement/style, pas au contenu ;
        // sans cette pose initiale, seules les DEUX cartes concernées par le premier appel à
        // refreshGalleryActiveContent (ci-dessous) recevraient un contenu, toutes les autres
        // cartes voisines resteraient vides.
        el.innerHTML = renderGalleryCardInner(item, isActive);
        applyGalleryCardStyle(el, i - galleryIndex);
        track.appendChild(el);
        return el;
    });
    galleryActiveIndex = galleryIndex;
    // Force le navigateur à peindre la position ci-dessus AVANT de réactiver la transition -
    // sans ce reflow forcé, le retrait de `transition:none` juste après repasserait par le même
    // batch de style que la pose initiale et une navigation immédiatement suivante repartirait en
    // l'animant depuis zéro (coin de l'écran) plutôt que depuis sa position actuelle.
    void track.offsetWidth;
    galleryCardEls.forEach(el => { el.style.transition = ''; });
}

/** Repositionne les cartes déjà en place (navigation dans un carrousel déjà ouvert) - anime via
 * la transition CSS posée par buildGalleryTrack, aucune carte n'est recréée. */
function updateGalleryPositions() {
    galleryCardEls.forEach((el, i) => applyGalleryCardStyle(el, i - galleryIndex));
    refreshGalleryActiveContent();
}

/** Bascule le contenu "actif" (lecteur vidéo plein format / image non recadrée) UNIQUEMENT entre
 * l'ancienne et la nouvelle carte active - les autres gardent leur simple vignette statique
 * inchangée, y compris après un saut de plusieurs crans (clic sur un point de pagination). */
function refreshGalleryActiveContent() {
    if (galleryActiveIndex === galleryIndex) return;
    if (galleryActiveIndex !== null && galleryCardEls[galleryActiveIndex]) {
        galleryCardEls[galleryActiveIndex].innerHTML = renderGalleryCardInner(galleryItems[galleryActiveIndex], false);
    }
    const activeEl = galleryCardEls[galleryIndex];
    if (activeEl) activeEl.innerHTML = renderGalleryCardInner(galleryItems[galleryIndex], true);
    galleryActiveIndex = galleryIndex;
}

/** Fond flouté (voir #highlight-lightbox-backdrop dans index.html) : deux calques superposés
 * dont on bascule l'opacité en alternance pour un fondu enchaîné - `background-image` ne
 * s'anime pas nativement en CSS, changer l'image d'un seul calque produirait un cut sec. */
function updateGalleryBackdrop(instant = false) {
    const item = galleryItems[galleryIndex];
    if (!item) return;
    const showEl = document.getElementById(backdropCurrentIsA ? 'highlight-lightbox-backdrop-b' : 'highlight-lightbox-backdrop-a');
    const hideEl = document.getElementById(backdropCurrentIsA ? 'highlight-lightbox-backdrop-a' : 'highlight-lightbox-backdrop-b');
    if (!showEl || !hideEl) return;
    if (instant) { showEl.style.transition = 'none'; hideEl.style.transition = 'none'; }
    showEl.style.backgroundImage = `url('${galleryThumbUrl(item)}')`;
    showEl.style.opacity = '1';
    hideEl.style.opacity = '0';
    if (instant) {
        void showEl.offsetWidth;
        showEl.style.transition = '';
        hideEl.style.transition = '';
    }
    backdropCurrentIsA = !backdropCurrentIsA;
}

function renderGalleryDots() {
    const dots = document.getElementById('highlight-lightbox-dots');
    if (!dots) return;
    if (galleryItems.length <= 1) { dots.innerHTML = ''; return; }
    dots.innerHTML = galleryItems.map((_, i) => `
        <button data-gallery-go="${i}" aria-label="Aller à l'élément ${i + 1}" ${i === galleryIndex ? 'aria-current="true"' : ''} class="h-1.5 rounded-full transition-all ${i === galleryIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/30 hover:bg-white/50'}"></button>`
    ).join('');
}

function showLightbox() {
    const overlay = document.getElementById('highlight-lightbox');
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    const hasMultiple = galleryItems.length > 1;
    document.getElementById('btn-lightbox-prev').classList.toggle('hidden', !hasMultiple);
    document.getElementById('btn-lightbox-next').classList.toggle('hidden', !hasMultiple);
}

export function closeLightbox() {
    const overlay = document.getElementById('highlight-lightbox');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    // Décharge le contenu (iframe/img) pour couper net une éventuelle lecture vidéo, plutôt que
    // de la laisser tourner en arrière-plan derrière la modale/vue rouverte.
    document.getElementById('highlight-lightbox-track').innerHTML = '';
    document.getElementById('highlight-lightbox-dots').innerHTML = '';
    // Fond flouté remis à zéro (sans transition, la boîte est déjà masquée) pour ne pas laisser
    // transparaître l'ancienne image un court instant à la prochaine ouverture.
    ['highlight-lightbox-backdrop-a', 'highlight-lightbox-backdrop-b'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.transition = 'none';
        el.style.opacity = '0';
        el.style.backgroundImage = '';
    });
    backdropCurrentIsA = true;
    galleryItems = [];
    galleryIndex = 0;
    galleryCardEls = [];
    galleryActiveIndex = null;
}
