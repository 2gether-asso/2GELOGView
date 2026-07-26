import { groupByTitle, renderRow, renderGroupRow, wireGroupToggle } from './SearchResultsView.js';

const MONTH_LABELS_LONG = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

/**
 * Vue "Frise" : les mêmes événements filtrés que le calendrier, organisés en frise
 * chronologique groupée par mois - à la différence de la vue Planning de FullCalendar (une
 * liste plate, une ligne par occurrence), une série qui s'étale sur plusieurs semaines (ex:
 * une saison diffusée chaque semaine) apparaît comme UN SEUL bloc continu (même regroupement
 * que la vue Recherche, voir SearchResultsView.js - réutilisé tel quel ici), ancré sous le mois
 * de sa première occurrence plutôt que dispersée en autant d'entrées que de diffusions.
 * @param {HTMLElement} container
 * @param {Array<Object>} events - Déjà filtrés par l'appelant (comme renderSearchResults)
 * @param {'asc'|'desc'} order - Sens d'affichage (mois ET séries dans chaque mois) ; le bouton
 * de bascule est rendu ici, son clic est délégué par l'appelant (voir data-timeline-order-toggle).
 */
export function renderTimeline(container, events, order = 'asc') {
    if (!events || events.length === 0) {
        container.innerHTML = `<div class="text-center text-sm text-slate-500 py-24">Aucun événement à afficher pour ces filtres.</div>`;
        return;
    }

    const indexOf = (() => {
        const map = new Map(events.map((e, i) => [e, i]));
        return (e) => map.get(e);
    })();

    const cmp = (a, b) => order === 'asc' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start);
    const sorted = [...events].sort(cmp);
    // groupByTitle suit l'ordre de première rencontre dans le tableau donné : comme `sorted`
    // est déjà dans le sens demandé, chaque groupe hérite naturellement de ce même sens sans
    // retri supplémentaire (aucun besoin de re-classer les groupes ni les compartiments mensuels
    // séparément ci-dessous).
    const groups = groupByTitle(sorted);

    // Ancre chaque groupe sur sa PREMIÈRE occurrence CHRONOLOGIQUE (toujours la plus ancienne,
    // quel que soit le sens d'affichage) : une série qui s'étale sur plusieurs mois n'apparaît
    // qu'une fois, sous son mois de départ - jamais dupliquée.
    const byMonth = new Map(); // "2026-03" -> [group, ...]
    groups.forEach(group => {
        const first = [...group].sort((a, b) => a.start.localeCompare(b.start))[0];
        const d = new Date(first.start);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(group);
    });

    const monthKeys = [...byMonth.keys()].sort();
    if (order === 'desc') monthKeys.reverse();

    const sectionsHtml = monthKeys.map(key => {
        const [year, month] = key.split('-').map(Number);
        const rowsHtml = byMonth.get(key)
            .map(group => group.length > 1 ? renderGroupRow(group, indexOf) : renderRow(group[0], indexOf(group[0])))
            .join('');
        return `
            <div class="mb-6">
                <div class="sticky top-0 z-10 -mx-1 px-1 py-2 mb-2 bg-black/40 backdrop-blur-sm">
                    <h3 class="text-sm font-black uppercase tracking-widest text-indigo-400">${MONTH_LABELS_LONG[month - 1]} ${year}</h3>
                </div>
                <div class="space-y-2">${rowsHtml}</div>
            </div>
        `;
    }).join('');

    const orderToggleHtml = `
        <div class="max-w-3xl mx-auto mb-4 flex justify-end">
            <button data-timeline-order-toggle title="Inverser l'ordre chronologique de la frise" class="text-[11px] font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-white/5 bg-white/5 transition-all">
                ${order === 'asc' ? '⬇️ Plus ancien d\'abord' : '⬆️ Plus récent d\'abord'}
            </button>
        </div>
    `;

    container.innerHTML = `${orderToggleHtml}<div class="max-w-3xl mx-auto">${sectionsHtml}</div>`;
    wireGroupToggle(container);
}
