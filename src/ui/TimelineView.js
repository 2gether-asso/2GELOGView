import { groupByTitle, renderRow, renderGroupRow, wireGroupToggle } from './SearchResultsView.js';
import { Icons } from './Icons.js';
import { DateUtils } from '../utils/DateUtils.js';
import { EmptyIllustrations, renderEmptyState } from './EmptyState.js';
import { getAvailableYears } from './RetrospectiveView.js';

const MONTH_LABELS_LONG = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];
const MONTH_LABELS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

/**
 * Rail de navigation rapide mois/année (V2.4) : façon index alphabétique d'un répertoire de
 * contacts, mais avec des mois plutôt que des lettres - saute directement au bon mois plutôt
 * que de défiler manuellement toute l'année. L'année en cours (`year`) sert de repère en haut
 * du rail ; les mois SANS le moindre événement cette année restent affichés (pour l'orientation
 * visuelle, "on est bien en milieu d'année") mais grisés/non cliquables - `#timeline-month-{m}`
 * n'existe tout simplement pas dans le DOM pour eux (voir la boucle plus bas qui ne pose ce
 * `id` que sur les mois présents dans `byMonth`), rien à cibler.
 * @param {number} year
 * @param {Set<number>} monthsWithData - indices de mois (0-11) ayant au moins un événement affiché
 */
function renderMonthRail(year, monthsWithData) {
    const monthsHtml = MONTH_LABELS_SHORT.map((label, m) => {
        const hasData = monthsWithData.has(m);
        return `<button data-timeline-jump-month="${m}" ${hasData ? '' : 'disabled'} aria-label="Aller à ${MONTH_LABELS_LONG[m]}" class="w-full text-3xs font-black uppercase tracking-wide py-1 rounded transition-all ${hasData ? 'text-slate-300 hover:text-white hover:bg-indigo-500/20' : 'text-slate-700 cursor-default'}">${label}</button>`;
    }).join('');
    return `
        <div class="flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl bg-black/20 border border-white/5">
            <span class="text-3xs font-black text-indigo-400 mb-1">${year}</span>
            ${monthsHtml}
        </div>
    `;
}

/** Un "nœud" de la frise : pastille sur l'axe vertical + contenu à droite, reliés par un
 * segment de trait qui s'enchaîne naturellement d'un nœud au suivant (bordure de la colonne
 * d'axe, pas un positionnement absolu à coordonnées magiques). */
function axisNode(dotHtml, contentHtml) {
    return `
        <div class="flex gap-3">
            <div class="flex flex-col items-center w-5 shrink-0">
                ${dotHtml}
                <div class="w-px flex-1 bg-white/10 my-1"></div>
            </div>
            <div class="flex-1 min-w-0 pb-5 -mt-0.5">${contentHtml}</div>
        </div>
    `;
}

function monthDot() {
    return `<span class="w-3 h-3 rounded-full bg-indigo-400 ring-4 ring-[var(--surface-0)] shrink-0 mt-0.5"></span>`;
}

function eventDot() {
    return `<span class="w-2 h-2 rounded-full bg-white/25 ring-4 ring-[var(--surface-0)] shrink-0 mt-2.5"></span>`;
}

function todayDot() {
    return `<span class="relative flex w-3 h-3 shrink-0 mt-0.5" aria-hidden="true">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
        <span class="relative inline-flex rounded-full w-3 h-3 bg-rose-500 ring-4 ring-[var(--surface-0)]"></span>
    </span>`;
}

// `availableYears` (V2.2, QOL - cohérence avec le sélecteur d'année de la Rétrospective, voir
// RetrospectiveView.js) : désactive prev/next vers une année sans aucun événement, plutôt que de
// naviguer dans le vide et ne s'en apercevoir qu'après (état vide affiché seulement APRÈS le saut).
function renderYearNav(year, availableYears) {
    const currentYear = new Date().getFullYear();
    const hasPrev = availableYears.includes(year - 1);
    const hasNext = availableYears.includes(year + 1);
    return `
        <div class="flex items-center justify-center gap-3 sm:gap-4 mb-2">
            <button data-timeline-year="${year - 1}" ${hasPrev ? '' : 'disabled'} aria-label="Année précédente" class="text-slate-400 hover:text-white disabled:opacity-20 disabled:hover:text-slate-400 p-1.5 rounded-lg hover:bg-white/5 transition-all">${Icons.chevronLeft('w-5 h-5')}</button>
            <h2 class="text-xl sm:text-2xl font-black text-white">Frise ${year}</h2>
            ${year !== currentYear ? `<button data-timeline-year="${currentYear}" title="Revenir à l'année en cours" class="text-2xs font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md uppercase tracking-wider">Aujourd'hui</button>` : ''}
            <button data-timeline-year="${year + 1}" ${hasNext ? '' : 'disabled'} aria-label="Année suivante" class="text-slate-400 hover:text-white disabled:opacity-20 disabled:hover:text-slate-400 p-1.5 rounded-lg hover:bg-white/5 transition-all">${Icons.chevronRight('w-5 h-5')}</button>
        </div>
    `;
}

/**
 * Vue "Frise" : une vraie frise chronologique verticale (axe + pastilles reliées par un trait,
 * pas une simple liste groupée par mois) des événements filtrés, sur UNE année à la fois
 * (sélecteur d'année, comme la Rétrospective) - par défaut l'année en cours, avec un repère
 * "Aujourd'hui" animé inséré à sa vraie position chronologique dans l'axe et un défilement
 * automatique jusqu'à lui à l'ouverture (voir `scrollToToday`, positionné par l'appelant au
 * moment où la vue devient visible - pas à chaque changement de filtre/tri une fois déjà ouverte,
 * pour ne pas arracher l'utilisateur d'un endroit où il aurait déjà fait défiler manuellement).
 * Les occurrences répétées d'un même titre (saison, soirée hebdo) restent regroupées en un seul
 * nœud (même logique que la vue Recherche, voir SearchResultsView.js), ancré sous le mois de sa
 * première occurrence.
 * @param {HTMLElement} container
 * @param {Array<Object>} events - Déjà filtrés par l'appelant (comme renderSearchResults), TOUTES années confondues
 * @param {'asc'|'desc'} order
 * @param {number} year - Année actuellement affichée
 * @param {boolean} scrollToToday - Défile jusqu'au repère "Aujourd'hui" une fois rendu
 * @param {Array<number>|null} [allYears] - Années disponibles sur TOUT le dépôt, filtres actifs
 *   ignorés (voir getAvailableYears(repo.getAll()) côté appelant) - sert UNIQUEMENT à activer/
 *   désactiver précédent/suivant (voir renderYearNav). Sans ce paramètre séparé, un filtre actif
 *   n'ayant aucune correspondance sur l'année voisine désactivait le bouton même quand cette
 *   année a bel et bien d'autres événements (juste pas dans le filtre courant) - un filtre ne
 *   doit jamais bloquer la NAVIGATION, seulement le contenu affiché une fois arrivé. Repli sur
 *   `events` (comportement d'avant ce correctif) si non fourni.
 * @returns {Array<Object>} Les événements réellement affichés (année sélectionnée), pour que
 *   l'appelant puisse retrouver l'objet complet au clic (délégation par data-idx).
 */
export function renderTimeline(container, events, order = 'asc', year = new Date().getFullYear(), scrollToToday = false, allYears = null) {
    const yearEvents = events.filter(e => new Date(e.start).getFullYear() === year);
    const isCurrentYear = year === new Date().getFullYear();
    const navYears = allYears || getAvailableYears(events);
    const headerHtml = `
        <div class="max-w-2xl mx-auto mb-2">
            ${renderYearNav(year, navYears)}
            <div class="flex justify-end gap-2">
                ${isCurrentYear ? `
                <button data-timeline-scroll-today title="Revenir au repère Aujourd'hui" class="inline-flex items-center gap-1.5 text-xxs font-bold text-rose-300 hover:text-rose-200 px-3 py-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 transition-all">
                    ${Icons.mapPin('w-3.5 h-3.5 shrink-0')}Aujourd'hui
                </button>` : ''}
                <button data-timeline-order-toggle title="Inverser l'ordre chronologique de la frise" class="inline-flex items-center gap-1.5 text-xxs font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-white/5 bg-white/5 transition-all">
                    ${order === 'asc' ? `${Icons.arrowDown('w-3.5 h-3.5 shrink-0')}Plus ancien d'abord` : `${Icons.arrowUp('w-3.5 h-3.5 shrink-0')}Plus récent d'abord`}
                </button>
            </div>
        </div>
    `;

    if (yearEvents.length === 0) {
        container.innerHTML = `${headerHtml}${renderEmptyState({
            illustration: EmptyIllustrations.calendarEmpty('w-16 h-16'),
            title: `Aucun événement à afficher pour ${year} avec ces filtres.`
        })}`;
        return [];
    }

    const indexOf = (() => {
        const map = new Map(yearEvents.map((e, i) => [e, i]));
        return (e) => map.get(e);
    })();

    const cmp = (a, b) => order === 'asc' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start);
    const sorted = [...yearEvents].sort(cmp);
    // groupByTitle suit l'ordre de première rencontre : comme `sorted` est déjà dans le sens
    // demandé, chaque groupe hérite naturellement de ce même sens sans retri supplémentaire.
    const groups = groupByTitle(sorted);

    // Ancre chaque groupe sur sa PREMIÈRE occurrence CHRONOLOGIQUE (toujours la plus ancienne,
    // quel que soit le sens d'affichage) : une série qui s'étale sur plusieurs mois n'apparaît
    // qu'une fois, sous son mois de départ - jamais dupliquée. `anchorDate` est aussi réutilisée
    // plus bas pour intercaler le repère "Aujourd'hui" au bon endroit PARMI les nœuds du mois
    // (pas juste avant le mois entier).
    const byMonth = new Map(); // month index (0-11) -> [{ group, anchorDate }, ...]
    groups.forEach(group => {
        const first = [...group].sort((a, b) => a.start.localeCompare(b.start))[0];
        const anchorDate = first.start.split('T')[0];
        const m = new Date(first.start).getMonth();
        if (!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m).push({ group, anchorDate });
    });

    // Repère "Aujourd'hui" : seulement pertinent pour l'année en cours. Un mois sans le moindre
    // événement (donc absent de byMonth) doit quand même apparaître dans la frise s'il s'agit du
    // mois en cours, pour que le repère "Aujourd'hui" ne disparaisse jamais purement parce que
    // rien n'est prévu ce mois-ci.
    const now = new Date();
    const todayStr = DateUtils.toLocalDateStr(now);
    const showTodayMarker = year === now.getFullYear();
    const todayMonth = now.getMonth();
    if (showTodayMarker && !byMonth.has(todayMonth)) byMonth.set(todayMonth, []);

    const monthOrder = [...byMonth.keys()].sort((a, b) => order === 'asc' ? a - b : b - a);
    const todayMarkerHtml = `<div id="timeline-today-marker" class="inline-flex items-center gap-1 text-xxs font-black text-rose-400 uppercase tracking-widest pt-0.5">${Icons.mapPin('w-3 h-3 shrink-0')}Aujourd'hui — ${now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</div>`;

    let nodesHtml = '';
    monthOrder.forEach(m => {
        nodesHtml += axisNode(monthDot(), `<h3 id="timeline-month-${m}" class="text-sm font-black uppercase tracking-widest text-indigo-300 scroll-mt-3">${MONTH_LABELS_LONG[m]}</h3>`);

        // Intercale "Aujourd'hui" à sa vraie place chronologique PARMI les nœuds du mois en
        // cours (pas systématiquement avant tous ses événements) : dès qu'un groupe est passé
        // de l'autre côté d'aujourd'hui selon le sens d'affichage, le repère se glisse juste avant.
        const insertTodayInThisMonth = showTodayMarker && todayMonth === m;
        let todayInserted = false;
        byMonth.get(m).forEach(({ group, anchorDate }) => {
            if (insertTodayInThisMonth && !todayInserted) {
                const pastToday = order === 'asc' ? anchorDate > todayStr : anchorDate < todayStr;
                if (pastToday) {
                    nodesHtml += axisNode(todayDot(), todayMarkerHtml);
                    todayInserted = true;
                }
            }
            const rowHtml = group.length > 1 ? renderGroupRow(group, indexOf, 'timeline') : renderRow(group[0], indexOf(group[0]), 'timeline');
            nodesHtml += axisNode(eventDot(), rowHtml);
        });
        // Aujourd'hui est après TOUS les événements déjà listés ce mois-ci (ou le mois n'en a
        // aucun) : le repère ferme le bloc du mois plutôt que de rester non-inséré.
        if (insertTodayInThisMonth && !todayInserted) {
            nodesHtml += axisNode(todayDot(), todayMarkerHtml);
        }
    });

    // Rail de navigation rapide (V2.4) : masqué sous `sm` (pas la place, et le pouce couvre de
    // toute façon tout l'écran sur mobile - le scroll manuel y reste le geste naturel), collé en
    // `sticky` pour rester visible pendant le défilement de la frise plutôt que de scroller avec
    // le contenu - fonctionne car il vit DANS le même conteneur scrollable (#timeline-view), pas
    // en `position: fixed` qui se serait superposé au panneau Statistiques à droite sur desktop.
    const monthRailHtml = renderMonthRail(year, new Set(byMonth.keys()));
    container.innerHTML = `
        ${headerHtml}
        <div class="flex gap-3 max-w-3xl mx-auto items-start">
            <div class="flex-1 min-w-0 max-w-2xl">${nodesHtml}</div>
            <div class="hidden sm:block sticky top-2 shrink-0">${monthRailHtml}</div>
        </div>
    `;
    wireGroupToggle(container);

    if (scrollToToday) {
        // scrollIntoView cible l'ancêtre scrollable réel (le conteneur #timeline-view a son
        // propre overflow-y-auto) : { block: 'center' } centre le repère dans CE conteneur,
        // pas dans la fenêtre entière. Double requestAnimationFrame (V2.2, bug corrigé après test :
        // appelé tout de suite après avoir posé innerHTML, la mise en page n'était pas toujours
        // stabilisée - le repère se retrouvait scrollé hors-vue malgré l'appel) - laisse le
        // navigateur terminer un cycle complet de mise en page + peinture avant de mesurer où
        // scroller, même mécanique de principe que le setTimeout de highlightCalendarDate dans
        // main.js pour la même catégorie de souci de timing.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                container.querySelector('#timeline-today-marker')?.scrollIntoView({ block: 'center', behavior: 'auto' });
            });
        });
    }

    return yearEvents;
}
