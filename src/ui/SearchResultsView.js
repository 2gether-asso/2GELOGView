import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { CONFIG } from '../config.js';
import { renderStatusBadge, getEpisodeLabel, getIconSrc, getOvernightSuffix } from './EventCardTemplate.js';
import { formatMinutes } from '../utils/Format.js';

function shortDate(iso) {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function renderRow(e, idx) {
    const iconSrc = getIconSrc(e);
    const dateObj = new Date(e.start);
    const readableDate = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const episode = escapeHtml(getEpisodeLabel(e));
    const location = e.location && e.location !== CONFIG.DEFAULT_LOCATION ? escapeHtml(e.location) : "";
    const host = escapeHtml(e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST);
    const duration = formatMinutes(e.dur);
    const title = escapeHtml(e.title);
    const type = escapeHtml(e.type || 'Événement');
    const notes = escapeHtml(e.notes);
    const posterUrl = sanitizeUrl(e.image);
    const tagsHtml = (e.tags || [])
        .map(t => `<span class="text-[11px] bg-black/40 text-slate-400 px-1.5 py-0.5 rounded border border-white/5">#${escapeHtml(t)}</span>`)
        .join('');

    const posterLayer = posterUrl
        ? `<div class="absolute inset-0 bg-cover bg-center opacity-20" style="background-image:url('${posterUrl}')"></div>
           <div class="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/10"></div>`
        : '';

    return `
        <div class="glass-card relative overflow-hidden flex gap-3 p-3 rounded-xl cursor-pointer items-start" data-idx="${idx}">
            ${posterLayer}
            <img src="${iconSrc}" alt="" class="relative z-10 w-14 aspect-[8/9] rounded-lg object-cover shrink-0" onerror="this.style.display='none'">
            <div class="relative z-10 flex-1 min-w-0 space-y-1.5">
                <div class="flex items-start justify-between gap-2 flex-wrap">
                    <div class="text-sm font-bold text-slate-100 ${e.isCanceled ? 'line-through opacity-50' : ''}" title="${title}">${title}</div>
                    <div class="text-[11px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0 whitespace-nowrap">${readableDate}${e.heure ? ' · ' + e.heure + escapeHtml(getOvernightSuffix(e)) : ''}</div>
                </div>
                <div class="flex flex-wrap gap-1.5 text-[11px]">
                    <span class="font-semibold px-1.5 py-0.5 rounded border" style="color: ${e.col}; border-color: ${e.col}40; background: ${e.col}1a;">${type}</span>
                    ${renderStatusBadge(e.progressStatus)}
                    ${e.isNew ? `<span class="text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">🆕 Nouveau</span>` : ''}
                    ${episode ? `<span class="text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">📺 ${episode}</span>` : ''}
                    ${location ? `<span class="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">📍 ${location}</span>` : ''}
                    ${host ? `<span class="text-slate-300 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">👤 ${host}</span>` : ''}
                    ${duration ? `<span class="text-slate-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">⏱️ ${duration}</span>` : ''}
                </div>
                ${notes ? `<p class="text-xs text-slate-400 italic line-clamp-2 leading-relaxed">${notes}</p>` : ''}
                ${tagsHtml ? `<div class="flex flex-wrap gap-1 pt-0.5">${tagsHtml}</div>` : ''}
            </div>
        </div>
    `;
}

/**
 * Regroupe les instances partageant le même titre (une ligne de tableur "hebdo"/série
 * génère une instance par date). On garde l'ordre de première apparition.
 */
function groupByTitle(events) {
    const order = [];
    const map = new Map();
    events.forEach(e => {
        if (!map.has(e.title)) { map.set(e.title, []); order.push(e.title); }
        map.get(e.title).push(e);
    });
    return order.map(title => map.get(title));
}

/**
 * Rendu d'un groupe de plusieurs occurrences (saison / soirée récurrente) : une seule
 * ligne résumant le total (occurrences, durée cumulée, plage de dates), dépliable pour
 * voir chaque date individuellement et l'ouvrir dans la modale.
 */
function renderGroupRow(group, indexOf) {
    const sorted = [...group].sort((a, b) => a.start.localeCompare(b.start));
    const first = sorted[0];
    const iconSrc = getIconSrc(first);
    const totalDuration = group.reduce((sum, e) => sum + (e.dur || 0), 0);
    const canceledCount = group.filter(e => e.isCanceled).length;
    const newCount = group.filter(e => e.isNew).length;

    const tagsSet = new Set();
    group.forEach(e => (e.tags || []).forEach(t => tagsSet.add(t)));

    const location = first.location && first.location !== CONFIG.DEFAULT_LOCATION ? escapeHtml(first.location) : "";
    const host = escapeHtml(first.meta?.host || first.meta?.orga || CONFIG.DEFAULT_HOST);
    const title = escapeHtml(first.title);
    const type = escapeHtml(first.type || 'Événement');

    // Une ligne "hebdo"/série unique génère des notes identiques sur toutes ses instances ;
    // des lignes distinctes partageant juste le même titre (ex: "Soirée Multijeux" ajoutée
    // chaque semaine) ont souvent des notes différentes par date, qu'on affiche alors par occurrence.
    const allSameNotes = group.every(e => (e.notes || "") === (first.notes || ""));
    const sharedNotes = escapeHtml(allSameNotes ? (first.notes || "") : "");

    const occurrencesHtml = sorted.map(e => {
        const idx = indexOf(e);
        const episode = escapeHtml(getEpisodeLabel(e));
        const dateStr = new Date(e.start).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
        const ownNotes = !allSameNotes && e.notes ? escapeHtml(e.notes) : "";
        return `
            <div class="px-3 py-2 hover:bg-white/5 cursor-pointer text-[13px]" data-idx="${idx}">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-slate-300 ${e.isCanceled ? 'line-through opacity-50' : ''}">${dateStr}${e.heure ? ' · ' + e.heure + escapeHtml(getOvernightSuffix(e)) : ''}</span>
                    <span class="flex items-center gap-2 min-w-0">
                        ${renderStatusBadge(e.progressStatus)}
                        ${episode ? `<span class="text-amber-400 truncate max-w-[140px]">${episode}</span>` : ''}
                        <span class="text-slate-500 shrink-0">${formatMinutes(e.dur)}</span>
                    </span>
                </div>
                ${ownNotes ? `<div class="text-slate-500 italic mt-0.5 leading-snug">${ownNotes}</div>` : ''}
            </div>
        `;
    }).join('');

    const tagsHtml = [...tagsSet]
        .map(t => `<span class="text-[11px] bg-black/40 text-slate-400 px-1.5 py-0.5 rounded border border-white/5">#${escapeHtml(t)}</span>`)
        .join('');

    const posterUrl = sanitizeUrl(first.image);
    const posterLayer = posterUrl
        ? `<div class="absolute inset-0 bg-cover bg-center opacity-20" style="background-image:url('${posterUrl}')"></div>
           <div class="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/10"></div>`
        : '';

    return `
        <div class="glass-card rounded-xl overflow-hidden">
            <div class="group-toggle relative overflow-hidden flex gap-3 p-3 items-start cursor-pointer">
                ${posterLayer}
                <img src="${iconSrc}" alt="" class="relative z-10 w-14 aspect-[8/9] rounded-lg object-cover shrink-0" onerror="this.style.display='none'">
                <div class="relative z-10 flex-1 min-w-0 space-y-1.5">
                    <div class="flex items-start justify-between gap-2 flex-wrap">
                        <div class="text-sm font-bold text-slate-100" title="${title}">${title}</div>
                        <div class="text-[11px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0 whitespace-nowrap">${shortDate(sorted[0].start)} → ${shortDate(sorted[sorted.length - 1].start)}</div>
                    </div>
                    <div class="flex flex-wrap gap-1.5 text-[11px]">
                        <span class="font-semibold px-1.5 py-0.5 rounded border" style="color: ${first.col}; border-color: ${first.col}40; background: ${first.col}1a;">${type}</span>
                        <span class="text-slate-300 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">🔁 ${group.length} occurrences</span>
                        <span class="text-slate-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">⏱️ ${formatMinutes(totalDuration)} cumulées</span>
                        ${newCount ? `<span class="text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">🆕 ${newCount} nouvelle(s)</span>` : ''}
                        ${canceledCount ? `<span class="text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">🚫 ${canceledCount} annulée(s)</span>` : ''}
                        ${location ? `<span class="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">📍 ${location}</span>` : ''}
                        ${host ? `<span class="text-slate-300 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">👤 ${host}</span>` : ''}
                    </div>
                    ${sharedNotes ? `<p class="text-xs text-slate-400 italic line-clamp-2 leading-relaxed">${sharedNotes}</p>` : ''}
                    ${tagsHtml ? `<div class="flex flex-wrap gap-1 pt-0.5">${tagsHtml}</div>` : ''}
                </div>
                <span class="chevron relative z-10 text-slate-500 text-xs shrink-0 mt-1 select-none">▾ détails</span>
            </div>
            <div class="occurrences-panel hidden border-t border-white/5 divide-y divide-white/5">
                ${occurrencesHtml}
            </div>
        </div>
    `;
}

// Un seul écouteur délégué par conteneur (le contenu est réinjecté à chaque recherche).
const wiredContainers = new WeakSet();

function wireGroupToggle(container) {
    if (wiredContainers.has(container)) return;
    wiredContainers.add(container);
    container.addEventListener('click', (e) => {
        const toggle = e.target.closest('.group-toggle');
        if (!toggle) return;
        const panel = toggle.parentElement.querySelector('.occurrences-panel');
        const chevron = toggle.querySelector('.chevron');
        if (!panel) return;
        const isHidden = panel.classList.toggle('hidden');
        if (chevron) chevron.textContent = isHidden ? '▾ détails' : '▴ replier';
    });
}

/**
 * Affiche un listing complet et détaillé des événements correspondant à la recherche,
 * à la place du calendrier. Les occurrences répétées (hebdo, saisons) sont regroupées
 * en une seule ligne détaillant le total (occurrences, durée cumulée, dates).
 * @param {HTMLElement} container
 * @param {Array<Object>} events - Déjà triés/filtrés par l'appelant
 */
export function renderSearchResults(container, events) {
    if (!events || events.length === 0) {
        container.innerHTML = `<div class="text-center text-sm text-slate-500 py-24">Aucun résultat pour cette recherche.</div>`;
        return;
    }

    const indexOf = (() => {
        const map = new Map(events.map((e, i) => [e, i]));
        return (e) => map.get(e);
    })();

    const rowsHtml = groupByTitle(events)
        .map(group => group.length > 1 ? renderGroupRow(group, indexOf) : renderRow(group[0], indexOf(group[0])))
        .join('');

    container.innerHTML = `
        <div class="text-[11px] font-bold text-slate-500 uppercase tracking-widest px-1 mb-2">${events.length} résultat${events.length > 1 ? 's' : ''}</div>
        <div class="space-y-2">${rowsHtml}</div>
    `;

    wireGroupToggle(container);
}
