import { escapeHtml } from '../utils/Html.js';
import { DateUtils } from '../utils/DateUtils.js';

const WEEKS = 13;
const DAYS = WEEKS * 7;
const LEVEL_BG = ['bg-white/5', 'bg-indigo-500/30', 'bg-indigo-500/55', 'bg-indigo-500/80', 'bg-indigo-400'];

function levelFor(count, maxCount) {
    if (count === 0) return 0;
    const ratio = count / maxCount;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
}

/**
 * Heatmap façon "contributions" (13 dernières semaines) : densité de sessions non
 * annulées par jour, pour repérer d'un coup d'œil les périodes calmes/chargées.
 * @param {HTMLElement} container
 * @param {Array<Object>} events - Tous les événements (non filtrés par catégorie/tag)
 */
export function renderActivityHeatmap(container, events) {
    const counts = new Map();
    events.forEach(e => {
        if (e.isCanceled || e.isPlanned) return;
        const day = e.start.split('T')[0];
        counts.set(day, (counts.get(day) || 0) + 1);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = DAYS - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        days.push(d);
    }

    const maxCount = Math.max(1, ...counts.values());
    const weeks = [];
    for (let w = 0; w < WEEKS; w++) weeks.push(days.slice(w * 7, w * 7 + 7));

    const cellsHtml = weeks.map(week => `
        <div class="flex flex-col gap-[3px]">
            ${week.map(d => {
                const iso = DateUtils.toLocalDateStr(d);
                const count = counts.get(iso) || 0;
                const level = levelFor(count, maxCount);
                const label = `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} — ${count} session${count > 1 ? 's' : ''}`;
                // Cliquable (V2.2, QOL) : saute à cette date dans le calendrier, voir
                // setupActivityHeatmapJump dans main.js - même geste que le mini-calendrier.
                return `<div class="w-[9px] h-[9px] rounded-sm ${LEVEL_BG[level]} cursor-pointer hover:ring-1 hover:ring-indigo-400 transition-all" role="button" tabindex="0" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" data-heatmap-date="${iso}"></div>`;
            }).join('')}
        </div>
    `).join('');

    container.innerHTML = `
        <div class="flex items-end justify-between gap-[3px] overflow-x-auto custom-scroll pb-1">${cellsHtml}</div>
        <div class="flex items-center justify-end gap-1 mt-1 text-3xs text-slate-600">
            <span>Moins</span>
            ${LEVEL_BG.map(cls => `<div class="w-[9px] h-[9px] rounded-sm ${cls}"></div>`).join('')}
            <span>Plus</span>
        </div>
    `;
}
