import { StatsService } from '../services/StatsService.js';
import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { formatMinutes, formatDurationLong, formatCategoryLabel, topN } from '../utils/Format.js';
import { CONFIG } from '../config.js';
import { renderEventCard } from './EventCardTemplate.js';
import { computeBadges } from '../services/BadgeService.js';

export const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Répartition par tranche horaire : donnée ordinale (matin → nuit), pas catégorielle - une
// seule teinte du plus clair au plus foncé plutôt que des couleurs distinctes (voir skill
// dataviz : "sequential = une teinte, clair → foncé", à ne pas confondre avec la palette
// catégorielle des catégories d'événements ci-dessus).
const TIME_OF_DAY_BUCKETS = [
    { label: 'Matin', from: 5, to: 12, color: '#a5b4fc' },
    { label: 'Après-midi', from: 12, to: 18, color: '#818cf8' },
    { label: 'Soirée', from: 18, to: 23, color: '#6366f1' },
    { label: 'Nuit', from: 23, to: 5, color: '#4338ca' }
];

// Palette catégorielle à ordre FIXE (jamais recyclée d'une catégorie à l'autre) : validée
// pour le fond sombre de l'app via le script du skill dataviz (CVD adjacent ΔE ≥ 10.3,
// contraste ≥ 3:1). Chaque barre porte aussi sa légende en toutes lettres (§ mitigation
// "relief rule" du skill : le CVD floor band n'est légal qu'avec un encodage secondaire).
const CATEGORY_COLORS = {
    jeux: '#3987e5',
    visionnage: '#199e70',
    special: '#c98500',
    'hors prog': '#9085e9',
    gazette: '#e66767',
    irl: '#d55181',
    jdr: '#d95926',
    externe: '#008300'
};
const CATEGORY_COLOR_FALLBACK = '#6b7280';

function categoryColor(cat) {
    return CATEGORY_COLORS[cat] || CATEGORY_COLOR_FALLBACK;
}

/** Années disponibles (avec au moins un événement), triées de la plus récente à la plus ancienne. */
export function getAvailableYears(events) {
    const years = new Set(events.map(e => new Date(e.start).getFullYear()));
    return [...years].sort((a, b) => b - a);
}

function heroTile(value, label, accentClass = "text-white") {
    return `
        <div class="glass-panel rounded-2xl p-5 sm:p-6 text-center">
            <div class="text-4xl sm:text-5xl font-black ${accentClass}">${value}</div>
            <div class="text-[10px] sm:text-xs uppercase tracking-widest text-slate-500 mt-1.5">${label}</div>
        </div>
    `;
}

function sectionHeading(emoji, title) {
    return `<h3 class="text-sm font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">${emoji} ${escapeHtml(title)}</h3>`;
}

export function renderCategoryBreakdown(byCategory) {
    // Une catégorie à 0 min (ex: Gazette, événements "instantanés" sans durée réelle propre -
    // voir EventGenerator) n'apporte rien à un classement par temps passé : juste un bruit
    // visuel (barre quasi invisible) dans une vue pensée pour célébrer, pas pour l'exhaustivité.
    const entries = Object.entries(byCategory).filter(([, v]) => v.t > 0).sort((a, b) => b[1].t - a[1].t);
    if (entries.length === 0) return '';
    const maxTime = Math.max(...entries.map(([, v]) => v.t));

    const rows = entries.map(([cat, stat]) => {
        const pct = maxTime > 0 ? Math.max(4, Math.round((stat.t / maxTime) * 100)) : 4;
        return `
            <div class="flex items-center gap-3">
                <div class="w-20 sm:w-28 shrink-0 text-xs font-bold text-slate-300 truncate">${escapeHtml(formatCategoryLabel(cat))}</div>
                <div class="flex-1 h-5 rounded-full bg-white/5 overflow-hidden">
                    <div class="h-full rounded-full transition-all" style="width:${pct}%; background:${categoryColor(cat)}"></div>
                </div>
                <div class="w-14 sm:w-20 shrink-0 text-right text-[11px] text-slate-400">${formatMinutes(stat.t)}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-3">
            ${sectionHeading('📊', 'Répartition du temps')}
            <div class="space-y-2.5">${rows}</div>
        </div>
    `;
}

/**
 * Carrousel horizontal des plus longues sessions de l'année : réutilise telle quelle la
 * tuile du calendrier (image/affiche, icône, badges, tags...) plutôt que de réinventer un
 * rendu dédié — c'est la même carte que partout ailleurs dans l'app, juste triée par durée.
 */
export function renderEventCarousel(events) {
    const top = [...events]
        .filter(e => (e.dur || 0) > 0)
        .sort((a, b) => (b.dur || 0) - (a.dur || 0))
        .slice(0, 10);
    if (top.length === 0) return '';

    const cards = top.map(e => {
        const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        return `<div class="w-64 sm:w-72 shrink-0 snap-start">${renderEventCard(e, readableDate)}</div>`;
    }).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-3">
            ${sectionHeading('🔥', 'Les sessions marathon')}
            <div class="flex gap-3 overflow-x-auto custom-scroll snap-x snap-mandatory pb-1 -mx-1 px-1">${cards}</div>
        </div>
    `;
}

/**
 * Regroupe une liste d'événements par titre (une série diffusée 4 fois dans le même
 * mois/jour ne doit pas polluer le détail au hover avec 4 lignes identiques) et trie du
 * plus "lourd" au plus léger en durée cumulée, pour le résumé affiché dans l'infobulle.
 */
function summarizeEventGroup(bucketEvents) {
    const byTitle = new Map();
    bucketEvents.forEach(e => {
        const entry = byTitle.get(e.title) || { count: 0, dur: 0 };
        entry.count++;
        entry.dur += (e.dur || 0);
        byTitle.set(e.title, entry);
    });
    return [...byTitle.entries()].sort((a, b) => b[1].dur - a[1].dur);
}

/** Répartit une liste d'événements dans `bucketCount` compartiments (mois, jour de semaine...) via `keyFn`. */
export function bucketEvents(events, keyFn, bucketCount) {
    const buckets = Array.from({ length: bucketCount }, () => ({ count: 0, duration: 0, events: [] }));
    events.forEach(e => {
        const b = buckets[keyFn(e)];
        b.count++;
        b.duration += (e.dur || 0);
        b.events.push(e);
    });
    return buckets;
}

export const BUCKET_KEY_FN = {
    month: e => new Date(e.start).getMonth(),
    weekday: e => (new Date(e.start).getDay() + 6) % 7 // 0 = Lundi
};

/**
 * Ré-obtient la liste complète (triée par date) des sessions d'un mois/jour de semaine donné,
 * pour une année - appelé au clic sur une barre (voir renderHoverBarChart) pour afficher le
 * détail complet dans sa propre modale, plutôt que de garder toutes les sessions de l'année en
 * mémoire tant que la rétrospective est ouverte.
 * @param {Array<Object>} events - Tous les événements du dépôt (toutes années confondues)
 * @param {number} year
 * @param {'month'|'weekday'} kind
 * @param {number} index
 * @returns {Array<Object>}
 */
export function getBucketEvents(events, year, kind, index) {
    const keyFn = BUCKET_KEY_FN[kind];
    return events
        .filter(e => new Date(e.start).getFullYear() === year && !e.isCanceled && !e.isPlanned && keyFn(e) === index)
        .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/**
 * Graphique en barres générique avec détail au survol (mois le plus actif, jour de semaine
 * préféré...) : factorisé pour ne pas dupliquer la logique d'infobulle entre les deux. Chaque
 * barre porte aussi des attributs `data-bucket-*` : un clic (voir setupRetrospective() dans
 * main.js) ouvre la liste complète des sessions de ce compartiment, l'infobulle ne montrant
 * elle qu'un résumé (top 3) pour rester lisible.
 * @param {Array<string>} labels
 * @param {Array<{count:number, duration:number, events:Array}>} buckets
 * @param {string} emoji
 * @param {(peakLabel:string) => string} headingFor
 * @param {'month'|'weekday'} kind
 */
export function renderHoverBarChart(labels, buckets, emoji, headingFor, kind) {
    const maxCount = Math.max(...buckets.map(b => b.count), 1);
    const peakIndex = buckets.reduce((best, b, i) => (b.count > buckets[best].count ? i : best), 0);

    const bars = buckets.map((b, i) => {
        const heightPct = b.count > 0 ? Math.max(8, Math.round((b.count / maxCount) * 100)) : 3;
        const isPeak = i === peakIndex && b.count > 0;

        let tooltip = '';
        if (b.count > 0) {
            const summary = summarizeEventGroup(b.events);
            const shown = summary.slice(0, 3).map(([title, s]) =>
                `<div class="truncate">${escapeHtml(title)}${s.count > 1 ? ` <span class="text-slate-500">×${s.count}</span>` : ''}</div>`
            ).join('');
            const rest = summary.length > 3 ? `<div class="text-slate-500">+${summary.length - 3} autre${summary.length - 3 > 1 ? 's' : ''}</div>` : '';
            tooltip = `
                <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-36 sm:w-48 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity duration-150 z-20">
                    <div class="glass-panel rounded-lg p-2.5 text-left shadow-xl space-y-1">
                        <div class="text-[10px] font-black text-white">${labels[i]} · ${b.count} session${b.count > 1 ? 's' : ''} · ${formatMinutes(b.duration)}</div>
                        <div class="text-[9px] text-slate-400 leading-snug space-y-0.5">${shown}${rest}</div>
                    </div>
                </div>
            `;
        }

        const interactiveAttrs = b.count > 0
            ? `role="button" aria-label="Voir les ${b.count} sessions de ${escapeHtml(labels[i])}" data-bucket-kind="${kind}" data-bucket-index="${i}" data-bucket-label="${escapeHtml(labels[i])}"`
            : '';

        return `
            <div class="relative group flex-1 flex flex-col items-center justify-end gap-1 h-full ${b.count > 0 ? 'cursor-pointer' : 'cursor-default'}" tabindex="${b.count > 0 ? '0' : '-1'}" ${interactiveAttrs}>
                ${tooltip}
                <div class="text-[9px] font-bold ${isPeak ? 'text-indigo-300' : 'text-slate-600'}">${b.count || ''}</div>
                <div class="w-full rounded-t ${isPeak ? 'bg-indigo-500' : 'bg-white/10'} transition-colors group-hover:bg-indigo-400 group-focus-within:bg-indigo-400" style="height:${heightPct}%"></div>
                <div class="text-[9px] text-slate-500">${labels[i]}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-3 overflow-visible">
            ${sectionHeading(emoji, headingFor(labels[peakIndex]))}
            <div class="flex items-end gap-1 sm:gap-2 h-28">${bars}</div>
            <p class="text-[10px] text-slate-600 text-center">Survolez pour un aperçu, cliquez sur une barre pour la liste complète.</p>
        </div>
    `;
}

/**
 * Mur des affiches : toutes les images distinctes (@image de l'événement, ou celle par
 * défaut du type) vues cette année. Dédupliquer par URL a un effet de bord recherché : les
 * types sans @image propre (qui partagent tous la même bannière par défaut) n'apparaissent
 * qu'une fois, ce qui laisse surtout ressortir les vraies affiches saisies au cas par cas.
 */
export function renderPosterWall(events) {
    const seen = new Map(); // url -> titre (garde le premier événement rencontré pour l'alt)
    events.forEach(e => {
        const url = sanitizeUrl(e.image);
        if (url && !seen.has(url)) seen.set(url, e.title);
    });
    const posters = [...seen.entries()].slice(0, 24);
    if (posters.length === 0) return '';

    const tiles = posters.map(([url, title]) => `
        <div class="aspect-video rounded-lg overflow-hidden bg-white/5 border border-white/10">
            <img src="${url}" alt="${escapeHtml(title)}" title="${escapeHtml(title)}" loading="lazy" class="w-full h-full object-cover" onerror="this.closest('div').style.display='none'">
        </div>
    `).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-3">
            ${sectionHeading('🖼️', 'Le mur des affiches')}
            <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">${tiles}</div>
        </div>
    `;
}

/**
 * Premier et dernier moment (par défaut "de l'année"), façon "bookends" - réutilise la tuile
 * calendrier telle quelle. Exclut les sessions encore "Prévu" (à venir) : on regarde en
 * arrière ("ce qu'on a vécu ensemble"), le dernier moment mis en avant ne doit jamais être un
 * événement qui n'a pas encore eu lieu (repli sur toutes les sessions si la période n'a encore
 * connu aucun événement passé, ex: année en cours tout juste commencée).
 * @param {Array<Object>} realSessions
 * @param {{first?: string, last?: string, only?: string, showYear?: boolean}} [labels] -
 *   Intitulés à personnaliser hors contexte "année" (ex: profil organisateur, toutes années
 *   confondues) ; showYear affiche aussi l'année sur la date de chaque tuile dans ce cas.
 */
export function renderBookendCards(realSessions, labels = {}) {
    const {
        first: firstLabel = "Premier moment de l'année",
        last: lastLabel = "Dernier moment de l'année",
        only: onlyLabel = "Le seul moment de l'année",
        showYear = false
    } = labels;

    const happened = realSessions.filter(e => e.progressStatus !== 'Prévu');
    const pool = happened.length > 0 ? happened : realSessions;
    if (pool.length === 0) return '';
    const sorted = [...pool].sort((a, b) => new Date(a.start) - new Date(b.start));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const dateOf = (e) => new Date(e.start).toLocaleDateString('fr-FR', showYear ? { day: '2-digit', month: '2-digit', year: 'numeric' } : { day: '2-digit', month: '2-digit' });

    if (first === last) {
        return `
            <div class="glass-panel rounded-2xl p-4 space-y-2">
                ${sectionHeading('🎬', onlyLabel)}
                ${renderEventCard(first, dateOf(first))}
            </div>
        `;
    }

    return `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="glass-panel rounded-2xl p-4 space-y-2">
                ${sectionHeading('🎬', firstLabel)}
                ${renderEventCard(first, dateOf(first))}
            </div>
            <div class="glass-panel rounded-2xl p-4 space-y-2">
                ${sectionHeading('🏁', lastLabel)}
                ${renderEventCard(last, dateOf(last))}
            </div>
        </div>
    `;
}

/**
 * Met en avant l'événement (série, mais aussi soirée jeux/JDR/meetup récurrent...) qui
 * revient le plus souvent - distinct du carrousel des sessions marathon qui classe des
 * occurrences individuelles : ici on regroupe toutes les occurrences d'un même titre entre
 * elles, classées par nombre de retours plutôt que par durée cumulée (un rendez-vous à petits
 * épisodes fréquents doit primer sur un film unique très long, déjà mis en avant ailleurs).
 */
export function renderMostRecurringEvent(realSessions) {
    const byTitle = new Map();
    realSessions.forEach(e => {
        const entry = byTitle.get(e.title) || { count: 0, dur: 0, sample: e };
        entry.count++;
        entry.dur += (e.dur || 0);
        if ((e.dur || 0) > (entry.sample.dur || 0)) entry.sample = e;
        byTitle.set(e.title, entry);
    });
    const recurring = [...byTitle.entries()].filter(([, s]) => s.count > 1).sort((a, b) => b[1].count - a[1].count || b[1].dur - a[1].dur);
    if (recurring.length === 0) return '';

    const [title, stat] = recurring[0];
    const posterUrl = sanitizeUrl(stat.sample.image);
    const backdrop = posterUrl
        ? `<div class="absolute inset-0 bg-cover bg-center opacity-20" style="background-image:url('${posterUrl}')"></div>
           <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>`
        : '';

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-2 relative overflow-hidden">
            ${backdrop}
            <div class="relative z-10 space-y-2">
                ${sectionHeading('🔁', "L'évènement qui revient le plus")}
                <div class="text-center">
                    <div class="text-xl font-black text-white">${escapeHtml(title)}</div>
                    <div class="text-xs text-slate-400 mt-1">${stat.count} séances · ${formatDurationLong(stat.dur)} cumulées</div>
                </div>
            </div>
        </div>
    `;
}

function timeOfDayBucketIndex(heure) {
    const h = parseInt(heure.split(':')[0], 10);
    if (h >= 5 && h < 12) return 0;
    if (h >= 12 && h < 18) return 1;
    if (h >= 18 && h < 23) return 2;
    return 3; // 23h-4h59
}

/** Répartition des sessions par tranche horaire (matin/après-midi/soirée/nuit), via `event.heure`. */
export function renderTimeOfDayBreakdown(events) {
    const withHeure = events.filter(e => e.heure);
    if (withHeure.length === 0) return '';

    const counts = [0, 0, 0, 0];
    withHeure.forEach(e => { counts[timeOfDayBucketIndex(e.heure)]++; });
    const total = withHeure.length;
    const maxCount = Math.max(...counts, 1);

    const rows = TIME_OF_DAY_BUCKETS.map((bucket, i) => {
        const pct = Math.max(4, Math.round((counts[i] / maxCount) * 100));
        const share = Math.round((counts[i] / total) * 100);
        return `
            <div class="flex items-center gap-3">
                <div class="w-20 sm:w-28 shrink-0 text-xs font-bold text-slate-300 truncate">${bucket.label}</div>
                <div class="flex-1 h-5 rounded-full bg-white/5 overflow-hidden">
                    <div class="h-full rounded-full transition-all" style="width:${pct}%; background:${bucket.color}"></div>
                </div>
                <div class="w-14 sm:w-16 shrink-0 text-right text-[11px] text-slate-400">${share}%</div>
            </div>
        `;
    }).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-3">
            ${sectionHeading('🕒', 'À quel moment on se retrouve')}
            <div class="space-y-2.5">${rows}</div>
        </div>
    `;
}

/** Plus longue série de semaines consécutives (Lundi→Dimanche) avec au moins une session. */
function longestWeekStreak(events) {
    const weekStarts = new Set(events.map(e => {
        const d = new Date(e.start);
        const dayIndex = (d.getDay() + 6) % 7; // 0 = Lundi
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayIndex).getTime();
    }));
    const sorted = [...weekStarts].sort((a, b) => a - b);
    if (sorted.length === 0) return 0;

    let best = 1;
    let current = 1;
    const WEEK_MS = 7 * 86400000;
    for (let i = 1; i < sorted.length; i++) {
        current = sorted[i] - sorted[i - 1] === WEEK_MS ? current + 1 : 1;
        best = Math.max(best, current);
    }
    return best;
}

/**
 * Équivalent de computeYearFacts() mais pour TOUTES les sessions d'un organisateur (toutes
 * années confondues plutôt qu'une année précise) - même forme de résultat, pour que le mini-
 * profil organisateur (main.js openOrganizerProfile) puisse réutiliser computeBadges() telle
 * quelle sans dupliquer ce calcul.
 * @param {Array<Object>} events - Tous les événements du dépôt
 * @param {string} hostName - Déjà normalisé (trim + minuscules), comme les clés de StatsService.byHost
 * @returns {Object}
 */
export function computeOrganizerFacts(events, hostName) {
    const hostEvents = events.filter(e => (e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST).trim().toLowerCase() === hostName);
    const realSessions = hostEvents.filter(e => !e.isCanceled && !e.isPlanned);
    const canceled = hostEvents.filter(e => e.isCanceled).length;
    const totalSessions = realSessions.length;
    const totalTime = realSessions.reduce((sum, e) => sum + (e.dur || 0), 0);

    const distinctTypes = new Set(realSessions.map(e => e.type)).size;
    const distinctGames = new Set(realSessions.filter(e => e.category === 'jeux').map(e => e.title)).size;
    const distinctWatched = new Set(realSessions.filter(e => e.category === 'visionnage').map(e => e.title)).size;
    const reliabilityPct = (totalSessions + canceled) > 0 ? Math.round((totalSessions / (totalSessions + canceled)) * 100) : 100;
    const streak = longestWeekStreak(realSessions);
    // Répartition par catégorie/tag/plateforme propre à CET organisateur (mêmes calculs que la
    // rétrospective annuelle, voir StatsService.compute) : permet de réutiliser telles quelles
    // renderCategoryBreakdown/renderTopTags dans le profil plutôt que de dupliquer cette logique.
    const stats = StatsService.compute(hostEvents);
    // Premières lettres d'un aperçu "quand" ce profil organise le plus (jour de semaine
    // préféré) : calculé ici pour être disponible aussi bien pour l'affichage que pour un
    // futur badge, sans dépendre du rendu du graphique correspondant.
    const weekdayBuckets = bucketEvents(realSessions, BUCKET_KEY_FN.weekday, 7);
    const peakWeekdayIndex = weekdayBuckets.reduce((best, b, i) => (b.count > weekdayBuckets[best].count ? i : best), 0);
    const topWeekday = weekdayBuckets[peakWeekdayIndex].count > 0 ? WEEKDAY_LABELS[peakWeekdayIndex] : null;

    return {
        realSessions, totalSessions, totalTime, distinctTypes, distinctGames, distinctWatched,
        canceled, reliabilityPct, streak, stats, weekdayBuckets, topWeekday
    };
}

export function renderTopTags(byTag) {
    const tags = topN(byTag, 8);
    if (tags.length === 0) return '';
    return `
        <div class="glass-panel rounded-2xl p-5 space-y-3">
            ${sectionHeading('🏷️', 'Tags favoris')}
            <div class="flex flex-wrap gap-2 justify-center">
                ${tags.map(([tag]) => `<span class="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-indigo-300">#${escapeHtml(tag)}</span>`).join('')}
            </div>
        </div>
    `;
}

function renderFunFacts(facts) {
    const tiles = [
        { emoji: '👑', value: facts.topHost || '—', label: facts.topHost ? `MVP · ${formatMinutes(facts.topHostMinutes)} animées` : "MVP de l'année" },
        { emoji: '🎭', value: facts.distinctTypes, label: 'Types d\'événements différents' },
        { emoji: '👥', value: facts.distinctHosts, label: 'Organisateurs différents' },
        { emoji: '🚫', value: facts.canceled, label: 'Annulations & reports' },
        { emoji: '✅', value: `${facts.reliabilityPct}%`, label: 'Sessions maintenues' },
        { emoji: '🔥', value: facts.streak, label: facts.streak > 1 ? "Semaines d'affilée (record)" : 'Semaine active' },
        { emoji: '🎮', value: facts.distinctGames, label: 'Jeux différents' },
        { emoji: '🎬', value: facts.distinctWatched, label: 'Films/séries différents' }
    ];
    return `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            ${tiles.map(t => `
                <div class="glass-panel rounded-xl p-3 text-center">
                    <div class="text-xl" aria-hidden="true">${t.emoji}</div>
                    <div class="text-base font-black text-white mt-1 truncate capitalize" title="${escapeHtml(String(t.value))}">${escapeHtml(String(t.value))}</div>
                    <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5 leading-tight">${escapeHtml(t.label)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Vitrine des badges communautaires (voir BadgeService.js) : tous affichés, y compris ceux pas
 * encore débloqués (grisés) — façon "à débloquer", plutôt que masqués, pour donner un objectif
 * visible d'une année sur l'autre. Réutilisée telle quelle pour le profil organisateur (à venir).
 */
export function renderBadgeShelf(badges) {
    const achievedCount = badges.filter(b => b.achieved).length;
    const tiles = badges.map(b => `
        <div class="glass-panel rounded-xl p-3 text-center transition-all ${b.achieved ? '' : 'opacity-30 grayscale'}" title="${escapeHtml(b.description)}">
            <div class="text-2xl" aria-hidden="true">${b.emoji}</div>
            <div class="text-[10px] font-bold text-white mt-1 leading-tight">${escapeHtml(b.label)}</div>
        </div>
    `).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-3">
            ${sectionHeading('🏅', `Badges (${achievedCount}/${badges.length})`)}
            <div class="grid grid-cols-3 sm:grid-cols-6 gap-2">${tiles}</div>
        </div>
    `;
}

function renderYearComparison(currentTotal, previousTotal, previousYear) {
    if (previousTotal === null) return '';
    const delta = currentTotal - previousTotal;
    const pct = previousTotal > 0 ? Math.round((delta / previousTotal) * 100) : 0;
    const isUp = delta >= 0;
    return `
        <div class="glass-panel rounded-2xl p-4 flex items-center justify-center gap-2 text-sm">
            <span class="${isUp ? 'text-emerald-400' : 'text-slate-400'}" aria-hidden="true">${isUp ? '▲' : '▼'}</span>
            <span class="text-slate-300">
                <span class="font-black ${isUp ? 'text-emerald-400' : 'text-slate-300'}">${isUp ? '+' : ''}${pct}%</span>
                de temps ensemble par rapport à ${previousYear}
            </span>
        </div>
    `;
}

/**
 * Rétrospective annuelle "vitrine" (inspirée des Steam/Spotify Wrapped) : une page unique,
 * chaleureuse, qui met en avant ce que la communauté a vécu ensemble dans l'année — à ne
 * pas confondre avec la rétrospective technique du mode Admin (anomalies, tableaux détaillés).
 * @param {HTMLElement} container
 * @param {Array<Object>} events - Tous les événements du dépôt (toutes années confondues)
 * @param {number} year
 */
/**
 * Calcule l'ensemble des statistiques dérivées d'une année (temps total, diversité, fiabilité,
 * régularité...) à partir de la liste complète des événements du dépôt. Source unique de
 * vérité partagée par la rétrospective et les badges (BadgeService.js) : ni l'une ni l'autre
 * ne doit recalculer ces mêmes chiffres séparément.
 * @param {Array<Object>} events - Tous les événements du dépôt (toutes années confondues)
 * @param {number} year
 * @returns {Object}
 */
export function computeYearFacts(events, year) {
    const yearEvents = events.filter(e => new Date(e.start).getFullYear() === year);
    const stats = StatsService.compute(yearEvents);

    const realSessions = yearEvents.filter(e => !e.isCanceled && !e.isPlanned);
    const totalSessions = realSessions.length;
    const totalTime = realSessions.reduce((sum, e) => sum + (e.dur || 0), 0);

    const distinctTypes = new Set(realSessions.map(e => e.type)).size;
    const distinctHosts = new Set(realSessions.map(e => (e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST).trim().toLowerCase())).size;
    const distinctGames = new Set(realSessions.filter(e => e.category === 'jeux').map(e => e.title)).size;
    const distinctWatched = new Set(realSessions.filter(e => e.category === 'visionnage').map(e => e.title)).size;
    const [topHost, topHostMinutes] = topN(stats.byHost, 1)[0] || [null, 0];

    const canceled = stats.counters.annulations || 0;
    const reliabilityPct = (totalSessions + canceled) > 0 ? Math.round((totalSessions / (totalSessions + canceled)) * 100) : 100;
    const streak = longestWeekStreak(realSessions);

    return {
        stats, realSessions, totalSessions, totalTime,
        distinctTypes, distinctHosts, distinctGames, distinctWatched,
        topHost, topHostMinutes, canceled, reliabilityPct, streak
    };
}

export function renderRetrospective(container, events, year) {
    const availableYears = getAvailableYears(events);
    const facts = computeYearFacts(events, year);
    const {
        stats, realSessions, totalSessions, totalTime,
        distinctTypes, distinctHosts, distinctGames, distinctWatched,
        topHost, topHostMinutes, canceled, reliabilityPct, streak
    } = facts;

    if (totalSessions === 0) {
        container.innerHTML = `
            <div class="text-center py-20 space-y-3">
                ${renderYearNav(year, availableYears)}
                <div class="text-slate-500 text-sm">Aucun événement enregistré pour ${year}.</div>
            </div>
        `;
        return;
    }

    const monthBuckets = bucketEvents(realSessions, BUCKET_KEY_FN.month, 12);
    const weekdayBuckets = bucketEvents(realSessions, BUCKET_KEY_FN.weekday, 7);

    const prevYearEvents = events.filter(e => new Date(e.start).getFullYear() === year - 1 && !e.isCanceled && !e.isPlanned);
    const hasPrevYear = availableYears.includes(year - 1);
    const prevTotal = hasPrevYear ? prevYearEvents.reduce((sum, e) => sum + (e.dur || 0), 0) : null;

    container.innerHTML = `
        <div class="max-w-2xl mx-auto space-y-4">
            ${renderYearNav(year, availableYears)}

            <div class="text-center -mt-2 mb-2">
                <p class="text-slate-400 text-sm">Tout ce qu'on a vécu ensemble cette année 💙</p>
            </div>

            <div class="grid grid-cols-2 gap-3 sm:gap-4">
                ${heroTile(totalSessions, 'Sessions organisées')}
                ${heroTile(formatDurationLong(totalTime), 'Temps passé ensemble', 'text-indigo-400')}
            </div>

            ${renderYearComparison(totalTime, prevTotal, year - 1)}
            ${renderBookendCards(realSessions)}
            ${renderCategoryBreakdown(stats.byCategory)}
            ${renderEventCarousel(realSessions)}
            ${renderPosterWall(realSessions)}
            ${renderMostRecurringEvent(realSessions)}
            ${renderHoverBarChart(MONTH_LABELS, monthBuckets, '📅', (peak) => `Mois le plus actif : ${peak}`, 'month')}
            ${renderHoverBarChart(WEEKDAY_LABELS, weekdayBuckets, '📆', (peak) => `Jour préféré : ${peak}`, 'weekday')}
            ${renderTimeOfDayBreakdown(realSessions)}
            ${renderTopTags(stats.byTag)}
            ${renderFunFacts({
                topHost,
                topHostMinutes,
                distinctTypes,
                distinctHosts,
                canceled,
                reliabilityPct,
                streak,
                distinctGames,
                distinctWatched
            })}
            ${renderBadgeShelf(computeBadges(facts))}

            <p class="text-center text-xs text-slate-600 pt-2 pb-1">Merci d'avoir fait vivre 2GETHER cette année 🎉</p>
        </div>
    `;
}

function renderYearNav(year, availableYears) {
    const hasPrev = availableYears.includes(year - 1);
    const hasNext = availableYears.includes(year + 1);
    return `
        <div class="flex items-center justify-center gap-3 sm:gap-4">
            <button data-retro-year="${year - 1}" ${hasPrev ? '' : 'disabled'} aria-label="Année précédente" class="text-slate-400 hover:text-white disabled:opacity-20 disabled:hover:text-slate-400 text-xl px-2 transition-all">‹</button>
            <h2 class="text-2xl sm:text-3xl font-black text-white">Rétrospective ${year}</h2>
            <button data-retro-year="${year + 1}" ${hasNext ? '' : 'disabled'} aria-label="Année suivante" class="text-slate-400 hover:text-white disabled:opacity-20 disabled:hover:text-slate-400 text-xl px-2 transition-all">›</button>
        </div>
    `;
}
