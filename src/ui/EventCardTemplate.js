import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { CONFIG } from '../config.js';

// Les visuels sources sont en format portrait (~8:9). On force ce ratio sur les
// vignettes plutôt qu'un cadre carré pour éviter le crop "object-cover" sur un carré.
const ICON_ASPECT_CLASS = "aspect-[8/9]";

const STATUS_STYLES = {
    "Prévu": { icon: "🔵", classes: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
    "En Cours": { icon: "🟢", classes: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    "Terminé": { icon: "⚪", classes: "text-slate-400 bg-white/5 border-white/10" }
};

/**
 * Badge "Prévu / En Cours / Terminé", calculé par EventGenerator selon la présence
 * et le dépassement (ou non) d'une date de fin.
 */
export function renderStatusBadge(status) {
    const style = STATUS_STYLES[status];
    if (!style) return '';
    return `<span class="text-[11px] font-bold px-2 py-0.5 rounded-md border ${style.classes}">${style.icon} ${escapeHtml(status)}</span>`;
}

/**
 * @episode/@diffusion explicite > texte de la ligne datée ("DD/MM/YYYY: ...") > numéro
 * auto-généré. Fonctionne pour tous les types (série ou non) : dès qu'une info
 * d'épisode existe, elle s'affiche. Partagé par toutes les vues (tuiles, recherche,
 * modale) pour n'avoir qu'un seul endroit où cette priorité est définie.
 * @param {Object} e
 * @returns {string}
 */
export function getEpisodeLabel(e) {
    return e.meta?.episode || e.meta?.diffusion || e.sub || e.episode || "";
}

/** Chemin de l'icône de catégorie, avec repli sur l'icône générique "Hors Prog". */
export function getIconSrc(e) {
    return e.img ? `./assets/img/${e.img}` : './assets/img/hors-prog.png';
}

export function renderEventCard(e, readableDate = null) {
    const detailsEpisode = escapeHtml(getEpisodeLabel(e));
    // e.location est toujours renseigné par EventGenerator (avec un lieu par défaut).
    const location = e.location && e.location !== CONFIG.DEFAULT_LOCATION ? escapeHtml(e.location) : "";
    const title = escapeHtml(e.title);
    const type = escapeHtml(e.type || 'Événement');

    const iconSrc = getIconSrc(e);
    // @image : affiche/jaquette du film, de la série ou du jeu, en fond translucide
    // de la tuile (métadonnée manuelle, voir GUIDE_METADONNEES.md).
    const posterUrl = sanitizeUrl(e.meta?.image);

    const tagsRender = (e.tags && e.tags.length > 0)
        ? `<div class="flex flex-wrap gap-1 mt-1.5">
            ${e.tags.slice(0, 4).map(t => `<span class="text-[11px] bg-black/40 text-slate-400 px-1.5 py-0.5 rounded border border-white/5">#${escapeHtml(t)}</span>`).join('')}
           </div>`
        : '';

    const posterLayer = posterUrl
        ? `<div class="absolute inset-0 bg-cover bg-center opacity-25" style="background-image:url('${posterUrl}')"></div>
           <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/20"></div>`
        : '';

    return `
        <div class="glass-card relative overflow-hidden flex flex-col w-full text-left p-3 rounded-xl ${e.isCanceled ? 'opacity-30 line-through' : ''}">
            ${posterLayer}
            <div class="relative z-10 flex flex-col">
                <div class="flex items-start justify-between space-x-1.5 w-full">
                    <div class="flex items-start space-x-2 min-w-0">
                        <img src="${iconSrc}" alt="" class="w-9 ${ICON_ASPECT_CLASS} rounded-lg object-cover mt-0.5 shrink-0" onerror="this.style.display='none'">
                        <div class="min-w-0">
                            <div class="text-sm font-bold text-slate-100 truncate tracking-tight">${title}</div>
                            <div class="text-[11px] font-bold text-slate-400 mt-1 flex flex-wrap items-center gap-1.5">
                                <span class="text-[11px] tracking-wide text-indigo-400 bg-indigo-500/5 border border-indigo-500/10 px-1.5 py-0.5 rounded-md" style="color: ${e.col}">${type}</span>
                                ${e.heure ? `<span class="text-indigo-400 font-extrabold">🕒 ${e.heure}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    ${readableDate ? `<div class="text-[11px] font-black text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">${readableDate}</div>` : ''}
                </div>

                <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                    ${renderStatusBadge(e.progressStatus)}
                    ${detailsEpisode ? `<span class="text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">📺 ${detailsEpisode}</span>` : ''}
                    ${location ? `<span class="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">📍 ${location}</span>` : ''}
                </div>

                ${tagsRender}
            </div>
        </div>
    `;
}

/**
 * Rendu compact pour les vues à créneaux horaires (semaine/jour) où la carte complète
 * ne tient pas dans une colonne étroite. Affiche l'essentiel : icône, heure, titre, épisode.
 */
export function renderCompactEventChip(e) {
    const iconSrc = getIconSrc(e);
    const detailsEpisode = escapeHtml(getEpisodeLabel(e));
    const title = escapeHtml(e.title);
    const color = e.col || '#6366f1';

    // FullCalendar neutralise le fond/bordure natifs du .fc-event (voir CSS globale) :
    // on recrée l'accent couleur nous-mêmes sur ce wrapper interne pour distinguer
    // les événements les uns des autres dans une colonne horaire étroite.
    return `
        <div class="flex items-center gap-1.5 w-full h-full px-1.5 py-1 overflow-hidden rounded-md border-l-2 ${e.isCanceled ? 'opacity-40 line-through' : ''}" style="background: ${color}26; border-color: ${color};">
            <img src="${iconSrc}" alt="" class="w-6 ${ICON_ASPECT_CLASS} rounded object-cover shrink-0" onerror="this.style.display='none'">
            <div class="min-w-0 flex-1 leading-tight">
                <div class="text-[13px] font-bold text-white truncate">${title}</div>
                <div class="text-[11px] text-white/70 truncate">${e.heure ? e.heure : ''}${detailsEpisode ? ' · ' + detailsEpisode : ''}</div>
            </div>
        </div>
    `;
}
