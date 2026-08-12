import { escapeHtml } from '../utils/Html.js';
import { DateUtils } from '../utils/DateUtils.js';
import { renderEventCard, isGenuinelyLive } from './EventCardTemplate.js';
import { Icons } from './Icons.js';

/**
 * Page dédiée "Aujourd'hui sur 2GETHER" (bouton 📍 Aujourd'hui de l'en-tête / raccourci clavier
 * T, voir goToTodayView dans main.js) : une vraie page de présentation du programme du jour,
 * plutôt qu'un simple raccourci de navigation dans le calendrier. Toujours calculée sur TOUT le
 * dépôt (l'appelant ne passe que les catégories masquées en moins, voir updateUIState) - comme
 * le bandeau "Prochain événement" ou le résumé quotidien, "aujourd'hui" doit rester une photo
 * fidèle de la vraie journée, indépendante des filtres de navigation actifs ailleurs.
 * @param {HTMLElement} container
 * @param {Array<Object>} events
 * @returns {Array<Object>} Les événements du jour affichés, triés par heure - pour que
 *   l'appelant puisse retrouver l'objet complet au clic (délégation par data-idx).
 */
export function renderTodayView(container, events) {
    const now = new Date();
    const todayStr = DateUtils.toLocalDateStr(now);
    const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const todayEvents = events
        .filter(e => !e.isCanceled && !e.isPlanned && e.start.split('T')[0] === todayStr)
        .sort((a, b) => a.start.localeCompare(b.start));
    const canceledToday = events.filter(e => e.isCanceled && e.start.split('T')[0] === todayStr);

    const heroHtml = `
        <div class="text-center pt-8 pb-6 space-y-2">
            <div class="flex justify-center text-indigo-400" aria-hidden="true">${Icons.sun('w-12 h-12')}</div>
            <h1 class="text-2xl sm:text-3xl font-black text-white tracking-tight">Aujourd'hui sur 2GETHER</h1>
            <p class="text-slate-400 text-sm capitalize">${escapeHtml(dateLabel)}</p>
        </div>
    `;

    if (todayEvents.length === 0) {
        container.innerHTML = `
            <div class="max-w-md mx-auto">
                ${heroHtml}
                <div class="text-center py-12 space-y-3">
                    <div class="text-4xl" aria-hidden="true">🌙</div>
                    <p class="text-slate-500 text-sm leading-relaxed">Rien de programmé aujourd'hui.<br>Profitez-en, la suite arrive vite !</p>
                    ${canceledToday.length > 0 ? `<p class="inline-flex items-center gap-1 text-[11px] text-rose-400/80">${Icons.xCircle('w-3 h-3 shrink-0')}${canceledToday.length} session${canceledToday.length > 1 ? 's' : ''} annulée${canceledToday.length > 1 ? 's' : ''} aujourd'hui</p>` : ''}
                </div>
            </div>
        `;
        return [];
    }

    const liveCount = todayEvents.filter(isGenuinelyLive).length;
    const summaryHtml = `
        <div class="flex items-center justify-center gap-2 flex-wrap text-[11px] font-bold mb-6">
            <span class="text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-lg">${todayEvents.length} session${todayEvents.length > 1 ? 's' : ''} au programme</span>
            ${liveCount > 0 ? `<span class="inline-flex items-center gap-1.5 text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg animate-pulse"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true"></span>${liveCount} en cours</span>` : ''}
            ${canceledToday.length > 0 ? `<span class="inline-flex items-center gap-1 text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-lg">${Icons.xCircle('w-3 h-3 shrink-0')}${canceledToday.length} annulée${canceledToday.length > 1 ? 's' : ''}</span>` : ''}
        </div>
    `;

    // Repère visuel "maintenant" (comme la ligne rouge des vues Semaine/Jour, voir CalendarView.js) :
    // inséré entre deux cartes à la position chronologique réelle, pas juste devant la première
    // session "à venir" - une frise de la journée doit rester lisible même passé minuit de retard.
    const nowIso = DateUtils.toLocalIso(now);
    let nowMarkerInserted = false;
    const cardsHtml = todayEvents.map((e, idx) => {
        let marker = '';
        if (!nowMarkerInserted && e.start > nowIso) {
            marker = `
                <div class="flex items-center gap-2 py-1" aria-hidden="true">
                    <span class="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] shrink-0"></span>
                    <span class="text-[10px] font-black text-rose-400 uppercase tracking-widest">Maintenant · ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span class="flex-1 h-px bg-rose-500/30"></span>
                </div>
            `;
            nowMarkerInserted = true;
        }
        const live = isGenuinelyLive(e);
        return `${marker}<div class="cursor-pointer ${live ? 'ring-2 ring-emerald-500/40 rounded-xl' : ''}" data-idx="${idx}">${renderEventCard(e)}</div>`;
    }).join('');

    container.innerHTML = `
        <div class="max-w-2xl mx-auto pb-8">
            ${heroHtml}
            ${summaryHtml}
            <div class="space-y-1.5">${cardsHtml}</div>
        </div>
    `;

    return todayEvents;
}
