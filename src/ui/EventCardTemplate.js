import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { CONFIG } from '../config.js';
import { ReminderService } from '../services/ReminderService.js';
import { Icons } from './Icons.js';

// Les visuels sources sont en format portrait (~8:9). On force ce ratio sur les
// vignettes plutôt qu'un cadre carré pour éviter le crop "object-cover" sur un carré.
const ICON_ASPECT_CLASS = "aspect-[8/9]";

// Pastille pleine plutôt qu'un emoji rond (🔵🟢⚪) : rendu identique quel que soit l'OS/
// navigateur (V2.2, voir Icons.js pour la même logique côté icônes SVG).
const STATUS_STYLES = {
    "Prévu": { dot: "bg-sky-400", classes: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
    "En Cours": { dot: "bg-emerald-400", classes: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    "Terminé": { dot: "bg-slate-400", classes: "text-slate-400 bg-white/5 border-white/10" }
};

/**
 * Badge "Prévu / En Cours / Terminé", calculé par EventGenerator selon la présence
 * et le dépassement (ou non) d'une date de fin.
 */
export function renderStatusBadge(status) {
    const style = STATUS_STYLES[status];
    if (!style) return '';
    return `<span class="inline-flex items-center gap-1 text-xxs font-bold px-2 py-0.5 rounded-md border ${style.classes}"><span class="w-1.5 h-1.5 rounded-full ${style.dot} shrink-0" aria-hidden="true"></span>${escapeHtml(status)}</span>`;
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

// Racine du dépôt (dossier contenant assets/), calculée depuis l'URL de CE module : une carte
// affichée depuis une page en sous-dossier (ex: widget/) doit résoudre l'icône vers assets/ à
// la racine, pas vers un assets/ relatif à sa propre page (voir même idiom dans utils/Html.js).
const REPO_ROOT_URL = new URL('../..', import.meta.url).href;

/** Chemin de l'icône de catégorie (assets/img/badges/), avec repli sur l'icône générique "Hors Prog". */
export function getIconSrc(e) {
    const fileName = e.img || 'hors-prog.png';
    return new URL(`assets/img/badges/${fileName}`, REPO_ROOT_URL).href;
}

/**
 * Heure de fin d'un événement ponctuel qui chevauche minuit (ex: 23h30 → 01h10 le
 * lendemain). FullCalendar ne scinde pas toujours ce genre de bandeau court en deux
 * segments visuels selon la vue ; on le rend donc explicite directement sur la carte,
 * quelle que soit la vue, plutôt que de dépendre de ce découpage.
 * @param {Object} e
 * @returns {string} " → 01:10 (+1j)" ou "" si non applicable
 */
export function getOvernightSuffix(e) {
    if (!e.isMultiDay || e.allDay || !e.end || !e.end.includes('T')) return "";
    const endHeure = e.end.split('T')[1].slice(0, 5);
    return ` → ${endHeure} (+1j)`;
}

/**
 * Un "En Cours" est-il vraiment en train de se dérouler MAINTENANT, ou juste "pas confirmé
 * terminé" (voir CONFIG.LIVE_GRACE_HOURS) ? Partagé par la pastille animée et le bandeau
 * "Prochain événement" (main.js) pour qu'un même événement ne soit jamais annoncé "en direct"
 * dans l'un et pas dans l'autre.
 * @param {Object} e
 * @returns {boolean}
 */
export function isGenuinelyLive(e) {
    if (e.progressStatus !== "En Cours") return false;
    if (e.end && !e.endIsEstimate) return true;
    return (new Date() - new Date(e.start)) <= CONFIG.LIVE_GRACE_HOURS * 3600000;
}

/**
 * Pourcentage écoulé d'un événement "En Cours" dont la fin est connue et fiable (V2.2) - null
 * si non applicable (pas en direct, annulé, pas de fin connue, ou fin seulement estimée : voir
 * isGenuinelyLive, mêmes critères de confiance que la pastille/le bandeau "Prochain événement").
 * @param {Object} e
 * @returns {number|null} 0-100, ou null
 */
export function liveProgressPercent(e) {
    if (!isGenuinelyLive(e) || e.isCanceled || !e.end || e.endIsEstimate) return null;
    const start = new Date(e.start).getTime();
    const end = new Date(e.end).getTime();
    if (!(end > start)) return null;
    return Math.max(0, Math.min(100, ((Date.now() - start) / (end - start)) * 100));
}

/** Fine barre de progression en bas de carte pour un "En Cours" dont la fin est fiable (V2.2). */
function renderLiveProgressBar(e) {
    const pct = liveProgressPercent(e);
    if (pct === null) return '';
    return `<div class="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40" aria-hidden="true"><div class="h-full bg-emerald-400" style="width:${pct.toFixed(1)}%"></div></div>`;
}

/** Petite pastille animée pour les événements "En Cours", en plus du badge de statut texte. */
function renderLiveDot(e) {
    if (!isGenuinelyLive(e) || e.isCanceled) return '';
    return `
        <span class="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
    `;
}

/** Badge "Nouveau" pour un événement ajouté au tableur depuis la dernière visite (voir main.js). */
function renderNewBadge(e) {
    if (!e.isNew) return '';
    return `<span class="inline-flex items-center gap-1 text-xxs font-bold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">${Icons.badgePlus('w-3 h-3 shrink-0')}Nouveau</span>`;
}

/** Badge "Rappel activé" si ce titre (série entière) est suivi, voir ReminderService/ModalView. */
function renderReminderBadge(e) {
    if (!ReminderService.isSet(e.title)) return '';
    return `<span class="inline-flex items-center gap-1 text-xxs font-bold text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">${Icons.bell('w-3 h-3 shrink-0')}Rappel activé</span>`;
}

/**
 * Gabarit compact (QOL #17, densité d'affichage) : 2 lignes plutôt que la carte complète
 * multi-blocs - pour voir davantage de sessions à l'écran sans défiler, sans pour autant tronquer
 * l'essentiel. Ligne 1 (identité + timing, ce qu'on scanne en premier) : Icône / Titre / Heure.
 * Ligne 2 (le reste, contexte secondaire) : Type, Statut, Épisode, date. Basculé automatiquement
 * par renderEventCard selon html.density-compact (voir setupDensityToggle dans main.js). Tailles
 * de police/badges volontairement identiques au gabarit confortable habituel.
 */
function renderCompactRow(e, readableDate) {
    const title = escapeHtml(e.title);
    const type = escapeHtml(e.type || 'Événement');
    const detailsEpisode = escapeHtml(getEpisodeLabel(e));
    const iconSrc = getIconSrc(e);

    const liveBorderCompact = isGenuinelyLive(e) && !e.isCanceled ? 'live-glow-border' : '';
    return `
        <div class="glass-card relative flex items-start gap-2 w-full text-left px-2.5 py-1.5 my-0.5 rounded-lg overflow-hidden ${e.isCanceled ? 'opacity-30 line-through' : ''} ${liveBorderCompact}" style="border-left: 3px solid ${e.col};">
            <img src="${iconSrc}" alt="" class="w-6 ${ICON_ASPECT_CLASS} rounded object-cover shrink-0 mt-0.5" onerror="this.style.display='none'">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
                    ${renderLiveDot(e)}
                    <span class="text-sm font-bold text-slate-100 truncate flex-1 min-w-0" title="${title}">${title}</span>
                    ${e.heure ? `<span class="inline-flex items-center gap-1 text-xxs font-extrabold text-indigo-400 shrink-0">${Icons.clock('w-3 h-3 shrink-0')}${e.heure}${escapeHtml(getOvernightSuffix(e))}</span>` : ''}
                </div>
                <div class="flex items-center gap-1.5 mt-0.5 min-w-0 flex-wrap">
                    <span class="text-2xs font-bold shrink-0 px-1.5 py-0.5 rounded border" style="color:${e.col}; background:linear-gradient(135deg, ${e.col}26, ${e.col}0d); border-color:${e.col}40;" title="${type}">${type}</span>
                    ${renderStatusBadge(e.progressStatus)}
                    ${detailsEpisode ? `<span class="inline-flex items-center gap-1 text-xxs font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 truncate">${Icons.tv('w-3 h-3 shrink-0')}${detailsEpisode}</span>` : ''}
                    ${readableDate ? `<span class="text-xxs font-black text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">${readableDate}</span>` : ''}
                </div>
            </div>
            ${renderLiveProgressBar(e)}
        </div>
    `;
}

export function renderEventCard(e, readableDate = null) {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('density-compact')) {
        return renderCompactRow(e, readableDate);
    }

    const detailsEpisode = escapeHtml(getEpisodeLabel(e));
    // e.location est toujours renseigné par EventGenerator (avec un lieu par défaut).
    const location = e.location && e.location !== CONFIG.DEFAULT_LOCATION ? escapeHtml(e.location) : "";
    const title = escapeHtml(e.title);
    const type = escapeHtml(e.type || 'Événement');

    const iconSrc = getIconSrc(e);
    // e.image (résolu par EventGenerator : @image de l'événement, sinon celle par défaut
    // du type) : affiche/jaquette du film, de la série ou du jeu, en fond translucide de
    // la tuile (voir GUIDE_METADONNEES.md).
    const posterUrl = sanitizeUrl(e.image);

    const tagsRender = (e.tags && e.tags.length > 0)
        ? `<div class="flex flex-wrap gap-1 mt-1.5">
            ${e.tags.slice(0, 4).map(t => `<span class="text-xxs bg-black/40 text-slate-400 px-1.5 py-0.5 rounded border border-white/5">#${escapeHtml(t)}</span>`).join('')}
           </div>`
        : '';

    const posterLayer = posterUrl
        ? `<div class="absolute inset-0 bg-cover bg-center opacity-25" style="background-image:url('${posterUrl}')"></div>
           <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/20"></div>`
        : '';

    const liveBorder = isGenuinelyLive(e) && !e.isCanceled ? 'live-glow-border' : '';
    // `has-poster` (V2.2, thème clair) : le dégradé sombre de posterLayer ci-dessus reste sombre
    // dans les deux thèmes (lisibilité du texte sur une AFFICHE/photo, indépendante du thème de
    // l'appli) - cette classe permet à index.html de restaurer le texte clair par-dessus en thème
    // clair, là où le reste du texte de l'appli passe sombre (voir html[data-theme="light"] .has-poster).
    return `
        <div class="glass-card relative overflow-hidden flex flex-col w-full text-left p-3 my-1 rounded-xl ${e.isCanceled ? 'opacity-30 line-through' : ''} ${liveBorder} ${posterUrl ? 'has-poster' : ''}" style="border-left: 3px solid ${e.col};">
            ${posterLayer}
            <div class="relative z-10 flex flex-col">
                <div class="flex items-start justify-between space-x-1.5 w-full">
                    <div class="flex items-start space-x-2 min-w-0">
                        <img src="${iconSrc}" alt="" class="w-9 ${ICON_ASPECT_CLASS} rounded-lg object-cover mt-0.5 shrink-0" onerror="this.style.display='none'">
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 min-w-0">
                                ${renderLiveDot(e)}
                                <div class="text-sm font-bold text-slate-100 truncate tracking-tight" title="${title}">${title}</div>
                            </div>
                            <div class="text-xxs font-bold text-slate-400 mt-1 flex flex-wrap items-center gap-1.5">
                                <span class="text-xxs tracking-wide px-1.5 py-0.5 rounded-md border" style="color:${e.col}; background:linear-gradient(135deg, ${e.col}26, ${e.col}0d); border-color:${e.col}40;">${type}</span>
                                ${e.heure ? `<span class="inline-flex items-center gap-1 text-indigo-400 font-extrabold">${Icons.clock('w-3 h-3 shrink-0')}${e.heure}${escapeHtml(getOvernightSuffix(e))}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    ${readableDate ? `<div class="text-xxs font-black text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">${readableDate}</div>` : ''}
                </div>

                <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                    ${renderStatusBadge(e.progressStatus)}
                    ${renderNewBadge(e)}
                    ${renderReminderBadge(e)}
                    ${detailsEpisode ? `<span class="inline-flex items-center gap-1 text-xxs font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">${Icons.tv('w-3 h-3 shrink-0')}${detailsEpisode}</span>` : ''}
                    ${location ? `<span class="inline-flex items-center gap-1 text-xxs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">${Icons.mapPin('w-3 h-3 shrink-0')}${location}</span>` : ''}
                </div>

                ${tagsRender}
            </div>
            ${renderLiveProgressBar(e)}
        </div>
    `;
}

/**
 * Rendu du/des segment(s) de continuation d'un événement multi-jours (chevauche minuit,
 * ou bandeau Meet Up/Partenaire/Sanctuaire étalé sur plusieurs jours). FullCalendar découpe
 * ces événements en un segment par jour traversé et appelle `eventContent` pour chacun : sans
 * ce rendu dédié, la carte complète (icône, titre, badges) se répéterait telle quelle sur
 * chaque jour, ce qui est à la fois redondant et illisible sur un segment souvent très étroit.
 * @param {Object} e
 * @param {boolean} isLastSegment - Vrai sur le dernier jour couvert (arg.isEnd)
 */
export function renderContinuationChip(e, isLastSegment) {
    const color = e.col || '#6366f1';
    const title = escapeHtml(e.title);
    const endHeure = e.end && e.end.includes('T') ? e.end.split('T')[1].slice(0, 5) : null;
    const suffix = isLastSegment && endHeure ? ` · jusqu'à ${escapeHtml(endHeure)}` : ' (suite)';
    return `
        <div class="flex items-center gap-1 w-full h-full px-1.5 py-0.5 overflow-hidden rounded-md border-l-2 opacity-80 ${e.isCanceled ? 'line-through' : ''}" style="background: ${color}1a; border-color: ${color};">
            <span class="text-xxs text-white/60 shrink-0">↳</span>
            <span class="text-xxs text-white/70 truncate">${title}${suffix}</span>
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
                <div class="flex items-center gap-1 min-w-0">
                    ${renderLiveDot(e)}
                    <div class="text-13 font-bold text-white truncate" title="${title}">${title}</div>
                </div>
                <div class="text-xxs text-white/70 truncate">${e.heure ? e.heure + getOvernightSuffix(e) : ''}${detailsEpisode ? ' · ' + detailsEpisode : ''}</div>
            </div>
        </div>
    `;
}
