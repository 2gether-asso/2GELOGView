import { StatsService } from '../services/StatsService.js';
import { escapeHtml } from '../utils/Html.js';
import { formatMinutes, topN } from '../utils/Format.js';
import { Icons } from './Icons.js';

function rankedRow(label, minutes) {
    return `
        <div class="flex items-center justify-between gap-2 bg-white/5 rounded px-2 py-1">
            <span class="text-slate-300 truncate capitalize">${escapeHtml(label)}</span>
            <span class="text-slate-500 font-bold shrink-0">${formatMinutes(minutes)}</span>
        </div>
    `;
}

/** Comme rankedRow, mais avec le nombre de sessions en plus du temps cumulé (catégories). */
function categoryRow(label, stat) {
    return `
        <div class="flex items-center justify-between gap-2 bg-white/5 rounded px-2 py-1">
            <span class="text-slate-300 truncate capitalize">${escapeHtml(label)}</span>
            <span class="text-slate-500 font-bold shrink-0">${stat.n} · ${formatMinutes(stat.t)}</span>
        </div>
    `;
}

function emptyRow() {
    return `<div class="text-slate-600 italic text-xs">Aucune donnée</div>`;
}

function renderYearCard(year, s) {
    const categories = Object.entries(s.byCategory).sort((a, b) => b[1].t - a[1].t);
    const totalSessions = categories.reduce((sum, [, v]) => sum + v.n, 0);
    const totalTime = categories.reduce((sum, [, v]) => sum + v.t, 0);

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-4">
            <div class="flex items-center justify-between flex-wrap gap-2">
                <h3 class="flex items-center gap-2 text-lg font-black text-white">${Icons.calendarDays('w-4 h-4 shrink-0 text-slate-400')}Rétrospective ${year}</h3>
                <span class="text-xs text-slate-400">${totalSessions} sessions · ${formatMinutes(totalTime)} au total</span>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div class="bg-black/20 p-3 rounded-xl border border-white/5">
                    <div class="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase font-bold">${Icons.xCircle('w-3 h-3 shrink-0')}Annulés / Reportés</div>
                    <div class="text-lg font-black text-rose-400">${s.counters.annulations}</div>
                    <div class="text-[11px] text-slate-500">${s.counters.reports} report(s)</div>
                </div>
                <div class="bg-black/20 p-3 rounded-xl border border-white/5">
                    <div class="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase font-bold">${Icons.arrowRightCircle('w-3 h-3 shrink-0')}Prévus</div>
                    <div class="text-lg font-black text-white">${s.counters.totalPlanned}</div>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                    <div class="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase font-bold mb-1">${Icons.barChart('w-3 h-3 shrink-0')}Par catégorie</div>
                    <div class="space-y-1">${categories.map(([k, v]) => categoryRow(k, v)).join('') || emptyRow()}</div>
                </div>
                <div>
                    <div class="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase font-bold mb-1">${Icons.tag('w-3 h-3 shrink-0')}Top Tags</div>
                    <div class="space-y-1">${topN(s.byTag).map(([k, v]) => rankedRow(k, v)).join('') || emptyRow()}</div>
                </div>
                <div>
                    <div class="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase font-bold mb-1">${Icons.user('w-3 h-3 shrink-0')}Top Organisateurs</div>
                    <div class="space-y-1">${topN(s.byHost).map(([k, v]) => rankedRow(k, v)).join('') || emptyRow()}</div>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                    <div class="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase font-bold mb-1">${Icons.tv('w-3 h-3 shrink-0')}Top Plateformes</div>
                    <div class="space-y-1">${topN(s.byPlatform).map(([k, v]) => rankedRow(k, v)).join('') || emptyRow()}</div>
                </div>
                <div class="sm:col-span-2">
                    <div class="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase font-bold mb-1">${Icons.film('w-3 h-3 shrink-0')}Répartition par type</div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        ${topN(s.byType, 12).map(([k, v]) => rankedRow(k, v)).join('') || emptyRow()}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderAnomaliesSection(anomalies) {
    if (!anomalies || anomalies.length === 0) {
        return `
            <div class="glass-panel rounded-2xl p-5">
                <h3 class="flex items-center gap-2 text-sm font-black text-emerald-400 mb-1">${Icons.checkCircle('w-4 h-4 shrink-0')}Aucune anomalie détectée</h3>
                <p class="text-xs text-slate-500">Les dates et types de toutes les lignes du tableur semblent cohérents.</p>
            </div>
        `;
    }

    const rows = anomalies.map(a => `
        <div class="flex items-start gap-2 px-3 py-2 rounded-lg ${a.severity === 'error' ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-amber-500/10 border border-amber-500/20'}">
            <span class="shrink-0 ${a.severity === 'error' ? 'text-rose-400' : 'text-amber-400'}">${a.severity === 'error' ? Icons.xCircle('w-4 h-4') : Icons.alertTriangle('w-4 h-4')}</span>
            <div class="min-w-0">
                <div class="text-xs font-bold text-slate-200">Ligne ${a.row} — ${escapeHtml(a.title)}</div>
                <div class="text-[11px] text-slate-400">${escapeHtml(a.message)}</div>
            </div>
        </div>
    `).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-2">
            <h3 class="flex items-center gap-2 text-sm font-black text-white">${Icons.alertTriangle('w-4 h-4 shrink-0 text-amber-400')}${anomalies.length} anomalie${anomalies.length > 1 ? 's' : ''} détectée${anomalies.length > 1 ? 's' : ''} dans le tableur</h3>
            <div class="space-y-1.5">${rows}</div>
        </div>
    `;
}

/**
 * Rendu de la vue Admin (mode ?admin) : rapport d'anomalies + rétrospective complète
 * année par année, pour permettre l'analyse a posteriori (bilans annuels).
 * @param {HTMLElement} container
 * @param {Array<Object>} events - Tous les événements du dépôt (non filtrés)
 * @param {Array<Object>} anomalies - Anomalies détectées par DataValidator.validateRows
 */
export function renderAdminView(container, events, anomalies = []) {
    const byYear = StatsService.computeByYear(events);
    const years = Object.keys(byYear);
    const anomaliesHtml = renderAnomaliesSection(anomalies);

    if (years.length === 0) {
        container.innerHTML = `<div class="space-y-6 max-w-5xl mx-auto">${anomaliesHtml}<div class="text-center text-slate-500 py-24">Aucune donnée disponible.</div></div>`;
        return;
    }

    container.innerHTML = `<div class="space-y-6 max-w-5xl mx-auto">${anomaliesHtml}${years.map(year => renderYearCard(year, byYear[year])).join('')}</div>`;
}
