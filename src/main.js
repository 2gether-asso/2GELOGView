import { CONFIG } from './config.js';
import { CSVParser } from './parsers/CSVParser.js';
import { EventGenerator } from './services/EventGenerator.js';
import { EventRepository } from './repositories/EventRepository.js';
import { CalendarView } from './ui/CalendarView.js';
import { ModalView } from './ui/ModalView.js';
import { renderEventCard, isGenuinelyLive } from './ui/EventCardTemplate.js';
import { renderSearchResults } from './ui/SearchResultsView.js';
import { renderTimeline } from './ui/TimelineView.js';
import { initMeetupMap, updateMeetupMap } from './ui/MeetupMapView.js';
import { renderAdminView } from './ui/AdminView.js';
import { StatsService } from './services/StatsService.js';
import { SearchEngine } from './services/SearchEngine.js';
import { IcsExporter } from './services/IcsExporter.js';
import { DiscordExporter } from './services/DiscordExporter.js';
import { renderActivityHeatmap } from './ui/ActivityHeatmap.js';
import { DateUtils } from './utils/DateUtils.js';
import { escapeHtml } from './utils/Html.js';
import { formatMinutes, topN, formatCategoryLabel } from './utils/Format.js';
import { validateRows } from './services/DataValidator.js';
import { ReminderService } from './services/ReminderService.js';
import {
    renderRetrospective, getAvailableYears, getBucketEvents, computeOrganizerFacts, renderBadgeShelf,
    renderCategoryBreakdown, renderTopTags, renderTimeOfDayBreakdown, renderPosterWall,
    renderMostRecurringEvent, renderBookendCards, renderHoverBarChart, WEEKDAY_LABELS
} from './ui/RetrospectiveView.js';
import { computeBadges } from './services/BadgeService.js';
import { applySeasonalTheme, resolveActiveSeason, getManualOverride, setManualOverride } from './services/SeasonalTheme.js';

const repo = new EventRepository();
let calendarInstance = null;

let currentCategory = "all";
let currentTagFilter = null;
let currentTypeFilter = null;
let currentSearchQuery = "";
let currentDateFrom = null;
let currentDateTo = null;
let dataAnomalies = [];

// La sidebar "Prochainement" et le listing de recherche conservent en mémoire
// les événements affichés pour retrouver l'objet complet lors d'un clic (délégation).
let upcomingEventsCache = [];
let searchResultsCache = [];
let timelineCache = [];
// Sens d'affichage de la vue Frise, modifiable via son propre bouton (voir TimelineView.js
// data-timeline-order-toggle) - indépendant du reste des filtres.
let timelineSortOrder = 'asc'; // 'asc' | 'desc'
// La recherche (isSearching) prime toujours sur ce mode : basculer en Frise/Carte n'empêche
// pas de chercher, ça change juste ce qui s'affiche quand la recherche est vide.
let currentViewMode = 'calendar'; // 'calendar' | 'timeline' | 'map'
// Dernier ensemble filtré affiché (calendrier ou recherche) : utilisé par l'export .ics
// pour exporter "ce que l'utilisateur voit" plutôt que tout le dépôt.
let lastFilteredEvents = [];
// Événement à ouvrir si l'utilisateur clique sur le bandeau "Prochain événement".
let nextEventForBanner = null;

const FILTERS_STORAGE_KEY = 'ui:activeFilters';
const SEEN_EVENTS_KEY = 'seen:upcomingEventIds';

const CATEGORY_BTN_ACTIVE = "px-3 py-1 rounded-lg bg-indigo-600 text-white font-bold shadow-[0_0_15px_rgba(99,102,241,0.4)]";
const CATEGORY_BTN_INACTIVE = "px-3 py-1 rounded-lg bg-white/5 border border-white/5 text-slate-300 hover:text-white hover:bg-white/10 transition-all";

function setActiveCategoryButton(selectedBtn) {
    document.querySelectorAll('#filter-categories-container button').forEach(b => {
        b.className = (b === selectedBtn) ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE;
    });
}

// Catégories générées dynamiquement depuis config.js THEMES[...].cat plutôt qu'une liste
// binaire figée ("watch"/"game") : suit automatiquement la taxonomie définie dans la config.
function renderCategoryFilterBar() {
    const container = document.getElementById('filter-categories-container');
    const categories = [...new Set(
        Object.entries(CONFIG.THEMES).filter(([name]) => name !== 'default').map(([, theme]) => theme.cat)
    )];

    const allBtn = `<button data-cat="all" class="${!currentCategory || currentCategory === 'all' ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE}">Tous</button>`;
    const catBtns = categories.map(cat =>
        `<button data-cat="${escapeHtml(cat)}" class="${currentCategory === cat ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE}">${escapeHtml(formatCategoryLabel(cat))}</button>`
    ).join('');

    container.innerHTML = allBtn + catBtns;
}

// Le panneau "Statistiques" ne porte que sur l'année en cours (pas tout l'historique) :
// un chiffre plus lisible et cohérent d'une rétrospective annuelle à l'autre. L'historique
// complet reste consultable dans le mode Admin (rétrospectives année par année).
function renderDashboardStats(events) {
    const currentYear = new Date().getFullYear();
    document.getElementById('stats-year-label').textContent = currentYear;
    const yearEvents = events.filter(e => new Date(e.start).getFullYear() === currentYear);

    const stats = StatsService.compute(yearEvents);
    const categoriesContainer = document.getElementById('stat-categories-container');
    const sortedCategories = Object.entries(stats.byCategory).sort((a, b) => b[1].t - a[1].t);

    categoriesContainer.innerHTML = sortedCategories.length === 0
        ? `<span class="col-span-2 text-[11px] text-slate-600 italic">Aucune session</span>`
        : sortedCategories.map(([cat, stat]) => `
            <div class="glass-panel p-3 rounded-xl flex flex-col shadow-sm">
                <span class="text-[10px] font-bold text-slate-400 truncate">${escapeHtml(formatCategoryLabel(cat))}</span>
                <span class="text-base font-black text-slate-100 mt-0.5">${stat.n}</span>
                <span class="text-[11px] text-indigo-400 font-bold mt-0.5 truncate">${formatMinutes(stat.t)}</span>
            </div>
        `).join('');

    document.getElementById('stat-canceled-count').innerText = stats.counters.annulations || 0;

    // Top 3 organisateurs (temps cumulé) de l'année en cours : même donnée que la
    // rétrospective admin (StatsService.byHost), condensée ici pour rester visible sans
    // passer par le mode ?admin.
    const hostsContainer = document.getElementById('stat-hosts-container');
    const topHosts = topN(stats.byHost, 3);
    hostsContainer.innerHTML = topHosts.length === 0
        ? `<span class="text-[11px] text-slate-600 italic">Aucune donnée</span>`
        : topHosts.map(([host, minutes]) => `
            <div class="flex items-center justify-between gap-2 text-[11px] cursor-pointer hover:text-white transition-colors" data-host="${escapeHtml(host)}">
                <span class="text-slate-300 truncate capitalize">${escapeHtml(host)}</span>
                <span class="text-slate-500 font-bold shrink-0">${formatMinutes(minutes)}</span>
            </div>
        `).join('');
}

function updateTagsFilterBar(events) {
    const container = document.getElementById('filter-tags-container');
    const tagCounts = {};
    events.forEach(e => {
        if (e.tags) e.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    });

    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);

    if (sortedTags.length === 0) {
        container.innerHTML = `<span class="text-[11px] text-slate-600 italic">Aucun #tag</span>`;
        return;
    }

    container.innerHTML = sortedTags.map(([tag, count]) => {
        const isSelected = currentTagFilter === tag;
        const safeTag = escapeHtml(tag);
        return `<button data-tag="${safeTag}" class="px-3 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-all backdrop-blur-md ${isSelected ? 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white hover:bg-white/10'}" >#${safeTag} <span class="text-[9px] opacity-70 ml-0.5">(${count})</span></button>`;
    }).join('');
}

// Chips "Types" générées dynamiquement à partir de CONFIG.THEMES : offre un filtrage
// fin par type exact (Soirée Série, Meet Up, JDR, ...) en plus des 2 catégories larges.
function renderTypeFilterBar() {
    const container = document.getElementById('filter-types-container');
    const types = Object.keys(CONFIG.THEMES).filter(name => name !== 'default');

    const allBtn = `<button data-type="" class="px-2.5 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-all ${!currentTypeFilter ? 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white hover:bg-white/10'}">Tous les types</button>`;

    // Chaque pastille inactive garde un liseré de la couleur propre à son type (voir
    // EventCardTemplate/CalendarView, qui utilisent la même teinte) : un repère visuel pour
    // repérer un type au coup d'œil dans cette liste, sans attendre de le sélectionner.
    const typeBtns = types.map(name => {
        const theme = CONFIG.THEMES[name];
        const isSelected = currentTypeFilter === name;
        const style = isSelected
            ? `background:${theme.col}33; border-color:${theme.col}; color:#fff;`
            : `border-left: 3px solid ${theme.col}99;`;
        return `<button data-type="${name}" class="px-2.5 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-all ${isSelected ? 'font-bold' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white hover:bg-white/10'}" style="${style}">${name}</button>`;
    }).join('');

    container.innerHTML = allBtn + typeBtns;
}

// Regroupe la sidebar "Prochainement" par horizon temporel plutôt qu'une liste plate :
// plus rapide à scanner pour repérer ce qui se passe aujourd'hui/demain d'un coup d'œil.
function renderUpcomingSidebar(events) {
    const container = document.getElementById('upcoming-list');
    const countLabel = document.getElementById('upcoming-count');
    // toLocalDateStr (pas toISOString) : sinon "aujourd'hui" est décalé d'un jour en arrière
    // pour un fuseau positif (France), et les événements d'hier apparaissaient encore sous
    // "Aujourd'hui" dans la sidebar.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = DateUtils.toLocalDateStr(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = DateUtils.toLocalDateStr(tomorrow);
    const weekLimit = new Date(today);
    weekLimit.setDate(weekLimit.getDate() + 7);
    const weekLimitStr = DateUtils.toLocalDateStr(weekLimit);

    const upcoming = events
        .filter(e => e.start.split('T')[0] >= todayStr && !e.isCanceled)
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, 20);

    upcomingEventsCache = upcoming;
    countLabel.innerText = upcoming.length;
    if (upcoming.length === 0) {
        container.innerHTML = `<div class="text-center text-xs text-slate-600 py-12">Aucun événement à venir</div>`;
        return;
    }

    const groups = { "Aujourd'hui": [], "Demain": [], "Cette semaine": [], "Plus tard": [] };
    upcoming.forEach((e, idx) => {
        const dayStr = e.start.split('T')[0];
        const item = { e, idx };
        if (dayStr === todayStr) groups["Aujourd'hui"].push(item);
        else if (dayStr === tomorrowStr) groups["Demain"].push(item);
        else if (dayStr < weekLimitStr) groups["Cette semaine"].push(item);
        else groups["Plus tard"].push(item);
    });

    container.innerHTML = Object.entries(groups)
        .filter(([, items]) => items.length > 0)
        .map(([label, items]) => `
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-0.5 pt-1 first:pt-0">${label}</div>
            ${items.map(({ e, idx }) => {
                const dateObj = new Date(e.start);
                const readableDate = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
                return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate)}</div>`;
            }).join('')}
        `).join('');
}

function saveFiltersToStorage() {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
        category: currentCategory,
        type: currentTypeFilter,
        tag: currentTagFilter
    }));
}

// Restaure les filtres actifs de la dernière visite, pour ne pas perdre son contexte
// de navigation à chaque rechargement de page.
function restoreFiltersFromStorage() {
    try {
        const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.category) currentCategory = saved.category;
        if (saved.type) currentTypeFilter = saved.type;
        if (saved.tag) currentTagFilter = saved.tag;
    } catch {
        // Valeur corrompue : on ignore silencieusement et repart sur les filtres par défaut.
    }
}

// La période (Du/Au) n'est volontairement PAS mémorisée d'une visite à l'autre (contrairement
// aux autres filtres) : une plage de dates a peu de sens rechargée plusieurs jours après, et
// resterait invisible/piégeante pour l'utilisateur qui rouvre l'app. Elle peut en revanche être
// partagée explicitement par lien (voir openTodayViewFromUrl, ?today=1).
function setupDateRangeFilter() {
    const fromInput = document.getElementById('filter-date-from');
    const toInput = document.getElementById('filter-date-to');
    const clearBtn = document.getElementById('btn-clear-date-range');

    const applyRange = () => {
        currentDateFrom = fromInput.value || null;
        currentDateTo = toInput.value || null;
        clearBtn.classList.toggle('hidden', !currentDateFrom && !currentDateTo);
        updateUIState();
    };

    fromInput.addEventListener('change', applyRange);
    toInput.addEventListener('change', applyRange);
    clearBtn.addEventListener('click', () => {
        fromInput.value = "";
        toInput.value = "";
        applyRange();
    });
}

// Lien direct "aujourd'hui" (?today=1) : pratique à épingler/partager pour retomber
// directement sur les sessions du jour, sans dépendre de la vue calendrier active.
function openTodayViewFromUrl() {
    if (new URLSearchParams(window.location.search).get('today') !== '1') return;
    const todayStr = DateUtils.toLocalDateStr(new Date());
    currentDateFrom = todayStr;
    currentDateTo = todayStr;
    document.getElementById('filter-date-from').value = todayStr;
    document.getElementById('filter-date-to').value = todayStr;
    document.getElementById('btn-clear-date-range').classList.remove('hidden');
}

// Marque `isNew` sur les événements à venir absents de l'ensemble mémorisé lors de la
// dernière visite (badge "🆕 Nouveau"). Ne mémorise que les événements non terminés,
// pour ne pas faire grossir indéfiniment le localStorage avec tout l'historique passé.
function computeAndMarkNewEvents(allEvents) {
    const upcoming = allEvents.filter(e => e.progressStatus !== "Terminé" && !e.isCanceled);

    let stored = null;
    try {
        const raw = localStorage.getItem(SEEN_EVENTS_KEY);
        stored = raw ? JSON.parse(raw) : null;
    } catch {
        stored = null;
    }

    if (Array.isArray(stored)) {
        const storedSet = new Set(stored);
        upcoming.forEach(e => { if (!storedSet.has(e.id)) e.isNew = true; });
    }

    localStorage.setItem(SEEN_EVENTS_KEY, JSON.stringify(upcoming.map(e => e.id)));
}

function formatCountdown(targetDate) {
    const diffMs = targetDate - new Date();
    if (diffMs <= 0) return "maintenant";
    const mins = Math.floor(diffMs / 60000);
    const days = Math.floor(mins / 1440);
    const hours = Math.floor((mins % 1440) / 60);
    const remMins = mins % 60;
    if (days > 0) return `dans ${days}j ${hours}h`;
    if (hours > 0) return `dans ${hours}h${remMins > 0 ? remMins + 'min' : ''}`;
    return `dans ${remMins} min`;
}

// Le prochain événement pertinent : celui actuellement "En Cours" en priorité (le plus
// utile à savoir immédiatement), sinon le prochain "Prévu" le plus proche. Calculé sur
// TOUT le dépôt (pas les filtres actifs) : c'est une info globale, pas liée au filtrage.
function computeNextEvent() {
    const all = repo.getAll().filter(e => !e.isCanceled && !e.isPlanned);
    const live = all.find(isGenuinelyLive);
    if (live) return { event: live, isLive: true };

    const now = new Date();
    const future = all
        .filter(e => e.progressStatus === "Prévu" && new Date(e.start) > now)
        .sort((a, b) => a.start.localeCompare(b.start));
    return future.length > 0 ? { event: future[0], isLive: false } : null;
}

function updateNextEventBanner() {
    const banner = document.getElementById('next-event-banner');
    const icon = document.getElementById('next-event-icon');
    const text = document.getElementById('next-event-text');
    const result = computeNextEvent();

    if (!result) {
        banner.classList.add('hidden');
        banner.classList.remove('flex');
        nextEventForBanner = null;
        return;
    }

    nextEventForBanner = result.event;
    banner.classList.remove('hidden');
    banner.classList.add('flex');

    if (result.isLive) {
        icon.textContent = '🔴';
        text.innerHTML = `<b>En direct :</b> ${escapeHtml(result.event.title)}${result.event.heure ? ' · depuis ' + escapeHtml(result.event.heure) : ''}`;
    } else {
        icon.textContent = '⏳';
        text.innerHTML = `<b>Prochain :</b> ${escapeHtml(result.event.title)} — ${formatCountdown(new Date(result.event.start))}`;
    }
}

// Reflète currentViewMode sur les boutons Frise/Carte (surbrillance du mode actif) - factorisé
// pour être appelable aussi bien depuis leurs propres clics que depuis goHome() (retour logo).
function applyViewButtonStyles() {
    const timelineBtn = document.getElementById('btn-toggle-timeline');
    const mapBtn = document.getElementById('btn-toggle-map');
    [[timelineBtn, 'timeline'], [mapBtn, 'map']].forEach(([btn, mode]) => {
        const active = currentViewMode === mode;
        btn.classList.toggle('bg-indigo-500/10', active);
        btn.classList.toggle('border-indigo-500/20', active);
        btn.classList.toggle('text-indigo-300', active);
    });
}

// Remet à zéro catégorie/type/tag/recherche/période (mais pas la vue Calendrier/Frise/Carte,
// ni les overlays ouvertes) - factorisé pour être appelé aussi bien par "✕ Annuler les filtres"
// que par le clic sur le logo (retour accueil, voir goHome()).
function resetFiltersAndSearch() {
    currentCategory = "all";
    currentTypeFilter = null;
    currentTagFilter = null;
    currentSearchQuery = "";
    currentDateFrom = null;
    currentDateTo = null;
    document.getElementById('recherche').value = "";
    document.getElementById('btn-clear-search').classList.add('hidden');
    document.getElementById('search-icon').classList.remove('hidden');
    document.getElementById('filter-date-from').value = "";
    document.getElementById('filter-date-to').value = "";
    document.getElementById('btn-clear-date-range').classList.add('hidden');
    setActiveCategoryButton(document.querySelector('#filter-categories-container button[data-cat="all"]'));
    renderTypeFilterBar();
    updateTagsFilterBar(repo.getAll());
    saveFiltersToStorage();
}

function updateUIState() {
    let filtered = repo.getAll();

    // Filtre par catégorie dynamique (config.js THEMES[...].cat), pas par type exact.
    if (currentCategory !== "all") {
        filtered = filtered.filter(e => e.category === currentCategory);
    }
    if (currentTypeFilter) {
        filtered = filtered.filter(e => e.type === currentTypeFilter);
    }
    if (currentTagFilter) {
        filtered = filtered.filter(e => e.tags && e.tags.includes(currentTagFilter));
    }
    if (currentDateFrom) {
        filtered = filtered.filter(e => e.start.split('T')[0] >= currentDateFrom);
    }
    if (currentDateTo) {
        filtered = filtered.filter(e => e.start.split('T')[0] <= currentDateTo);
    }

    const calendarEl = document.getElementById('calendar');
    const searchResultsEl = document.getElementById('search-results');
    const timelineEl = document.getElementById('timeline-view');
    const mapEl = document.getElementById('map-view');
    const isSearching = currentSearchQuery.trim().length > 0;

    // Quatre vues mutuellement exclusives sur la même sélection filtrée : la recherche prime
    // toujours sur Frise/Carte (voir currentViewMode plus haut), qui priment sur le calendrier.
    calendarEl.classList.add('hidden');
    searchResultsEl.classList.add('hidden');
    timelineEl.classList.add('hidden');
    mapEl.classList.add('hidden');

    if (isSearching) {
        filtered = SearchEngine.search(filtered, { query: currentSearchQuery });
        searchResultsCache = [...filtered].sort((a, b) => a.start.localeCompare(b.start));
        searchResultsEl.classList.remove('hidden');
        renderSearchResults(searchResultsEl, searchResultsCache);
    } else if (currentViewMode === 'timeline') {
        timelineCache = [...filtered].sort((a, b) => a.start.localeCompare(b.start));
        timelineEl.classList.remove('hidden');
        renderTimeline(timelineEl, timelineCache, timelineSortOrder);
    } else if (currentViewMode === 'map') {
        mapEl.classList.remove('hidden');
        updateMeetupMap(filtered, (ev) => ModalView.open(ev));
    } else {
        calendarEl.classList.remove('hidden');
        CalendarView.sync(calendarInstance, filtered);
    }

    renderDashboardStats(filtered);
    renderUpcomingSidebar(filtered);
    lastFilteredEvents = filtered;

    const clearBtn = document.getElementById('btn-clear-filters');
    if (currentCategory !== "all" || currentTypeFilter || currentTagFilter || currentDateFrom || currentDateTo || isSearching) {
        clearBtn.classList.remove('hidden');
    } else {
        clearBtn.classList.add('hidden');
    }
}

/**
 * Fabrique un contrôleur pour un panneau repliable (sidebar, barre de filtres...) :
 * centralise la persistance localStorage et le repli par défaut sur mobile, pour
 * éviter de dupliquer cette logique à chaque nouveau panneau repliable.
 * @param {string} storageKey - Clé localStorage (ex: 'ui:sidebarCollapsed')
 * @param {(collapsed: boolean) => void} applyState - Applique visuellement l'état
 */
function createCollapsiblePanel(storageKey, applyState) {
    const setCollapsed = (collapsed) => {
        applyState(collapsed);
        if (collapsed) localStorage.setItem(storageKey, '1');
        else localStorage.removeItem(storageKey);
    };

    // Respecte un choix déjà enregistré ; sinon replié par défaut sur petit écran
    // (mobile, où un panneau écraserait le contenu) et ouvert sinon.
    const stored = localStorage.getItem(storageKey);
    const collapsedByDefault = stored === '1' || (stored === null && window.matchMedia('(max-width: 639px)').matches);
    applyState(collapsedByDefault);

    return {
        collapse: () => setCollapsed(true),
        expand: () => setCollapsed(false),
        toggle: (currentlyCollapsed) => setCollapsed(!currentlyCollapsed)
    };
}

function setupSidebarToggle() {
    const panel = document.getElementById('sidebar-panel');
    const btnClose = document.getElementById('btn-toggle-sidebar');
    const btnReopen = document.getElementById('btn-reopen-sidebar');
    const refreshCalendarSize = () => setTimeout(() => calendarInstance && calendarInstance.updateSize(), 260);

    const panelCtrl = createCollapsiblePanel('ui:sidebarCollapsed', (collapsed) => {
        panel.classList.toggle('hidden', collapsed);
        btnReopen.classList.toggle('hidden', !collapsed);
    });

    btnClose.addEventListener('click', () => { panelCtrl.collapse(); refreshCalendarSize(); });
    btnReopen.addEventListener('click', () => { panelCtrl.expand(); refreshCalendarSize(); });
}

// Panneau "Statistiques" repliable : une fois replié, le panneau latéral se réduit à
// l'essentiel (heatmap d'activité + Prochainement), sans les cartes de stats qui prennent
// le plus de hauteur.
function setupStatsToggle() {
    const content = document.getElementById('stats-content');
    const btnToggle = document.getElementById('btn-toggle-stats');
    const chevron = document.getElementById('stats-chevron');

    const panelCtrl = createCollapsiblePanel('ui:statsCollapsed', (collapsed) => {
        content.classList.toggle('hidden', collapsed);
        chevron.textContent = collapsed ? '▸' : '▾';
        btnToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    btnToggle.addEventListener('click', () => {
        panelCtrl.toggle(content.classList.contains('hidden'));
    });
}

// Barre "Catégories / Tags / Types" repliable : évite d'occuper en permanence
// une bande d'écran quand on ne s'en sert pas.
function setupFiltersToggle() {
    const content = document.getElementById('filters-bar-content');
    const btnToggle = document.getElementById('btn-toggle-filters');
    const chevron = document.getElementById('filters-chevron');
    const refreshCalendarSize = () => setTimeout(() => calendarInstance && calendarInstance.updateSize(), 260);

    const panelCtrl = createCollapsiblePanel('ui:filtersCollapsed', (collapsed) => {
        content.classList.toggle('hidden', collapsed);
        chevron.textContent = collapsed ? '▸' : '▾';
        btnToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    btnToggle.addEventListener('click', () => {
        panelCtrl.toggle(content.classList.contains('hidden'));
        refreshCalendarSize();
    });
}

// Contenu des notes de version : à éditer librement à chaque mise à jour notable.
// Changez `version` pour que la popup se réaffiche une fois à tous les visiteurs.
const PATCH_NOTES = {
    version: "2026-07-26c",
    sections: [
        {
            title: "🚀 V2.1",
            items: [
                "🗓️ Nouvelle vue Frise : la sélection filtrée organisée par mois, une série entière (hebdo ou notée) regroupée en un seul bloc plutôt que dispersée en autant de lignes que de diffusions.",
                "🗺️ Nouvelle vue Carte : les meetups IRL localisés sur une carte interactive (Montpellier, Paris, Grenoble pour commencer, facilement extensible).",
                "🏅 Badges communautaires dans la rétrospective (régularité, diversité, fiabilité...), et un mini-profil par organisateur (cliquez son nom dans \"Top organisateurs\" ou dans la modale d'un événement) avec ses propres badges.",
                "📲 App installable : ajoutez 2GELOG à votre écran d'accueil, fonctionne même hors-ligne avec les dernières données connues.",
                "🎨 Thème saisonnier automatique (Halloween, Noël, St-Valentin) — désactivable en un clic sur le badge de l'en-tête si besoin.",
                "🧩 Widget \"Prochains événements\" embarquable ailleurs (description de salon Discord, Notion, autre site) : <code>widget/index.html?count=6</code>.",
                "💬 Digest Discord hebdomadaire automatique (en plus du bouton manuel existant) — nécessite qu'un organisateur configure un webhook (voir README)."
            ]
        },
        {
            title: "🚀 Nouveautés",
            items: [
                "Rétrospective enrichie : mur des affiches, premier/dernier moment de l'année, jour de la semaine et tranche horaire préférés, événement qui revient le plus, taux de fiabilité du planning, plus longue série de semaines actives... Survolez un mois/jour du graphique pour un résumé, cliquez dessus pour la liste complète des sessions.",
                "Aperçu automatique sur Discord : le lien copié (bouton 🔗 dans la modale) affiche désormais titre, date et affiche de l'événement dès qu'il est collé dans un salon, sans avoir à cliquer.",
                "🎉 Rétrospective annuelle : un bilan visuel de l'année façon \"Wrapped\" (temps passé ensemble, répartition par catégorie, MVP organisateur, mois le plus actif, tags favoris...) — accessible à tous via le bouton 🎉 Rétrospective de l'en-tête, une année à la fois.",
                "Rappels repensés : \"🔔 M'envoyer un rappel\" fonctionne sur n'importe quel événement — pour une série (dates hebdo ou notées), le même abonnement suit automatiquement chaque prochaine diffusion, pas seulement celle ouverte. Le bouton 🔔 Rappels de l'en-tête ouvre désormais la liste de vos abonnements, avec un interrupteur pour tout activer d'un coup.",
                "Bouton 💬 Discord : copie en un clic un message prêt à coller dans un salon d'annonces, avec le programme des 7 prochains jours.",
                "Nouveaux boutons dans la modale : 💬 lien direct vers le salon Discord de l'événement (<code>@salon</code>), 🗳️ lien vers un sondage (<code>@sondage</code>) pour voter le prochain film/jeu.",
                "Filtre par période (\"Du / Au\") dans la barre de filtres, et lien direct <code>?today=1</code> pour n'afficher que les sessions du jour.",
                "Mode Kiosque (🖥️) : affichage plein écran sans interaction, idéal sur un écran dédié affiché en continu.",
                "Top organisateurs de l'année ajouté au panneau Statistiques.",
                "Durées d'épisodes qui varient trop pour une moyenne : une annotation <code>(1h,23min,45min,1h)</code> en fin de ligne datée donne la durée réelle de chacun."
            ]
        },
        {
            title: "🛠️ Corrections",
            items: [
                "Durée d'un épisode couvrant plusieurs semaines à la fois (ex: \"Episodes 3 à 6\") : n'est plus diluée à parts égales entre toutes les semaines de la série, mais répartie au prorata du nombre d'épisodes de chacune.",
                "Discord et Kiosque sont désormais regroupés avec le mode Admin (moins utiles en usage courant), pour ne pas encombrer l'en-tête.",
                "Nouvelle colonne <b>Tags</b> dans le tableur : toutes les balises (#tag, @host, @lieu...) peuvent désormais y être saisies séparément, en laissant Notes pour du texte libre uniquement.",
                "Organisateur affiché par défaut : « Helldwin » si aucun @host n'est précisé, au lieu de rester vide.",
                "Statuts Prévu/En Cours/Terminé recalculés plus finement par occurrence : une série sans durée réelle connue reste \"En Cours\" plutôt que d'être annoncée \"Terminée\" à tort.",
                "Le bandeau \"En direct\" et la pastille animée ne se fient plus indéfiniment à un statut \"En Cours\" incertain : passé quelques heures sans confirmation, l'événement n'est plus annoncé comme diffusé \"maintenant\".",
                "Vue Semaine : la plage horaire affichée est resserrée à la fenêtre réellement utilisée (14h → 2h du matin)."
            ]
        },
        {
            title: "ℹ️ À savoir",
            items: [
                "Le lieu par défaut des événements est désormais « Discord 2GETHER » sauf indication contraire.",
                "Un événement peut toujours être annulé ou reporté à la dernière minute : pensez à vérifier le calendrier avant chaque session.",
                "Le bouton 📅 .ics est un export ponctuel à réimporter manuellement ; pour une synchronisation automatique, préférez 🔗 S'abonner (lien webcal://, régénéré côté serveur toutes les heures)."
            ]
        }
    ]
};

// Popup "Quoi de neuf ?" affichée une seule fois par version (localStorage).
function setupPatchNotes() {
    const overlay = document.getElementById('patchnotes-overlay');
    const content = document.getElementById('patchnotes-content');

    content.innerHTML = PATCH_NOTES.sections.map(section => `
        <div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">${section.title}</h3>
            <ul class="space-y-1.5 list-disc list-inside">
                ${section.items.map(item => `<li>${item}</li>`).join('')}
            </ul>
        </div>
    `).join('');

    const close = () => {
        overlay.classList.add('hidden');
        localStorage.setItem('patchnotes:seenVersion', PATCH_NOTES.version);
    };

    document.getElementById('btn-close-patchnotes').addEventListener('click', close);
    document.getElementById('btn-dismiss-patchnotes').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    if (localStorage.getItem('patchnotes:seenVersion') !== PATCH_NOTES.version) {
        overlay.classList.remove('hidden');
    }
}

const NOTIF_ENABLED_KEY = 'notif:enabled';
const NOTIF_NOTIFIED_KEY = 'notif:notifiedIds';
const NOTIF_LEAD_MINUTES = 15;

function hasNotificationPermission() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

function isBlanketRemindersEnabled() {
    return hasNotificationPermission() && localStorage.getItem(NOTIF_ENABLED_KEY) === '1';
}

// Un événement déclenche un rappel si l'interrupteur global "Tout activer" est actif, OU si
// son titre (voir ReminderService) est suivi individuellement.
function shouldRemindFor(event) {
    return hasNotificationPermission() && (isBlanketRemindersEnabled() || ReminderService.isSet(event.title));
}

function updateBlanketReminderButton() {
    const btn = document.getElementById('btn-toggle-all-reminders');
    const enabled = isBlanketRemindersEnabled();
    btn.innerHTML = enabled ? '🔔 Activé' : '🔕 Désactivé';
    btn.setAttribute('aria-pressed', String(enabled));
    btn.className = `shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${enabled ? 'bg-indigo-600/80 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`;
}

// Rappel navigateur (opt-in, Web Notification API) : la permission une fois accordée par
// le navigateur ne peut pas être révoquée depuis le JS, donc "désactiver" ne fait que
// couper notre propre déclenchement (localStorage), la permission système reste accordée.
async function toggleBlanketReminders() {
    if (isBlanketRemindersEnabled()) {
        localStorage.setItem(NOTIF_ENABLED_KEY, '0');
        updateBlanketReminderButton();
        return;
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') {
        localStorage.setItem(NOTIF_ENABLED_KEY, '1');
        new Notification('2GELOG', { body: `Rappels activés : vous serez prévenu ${NOTIF_LEAD_MINUTES} minutes avant chaque session.` });
    }
    updateBlanketReminderButton();
}

// Panneau "Suivis individuellement" (abonnements ReminderService, par titre) : affiche la
// prochaine occurrence connue de chaque titre suivi, avec un bouton pour se désabonner.
function renderRemindersList() {
    const container = document.getElementById('reminders-list');
    const reminders = ReminderService.getAll();

    if (reminders.length === 0) {
        container.innerHTML = `<div class="text-[11px] text-slate-600 italic">Aucun événement suivi individuellement pour l'instant. Ouvrez-en un et cliquez sur "🔔 M'envoyer un rappel".</div>`;
        return;
    }

    const now = new Date();
    const all = repo.getAll();
    container.innerHTML = reminders.map(({ title }) => {
        const next = all
            .filter(e => e.title === title && !e.isCanceled && new Date(e.start) > now)
            .sort((a, b) => a.start.localeCompare(b.start))[0];
        const nextLabel = next
            ? new Date(next.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + (next.heure ? ' · ' + next.heure : '')
            : "Aucune prochaine date connue";
        return `
            <div class="glass-card flex items-center justify-between gap-2 p-2.5 rounded-xl">
                <div class="min-w-0">
                    <div class="text-xs font-bold text-slate-200 truncate">${escapeHtml(title)}</div>
                    <div class="text-[11px] text-slate-500">Prochaine : ${escapeHtml(nextLabel)}</div>
                </div>
                <button data-remove-title="${escapeHtml(title)}" title="Ne plus suivre" aria-label="Ne plus suivre ${escapeHtml(title)}" class="shrink-0 text-slate-500 hover:text-rose-400 text-xs p-1.5 rounded-md hover:bg-rose-500/10 transition-all">✕</button>
            </div>
        `;
    }).join('');
}

function setupRemindersOverlay() {
    const overlay = document.getElementById('reminders-overlay');
    const open = () => {
        updateBlanketReminderButton();
        renderRemindersList();
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    };
    const close = () => { overlay.classList.add('hidden'); overlay.classList.remove('flex'); };

    document.getElementById('btn-open-reminders').addEventListener('click', open);
    document.getElementById('btn-close-reminders').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('btn-toggle-all-reminders').addEventListener('click', toggleBlanketReminders);

    document.getElementById('reminders-list').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-remove-title]');
        if (!btn) return;
        ReminderService.remove(btn.dataset.removeTitle);
        renderRemindersList();
        updateUIState(); // Rafraîchit le badge 🔔 sur les tuiles concernées.
    });
}

function getNotifiedIds() {
    try {
        const parsed = JSON.parse(localStorage.getItem(NOTIF_NOTIFIED_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// Cherche, sur TOUT le dépôt (pas les filtres actifs à l'écran : le rappel doit sonner pour
// n'importe quelle session à venir), les événements démarrant dans moins de
// NOTIF_LEAD_MINUTES et concernés par un rappel (global ou par abonnement individuel) et
// déclenche une notification navigateur une seule fois chacun.
function checkUpcomingNotifications() {
    if (!hasNotificationPermission()) return;
    const now = new Date();
    const leadMs = NOTIF_LEAD_MINUTES * 60000;
    const notified = new Set(getNotifiedIds());

    const due = repo.getAll().filter(e => {
        if (e.isCanceled || e.isPlanned || notified.has(e.id) || !shouldRemindFor(e)) return false;
        const diff = new Date(e.start) - now;
        return diff > 0 && diff <= leadMs;
    });
    if (due.length === 0) return;

    due.forEach(e => {
        new Notification(`🔴 ${e.title}`, {
            body: `Commence dans ${Math.round((new Date(e.start) - now) / 60000)} min${e.heure ? ' · ' + e.heure : ''}`,
            tag: e.id
        });
        notified.add(e.id);
    });

    // Purge les ids de plus de 2 jours pour ne pas faire grossir indéfiniment le localStorage
    // (l'id embarque la date de début : "2026-07-14T20:00:00__Titre", voir EventGenerator).
    const cutoff = new Date(now.getTime() - 2 * 24 * 3600000);
    const pruned = [...notified].filter(id => new Date(id.split('T')[0]) >= cutoff);
    localStorage.setItem(NOTIF_NOTIFIED_KEY, JSON.stringify(pruned));
}

let kioskRotationTimer = null;
let kioskSavedState = null;

// Mode Kiosque : plein écran sans interaction, pensé pour un écran dédié affiché en
// continu (ex: partagé dans un salon vocal Discord). Alterne automatiquement entre
// "Aujourd'hui" et "Cette semaine" en réutilisant le filtre de plage de dates (§ Feature 7).
function applyKioskRange(days) {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const fromStr = DateUtils.toLocalDateStr(from);
    const to = new Date(from); to.setDate(to.getDate() + days);
    currentDateFrom = fromStr;
    currentDateTo = DateUtils.toLocalDateStr(to);
    updateUIState();
}

function enterKioskMode() {
    kioskSavedState = {
        dateFrom: currentDateFrom,
        dateTo: currentDateTo,
        view: calendarInstance ? calendarInstance.view.type : null
    };

    document.body.classList.add('kiosk-mode');
    document.getElementById('btn-exit-kiosk').classList.remove('hidden');
    document.documentElement.requestFullscreen?.().catch(() => {});

    if (calendarInstance) calendarInstance.changeView('listMonth');

    // Démarre sur "Cette semaine" plutôt que "Aujourd'hui" : un jour sans aucune session
    // (fréquent) afficherait sinon un écran vide en tout premier, qui a tout l'air d'un
    // mode Kiosque cassé plutôt que "simplement rien de prévu maintenant".
    let showingWeek = true;
    applyKioskRange(7);
    kioskRotationTimer = setInterval(() => {
        showingWeek = !showingWeek;
        applyKioskRange(showingWeek ? 7 : 0);
    }, 20000);
}

function exitKioskMode() {
    document.body.classList.remove('kiosk-mode');
    document.getElementById('btn-exit-kiosk').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    clearInterval(kioskRotationTimer);
    kioskRotationTimer = null;

    if (kioskSavedState) {
        currentDateFrom = kioskSavedState.dateFrom;
        currentDateTo = kioskSavedState.dateTo;
        document.getElementById('filter-date-from').value = currentDateFrom || "";
        document.getElementById('filter-date-to').value = currentDateTo || "";
        document.getElementById('btn-clear-date-range').classList.toggle('hidden', !currentDateFrom && !currentDateTo);
        if (calendarInstance && kioskSavedState.view) calendarInstance.changeView(kioskSavedState.view);
        kioskSavedState = null;
    }
    updateUIState();
}

function setupKioskMode() {
    document.getElementById('btn-kiosk-mode').addEventListener('click', enterKioskMode);
    document.getElementById('btn-exit-kiosk').addEventListener('click', exitKioskMode);
    // La sortie plein écran par Échap (raccourci natif du navigateur) doit aussi
    // désactiver proprement le mode Kiosque (arrêter la rotation, réafficher les contrôles).
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && document.body.classList.contains('kiosk-mode')) {
            exitKioskMode();
        }
    });
}

// Thème saisonnier (voir SeasonalTheme.js) : purement cosmétique (teinte de fond + pastille
// d'en-tête), jamais bloquant. Le badge affiché sert aussi de bouton pour le désactiver le
// temps de la saison, au cas où certains visiteurs préfèrent le thème neutre habituel.
function refreshSeasonalTheme() {
    const season = resolveActiveSeason();
    const cfg = applySeasonalTheme(season);
    const badge = document.getElementById('seasonal-badge');
    if (!cfg) {
        badge.classList.add('hidden');
        return;
    }
    badge.textContent = `${cfg.emoji} ${cfg.label}`;
    badge.style.color = cfg.color;
    badge.style.borderColor = `${cfg.color}40`;
    badge.style.background = `${cfg.color}1a`;
    badge.classList.remove('hidden');
}

// Thème saisonnier : "Auto" (par défaut) suit la date réelle, ou un choix manuel (forcer un
// thème toute l'année, ou le désactiver complètement) via le sélecteur d'en-tête - persisté
// dans localStorage (voir SeasonalTheme.js). Le badge n'est plus qu'un indicatif visuel du
// thème actif, ce sélecteur est l'unique commande.
function setupSeasonalTheme() {
    const select = document.getElementById('theme-select');
    select.value = getManualOverride();
    refreshSeasonalTheme();

    select.addEventListener('change', () => {
        setManualOverride(select.value);
        refreshSeasonalTheme();
    });
}

async function sha256Hex(text) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verrou du mode admin : protection côté client uniquement (site 100% statique,
// sans backend possible). Ça décourage un visiteur curieux, pas un attaquant
// déterminé qui lirait le code source — voir le commentaire dans config.js.
function setupAdminMode() {
    const isAdmin = new URLSearchParams(window.location.search).has('admin');
    if (!isAdmin) return;

    const btnAdmin = document.getElementById('btn-admin-view');
    const overlay = document.getElementById('admin-overlay');
    const content = document.getElementById('admin-content');

    btnAdmin.classList.remove('hidden');
    // Export Discord, lien de déclenchement du digest webhook, et mode Kiosque : plutôt des
    // outils d'organisateur que d'usage courant, regroupés avec le mode Admin pour ne pas
    // encombrer l'en-tête des visiteurs classiques.
    document.getElementById('btn-export-discord').classList.remove('hidden');
    document.getElementById('btn-trigger-webhook').classList.remove('hidden');
    document.getElementById('btn-kiosk-mode').classList.remove('hidden');

    const openAdmin = () => {
        renderAdminView(content, repo.getAll(), dataAnomalies);
        overlay.classList.remove('hidden');
    };

    btnAdmin.addEventListener('click', async () => {
        if (sessionStorage.getItem('admin:unlocked') === '1') {
            openAdmin();
            return;
        }
        const attempt = window.prompt("Mot de passe administrateur :");
        if (attempt === null) return;
        const hash = await sha256Hex(attempt);
        if (hash === CONFIG.ADMIN_PASSPHRASE_SHA256) {
            sessionStorage.setItem('admin:unlocked', '1');
            openAdmin();
        } else {
            window.alert("Mot de passe incorrect.");
        }
    });

    document.getElementById('btn-close-admin').addEventListener('click', () => {
        overlay.classList.add('hidden');
    });
}

let currentRetrospectiveYear = null;
// Événements du dernier mois/jour de semaine ouvert en détail (voir openBucketDetail) :
// indexé de la même façon que le rendu, pour retrouver l'objet complet au clic sur une carte.
let bucketDetailCache = [];

/**
 * Liste complète (et non plus seulement le résumé "top 3" de l'infobulle) des sessions d'un
 * mois ou jour de semaine de la rétrospective, ouverte au clic sur une barre des graphiques
 * (voir renderHoverBarChart dans RetrospectiveView.js).
 */
function openBucketDetail(kind, label, index) {
    bucketDetailCache = getBucketEvents(repo.getAll(), currentRetrospectiveYear, kind, index);

    const title = document.getElementById('bucket-detail-title');
    const content = document.getElementById('bucket-detail-content');
    const count = bucketDetailCache.length;
    title.textContent = `${label} ${currentRetrospectiveYear} · ${count} session${count > 1 ? 's' : ''}`;
    content.innerHTML = bucketDetailCache.map((e, idx) => {
        const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
        return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate)}</div>`;
    }).join('');

    document.getElementById('bucket-detail-overlay').classList.remove('hidden');
}

// Sessions du dernier organisateur ouvert en profil (voir openOrganizerProfile) : indexé de la
// même façon que le rendu, pour retrouver l'objet complet au clic sur une carte.
let organizerProfileCache = [];
// Mêmes sessions que organizerProfileCache mais non triées (juste facts.realSessions) : source
// pour le filtrage par jour de semaine du graphique "hostWeekday" (voir openOrganizerWeekdayDetail).
let organizerWeekdayCache = [];

/**
 * Mini-profil d'un organisateur (toutes années confondues) : total de sessions/temps animé,
 * répartition par catégorie/tags/moment de la journée, jour de semaine préféré, événement qui
 * revient le plus, premier/dernier moment, mur des affiches, badges personnels (réutilise
 * BadgeService/computeOrganizerFacts - même mécanique que la rétrospective annuelle), et la
 * liste complète de ses sessions. Ouvert depuis le "Top organisateurs" de la sidebar ou le
 * champ "Organisé par" de la modale d'un événement.
 * @param {string} hostName - Nom tel que cliqué (pas forcément déjà normalisé)
 */
function openOrganizerProfile(hostName) {
    if (!hostName) return;
    const normalized = hostName.trim().toLowerCase();
    const allEvents = repo.getAll();
    const facts = computeOrganizerFacts(allEvents, normalized);

    organizerProfileCache = [...facts.realSessions].sort((a, b) => new Date(b.start) - new Date(a.start));
    organizerWeekdayCache = facts.realSessions;

    const currentYear = new Date().getFullYear();
    const yearStats = StatsService.compute(allEvents.filter(e => new Date(e.start).getFullYear() === currentYear));
    const isTopHostThisYear = (topN(yearStats.byHost, 1)[0] || [])[0] === normalized;

    document.getElementById('organizer-profile-title').innerHTML = `👤 <span class="capitalize">${escapeHtml(hostName)}</span>`;
    document.getElementById('organizer-profile-summary').innerHTML = `
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-3">
            <div class="glass-panel rounded-xl p-3 text-center">
                <div class="text-xl font-black text-white">${facts.totalSessions}</div>
                <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">Sessions organisées</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div class="text-xl font-black text-indigo-400">${formatMinutes(facts.totalTime)}</div>
                <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">Temps animé (cumulé)</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div class="text-xl font-black text-white">${facts.distinctTypes}</div>
                <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">Types différents</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div class="text-xl font-black text-emerald-400">${facts.reliabilityPct}%</div>
                <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">Sessions maintenues</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div class="text-xl font-black text-white">${facts.streak}</div>
                <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">${facts.streak > 1 ? "Semaines d'affilée (record)" : 'Semaine active'}</div>
            </div>
        </div>
        ${isTopHostThisYear ? `<div class="text-center text-xs font-bold text-amber-300 mb-3">👑 MVP de ${currentYear}</div>` : ''}
        ${renderBadgeShelf(computeBadges(facts))}
    `;

    // Sections enrichies : mêmes briques que la rétrospective annuelle (voir RetrospectiveView.js),
    // réutilisées telles quelles mais recentrées sur les seules sessions de CET organisateur.
    // "hostWeekday" (au lieu de "weekday") distingue ce graphique de celui de la rétrospective
    // annuelle : son clic doit filtrer organizerWeekdayCache, pas rouvrir getBucketEvents (qui
    // ne connaît qu'une année et tous organisateurs confondus).
    const weekdayChart = facts.weekdayBuckets.some(b => b.count > 0)
        ? renderHoverBarChart(WEEKDAY_LABELS, facts.weekdayBuckets, '📆', (peak) => `Jour préféré pour organiser : ${peak}`, 'hostWeekday')
        : '';
    document.getElementById('organizer-profile-sections').innerHTML = [
        renderCategoryBreakdown(facts.stats.byCategory),
        weekdayChart,
        renderTimeOfDayBreakdown(facts.realSessions),
        renderMostRecurringEvent(facts.realSessions),
        renderTopTags(facts.stats.byTag),
        renderBookendCards(facts.realSessions, {
            first: 'Premier moment organisé',
            last: 'Dernier moment organisé',
            only: 'Le seul moment organisé',
            showYear: true
        }),
        renderPosterWall(facts.realSessions)
    ].filter(Boolean).join('');

    document.getElementById('organizer-profile-content').innerHTML = organizerProfileCache.map((e, idx) => {
        const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate)}</div>`;
    }).join('');

    document.getElementById('organizer-profile-overlay').classList.remove('hidden');
}

// Sessions du dernier jour de semaine ouvert en détail depuis LE PROFIL D'UN ORGANISATEUR (pas
// depuis la rétrospective annuelle, voir openBucketDetail) : toutes années confondues, propres
// à ce seul organisateur - un compartiment que getBucketEvents() ne sait pas produire (année +
// tous organisateurs confondus).
function openOrganizerWeekdayDetail(label, index) {
    bucketDetailCache = organizerWeekdayCache
        .filter(e => (new Date(e.start).getDay() + 6) % 7 === index)
        .sort((a, b) => new Date(b.start) - new Date(a.start));

    const title = document.getElementById('bucket-detail-title');
    const content = document.getElementById('bucket-detail-content');
    const count = bucketDetailCache.length;
    title.textContent = `${label} · ${count} session${count > 1 ? 's' : ''}`;
    content.innerHTML = bucketDetailCache.map((e, idx) => {
        const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate)}</div>`;
    }).join('');

    // Ferme le profil avant d'ouvrir le détail (même raison que openBucketDetail plus haut :
    // ModalView/bucket-detail-overlay ne sont pas empilables par z-index avec ce panneau).
    document.getElementById('organizer-profile-overlay').classList.add('hidden');
    document.getElementById('bucket-detail-overlay').classList.remove('hidden');
}

function setupOrganizerProfile() {
    const overlay = document.getElementById('organizer-profile-overlay');
    const close = () => overlay.classList.add('hidden');

    document.getElementById('btn-close-organizer-profile').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { close(); return; }
        const bar = e.target.closest('[data-bucket-kind="hostWeekday"]');
        if (bar) { openOrganizerWeekdayDetail(bar.dataset.bucketLabel, Number(bar.dataset.bucketIndex)); return; }
        const card = e.target.closest('[data-idx]');
        if (!card) return;
        const ev = organizerProfileCache[Number(card.dataset.idx)];
        if (ev) { close(); ModalView.open(ev); }
    });

    // Délégation de clic sur le "Top organisateurs" de la sidebar (voir renderDashboardStats).
    document.getElementById('stat-hosts-container').addEventListener('click', (e) => {
        const row = e.target.closest('[data-host]');
        if (row) openOrganizerProfile(row.dataset.host);
    });
}

// Rétrospective annuelle "vitrine" (voir RetrospectiveView.js) : accessible à tous, contrairement
// au mode Admin (anomalies/tableaux techniques, réservé aux organisateurs via ?admin).
function setupRetrospective() {
    const overlay = document.getElementById('retrospective-overlay');
    const content = document.getElementById('retrospective-content');

    const renderCurrentYear = () => renderRetrospective(content, repo.getAll(), currentRetrospectiveYear);

    const open = () => {
        const years = getAvailableYears(repo.getAll());
        const thisYear = new Date().getFullYear();
        // Ouvre sur l'année en cours si elle a des données, sinon la plus récente disponible.
        currentRetrospectiveYear = years.includes(thisYear) ? thisYear : (years[0] || thisYear);
        renderCurrentYear();
        overlay.classList.remove('hidden');
    };
    const close = () => overlay.classList.add('hidden');

    document.getElementById('btn-open-retrospective').addEventListener('click', open);
    document.getElementById('btn-close-retrospective').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    content.addEventListener('click', (e) => {
        const bar = e.target.closest('[data-bucket-kind]');
        if (bar) {
            openBucketDetail(bar.dataset.bucketKind, bar.dataset.bucketLabel, Number(bar.dataset.bucketIndex));
            return;
        }
        const btn = e.target.closest('button[data-retro-year]');
        if (!btn || btn.disabled) return;
        currentRetrospectiveYear = Number(btn.dataset.retroYear);
        renderCurrentYear();
    });
    // Accessibilité clavier : les barres sont des div focusables (role="button"), Entrée/Espace
    // doivent donc les activer comme le ferait un vrai <button> (même besoin que next-event-banner).
    content.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const bar = e.target.closest('[data-bucket-kind]');
        if (!bar) return;
        e.preventDefault();
        openBucketDetail(bar.dataset.bucketKind, bar.dataset.bucketLabel, Number(bar.dataset.bucketIndex));
    });

    const bucketOverlay = document.getElementById('bucket-detail-overlay');
    const closeBucketDetail = () => bucketOverlay.classList.add('hidden');
    document.getElementById('btn-close-bucket-detail').addEventListener('click', closeBucketDetail);
    bucketOverlay.addEventListener('click', (e) => {
        if (e.target === bucketOverlay) { closeBucketDetail(); return; }
        const card = e.target.closest('[data-idx]');
        if (!card) return;
        const ev = bucketDetailCache[Number(card.dataset.idx)];
        if (!ev) return;
        // Ferme les deux overlays de la rétrospective avant d'ouvrir la modale : ModalView
        // (z-50) est sous les deux (z-62/63), elle resterait invisible sinon.
        closeBucketDetail();
        close();
        ModalView.open(ev);
    });
}

// Lien partageable direct (?event=<id>, voir ModalView) : rouvre la modale de
// l'événement visé si l'id est encore présent dans le dépôt fraîchement chargé.
function openEventFromUrl() {
    const id = new URLSearchParams(window.location.search).get('event');
    if (!id) return;
    const ev = repo.getAll().find(e => e.id === id);
    if (ev) ModalView.open(ev);
}

// Affiche l'heure de la dernière synchronisation réussie (sur la pastille d'en-tête, déjà
// existante) : utile en PWA hors-ligne, où le Service Worker (voir sw.js) peut servir la
// dernière copie connue du CSV de façon totalement transparente pour ce code - impossible de
// distinguer une réponse réseau fraîche d'une réponse mise en cache, donc on se contente
// d'enregistrer "la dernière fois que ça a marché", vrai dans les deux cas.
const LAST_SYNCED_KEY = 'csv:lastSyncedAt';

function updateLastSyncedTooltip() {
    const dot = document.getElementById('header-status-dot');
    const raw = localStorage.getItem(LAST_SYNCED_KEY);
    if (!dot || !raw) return;
    const time = new Date(parseInt(raw, 10)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    dot.title = `Dernière synchronisation : ${time}`;
}

// Récupère le CSV, régénère le dépôt et rafraîchit l'UI. Isolée d'initApp() pour
// pouvoir être rejouée par le bouton "Réessayer" sans dupliquer les écouteurs.
async function loadData() {
    const loadingEl = document.getElementById('loading-overlay');
    const errorEl = document.getElementById('error-banner');
    errorEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    try {
        const rawRows = await CSVParser.fetch(CONFIG.CSV_URL);
        dataAnomalies = validateRows(rawRows);

        repo.clear();
        rawRows.forEach(row => {
            const instances = EventGenerator.generate(row);
            instances.forEach(inst => repo.add(inst));
        });
        computeAndMarkNewEvents(repo.getAll());

        updateTagsFilterBar(repo.getAll());
        renderTypeFilterBar();
        renderCategoryFilterBar();
        updateUIState();
        updateNextEventBanner();
        checkUpcomingNotifications();
        renderActivityHeatmap(document.getElementById('activity-heatmap'), repo.getAll());
        openEventFromUrl();
        localStorage.setItem(LAST_SYNCED_KEY, Date.now().toString());
        updateLastSyncedTooltip();
        loadingEl.classList.add('hidden');
    } catch (error) {
        console.error("❌ Erreur de chargement du planning :", error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// Bouton d'aide/légende (statuts, catégories, tags...) pour les nouveaux arrivants.
function setupHelpOverlay() {
    const overlay = document.getElementById('help-overlay');
    const open = () => { overlay.classList.remove('hidden'); overlay.classList.add('flex'); };
    const close = () => { overlay.classList.add('hidden'); overlay.classList.remove('flex'); };

    document.getElementById('btn-help').addEventListener('click', open);
    document.getElementById('btn-close-help').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// Recherche : la saisie est temporisée (200ms) pour éviter de relancer le filtrage sur
// chaque frappe (recherche + rendu sur plus d'un millier d'événements), et le raccourci
// clavier "/" y donne le focus directement (sauf si un autre champ est déjà en cours de
// saisie), comme dans la plupart des apps web.
function setupSearchInput() {
    const input = document.getElementById('recherche');
    const clearBtn = document.getElementById('btn-clear-search');
    const icon = document.getElementById('search-icon');
    let debounceTimer = null;

    const toggleClearBtn = (hasValue) => {
        clearBtn.classList.toggle('hidden', !hasValue);
        icon.classList.toggle('hidden', hasValue);
    };

    const applyQuery = (value) => {
        currentSearchQuery = value;
        toggleClearBtn(value.length > 0);
        updateUIState();
    };

    input.addEventListener('input', (e) => {
        toggleClearBtn(e.target.value.length > 0);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => applyQuery(e.target.value), 200);
    });

    clearBtn.addEventListener('click', () => {
        input.value = "";
        applyQuery("");
        input.focus();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== '/') return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        e.preventDefault();
        input.focus();
    });
}

// Ferme la modale/popup au premier plan avec Échap (celles qui n'ont qu'un clic en dehors
// ou un bouton dédié jusqu'ici) : geste attendu par réflexe sur la plupart des sites.
function setupEscapeToClose() {
    const overlayCloseButtons = [
        ['patchnotes-overlay', 'btn-close-patchnotes'],
        ['help-overlay', 'btn-close-help'],
        ['reminders-overlay', 'btn-close-reminders'],
        ['bucket-detail-overlay', 'btn-close-bucket-detail'],
        ['organizer-profile-overlay', 'btn-close-organizer-profile'],
        ['retrospective-overlay', 'btn-close-retrospective'],
        ['admin-overlay', 'btn-close-admin']
    ];
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // Si plusieurs de ces panneaux sont visibles à la fois (ex: Détail ouvert par-dessus
        // Rétrospective), Échap doit fermer celui du DESSUS (le plus grand z-index), pas le
        // premier trouvé dans une liste figée — sinon il "ne se passe rien" à l'écran : le
        // panneau du dessous se ferme bien mais reste invisible derrière celui resté ouvert.
        let topMost = null;
        for (const [overlayId, btnId] of overlayCloseButtons) {
            const overlay = document.getElementById(overlayId);
            if (overlay.classList.contains('hidden')) continue;
            const z = parseInt(getComputedStyle(overlay).zIndex, 10) || 0;
            if (!topMost || z > topMost.z) topMost = { btnId, z };
        }
        if (topMost) document.getElementById(topMost.btnId).click();
    });
}

async function initApp() {
    try {
        // Purement cosmétique et indépendant des données du tableur : posé tôt, avant même
        // le chargement du CSV.
        setupSeasonalTheme();

        // PWA : coquille + dernier CSV connu mis en cache pour un fonctionnement hors-ligne
        // (voir sw.js). Ignoré silencieusement sur un navigateur qui ne supporte pas les
        // service workers - dégradation gracieuse, jamais bloquant.
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(err => console.warn('⚠️ Enregistrement du Service Worker échoué :', err));
        }
        // Reflète tout de suite la dernière synchro connue (visite précédente), avant même que
        // le chargement en cours n'ait eu le temps d'aboutir ou d'échouer.
        updateLastSyncedTooltip();

        // Restaure les filtres de la dernière visite avant le premier rendu, pour que
        // les barres de filtres et le calendrier reflètent directement le bon état.
        restoreFiltersFromStorage();
        // ?today=1 (lien partageable) prime sur les filtres restaurés : intention explicite
        // de l'utilisateur qui a cliqué ce lien précis.
        openTodayViewFromUrl();

        // ModalView pilote la modale existante ; le clic sur un tag relance une recherche.
        ModalView.init((tag) => {
            document.getElementById('recherche').value = `#${tag}`;
            document.getElementById('btn-clear-search').classList.remove('hidden');
            document.getElementById('search-icon').classList.add('hidden');
            currentSearchQuery = `#${tag}`;
            updateUIState();
        }, () => updateUIState(), (host) => openOrganizerProfile(host));

        // Délégation de clic sur la sidebar "Prochainement" : ouvre la modale
        // avec l'objet événement complet (pas de lookup global requis).
        document.getElementById('upcoming-list').addEventListener('click', (e) => {
            const card = e.target.closest('[data-idx]');
            if (!card) return;
            const ev = upcomingEventsCache[Number(card.dataset.idx)];
            if (ev) ModalView.open(ev);
        });

        // Idem pour le listing complet affiché lors d'une recherche.
        document.getElementById('search-results').addEventListener('click', (e) => {
            const card = e.target.closest('[data-idx]');
            if (!card) return;
            const ev = searchResultsCache[Number(card.dataset.idx)];
            if (ev) ModalView.open(ev);
        });

        // Idem pour la vue Frise (mêmes lignes/groupes que la vue Recherche, voir TimelineView.js).
        document.getElementById('timeline-view').addEventListener('click', (e) => {
            const orderToggle = e.target.closest('[data-timeline-order-toggle]');
            if (orderToggle) {
                timelineSortOrder = timelineSortOrder === 'asc' ? 'desc' : 'asc';
                updateUIState();
                return;
            }
            const card = e.target.closest('[data-idx]');
            if (!card) return;
            const ev = timelineCache[Number(card.dataset.idx)];
            if (ev) ModalView.open(ev);
        });

        // Bascule Calendrier <-> Frise/Carte : la recherche (isSearching) prime toujours sur ce
        // choix, voir updateUIState(). Un seul bouton actif à la fois (retour au calendrier si
        // on reclique le bouton déjà actif, ou si on active l'autre vue).
        const timelineBtn = document.getElementById('btn-toggle-timeline');
        const mapBtn = document.getElementById('btn-toggle-map');
        timelineBtn.addEventListener('click', () => {
            currentViewMode = currentViewMode === 'timeline' ? 'calendar' : 'timeline';
            applyViewButtonStyles();
            updateUIState();
        });
        mapBtn.addEventListener('click', () => {
            currentViewMode = currentViewMode === 'map' ? 'calendar' : 'map';
            applyViewButtonStyles();
            if (currentViewMode === 'map') {
                const map = initMeetupMap('meetup-map');
                // Le conteneur était caché (display:none) lors de l'init : Leaflet a calculé sa
                // taille sur une boîte à 0px, invalidateSize() la recalcule maintenant qu'elle
                // est visible (sinon la carte reste tronquée/mal centrée tant qu'on ne zoome pas).
                setTimeout(() => map.invalidateSize(), 50);
            }
            updateUIState();
        });

        setupSidebarToggle();
        setupStatsToggle();
        setupFiltersToggle();
        setupAdminMode();
        setupRetrospective();
        setupOrganizerProfile();
        setupPatchNotes();
        setupHelpOverlay();
        setupEscapeToClose();
        setupRemindersOverlay();
        setupKioskMode();

        document.getElementById('btn-retry-load').addEventListener('click', () => loadData());

        const openNextEventBanner = () => { if (nextEventForBanner) ModalView.open(nextEventForBanner); };
        document.getElementById('next-event-banner').addEventListener('click', openNextEventBanner);
        // Accessibilité clavier : le bandeau est un div focusable (role="button"), Entrée/Espace
        // doivent donc l'activer comme le ferait un vrai <button>.
        document.getElementById('next-event-banner').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openNextEventBanner();
            }
        });
        // Rafraîchit le compte à rebours et vérifie les rappels à déclencher régulièrement,
        // sans dépendre d'un rechargement des données.
        setInterval(() => { updateNextEventBanner(); checkUpcomingNotifications(); }, 30000);

        document.getElementById('btn-export-ics').addEventListener('click', () => {
            const filename = `planning-2gelog-${DateUtils.toLocalDateStr(new Date())}.ics`;
            IcsExporter.download(lastFilteredEvents, filename);
        });

        // Lien d'abonnement (webcal://) vers le flux régénéré en continu par la CI (voir
        // scripts/generate-ics.js) : à la différence du bouton 📅 .ics ci-dessus (un instantané
        // ponctuel à réimporter à la main), ce lien ne se copie qu'une fois dans l'appli
        // calendrier de l'utilisateur, qui se resynchronise ensuite tout seul.
        document.getElementById('btn-subscribe-ics').addEventListener('click', async (e) => {
            const webcalUrl = CONFIG.SITE_URL.replace(/^https?:\/\//, 'webcal://') + 'ics/planning.ics';
            const btn = e.currentTarget;
            try {
                await navigator.clipboard.writeText(webcalUrl);
                const original = btn.innerHTML;
                btn.innerHTML = '✅ Copié !';
                setTimeout(() => { btn.innerHTML = original; }, 1500);
            } catch {
                window.prompt("Copiez ce lien d'abonnement dans votre appli calendrier :", webcalUrl);
            }
        });

        document.getElementById('btn-export-discord').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const original = btn.innerHTML;
            const copied = await DiscordExporter.copyToClipboard(repo.getAll());
            if (copied) {
                btn.innerHTML = '✅ Copié !';
                setTimeout(() => { btn.innerHTML = original; }, 1500);
            }
        });

        // CalendarView pilote entièrement l'instance FullCalendar (rendu + clic).
        calendarInstance = CalendarView.create('calendar', (ev) => ModalView.open(ev));
        calendarInstance.render();

        setupSearchInput();
        setupDateRangeFilter();

        document.getElementById('filter-categories-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            setActiveCategoryButton(btn);
            currentCategory = btn.dataset.cat;
            saveFiltersToStorage();
            updateUIState();
        });

        document.getElementById('filter-types-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const type = btn.dataset.type;
            currentTypeFilter = (currentTypeFilter === type || type === "") ? null : type;
            renderTypeFilterBar();
            saveFiltersToStorage();
            updateUIState();
        });

        document.getElementById('filter-tags-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const tag = btn.dataset.tag;
            currentTagFilter = (currentTagFilter === tag) ? null : tag;
            updateTagsFilterBar(repo.getAll());
            saveFiltersToStorage();
            updateUIState();
        });

        document.getElementById('btn-clear-filters').addEventListener('click', () => {
            resetFiltersAndSearch();
            updateUIState();
        });

        // Logo/titre d'en-tête : retour à l'accueil (réinitialise filtres/recherche/vue, ferme
        // toute overlay ouverte). Ignore les clics venant du badge saisonnier imbriqué dedans
        // (purement indicatif désormais, mais autant éviter un double effet de bord si son
        // wrapper capte quand même le clic).
        const goHome = () => {
            resetFiltersAndSearch();
            if (currentViewMode !== 'calendar') {
                currentViewMode = 'calendar';
                applyViewButtonStyles();
            }
            ['help-overlay', 'reminders-overlay', 'retrospective-overlay', 'admin-overlay',
                'bucket-detail-overlay', 'organizer-profile-overlay', 'patchnotes-overlay'
            ].forEach(id => document.getElementById(id)?.classList.add('hidden'));
            ModalView.hide();
            updateUIState();
        };
        const homeBtn = document.getElementById('btn-go-home');
        homeBtn.addEventListener('click', (e) => {
            if (e.target.closest('#seasonal-badge')) return;
            goHome();
        });
        homeBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); }
        });

        await loadData();

    } catch (error) {
        console.error("❌ Erreur d'initialisation de l'UI Glassmorphism :", error);
        document.getElementById('loading-overlay').classList.add('hidden');
        document.getElementById('error-banner').classList.remove('hidden');
    }
}

document.addEventListener('DOMContentLoaded', initApp);
