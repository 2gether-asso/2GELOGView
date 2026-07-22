import { StatsService } from '../services/StatsService.js';
import { escapeHtml } from '../utils/Html.js';
import { formatMinutes, formatDurationLong, formatCategoryLabel, topN } from '../utils/Format.js';
import { CONFIG } from '../config.js';
import { renderEventCard } from './EventCardTemplate.js';

const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

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

function renderCategoryBreakdown(byCategory) {
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
function renderEventCarousel(events) {
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

function renderMonthChart(monthCounts) {
    const maxCount = Math.max(...monthCounts, 1);
    const peakIndex = monthCounts.indexOf(maxCount);
    const bars = monthCounts.map((count, i) => {
        const heightPct = count > 0 ? Math.max(8, Math.round((count / maxCount) * 100)) : 3;
        const isPeak = i === peakIndex && count > 0;
        return `
            <div class="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                <div class="text-[9px] font-bold ${isPeak ? 'text-indigo-300' : 'text-slate-600'}">${count || ''}</div>
                <div class="w-full rounded-t ${isPeak ? 'bg-indigo-500' : 'bg-white/10'}" style="height:${heightPct}%"></div>
                <div class="text-[9px] text-slate-500">${MONTH_LABELS[i]}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-3">
            ${sectionHeading('📅', `Mois le plus actif : ${MONTH_LABELS[peakIndex]}`)}
            <div class="flex items-end gap-1 sm:gap-2 h-28">${bars}</div>
        </div>
    `;
}

function renderTopTags(byTag) {
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
        { emoji: '🚫', value: facts.canceled, label: 'Annulations & reports' }
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
export function renderRetrospective(container, events, year) {
    const availableYears = getAvailableYears(events);
    const yearEvents = events.filter(e => new Date(e.start).getFullYear() === year);
    const stats = StatsService.compute(yearEvents);

    const realSessions = yearEvents.filter(e => !e.isCanceled && !e.isPlanned);
    const totalSessions = realSessions.length;
    const totalTime = realSessions.reduce((sum, e) => sum + (e.dur || 0), 0);

    if (totalSessions === 0) {
        container.innerHTML = `
            <div class="text-center py-20 space-y-3">
                ${renderYearNav(year, availableYears)}
                <div class="text-slate-500 text-sm">Aucun événement enregistré pour ${year}.</div>
            </div>
        `;
        return;
    }

    const monthCounts = new Array(12).fill(0);
    realSessions.forEach(e => { monthCounts[new Date(e.start).getMonth()]++; });

    const distinctTypes = new Set(realSessions.map(e => e.type)).size;
    const distinctHosts = new Set(realSessions.map(e => (e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST).trim().toLowerCase())).size;
    const [topHost, topHostMinutes] = topN(stats.byHost, 1)[0] || [null, 0];

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
            ${renderCategoryBreakdown(stats.byCategory)}
            ${renderEventCarousel(realSessions)}
            ${renderMonthChart(monthCounts)}
            ${renderTopTags(stats.byTag)}
            ${renderFunFacts({
                topHost,
                topHostMinutes,
                distinctTypes,
                distinctHosts,
                canceled: stats.counters.annulations || 0
            })}

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
