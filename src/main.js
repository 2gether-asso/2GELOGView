import { CONFIG } from './config.js';
import { CSVParser } from './parsers/CSVParser.js';
import { EventGenerator } from './services/EventGenerator.js';
import { EventRepository } from './repositories/EventRepository.js';
import { CalendarView } from './ui/CalendarView.js';
import { ModalView } from './ui/ModalView.js';
import { renderEventCard, isGenuinelyLive } from './ui/EventCardTemplate.js';
import { renderSearchResults } from './ui/SearchResultsView.js';
import { renderTimeline } from './ui/TimelineView.js';
import { renderTodayView } from './ui/TodayView.js';
import { renderYearView } from './ui/YearView.js';
import { fetchBirthdays } from './services/BirthdayService.js';
import { fetchCurrentPoll, submitVote, getMyVote } from './services/PollService.js';
import { renderPoll } from './ui/PollView.js';
import { initMeetupMap, updateMeetupMap, groupEventsByCity, cityLabel, getKnownCityKeys } from './ui/MeetupMapView.js';
import { renderAdminView } from './ui/AdminView.js';
import { StatsService } from './services/StatsService.js';
import { SearchEngine } from './services/SearchEngine.js';
import { IcsExporter } from './services/IcsExporter.js';
import { DiscordExporter } from './services/DiscordExporter.js';
import { renderActivityHeatmap } from './ui/ActivityHeatmap.js';
import { DateUtils } from './utils/DateUtils.js';
import { escapeHtml, sanitizeUrl } from './utils/Html.js';
import { formatMinutes, topN, formatCategoryLabel, formatCountdown, formatDurationLong } from './utils/Format.js';
import { validateRows } from './services/DataValidator.js';
import { ReminderService } from './services/ReminderService.js';
import {
    renderRetrospective, getAvailableYears, getBucketEvents, computeOrganizerFacts, renderBadgeShelf,
    renderCategoryBreakdown, renderTopTags, renderTimeOfDayBreakdown, renderPosterWall,
    renderMostRecurringEvent, renderBookendCards, renderHoverBarChart, WEEKDAY_LABELS, computeYearFacts,
    renderAllYearsHistory
} from './ui/RetrospectiveView.js';
import { computeBadges } from './services/BadgeService.js';
import { applySeasonalTheme, resolveActiveSeason, getManualOverride, setManualOverride, SEASONS } from './services/SeasonalTheme.js';
import { Icons } from './ui/Icons.js';
import { showToast } from './ui/Toast.js';
import { startOnboardingTour } from './ui/OnboardingTour.js';
import { renderAvatarInitials } from './utils/Avatar.js';
import { animateCountUp } from './utils/CountUp.js';

const repo = new EventRepository();
let calendarInstance = null;

let currentCategory = "all";
let currentTagFilter = null;
let currentTypeFilter = null;
let currentHostFilter = null;
let currentSearchQuery = "";
let currentDateFrom = null;
let currentDateTo = null;
let dataAnomalies = [];

// Catégories masquées en permanence (QOL #18) : distinct du filtre "actif" à la fois (currentCategory,
// un seul choix affiché) - un ensemble qui exclut ces catégories de TOUTES les vues jusqu'à
// réactivation explicite, mémorisé d'une visite à l'autre.
const HIDDEN_CATEGORIES_KEY = 'ui:hiddenCategories';
let hiddenCategories = new Set();

// Vues favorites (QOL #1) : jeux de filtres nommés, rappelables en un clic depuis le sélecteur
// dédié de la barre de filtres. Ne mémorise que catégorie/type/tag/organisateur (pas la période,
// pour la même raison que saveFiltersToStorage ne la mémorise pas non plus - voir plus bas).
const SAVED_VIEWS_KEY = 'ui:savedViews';
let savedViews = [];

// La sidebar "Prochainement" et le listing de recherche conservent en mémoire
// les événements affichés pour retrouver l'objet complet lors d'un clic (délégation).
let upcomingEventsCache = [];
let nextWeekEventsCache = [];
let searchResultsCache = [];
let timelineCache = [];
let todayViewCache = [];
// Anniversaires des membres (V2.3), chargés une seule fois depuis un tableur annexe (voir
// BirthdayService.js) - pas rafraîchis à chaque loadData() comme le planning principal, un
// tableur d'anniversaires n'a pas besoin d'être re-téléchargé aussi souvent.
let birthdaysList = [];
// Filtre carte par rayon (V2.4, "15") : null = pas de filtre (toutes les villes reconnues),
// sinon { city, km } lu depuis #map-radius-city/#map-radius-km (voir setupMapRadiusFilter).
let mapRadiusFilter = null;
// Année affichée par la vue Année (V2.4, "5") - indépendante de timelineYear (Frise) : rien
// n'empêche de vouloir garder la Frise sur 2025 en cours de consultation, pendant qu'on
// parcourt l'Année sur une autre période.
let yearViewYear = new Date().getFullYear();
// Sens d'affichage et année affichée de la vue Frise, modifiables via leurs propres contrôles
// (voir TimelineView.js data-timeline-order-toggle / data-timeline-year) - indépendants du
// reste des filtres.
let timelineSortOrder = 'asc'; // 'asc' | 'desc'
let timelineYear = new Date().getFullYear();
// Sens d'affichage de la vue Recherche (V2.2, QOL - cohérence avec la Frise ci-dessus, qui a déjà
// son propre bouton d'inversion) : jusque-là toujours croissant, sans moyen de le changer.
let searchResultsSortOrder = 'asc';
// La recherche (isSearching) prime toujours sur ce mode : basculer en Frise/Carte/Aujourd'hui
// n'empêche pas de chercher, ça change juste ce qui s'affiche quand la recherche est vide.
// Sur mobile, la grille du calendrier (Mois) est étroite et peu confortable au doigt : la Frise
// (liste verticale, scroll naturel) est un bien meilleur point d'entrée par défaut - inline plutôt
// que via isMobileWidth() (définie plus bas dans le fichier, pas encore accessible ici vu l'ordre
// d'exécution des `let`/`const` de haut en bas).
let currentViewMode = window.matchMedia('(max-width: 639px)').matches ? 'timeline' : 'calendar'; // 'calendar' | 'timeline' | 'map' | 'today'
// Dernière vue principale réellement affichée (voir updateUIState) : sert uniquement à savoir
// si la vue affichée à CET appel diffère du précédent, pour ne jouer l'animation .view-fade-in
// (V2.2, voir index.html) que lors d'une vraie bascule de vue, pas à chaque filtre/recherche.
let lastVisiblePaneId = null;
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
    // Scopé à button[data-cat] (pas tous les <button>) : le petit bouton 👁 masquer/afficher
    // accolé à chaque catégorie (voir renderCategoryFilterBar) est aussi un <button> mais porte
    // data-hide-cat, pas data-cat - il ne doit pas se faire écraser son style par celui-ci.
    document.querySelectorAll('#filter-categories-container button[data-cat]').forEach(b => {
        b.className = (b === selectedBtn) ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE;
    });
}

function loadHiddenCategories() {
    try {
        const raw = JSON.parse(localStorage.getItem(HIDDEN_CATEGORIES_KEY) || '[]');
        hiddenCategories = new Set(Array.isArray(raw) ? raw : []);
    } catch {
        hiddenCategories = new Set();
    }
}

function saveHiddenCategories() {
    localStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify([...hiddenCategories]));
}

function updateHiddenCategoriesBadge() {
    const btn = document.getElementById('btn-hidden-categories');
    if (hiddenCategories.size === 0) {
        btn.classList.add('hidden');
        return;
    }
    // btn passe de `hidden` à visible via classList.remove('hidden') uniquement (pas de classe
    // flex ajoutée en JS) : l'icône reste donc `inline` (alignée à la ligne de base via
    // align-middle) plutôt que dans un wrapper inline-flex, pour ne pas dépendre de l'ordre de
    // génération CSS entre les utilitaires `hidden` et `inline-flex` du CDN Tailwind (JIT).
    btn.innerHTML = `${Icons.eyeOff('inline w-3 h-3 align-middle mr-0.5')}${hiddenCategories.size} masquée${hiddenCategories.size > 1 ? 's' : ''}`;
    btn.classList.remove('hidden');
}

// Catégories générées dynamiquement depuis config.js THEMES[...].cat plutôt qu'une liste
// binaire figée ("watch"/"game") : suit automatiquement la taxonomie définie dans la config.
// Chaque pastille porte aussi un petit bouton 👁/🙈 (QOL #18) pour la masquer durablement de
// TOUTES les vues (pas juste "filtrer dessus" comme le clic sur la pastille elle-même) - utile
// pour des catégories qu'on ne veut simplement plus jamais voir (ex: Gazette), sans avoir à
// re-sélectionner "Tous" puis reperdre ce choix à la prochaine visite.
function renderCategoryFilterBar(events = []) {
    const container = document.getElementById('filter-categories-container');
    const categories = [...new Set(
        Object.entries(CONFIG.THEMES).filter(([name]) => name !== 'default').map(([, theme]) => theme.cat)
    )];
    // Compteurs (V2.2, cohérence avec les chips Tags/Organisateurs qui en affichent déjà) :
    // total du dépôt (pas le sous-ensemble déjà filtré), même base que renderHostFilterBar/
    // updateTagsFilterBar - exclut annulés/prévus, pas de vraies sessions à compter ici.
    const counts = {};
    events.forEach(e => { if (!e.isCanceled && !e.isPlanned) counts[e.category] = (counts[e.category] || 0) + 1; });

    const allBtn = `<button data-cat="all" class="${!currentCategory || currentCategory === 'all' ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE}">Tous</button>`;
    const catBtns = categories.map(cat => {
        const isHidden = hiddenCategories.has(cat);
        const label = escapeHtml(formatCategoryLabel(cat));
        return `
            <span class="inline-flex items-center gap-0.5 ${isHidden ? 'opacity-40' : ''}">
                <button data-cat="${escapeHtml(cat)}" class="${currentCategory === cat ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE} ${isHidden ? 'line-through' : ''}">${label} <span class="text-3xs opacity-70 ml-0.5">(${counts[cat] || 0})</span></button>
                <button data-hide-cat="${escapeHtml(cat)}" title="${isHidden ? 'Réafficher' : 'Masquer'} la catégorie ${label}" aria-label="${isHidden ? 'Réafficher' : 'Masquer'} la catégorie ${label}" class="text-slate-500 hover:text-amber-300 px-1 py-1 rounded-md hover:bg-white/5 transition-all">${isHidden ? Icons.eyeOff('w-3 h-3') : Icons.eye('w-3 h-3')}</button>
            </span>`;
    }).join('');

    container.innerHTML = allBtn + catBtns;
    updateHiddenCategoriesBadge();
}

// Top organisateurs (par nombre de sessions réelles) pour le filtre "Organisateurs" (QOL #2) -
// même position/rôle que updateTagsFilterBar (barre horizontale scrollable), pour une cohérence
// visuelle entre les deux. Distinct du clic sur un nom dans la sidebar/modale (qui ouvre le
// PROFIL de l'organisateur) : ici on FILTRE le calendrier sur lui, sans quitter la vue courante.
function renderHostFilterBar(events) {
    const container = document.getElementById('filter-hosts-container');
    const counts = {};
    events.forEach(e => {
        if (e.isCanceled || e.isPlanned) return;
        const host = (e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST).trim();
        counts[host] = (counts[host] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);

    if (sorted.length === 0) {
        container.innerHTML = `<span class="text-xxs text-slate-600 italic">Aucun organisateur</span>`;
        return;
    }

    container.innerHTML = sorted.map(([host, count]) => {
        const isSelected = currentHostFilter === host;
        const safeHost = escapeHtml(host);
        return `<button data-host="${safeHost}" class="px-3 py-1 text-xxs rounded-lg border whitespace-nowrap transition-all ${isSelected ? 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white hover:bg-white/10'}">${safeHost} <span class="text-3xs opacity-70 ml-0.5">(${count})</span></button>`;
    }).join('');
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
        ? `<span class="col-span-2 text-xxs text-slate-600 italic">Aucune session</span>`
        : sortedCategories.map(([cat, stat]) => `
            <div class="glass-panel p-3 rounded-xl flex flex-col shadow-sm">
                <span class="text-2xs font-bold text-slate-400 truncate">${escapeHtml(formatCategoryLabel(cat))}</span>
                <span class="text-base font-black text-slate-100 mt-0.5">${stat.n}</span>
                <span class="text-xxs text-indigo-400 font-bold mt-0.5 truncate">${formatMinutes(stat.t)}</span>
            </div>
        `).join('');

    // Pas de count-up ici (contrairement aux profils/rétrospective) : renderDashboardStats est
    // rappelé à chaque frappe de recherche/filtre, une animation à chaque lettre tapée serait
    // criarde plutôt qu'agréable - réservé aux "reveals" ponctuels (ouverture d'un profil/overlay).
    document.getElementById('stat-canceled-count').innerText = stats.counters.annulations || 0;

    // Top 3 organisateurs (temps cumulé) de l'année en cours : même donnée que la
    // rétrospective admin (StatsService.byHost), condensée ici pour rester visible sans
    // passer par le mode ?admin.
    const hostsContainer = document.getElementById('stat-hosts-container');
    const topHosts = topN(stats.byHost, 3);
    hostsContainer.innerHTML = topHosts.length === 0
        ? `<span class="text-xxs text-slate-600 italic">Aucune donnée</span>`
        : topHosts.map(([host, minutes]) => `
            <div class="flex items-center justify-between gap-2 text-xxs cursor-pointer hover:text-white transition-colors" data-host="${escapeHtml(host)}">
                <span class="flex items-center gap-1.5 min-w-0">
                    ${renderAvatarInitials(host, 'w-5 h-5 text-3xs')}
                    <span class="text-slate-300 truncate capitalize">${escapeHtml(host)}</span>
                </span>
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
        container.innerHTML = `<span class="text-xxs text-slate-600 italic">Aucun #tag</span>`;
        return;
    }

    container.innerHTML = sortedTags.map(([tag, count]) => {
        const isSelected = currentTagFilter === tag;
        const safeTag = escapeHtml(tag);
        return `<button data-tag="${safeTag}" class="px-3 py-1 text-xxs rounded-lg border whitespace-nowrap transition-all backdrop-blur-md ${isSelected ? 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white hover:bg-white/10'}" >#${safeTag} <span class="text-3xs opacity-70 ml-0.5">(${count})</span></button>`;
    }).join('');
}

// Chips "Types" générées dynamiquement à partir de CONFIG.THEMES : offre un filtrage
// fin par type exact (Soirée Série, Meet Up, JDR, ...) en plus des 2 catégories larges.
function renderTypeFilterBar(events = []) {
    const container = document.getElementById('filter-types-container');
    const types = Object.keys(CONFIG.THEMES).filter(name => name !== 'default');
    // Compteurs (V2.2, cohérence avec les chips Tags/Organisateurs) : total du dépôt, même base
    // que renderCategoryFilterBar ci-dessus.
    const counts = {};
    events.forEach(e => { if (!e.isCanceled && !e.isPlanned) counts[e.type] = (counts[e.type] || 0) + 1; });

    const allBtn = `<button data-type="" class="px-2.5 py-1 text-xxs rounded-lg border whitespace-nowrap transition-all ${!currentTypeFilter ? 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white hover:bg-white/10'}">Tous les types</button>`;

    // Chaque pastille inactive garde un liseré de la couleur propre à son type (voir
    // EventCardTemplate/CalendarView, qui utilisent la même teinte) : un repère visuel pour
    // repérer un type au coup d'œil dans cette liste, sans attendre de le sélectionner.
    const typeBtns = types.map(name => {
        const theme = CONFIG.THEMES[name];
        const isSelected = currentTypeFilter === name;
        const style = isSelected
            ? `background:${theme.col}33; border-color:${theme.col}; color:#fff;`
            : `border-left: 3px solid ${theme.col}99;`;
        return `<button data-type="${name}" class="px-2.5 py-1 text-xxs rounded-lg border whitespace-nowrap transition-all ${isSelected ? 'font-bold' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white hover:bg-white/10'}" style="${style}">${name} <span class="text-3xs opacity-70 ml-0.5">(${counts[name] || 0})</span></button>`;
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
            <div class="text-2xs font-bold uppercase tracking-wider text-slate-500 px-0.5 pt-1 first:pt-0">${label}</div>
            ${items.map(({ e, idx }) => {
                const dateObj = new Date(e.start);
                const readableDate = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
                return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate, 'upcoming-sidebar')}</div>`;
            }).join('')}
        `).join('');
}

// Widget "Semaine prochaine" (V2.3, "16") : distinct de "Prochainement" ci-dessus (qui mélange
// aujourd'hui/demain/cette semaine/plus tard sur les 20 prochains événements) - ici uniquement
// la fenêtre ISO lundi->dimanche qui suit la semaine EN COURS, pour se projeter sur "la semaine
// prochaine" au sens calendaire strict plutôt que sur un simple "7 prochains jours" glissant.
function renderNextWeekSidebar(events) {
    const container = document.getElementById('nextweek-list');
    const countLabel = document.getElementById('nextweek-count');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Lundi de la semaine en cours (firstDay=1, cohérent avec FullCalendar, voir CalendarView.js).
    const currentMonday = new Date(today);
    currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7));
    const nextMonday = new Date(currentMonday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextSunday.getDate() + 6);
    const nextMondayStr = DateUtils.toLocalDateStr(nextMonday);
    const nextSundayStr = DateUtils.toLocalDateStr(nextSunday);

    const nextWeek = events
        .filter(e => { const d = e.start.split('T')[0]; return d >= nextMondayStr && d <= nextSundayStr && !e.isCanceled; })
        .sort((a, b) => a.start.localeCompare(b.start));

    nextWeekEventsCache = nextWeek;
    countLabel.innerText = nextWeek.length;
    if (nextWeek.length === 0) {
        container.innerHTML = `<div class="text-center text-xs text-slate-600 py-12">Rien de prévu la semaine prochaine</div>`;
        return;
    }

    container.innerHTML = nextWeek.map((e, idx) => {
        const dateObj = new Date(e.start);
        const readableDate = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
        return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate, 'nextweek-sidebar')}</div>`;
    }).join('');
}

function saveFiltersToStorage() {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
        category: currentCategory,
        type: currentTypeFilter,
        tag: currentTagFilter,
        host: currentHostFilter
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
        if (saved.host) currentHostFilter = saved.host;
    } catch {
        // Valeur corrompue : on ignore silencieusement et repart sur les filtres par défaut.
    }
}

// Lien partageable encodant tous les filtres actifs (V2.3, "8") : contrairement aux vues
// favorites (catégorie/type/tag/organisateur seulement, voir setupSavedViews), inclut aussi la
// recherche et la période puisqu'un lien partagé décrit un instant précis, pas une combinaison
// réutilisable dans le temps. "fhost" (et pas "host", déjà pris par openOrganizerProfileFromUrl
// qui OUVRE le profil d'un organisateur plutôt que de filtrer dessus) évite toute collision.
const FILTER_URL_PARAMS = { cat: 'category', type: 'type', tag: 'tag', fhost: 'host', q: 'search', from: 'dateFrom', to: 'dateTo' };

function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (![...Object.keys(FILTER_URL_PARAMS)].some(p => params.has(p))) return;

    if (params.has('cat')) currentCategory = params.get('cat');
    if (params.has('type')) currentTypeFilter = params.get('type');
    if (params.has('tag')) currentTagFilter = params.get('tag');
    if (params.has('fhost')) currentHostFilter = params.get('fhost');
    if (params.has('from')) currentDateFrom = params.get('from');
    if (params.has('to')) currentDateTo = params.get('to');

    if (params.has('q')) {
        currentSearchQuery = params.get('q');
        const searchInput = document.getElementById('recherche');
        searchInput.value = currentSearchQuery;
        document.getElementById('btn-clear-search').classList.toggle('hidden', !currentSearchQuery);
        document.getElementById('search-icon').classList.toggle('hidden', !!currentSearchQuery);
    }
    if (currentDateFrom) document.getElementById('filter-date-from').value = currentDateFrom;
    if (currentDateTo) document.getElementById('filter-date-to').value = currentDateTo;
    document.getElementById('btn-clear-date-range').classList.toggle('hidden', !currentDateFrom && !currentDateTo);

    saveFiltersToStorage();
}

// Construit l'URL partageable reflétant les filtres actuellement actifs (voir FILTER_URL_PARAMS
// ci-dessus pour la correspondance param -> variable). Repart d'une URL "propre" (sans anciens
// paramètres de filtre déjà présents) pour ne jamais empiler d'anciennes valeurs obsolètes.
function buildFiltersShareUrl() {
    const url = new URL(window.location.href);
    Object.keys(FILTER_URL_PARAMS).forEach(p => url.searchParams.delete(p));
    if (currentCategory && currentCategory !== 'all') url.searchParams.set('cat', currentCategory);
    if (currentTypeFilter) url.searchParams.set('type', currentTypeFilter);
    if (currentTagFilter) url.searchParams.set('tag', currentTagFilter);
    if (currentHostFilter) url.searchParams.set('fhost', currentHostFilter);
    if (currentSearchQuery) url.searchParams.set('q', currentSearchQuery);
    if (currentDateFrom) url.searchParams.set('from', currentDateFrom);
    if (currentDateTo) url.searchParams.set('to', currentDateTo);
    return url;
}

function loadSavedViews() {
    try {
        const raw = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]');
        savedViews = Array.isArray(raw) ? raw : [];
    } catch {
        savedViews = [];
    }
}

function persistSavedViews() {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
}

function renderSavedViewsSelect() {
    const select = document.getElementById('saved-views-select');
    const current = select.value;
    select.innerHTML = `<option value="">— Aucune —</option>` +
        savedViews.map((v, idx) => `<option value="${idx}">${escapeHtml(v.name)}</option>`).join('');
    // Conserve la sélection si elle existe toujours après un ré-rendu (ex: après suppression
    // d'une AUTRE vue, qui décale les index des suivantes dans la liste).
    if ([...select.options].some(o => o.value === current)) select.value = current;
}

// Vue favorite (QOL #1) : jeu de filtres (catégorie/type/tag/organisateur, PAS la période -
// même raison que setupDateRangeFilter ci-dessous) nommé et rappelable en un clic, sans avoir à
// recliquer chaque pastille individuellement à chaque visite pour retrouver une combinaison
// utilisée régulièrement (ex: "mes soirées jeux du mardi").
function setupSavedViews() {
    const select = document.getElementById('saved-views-select');
    const deleteBtn = document.getElementById('btn-delete-view');

    document.getElementById('btn-save-view').addEventListener('click', () => {
        const name = window.prompt("Nom de cette vue favorite (ex: \"Soirées jeux\") :");
        if (!name || !name.trim()) return;
        savedViews.push({
            name: name.trim(),
            category: currentCategory,
            type: currentTypeFilter,
            tag: currentTagFilter,
            host: currentHostFilter
        });
        persistSavedViews();
        renderSavedViewsSelect();
        select.value = String(savedViews.length - 1);
        deleteBtn.classList.remove('hidden');
        showToast(`Vue « ${escapeHtml(name.trim())} » enregistrée !`, { icon: Icons.star('w-3.5 h-3.5 shrink-0 text-indigo-300') });
    });

    select.addEventListener('change', () => {
        deleteBtn.classList.toggle('hidden', select.value === "");
        if (select.value === "") return;
        const view = savedViews[Number(select.value)];
        if (!view) return;
        currentCategory = view.category || 'all';
        currentTypeFilter = view.type || null;
        currentTagFilter = view.tag || null;
        currentHostFilter = view.host || null;
        setActiveCategoryButton(document.querySelector(`#filter-categories-container button[data-cat="${currentCategory === 'all' ? 'all' : CSS.escape(currentCategory)}"]`) || document.querySelector('#filter-categories-container button[data-cat="all"]'));
        renderTypeFilterBar(repo.getAll());
        updateTagsFilterBar(repo.getAll());
        renderHostFilterBar(repo.getAll());
        saveFiltersToStorage();
        updateUIState();
    });

    deleteBtn.addEventListener('click', () => {
        if (select.value === "") return;
        const idx = Number(select.value);
        const view = savedViews[idx];
        if (!view || !window.confirm(`Supprimer la vue favorite "${view.name}" ?`)) return;
        savedViews.splice(idx, 1);
        persistSavedViews();
        renderSavedViewsSelect();
        deleteBtn.classList.add('hidden');
    });

    // Lien partageable (V2.3, "8") - voir buildFiltersShareUrl/applyFiltersFromUrl. Même geste
    // copier/coller que les autres liens directs de l'app (organisateur, lieu, événement).
    document.getElementById('btn-share-filters').addEventListener('click', async () => {
        const url = buildFiltersShareUrl();
        try {
            await navigator.clipboard.writeText(url.href);
            showToast('Lien de la vue filtrée copié !', { icon: Icons.link('w-3.5 h-3.5 shrink-0 text-indigo-300') });
        } catch {
            window.prompt("Copiez ce lien :", url.href);
        }
    });
}

// Mini-calendrier (QOL #16) : intégré en permanence en haut de la sidebar Statistiques (V2.2,
// remplace l'ancien popover ouvert depuis "Aller à une date..." dans la sidebar Filtres) - un
// coup d'oeil suffit pour voir le mois entier ET sauter directement à une date précise, plus
// rapide que d'enchaîner les boutons prev/next de FullCalendar quand la cible est éloignée (ex:
// dans 3 mois). Pure navigation (comme prev/next), ne touche à aucun filtre - juste la date
// affichée par le calendrier.
let miniCalendarDate = new Date();

/**
 * Pour un mois donné : quels jours ont au moins un événement (pastille), et pour lesquels
 * peut-on afficher en fond la vignette d'un de ses événements (@image de l'événement, ou celle
 * par défaut du type - voir sanitizeUrl/getIconSrc) ? Calculé sur les événements FILTRÉS passés
 * par l'appelant (V2.4 - avant ce correctif, toujours TOUT le dépôt quels que soient les
 * filtres actifs ailleurs dans l'appli, sur le principe d'une "photo fidèle du programme réel" -
 * retour utilisateur explicite : une recherche/un filtre doit aussi se voir reflété ici, ex.
 * retirer la pastille d'un jour qui n'a rien de pertinent pour la recherche en cours).
 * @param {number} year
 * @param {number} month - 0-11
 * @param {Array<Object>} events - Déjà filtrés par l'appelant
 * @returns {{ hasEvent: Set<number>, images: Map<number, string> }}
 */
function computeMiniCalendarDayInfo(year, month, events) {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const hasEvent = new Set();
    const images = new Map();
    events
        .filter(e => !e.isCanceled && e.start.startsWith(monthPrefix))
        .sort((a, b) => a.start.localeCompare(b.start))
        .forEach(e => {
            const day = parseInt(e.start.split('T')[0].split('-')[2], 10);
            hasEvent.add(day);
            if (!images.has(day)) {
                const url = sanitizeUrl(e.image);
                if (url) images.set(day, url);
            }
        });
    return { hasEvent, images };
}

/** Une case-jour : vignette (fond assombri en dégradé pour garder le numéro lisible) si un
 * événement de ce jour en a une, sinon une simple pastille s'il y a au moins un événement. */
function renderMiniCalendarDay(dateStr, day, isToday, imageUrl, hasEvent) {
    const bgAttr = imageUrl ? ` style="background-image:url('${imageUrl}')"` : '';
    const todayRing = isToday ? 'ring-2 ring-indigo-400 ring-inset' : '';
    const colorClasses = imageUrl
        ? 'text-white hover:brightness-125'
        : (isToday ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-300 hover:bg-white/10');
    return `
        <button data-minical-date="${dateStr}"${bgAttr} aria-label="${day}" class="relative aspect-square w-full rounded-md text-xxs font-bold transition-all overflow-hidden bg-cover bg-center ${todayRing} ${colorClasses}">
            ${imageUrl ? '<span class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" aria-hidden="true"></span>' : ''}
            <span class="relative z-10">${day}</span>
            ${hasEvent && !imageUrl ? '<span class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-400" aria-hidden="true"></span>' : ''}
        </button>`;
}

function renderMiniCalendar(events = lastFilteredEvents) {
    const container = document.getElementById('sidebar-minical');
    if (!container) return;
    const year = miniCalendarDate.getFullYear();
    const month = miniCalendarDate.getMonth();
    const monthLabel = miniCalendarDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // 0 = Lundi
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = DateUtils.toLocalDateStr(new Date());
    const { hasEvent, images } = computeMiniCalendarDayInfo(year, month, events);

    let cells = '';
    for (let i = 0; i < startOffset; i++) cells += `<span></span>`;
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells += renderMiniCalendarDay(dateStr, d, dateStr === todayStr, images.get(d), hasEvent.has(d));
    }

    container.innerHTML = `
        <div class="rounded-xl border border-white/5 bg-black/20 p-3">
            <div class="flex items-center justify-between mb-2">
                <button id="minical-prev" aria-label="Mois précédent" class="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition-all">${Icons.chevronLeft('w-3.5 h-3.5')}</button>
                <span class="text-xxs font-bold text-slate-200 capitalize">${monthLabel}</span>
                <button id="minical-next" aria-label="Mois suivant" class="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition-all">${Icons.chevronRight('w-3.5 h-3.5')}</button>
            </div>
            <div class="grid grid-cols-7 gap-1 text-center text-3xs font-bold text-slate-500 mb-1.5">
                ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span>${d}</span>`).join('')}
            </div>
            <div class="grid grid-cols-7 gap-1">${cells}</div>
        </div>
    `;
}

// Bascule vers la vue calendrier à une date donnée + la fait briller (V2.2 : factorisé hors de
// setupMiniCalendar pour être réutilisé par la heatmap d'activité, voir setupActivityHeatmapJump).
function jumpToDate(dateStr) {
    if (currentSearchQuery) {
        currentSearchQuery = "";
        document.getElementById('recherche').value = "";
        document.getElementById('btn-clear-search').classList.add('hidden');
        document.getElementById('search-icon').classList.remove('hidden');
    }
    currentViewMode = 'calendar';
    applyViewButtonStyles();
    updateUIState();
    if (calendarInstance) {
        calendarInstance.gotoDate(dateStr);
        // Laisse FullCalendar terminer son propre re-rendu (gotoDate ne met pas le DOM à
        // jour de façon synchrone) avant de chercher la case à faire briller.
        setTimeout(() => highlightCalendarDate(dateStr), 50);
    }
}

function setupMiniCalendar() {
    const container = document.getElementById('sidebar-minical');

    container.addEventListener('click', (e) => {
        // .closest() (pas e.target.id direct) : ces boutons contiennent une icône SVG - un clic
        // sur l'icône fait de e.target un <svg>/<path> sans id, jamais le bouton lui-même.
        if (e.target.closest('#minical-prev')) { miniCalendarDate.setMonth(miniCalendarDate.getMonth() - 1); renderMiniCalendar(); return; }
        if (e.target.closest('#minical-next')) { miniCalendarDate.setMonth(miniCalendarDate.getMonth() + 1); renderMiniCalendar(); return; }
        const dateBtn = e.target.closest('button[data-minical-date]');
        if (!dateBtn) return;
        jumpToDate(dateBtn.dataset.minicalDate);
    });
}

// Cellules de la heatmap d'activité cliquables (V2.2, QOL - cohérence avec le mini-calendrier qui
// permet déjà de sauter à une date) : voir data-heatmap-date posé par ActivityHeatmap.js.
function setupActivityHeatmapJump() {
    document.getElementById('activity-heatmap').addEventListener('click', (e) => {
        const cell = e.target.closest('[data-heatmap-date]');
        if (!cell) return;
        jumpToDate(cell.dataset.heatmapDate);
    });
}

/**
 * Fait "briller" brièvement la case correspondant à `dateStr` dans la vue calendrier actuelle
 * (Mois/Semaine/Jour/Planning), sans ouvrir sa modale - juste un repère visuel confirmant "on est
 * arrivé ici" après un saut depuis le mini-calendrier. `[data-date]` est posé par FullCalendar
 * lui-même sur l'élément pertinent quelle que soit la vue (case du mois, colonne de la semaine/
 * jour, ligne d'en-tête de jour en Planning), donc un seul sélecteur générique suffit.
 * @param {string} dateStr - "YYYY-MM-DD"
 */
function highlightCalendarDate(dateStr) {
    const el = document.querySelector(`#calendar [data-date="${dateStr}"]`);
    if (!el) return;
    el.classList.remove('jump-highlight');
    void el.offsetWidth; // reflow : relance l'animation même si la case venait déjà de briller
    el.classList.add('jump-highlight');
    setTimeout(() => el.classList.remove('jump-highlight'), 1300);
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
        // Même pastille animée que sur les cartes (isGenuinelyLive/renderLiveDot) plutôt qu'un
        // emoji 🔴 statique, pour une cohérence visuelle "live" à travers toute l'app.
        icon.innerHTML = `<span class="relative flex h-2.5 w-2.5" aria-hidden="true"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span><span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span></span>`;
        text.innerHTML = `<b>En direct :</b> ${escapeHtml(result.event.title)}${result.event.heure ? ' · depuis ' + escapeHtml(result.event.heure) : ''}`;
    } else {
        icon.innerHTML = Icons.clock('w-3.5 h-3.5');
        text.innerHTML = `<b>Prochain :</b> ${escapeHtml(result.event.title)} — ${formatCountdown(result.event.start) || 'maintenant'}`;
    }
}

// Reflète currentViewMode sur les boutons Frise/Carte (surbrillance du mode actif) - factorisé
// pour être appelable aussi bien depuis leurs propres clics que depuis goHome() (retour logo).
function applyViewButtonStyles() {
    const timelineBtn = document.getElementById('btn-toggle-timeline');
    const mapBtn = document.getElementById('btn-toggle-map');
    const todayBtn = document.getElementById('btn-goto-today');
    const yearBtn = document.getElementById('btn-toggle-year');
    [[timelineBtn, 'timeline'], [mapBtn, 'map'], [todayBtn, 'today'], [yearBtn, 'year']].forEach(([btn, mode]) => {
        const active = currentViewMode === mode;
        btn.classList.toggle('bg-indigo-500/10', active);
        btn.classList.toggle('border-indigo-500/20', active);
        btn.classList.toggle('text-indigo-300', active);
    });
    // Affordance "Retour au calendrier" (V2.4) : visible sur les 4 vues qui remplacent le
    // calendrier (Aujourd'hui/Frise/Carte/Année), pas sur la Recherche (déjà son propre
    // "✕ Annuler les filtres" pour en sortir en vidant la recherche).
    document.getElementById('btn-close-secondary-view').classList.toggle('hidden', currentViewMode === 'calendar');
}

// Vue "Aujourd'hui" dédiée (QOL #6, voir TodayView.js) : une page de présentation du programme
// du jour à part entière (même statut que Frise/Carte, currentViewMode='today'), pas juste un
// raccourci de navigation dans le calendrier. Quitte aussi la recherche si elle était active,
// pour que ce soit bien elle qui s'affiche.
function goToTodayView() {
    if (currentSearchQuery) {
        currentSearchQuery = "";
        document.getElementById('recherche').value = "";
        document.getElementById('btn-clear-search').classList.add('hidden');
        document.getElementById('search-icon').classList.remove('hidden');
    }
    currentViewMode = currentViewMode === 'today' ? 'calendar' : 'today';
    applyViewButtonStyles();
    updateUIState();
}

// Densité d'affichage des cartes (QOL #17) : bascule une classe sur <html>, lue par les règles
// CSS `.density-compact` (voir index.html) qui resserrent paddings/tailles de police des cartes
// d'événements - utile pour voir plus de sessions à l'écran sans défiler, au prix du confort de
// lecture. Mémorisé d'une visite à l'autre comme les autres préférences d'affichage (thème...).
const DENSITY_KEY = 'ui:density';
function applyDensity(compact) {
    document.documentElement.classList.toggle('density-compact', compact);
    const btn = document.getElementById('btn-toggle-density');
    btn.title = `Densité d'affichage des cartes : ${compact ? 'compacte' : 'confortable'}`;
    // innerHTML (icône SVG + libellé) réécrit ici à chaque bascule : doit reprendre exactement
    // le même gabarit que le bouton statique dans index.html (icône Icons.sliders), sans quoi
    // le premier clic remplacerait l'icône par du texte brut.
    btn.innerHTML = `${Icons.sliders('w-4 h-4 shrink-0')}<span class="hidden sm:inline">${compact ? 'Compact' : 'Confortable'}</span>`;
}
// Mode "grand texte" (V2.4, "17", voir #btn-toggle-large-text dans l'aide) : purement du CSS
// (zoom, voir index.html), pas besoin de re-rendu comme la densité - le texte grossit "pour de
// vrai" (voir la règle CSS pour pourquoi zoom plutôt que transform:scale sur ce site).
const LARGE_TEXT_KEY = 'ui:largeText';
function applyLargeText(enabled) {
    document.documentElement.classList.toggle('a11y-large-text', enabled);
    const btn = document.getElementById('btn-toggle-large-text');
    btn.setAttribute('aria-pressed', String(enabled));
    btn.querySelector('span').textContent = `🔠 Grand texte : ${enabled ? 'Activé' : 'Désactivé'}`;
}
function setupLargeTextToggle() {
    const enabled = localStorage.getItem(LARGE_TEXT_KEY) === '1';
    applyLargeText(enabled);
    document.getElementById('btn-toggle-large-text').addEventListener('click', () => {
        const nowEnabled = !document.documentElement.classList.contains('a11y-large-text');
        applyLargeText(nowEnabled);
        localStorage.setItem(LARGE_TEXT_KEY, nowEnabled ? '1' : '0');
    });
}

// Filtre carte par rayon (V2.4, "15") : centre choisi parmi les villes reconnues
// (CITY_COORDINATES, voir getKnownCityKeys) + un rayon en km - le sélecteur de rayon ne
// s'affiche qu'une fois une ville centre choisie (masqué sinon, inutile tant qu'aucun centre
// n'est fixé). Purement une préférence de session, pas persistée (repart à "Toutes les villes"
// à chaque rechargement, comme le zoom/pan de la carte elle-même).
function setupMapRadiusFilter() {
    const citySelect = document.getElementById('map-radius-city');
    const kmSelect = document.getElementById('map-radius-km');
    getKnownCityKeys().forEach(city => {
        const opt = document.createElement('option');
        opt.value = city;
        opt.textContent = cityLabel(city);
        citySelect.appendChild(opt);
    });

    const apply = () => {
        mapRadiusFilter = citySelect.value ? { city: citySelect.value, km: Number(kmSelect.value) } : null;
        kmSelect.classList.toggle('hidden', !citySelect.value);
        if (currentViewMode === 'map') updateUIState();
    };
    citySelect.addEventListener('change', apply);
    kmSelect.addEventListener('change', apply);
}

function setupDensityToggle() {
    const compact = localStorage.getItem(DENSITY_KEY) === '1';
    applyDensity(compact);
    document.getElementById('btn-toggle-density').addEventListener('click', () => {
        const nowCompact = !document.documentElement.classList.contains('density-compact');
        applyDensity(nowCompact);
        localStorage.setItem(DENSITY_KEY, nowCompact ? '1' : '0');
        // renderEventCard (EventCardTemplate.js) choisit son gabarit (compact ou confortable) en
        // lisant html.density-compact AU MOMENT du rendu : un changement ne prend effet sur les
        // cartes déjà affichées qu'en les re-rendant, d'où ce rafraîchissement immédiat plutôt
        // que d'attendre le prochain changement de filtre/vue pour voir l'effet.
        updateUIState();
    });
}

// Remet à zéro catégorie/type/tag/recherche/période (mais pas la vue Calendrier/Frise/Carte,
// ni les overlays ouvertes) - factorisé pour être appelé aussi bien par "✕ Annuler les filtres"
// que par le clic sur le logo (retour accueil, voir goHome()).
function resetFiltersAndSearch() {
    currentCategory = "all";
    currentTypeFilter = null;
    currentTagFilter = null;
    currentHostFilter = null;
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
    renderTypeFilterBar(repo.getAll());
    updateTagsFilterBar(repo.getAll());
    renderHostFilterBar(repo.getAll());
    document.getElementById('saved-views-select').value = "";
    document.getElementById('btn-delete-view').classList.add('hidden');
    saveFiltersToStorage();
}

function updateUIState() {
    let filtered = repo.getAll();

    // Catégories masquées durablement (QOL #18) : exclues de TOUTES les vues, indépendamment du
    // filtre "actif" (currentCategory) - appliqué en premier pour qu'aucun autre filtre ne
    // puisse "repêcher" un événement d'une catégorie qu'on a choisi de ne plus jamais voir.
    if (hiddenCategories.size > 0) {
        filtered = filtered.filter(e => !hiddenCategories.has(e.category));
    }
    // Snapshot pour la vue "Aujourd'hui" (voir plus bas) : `filter` renvoie un nouveau tableau à
    // chaque étape (ne mute jamais `filtered` en place), donc cette référence reste valide même
    // une fois que `filtered` continue de se réduire avec les filtres de navigation ci-dessous -
    // "aujourd'hui" doit rester une photo fidèle de la vraie journée (comme le bandeau "Prochain
    // événement" ou le résumé quotidien), pas dépendante d'une catégorie/tag/organisateur/période
    // actuellement sélectionnés ailleurs.
    const eventsForToday = filtered;
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
    if (currentHostFilter) {
        filtered = filtered.filter(e => (e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST).trim() === currentHostFilter);
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
    const todayEl = document.getElementById('today-view');
    const yearEl = document.getElementById('year-view');
    const isSearching = currentSearchQuery.trim().length > 0;

    // Six vues mutuellement exclusives sur la même sélection filtrée : la recherche prime
    // toujours sur Frise/Carte/Aujourd'hui/Année (voir currentViewMode plus haut), qui priment
    // sur le calendrier.
    calendarEl.classList.add('hidden');
    searchResultsEl.classList.add('hidden');
    timelineEl.classList.add('hidden');
    mapEl.classList.add('hidden');
    todayEl.classList.add('hidden');
    yearEl.classList.add('hidden');

    if (isSearching) {
        filtered = SearchEngine.search(filtered, { query: currentSearchQuery });
        searchResultsCache = [...filtered].sort((a, b) => searchResultsSortOrder === 'asc' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start));
        searchResultsEl.classList.remove('hidden');
        renderSearchResults(searchResultsEl, searchResultsCache, searchResultsSortOrder);
    } else if (currentViewMode === 'timeline') {
        // Défile jusqu'au repère "Aujourd'hui" seulement quand la Frise vient de devenir
        // visible (pas à chaque changement de filtre/tri une fois déjà ouverte, sans quoi
        // basculer l'ordre d'affichage arracherait l'utilisateur d'un endroit où il aurait
        // déjà fait défiler manuellement) - y compris au tout premier chargement de l'appli
        // (mobile démarre directement en Frise, voir currentViewMode plus haut).
        // `timelineEl.classList.contains('hidden')` ne marche PAS ici : les 5 vues viennent
        // TOUTES d'être masquées inconditionnellement juste au-dessus (voir le bloc juste avant
        // ce if), donc cette classe vaut toujours "hidden" à ce stade, qu'on vienne vraiment
        // d'ouvrir la Frise ou qu'on soit juste en train de retoucher un filtre en restant
        // dessus. `lastVisiblePaneId` (posé par le tout dernier rendu, pas encore mis à jour à ce
        // point de la fonction) donne la vraie réponse.
        const justOpened = lastVisiblePaneId !== 'timeline-view';
        timelineEl.classList.remove('hidden');
        // getAvailableYears(repo.getAll()) (pas `filtered`) : un filtre ne doit jamais bloquer la
        // navigation prev/next vers une année qui a bel et bien des événements, juste pas dans
        // le filtre courant (voir doc du paramètre allYears dans TimelineView.js).
        timelineCache = renderTimeline(timelineEl, filtered, timelineSortOrder, timelineYear, justOpened, getAvailableYears(repo.getAll()));
    } else if (currentViewMode === 'map') {
        // Cadrage automatique sur les marqueurs (V2.2, QOL) seulement à l'ouverture de la Carte
        // (même logique que justOpened pour la Frise ci-dessus) - pas à chaque filtre/recherche
        // une fois déjà dessus, sous peine de faire sauter le zoom/pan choisi par l'utilisateur.
        const mapJustOpened = lastVisiblePaneId !== 'map-view';
        mapEl.classList.remove('hidden');
        updateMeetupMap(filtered, (ev) => ModalView.open(ev), (cityKey) => openLocationProfile(cityKey), mapJustOpened, mapRadiusFilter);
    } else if (currentViewMode === 'today') {
        todayEl.classList.remove('hidden');
        todayViewCache = renderTodayView(todayEl, eventsForToday, birthdaysList, repo.getAll());
    } else if (currentViewMode === 'year') {
        yearEl.classList.remove('hidden');
        // filtered (pas repo.getAll()) : V2.4, mêmes raisons que renderMiniCalendar plus haut -
        // la vue Année doit refléter les filtres/la recherche actifs, pas rester une photo figée
        // de tout le dépôt.
        renderYearView(yearEl, filtered, yearViewYear);
    } else {
        calendarEl.classList.remove('hidden');
        CalendarView.sync(calendarInstance, filtered);
    }

    // Anime seulement une vraie bascule de vue (voir lastVisiblePaneId plus haut), pas ce même
    // appel qui masque/réaffiche systématiquement la vue déjà active à chaque filtre/recherche.
    const activePaneId = isSearching ? 'search-results'
        : currentViewMode === 'timeline' ? 'timeline-view'
        : currentViewMode === 'map' ? 'map-view'
        : currentViewMode === 'today' ? 'today-view'
        : currentViewMode === 'year' ? 'year-view'
        : 'calendar';
    if (activePaneId !== lastVisiblePaneId) {
        const activePaneEl = document.getElementById(activePaneId);
        activePaneEl.classList.remove('view-fade-in');
        void activePaneEl.offsetWidth; // force un reflow : relance l'animation même si la classe était déjà retirée au repaint précédent
        activePaneEl.classList.add('view-fade-in');
        lastVisiblePaneId = activePaneId;
    }

    renderDashboardStats(filtered);
    renderUpcomingSidebar(filtered);
    renderNextWeekSidebar(filtered);
    // Reflète les filtres actifs (V2.4, voir computeMiniCalendarDayInfo) : `filtered` passé
    // explicitement plutôt que de laisser renderMiniCalendar retomber sur son défaut
    // `lastFilteredEvents`, qui n'est mis à jour qu'à la ligne suivante - lire l'ancienne
    // valeur ici afficherait les pastilles d'un cran de retard sur le tout dernier filtre.
    renderMiniCalendar(filtered);
    lastFilteredEvents = filtered;

    const clearBtn = document.getElementById('btn-clear-filters');
    // currentHostFilter manquait ici : le bouton "Annuler les filtres" restait caché quand seul
    // le filtre Organisateur était actif, alors qu'il narrowait bien la sélection affichée.
    const anyFilterActive = currentCategory !== "all" || currentTypeFilter || currentTagFilter
        || currentHostFilter || currentDateFrom || currentDateTo || isSearching;
    clearBtn.classList.toggle('hidden', !anyFilterActive);
    // Navigation calendrier qui saute les mois/semaines vides (voir CalendarView.js) : seulement
    // pertinente quand un filtre restreint réellement ce qui s'affiche, jamais par défaut.
    CalendarView.setFilterActive(anyFilterActive);
}

/**
 * Fabrique un contrôleur pour un panneau repliable (sidebar, barre de filtres...) :
 * centralise la persistance localStorage et le repli par défaut sur mobile, pour
 * éviter de dupliquer cette logique à chaque nouveau panneau repliable.
 * @param {string} storageKey - Clé localStorage (ex: 'ui:sidebarCollapsed')
 * @param {(collapsed: boolean) => void} applyState - Applique visuellement l'état
 */
function createCollapsiblePanel(storageKey, applyState, forceDefaultCollapsed = false) {
    const setCollapsed = (collapsed) => {
        applyState(collapsed);
        if (collapsed) localStorage.setItem(storageKey, '1');
        else localStorage.removeItem(storageKey);
    };

    // Respecte un choix déjà enregistré ; sinon replié par défaut sur petit écran (mobile, où un
    // panneau écraserait le contenu) et ouvert sinon - sauf `forceDefaultCollapsed` (V2.3,
    // Statistiques) qui impose replié par défaut sur TOUTE taille d'écran tant que rien n'a
    // encore été explicitement enregistré (un dépli explicite reste, lui, mémorisé comme
    // d'habitude puisqu'il retire juste la clé plutôt que d'en écrire une "0").
    const stored = localStorage.getItem(storageKey);
    const collapsedByDefault = stored === '1' || (stored === null && (forceDefaultCollapsed || window.matchMedia('(max-width: 639px)').matches));
    applyState(collapsedByDefault);

    return {
        collapse: () => setCollapsed(true),
        expand: () => setCollapsed(false),
        toggle: (currentlyCollapsed) => setCollapsed(!currentlyCollapsed)
    };
}

// Contrôleurs des deux sidebars (Filtres à gauche, Statistiques à droite) : références
// module-level pour que chacune puisse refermer l'AUTRE sur mobile (voir isMobileWidth
// plus bas) - sur un écran étroit, les deux sont des overlays plein écran superposés, donc
// les avoir toutes les deux ouvertes en même temps ne fait que cacher l'une derrière l'autre
// sans le moindre indice visuel de ce qui vient de se passer.
let statsSidebarCtrl = null;
let filtersSidebarCtrl = null;
const isMobileWidth = () => window.matchMedia('(max-width: 639px)').matches;

function setupSidebarToggle() {
    const panel = document.getElementById('sidebar-panel');
    const btnClose = document.getElementById('btn-toggle-sidebar');
    const btnReopen = document.getElementById('btn-reopen-sidebar');
    const refreshCalendarSize = () => setTimeout(() => calendarInstance && calendarInstance.updateSize(), 260);

    statsSidebarCtrl = createCollapsiblePanel('ui:sidebarCollapsed', (collapsed) => {
        panel.classList.toggle('hidden', collapsed);
        btnReopen.classList.toggle('hidden', !collapsed);
    });

    btnClose.addEventListener('click', () => { statsSidebarCtrl.collapse(); refreshCalendarSize(); });
    btnReopen.addEventListener('click', () => {
        if (isMobileWidth()) filtersSidebarCtrl?.collapse();
        statsSidebarCtrl.expand();
        refreshCalendarSize();
    });
}

// Panneau "Statistiques" repliable : une fois replié, le panneau latéral se réduit à
// l'essentiel (mini-calendrier + Semaine prochaine/Prochainement), sans les cartes de stats
// qui prennent le plus de hauteur - replié par défaut (V2.3, forceDefaultCollapsed) tant que
// l'utilisateur ne l'a pas explicitement déplié au moins une fois.
function setupStatsToggle() {
    // #stats-content-collapse (grid-template-rows 1fr/0fr, voir .collapse-wrap dans index.html) :
    // pas #stats-content directement, dont la classe `hidden` (display:none) ne peut pas s'animer.
    const wrap = document.getElementById('stats-content-collapse');
    const btnToggle = document.getElementById('btn-toggle-stats');
    const chevron = document.getElementById('stats-chevron');

    const panelCtrl = createCollapsiblePanel('ui:statsCollapsed', (collapsed) => {
        wrap.style.gridTemplateRows = collapsed ? '0fr' : '1fr';
        wrap.inert = collapsed; // pas de focus/interaction possible sur un contenu réduit à 0px
        // Rotation CSS (-90deg) plutôt qu'un second glyphe ▸ : un seul SVG qui pivote en douceur
        // (transition déjà posée dans index.html) au lieu d'un changement de caractère instantané.
        chevron.classList.toggle('-rotate-90', collapsed);
        btnToggle.setAttribute('aria-expanded', String(!collapsed));
    }, true);

    btnToggle.addEventListener('click', () => {
        panelCtrl.toggle(wrap.style.gridTemplateRows === '0fr');
    });
}

// Panneau "Prochainement" repliable (V2.2) : même mécanique que setupStatsToggle juste au-dessus -
// utile une fois qu'on a déjà repéré ce qui vient, pour laisser plus de place au mini-calendrier/
// aux stats sans avoir à tout refermer d'un coup via #btn-toggle-sidebar.
function setupUpcomingToggle() {
    const wrap = document.getElementById('upcoming-content-collapse');
    const btnToggle = document.getElementById('btn-toggle-upcoming');
    const chevron = document.getElementById('upcoming-chevron');

    const panelCtrl = createCollapsiblePanel('ui:upcomingCollapsed', (collapsed) => {
        wrap.style.gridTemplateRows = collapsed ? '0fr' : '1fr';
        wrap.inert = collapsed;
        chevron.classList.toggle('-rotate-90', collapsed);
        btnToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    btnToggle.addEventListener('click', () => {
        panelCtrl.toggle(wrap.style.gridTemplateRows === '0fr');
    });
}

// Panneau "Semaine prochaine" repliable (V2.3, "16") - même mécanique que setupUpcomingToggle.
function setupNextWeekToggle() {
    const wrap = document.getElementById('nextweek-content-collapse');
    const btnToggle = document.getElementById('btn-toggle-nextweek');
    const chevron = document.getElementById('nextweek-chevron');

    const panelCtrl = createCollapsiblePanel('ui:nextWeekCollapsed', (collapsed) => {
        wrap.style.gridTemplateRows = collapsed ? '0fr' : '1fr';
        wrap.inert = collapsed;
        chevron.classList.toggle('-rotate-90', collapsed);
        btnToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    btnToggle.addEventListener('click', () => {
        panelCtrl.toggle(wrap.style.gridTemplateRows === '0fr');
    });
}

// Sidebar Filtres repliable (voir index.html #filters-sidebar) : même mécanique que
// setupSidebarToggle (panneau Statistiques à droite) - repliée par défaut sur mobile,
// dépliée sur desktop tant qu'on ne l'a pas explicitement refermée (voir createCollapsiblePanel).
function setupFiltersSidebarToggle() {
    const panel = document.getElementById('filters-sidebar');
    const btnClose = document.getElementById('btn-toggle-filters-sidebar');
    const btnReopen = document.getElementById('btn-reopen-filters-sidebar');
    const refreshCalendarSize = () => setTimeout(() => calendarInstance && calendarInstance.updateSize(), 260);

    filtersSidebarCtrl = createCollapsiblePanel('ui:filtersSidebarCollapsed', (collapsed) => {
        panel.classList.toggle('hidden', collapsed);
        btnReopen.classList.toggle('hidden', !collapsed);
    });

    btnClose.addEventListener('click', () => { filtersSidebarCtrl.collapse(); refreshCalendarSize(); });
    btnReopen.addEventListener('click', () => {
        if (isMobileWidth()) statsSidebarCtrl?.collapse();
        filtersSidebarCtrl.expand();
        refreshCalendarSize();
    });
}

// Visite guidée interactive (V2.2, premier lancement) : présente les fonctionnalités majeures une
// par une, chacune mise en surbrillance directement sur l'élément réel de la page - voir
// startOnboardingTour dans OnboardingTour.js pour le moteur. Rejouable à tout moment (bouton
// "Revoir la visite guidée" dans l'aide, voir setupHelpOverlay) sans que ça re-déclenche le popup
// "Quoi de neuf ?" juste après (les deux marquent leurs propres clés en localStorage).
const ONBOARDING_DONE_KEY = 'onboarding:completed';
const ONBOARDING_STEPS = [
    { target: null, title: 'Bienvenue sur 2GELOG 👋', text: "Le planning communautaire de 2GETHER. Petit tour rapide des fonctionnalités principales - passez-le à tout moment, vous pourrez le revoir depuis l'aide (?)." },
    { target: '#btn-goto-today', title: "☀️ Aujourd'hui", text: 'Le programme du jour en un coup d\'œil, avec un repère sur ce qui est en cours ou à venir. Raccourci clavier : T.' },
    { target: '#btn-toggle-timeline', title: '🗓️ Vue Frise', text: "Toute l'année organisée en frise chronologique, les séries (hebdo ou à épisodes) regroupées en un seul bloc plutôt qu'éparpillées. Raccourci : F." },
    { target: '#btn-toggle-map', title: '📍 Vue Carte', text: 'Les meetups IRL localisés sur une carte interactive, avec un mini-profil par lieu. Raccourci : C.' },
    { target: '#recherche', title: '🔍 Recherche', text: 'Cherchez un jeu, un stream, un organisateur, un #tag... Raccourci clavier : / pour y accéder directement.' },
    { target: '#filters-sidebar', title: '🗂️ Filtres', text: 'Affinez par catégorie, type, tag ou organisateur - vos choix (et vos vues favorites) sont mémorisés pour la prochaine visite.' },
    { target: '#sidebar-panel', title: '📊 Tableau de bord', text: "Statistiques de l'année, mini-calendrier, activité récente et prochains événements, toujours sous la main." },
    { target: '#btn-open-reminders', title: '🔔 Rappels', text: "Abonnez-vous à un événement (ou une série entière) pour être notifié avant chaque diffusion." },
    { target: '#btn-open-retrospective', title: '🎉 Rétrospective', text: "Un bilan visuel façon \"Wrapped\" de toute une année vécue ensemble : temps passé, MVP, mois le plus actif..." },
    { target: '#btn-toggle-theme', title: '🌗 Thème clair/sombre', text: "Basculez l'apparence selon vos préférences, à tout moment." },
    { target: '#btn-help', title: "Besoin d'aide ?", text: "Toute la légende (catégories, statuts, raccourcis clavier...) est ici, ainsi qu'un lien pour revoir cette visite guidée. Bonne visite sur 2GELOG !" }
];

function setupOnboardingTour() {
    const launch = () => startOnboardingTour(ONBOARDING_STEPS, {
        onDone: () => {
            localStorage.setItem(ONBOARDING_DONE_KEY, '1');
            // Évite un second popup "Quoi de neuf ?" juste après la visite (V2.2, voir
            // setupPatchNotes) : la visite guidée vient déjà de couvrir "ce qu'il y a à savoir".
            localStorage.setItem('patchnotes:seenVersion', PATCH_NOTES_HISTORY[0].version);
        }
    });

    document.getElementById('btn-replay-onboarding').addEventListener('click', () => {
        document.getElementById('help-overlay').classList.add('hidden');
        document.getElementById('help-overlay').classList.remove('flex');
        launch();
    });

    if (!localStorage.getItem(ONBOARDING_DONE_KEY)) launch();
}

// Historique des notes de version (V2.2, "vue dédiée incluant l'historique des mises à jour") :
// un tableau plutôt qu'un objet unique - chaque nouvelle mise à jour s'AJOUTE en tête (la plus
// récente en premier) au lieu d'écraser la précédente, pour que la vue "Nouveautés" reste un
// vrai historique consultable, pas juste "ce qui a changé la dernière fois". Pour publier une
// nouvelle version : ajoutez un nouvel objet EN TÊTE de ce tableau (même forme que le premier),
// avec un `version` différent (déclenche à nouveau la popup automatique une fois par visiteur).
// Historique reconstruit (V2.2) à partir des VRAIS commits git ("revois tous les précédents
// commits pour refaire le détail des versions précédentes") : chaque ancienne version avait déjà
// son propre PATCH_NOTES dans le code à l'époque (voir `git show <hash>:src/main.js`), mais new
// écrasait toujours l'ancien plutôt que de l'archiver - les entrées "V2" et "V2.1" ci-dessous sont
// donc le texte ORIGINAL de l'auteur à ces dates-là (git show 95648af / 61ec710), pas une
// reformulation. "V1" (avant l'existence même d'un PATCH_NOTES dans le code) et "V2.2" (jamais
// documentée nulle part avant aujourd'hui) ont dû être reconstruites depuis les diffs réels.
const PATCH_NOTES_HISTORY = [
    {
        version: "2026-08-18",
        label: "V2.5",
        sections: [
            {
                title: "🚀 Nouveautés",
                items: [
                    "🗳️ Sondage communautaire directement dans l'app : votez pour la prochaine soirée (film, jeu...), résultats en direct, changez d'avis à tout moment.",
                    "🧭 Navigation rapide dans la Frise façon répertoire de contacts : un rail avec les mois de l'année, cliquez pour sauter directement dessus au lieu de tout faire défiler.",
                    "🔠 Bouton \"Retour au calendrier\" clairement visible sur Aujourd'hui/Frise/Carte/Année, plutôt que de deviner qu'il fallait recliquer le même bouton pour en sortir.",
                    "🖼️ L'image exportée du planning s'adapte maintenant à la vue affichée : une vraie liste en vue Planning/Jour, plutôt qu'une grille mensuelle qui ne ressemblait à rien à l'écran.",
                    "🔍 Le mini-calendrier (panneau Statistiques) et la vue Année reflètent maintenant les filtres/la recherche actifs, comme le reste de l'app."
                ]
            },
            {
                title: "🛠️ Corrections",
                items: [
                    "Un filtre actif (ex: une catégorie) pouvait bloquer la navigation entre années dans la Frise, même quand l'année visée avait bel et bien d'autres événements (juste pas dans le filtre).",
                    "Mode d'affichage Compact sans effet sur les vues Recherche et Frise.",
                    "Bouton d'export image cliquable mais inactif en vue \"Toute l'histoire\" de la Rétrospective.",
                    "Widget \"Il y a un an, ce jour-là\" affichant la mauvaise date les 29 février.",
                    "Bouton \"Aujourd'hui\" stylé différemment des autres boutons de vue, pouvant laisser croire qu'il n'était pas cliquable."
                ]
            }
        ]
    },
    {
        version: "2026-08-14b",
        label: "V2.4",
        sections: [
            {
                title: "🚀 Nouveautés",
                items: [
                    "🗓️ Nouvelle vue Année : les 12 mois d'un coup d'oeil, chaque jour cliquable pour sauter directement dessus en vue Calendrier.",
                    "📜 \"Toute l'histoire\" dans la Rétrospective : un résumé de chaque année disponible en un seul défilement, plutôt que naviguée une par une.",
                    "🔥 Carte des lieux : les pins se teintent désormais selon la fréquentation relative (plus foncé = plus de sessions), en plus du chiffre déjà affiché.",
                    "📍 Filtre carte par rayon : centrez sur une ville reconnue et limitez l'affichage à un rayon choisi (50 à 500 km).",
                    "🔠 Mode \"grand texte\" (accessibilité) dans l'aide, pour agrandir tout le texte de l'appli en un clic.",
                    "⌨️ Navigation clavier complète de la grille du calendrier (Mois) : flèches pour se déplacer entre les jours, Entrée pour ouvrir la vue Jour."
                ]
            }
        ]
    },
    {
        version: "2026-08-14",
        label: "V2.3",
        sections: [
            {
                title: "🚀 Nouveautés",
                items: [
                    "⏱️ Compte à rebours en direct sur vos rappels suivis (panneau Rappels et modale d'un événement) : \"dans 2j 4h\", \"dans 45 min\"...",
                    "🔔 Alerte automatique si une session que vous suivez change d'horaire ou est annulée, détectée d'une visite à l'autre.",
                    "🖼️ Image récap de la rétrospective annuelle téléchargeable (même principe que le profil organisateur), pour la partager où vous voulez.",
                    "🔗 Lien qui encode tous vos filtres actifs (catégorie, type, tag, organisateur, recherche, période) : copiez-le pour partager exactement la vue que vous regardez.",
                    "🖼️ Image téléchargeable du planning affiché : bouton dédié dans la barre du calendrier, grille structurée façon planning plutôt qu'une simple capture d'écran.",
                    "📊 La rétrospective compare désormais chaque catégorie à l'année précédente (▲/▼ %), en plus du total déjà comparé.",
                    "📅 \"Il y a un an, ce jour-là\" sur la page Aujourd'hui : un petit rappel de ce qui s'est passé à la même date l'an dernier, quand il y a quelque chose à montrer.",
                    "🔮 Nouveau widget \"Semaine prochaine\" dans le panneau Statistiques, distinct de \"Prochainement\" : uniquement les sessions de la semaine calendaire qui suit.",
                    "🔊 Signal sonore discret optionnel sur les rappels et le résumé quotidien, à activer dans le panneau Rappels.",
                    "🎂 Bandeau anniversaire sur la page Aujourd'hui, alimenté par la liste des membres l'ayant partagé volontairement."
                ]
            }
        ]
    },
    {
        version: "2026-08-12",
        label: "V2.2",
        sections: [
            {
                title: "🚀 Nouveautés",
                items: [
                    "☀️ Nouvelle page \"Aujourd'hui sur 2GETHER\" (bouton dédié de l'en-tête) : le programme du jour à part entière, avec un repère \"maintenant\" sur la session en cours ou à venir.",
                    "⭐ Vues favorites : enregistrez un jeu de filtres (catégories, types, tags, organisateur) sous un nom, pour le rappeler en un clic depuis la barre de filtres.",
                    "🙈 Masquez durablement une catégorie de TOUTES les vues (pas juste un filtre ponctuel qu'il faut refaire à chaque visite), directement depuis la barre de filtres.",
                    "🗓️ Mini-calendrier désormais intégré en permanence dans le panneau Statistiques (remplace l'ancien popover \"Aller à une date...\").",
                    "📋 Densité d'affichage des cartes (Confortable / Compact), pour voir plus de sessions à l'écran sans défiler.",
                    "🌙 \"Ne pas déranger\" : coupe temporairement tous les rappels (globaux et individuels) sans avoir à se désabonner de quoi que ce soit.",
                    "🔔 Résumé quotidien en une seule notification groupée, au lieu d'une par session.",
                    "📲 Badge sur l'icône de l'app installée : nombre de sessions du jour visible sans avoir à l'ouvrir.",
                    "Rétrospective encore enrichie : mur des affiches, premier/dernier moment de l'année, l'événement qui revient le plus, répartition par tranche horaire de la journée.",
                    "Vues Semaine/Jour repensées pour mobile : Planning et Jour proposés par défaut sur petit écran, plage horaire ajustée automatiquement aux horaires réellement utilisés.",
                    "Nouveau jeu d'icônes dans tout le \"chrome\" de l'appli (en-tête, menus, boutons des modales), à la place des emoji.",
                    "Menu \"⋯\" qui regroupe les outils d'organisateur (Discord, Webhook, Kiosque, Admin) pour désencombrer l'en-tête.",
                    "Fiche complète pour chaque lieu de meetup sur la vue Carte (historique + sessions à venir), en plus du profil par organisateur."
                ]
            }
        ]
    },
    {
        version: "2026-07-26c",
        label: "V2.1",
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
    },
    {
        version: "2026-07-06",
        label: "V2",
        sections: [
            {
                title: "🚀 Nouveautés",
                items: [
                    "Recherche améliorée : les soirées répétées (saisons, soirées hebdo) sont regroupées en une seule ligne avec le détail de chaque date et la durée cumulée.",
                    "Statut 🔵 Prévu / 🟢 En Cours / ⚪ Terminé affiché directement sur chaque tuile du calendrier.",
                    "Mode Admin (rétrospectives annuelles + détection d'anomalies dans le tableur), protégé par mot de passe.",
                    "Barre de filtres et panneau de statistiques désormais repliables, pour un calendrier plus dégagé.",
                    "Meilleure prise en charge sur mobile."
                ]
            },
            {
                title: "ℹ️ À savoir",
                items: [
                    "Le lieu par défaut des événements est désormais « Discord 2GETHER » sauf indication contraire, et certains horaires par défaut ont été corrigés dans le tableur.",
                    "Un événement peut toujours être annulé ou reporté à la dernière minute : pensez à vérifier le calendrier avant chaque session."
                ]
            }
        ]
    },
    {
        version: "2026-05-04",
        label: "Lancement",
        sections: [
            {
                title: "🚀 Au programme dès le premier jour",
                items: [
                    "Calendrier communautaire alimenté en direct par un Google Sheet public (aucune saisie manuelle côté site, tout se passe dans le tableur).",
                    "Icônes et couleurs dédiées par type de soirée (Jeux, Film, Série, JDR, Minecraft, Meet Up, événements spéciaux).",
                    "Statistiques cumulées de temps Visionnage / Gaming.",
                    "Recherche et filtres par catégorie.",
                    "Détection automatique des soirées annulées ou reportées, des soirées partenaires/sanctuaires, et génération des séries hebdomadaires à partir des notes.",
                    "Modale de détail au clic sur un événement."
                ]
            }
        ]
    }
];

// Popup "Quoi de neuf ?" affichée une seule fois par version (localStorage) - voir aussi
// #btn-open-patchnotes (V2.2) qui rouvre la même vue à tout moment, historique complet inclus.
function setupPatchNotes() {
    const overlay = document.getElementById('patchnotes-overlay');
    const content = document.getElementById('patchnotes-content');
    const latestVersion = PATCH_NOTES_HISTORY[0].version;

    // Historique complet (V2.2) : chaque entrée de PATCH_NOTES_HISTORY sous son propre en-tête de
    // version, la plus récente en premier - un seul rendu sert à la fois pour la popup "Quoi de
    // neuf ?" automatique ET pour la vue rouverte à la demande (#btn-open-patchnotes).
    content.innerHTML = PATCH_NOTES_HISTORY.map((release, i) => `
        <div class="space-y-4 ${i > 0 ? 'pt-4 border-t border-white/10' : ''}">
            <div class="flex items-center gap-2">
                ${release.label ? `<span class="text-2xs font-black text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md uppercase tracking-wider">${escapeHtml(release.label)}</span>` : ''}
                <span class="text-2xs text-slate-500">${escapeHtml(release.version)}</span>
            </div>
            ${release.sections.map(section => `
                <div>
                    <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">${section.title}</h3>
                    <ul class="space-y-1.5 list-disc list-inside">
                        ${section.items.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                </div>
            `).join('')}
        </div>
    `).join('');

    const close = () => {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        localStorage.setItem('patchnotes:seenVersion', latestVersion);
    };
    const open = () => {
        // classList.add('flex') en plus de remove('hidden') : sans ça, l'overlay retombe en
        // display:block par défaut (aucune classe flex/grid statique) et "items-center
        // justify-center" n'a plus aucun effet - la carte se retrouve collée en haut à gauche
        // au lieu d'être centrée (même mécanique que reminders-overlay/help-overlay).
        content.scrollTop = 0;
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    };

    document.getElementById('btn-close-patchnotes').addEventListener('click', close);
    document.getElementById('btn-dismiss-patchnotes').addEventListener('click', close);
    // Bouton permanent d'en-tête (V2.2, QOL) : rouvre l'historique complet à tout moment, pas
    // seulement à la sortie d'une nouvelle version - marque aussi la version comme "vue" pour ne
    // pas redéclencher la popup automatique juste après une consultation volontaire.
    document.getElementById('btn-open-patchnotes').addEventListener('click', () => {
        localStorage.setItem('patchnotes:seenVersion', latestVersion);
        open();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Pas de popup automatique pour un tout nouveau visiteur (V2.2) : la visite guidée
    // (setupOnboardingTour) couvre déjà "ce qu'il y a à savoir maintenant" - un historique de
    // changements n'a pas de sens avant d'avoir vu l'appli une première fois. Reste accessible
    // à tout moment via #btn-open-patchnotes.
    const isFirstEverVisit = !localStorage.getItem(ONBOARDING_DONE_KEY) && !localStorage.getItem('patchnotes:seenVersion');
    if (!isFirstEverVisit && localStorage.getItem('patchnotes:seenVersion') !== latestVersion) {
        open();
    }
}

const NOTIF_ENABLED_KEY = 'notif:enabled';
const NOTIF_NOTIFIED_KEY = 'notif:notifiedIds';
// Délai de rappel configurable (QOL #8, remplace l'ancienne constante fixe à 15 min) - voir
// #reminder-lead-select dans le panneau Rappels.
const NOTIF_LEAD_KEY = 'notif:leadMinutes';
const NOTIF_LEAD_DEFAULT = 15;
// Ne pas déranger (QOL #19) : timestamp jusqu'auquel TOUS les rappels (global + abonnements
// individuels) sont mis en pause, sans rien désabonner - juste une pause temporaire.
const NOTIF_DND_UNTIL_KEY = 'notif:dndUntil';
// Résumé quotidien (QOL #9) : une notification par jour (pas par session) avec le programme du
// jour - DAILY_DIGEST_SENT_KEY retient la date du dernier envoi pour n'en déclencher qu'un
// par jour même si checkDailyDigest() est rappelée toutes les 30s (voir setInterval plus bas).
const DAILY_DIGEST_ENABLED_KEY = 'notif:dailyDigest';
const DAILY_DIGEST_SENT_KEY = 'notif:dailyDigestSentDate';

function getReminderLeadMinutes() {
    return parseInt(localStorage.getItem(NOTIF_LEAD_KEY), 10) || NOTIF_LEAD_DEFAULT;
}

function hasNotificationPermission() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

function isDndActive() {
    const until = parseInt(localStorage.getItem(NOTIF_DND_UNTIL_KEY), 10) || 0;
    return Date.now() < until;
}

function isBlanketRemindersEnabled() {
    return hasNotificationPermission() && localStorage.getItem(NOTIF_ENABLED_KEY) === '1';
}

// Un événement déclenche un rappel si l'interrupteur global "Tout activer" est actif, OU si
// son titre (voir ReminderService) est suivi individuellement - sauf pendant une pause "Ne pas
// déranger" (QOL #19), qui prime sur les deux sans qu'il faille se désabonner de quoi que ce soit.
function shouldRemindFor(event) {
    return hasNotificationPermission() && !isDndActive() && (isBlanketRemindersEnabled() || ReminderService.isSet(event.title));
}

function updateBlanketReminderButton() {
    const btn = document.getElementById('btn-toggle-all-reminders');
    const enabled = isBlanketRemindersEnabled();
    btn.innerHTML = `<span class="inline-flex items-center gap-1.5">${enabled ? Icons.bell('w-3.5 h-3.5 shrink-0') : Icons.bellOff('w-3.5 h-3.5 shrink-0')}${enabled ? 'Activé' : 'Désactivé'}</span>`;
    btn.setAttribute('aria-pressed', String(enabled));
    btn.className = `shrink-0 text-xxs font-bold px-3 py-1.5 rounded-lg border transition-all ${enabled ? 'bg-indigo-600/80 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`;
}

function updateDailyDigestButton() {
    const btn = document.getElementById('btn-toggle-daily-digest');
    const enabled = hasNotificationPermission() && localStorage.getItem(DAILY_DIGEST_ENABLED_KEY) === '1';
    btn.innerHTML = `<span class="inline-flex items-center gap-1.5">${enabled ? Icons.bell('w-3.5 h-3.5 shrink-0') : Icons.bellOff('w-3.5 h-3.5 shrink-0')}${enabled ? 'Activé' : 'Désactivé'}</span>`;
    btn.setAttribute('aria-pressed', String(enabled));
    btn.className = `shrink-0 text-xxs font-bold px-3 py-1.5 rounded-lg border transition-all ${enabled ? 'bg-indigo-600/80 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`;
}

// Contrairement aux autres boutons "Activé/Désactivé" de ce panneau, celui-ci ne dépend d'aucune
// permission navigateur (Web Audio n'en demande pas) : bascule directement, sans passage par
// Notification.requestPermission().
function updateNotifSoundButton() {
    const btn = document.getElementById('btn-toggle-notif-sound');
    const enabled = localStorage.getItem(NOTIF_SOUND_KEY) === '1';
    btn.innerHTML = `<span class="inline-flex items-center gap-1.5">${enabled ? '🔊' : '🔕'}${enabled ? 'Activé' : 'Désactivé'}</span>`;
    btn.setAttribute('aria-pressed', String(enabled));
    btn.className = `shrink-0 text-xxs font-bold px-3 py-1.5 rounded-lg border transition-all ${enabled ? 'bg-indigo-600/80 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`;
}
function toggleNotifSound() {
    const enabled = localStorage.getItem(NOTIF_SOUND_KEY) === '1';
    localStorage.setItem(NOTIF_SOUND_KEY, enabled ? '0' : '1');
    updateNotifSoundButton();
    // Aperçu immédiat au clic (V2.3) : sans ça, impossible de savoir à quoi ressemble le son
    // avant qu'une vraie notification finisse par se déclencher.
    if (!enabled) playNotificationSound();
}

function updateDndUI() {
    const active = isDndActive();
    document.getElementById('btn-clear-dnd').classList.toggle('hidden', !active);
    document.getElementById('dnd-options').classList.toggle('hidden', active);
    const desc = document.getElementById('reminders-dnd-desc');
    if (active) {
        const until = new Date(parseInt(localStorage.getItem(NOTIF_DND_UNTIL_KEY), 10));
        desc.textContent = `Rappels en pause jusqu'à ${until.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
    } else {
        desc.textContent = 'Met en pause tous les rappels temporairement, sans rien désabonner.';
    }
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
        new Notification('2GELOG', { body: `Rappels activés : vous serez prévenu ${getReminderLeadMinutes()} minutes avant chaque session.` });
    }
    updateBlanketReminderButton();
}

async function toggleDailyDigest() {
    const enabled = hasNotificationPermission() && localStorage.getItem(DAILY_DIGEST_ENABLED_KEY) === '1';
    if (enabled) {
        localStorage.setItem(DAILY_DIGEST_ENABLED_KEY, '0');
        updateDailyDigestButton();
        return;
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') {
        localStorage.setItem(DAILY_DIGEST_ENABLED_KEY, '1');
        new Notification('2GELOG', { body: "Résumé quotidien activé : un rappel chaque matin s'il y a un programme aujourd'hui." });
    }
    updateDailyDigestButton();
}

// Programme du jour en une seule notification (QOL #9), plutôt qu'une par session - vérifié à
// chaque appel de checkUpcomingNotifications (toutes les 30s) mais n'envoie réellement qu'une
// fois par jour civil (DAILY_DIGEST_SENT_KEY retient la date du dernier envoi effectif).
// Son discret optionnel (V2.3) : petit carillon à deux notes généré via Web Audio API
// (pas de fichier audio à charger/héberger, fonctionne hors-ligne comme le reste de l'app) -
// désactivé par défaut, voir #btn-toggle-notif-sound dans le panneau Rappels.
const NOTIF_SOUND_KEY = 'notif:soundEnabled';
function playNotificationSound() {
    if (localStorage.getItem(NOTIF_SOUND_KEY) !== '1') return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        [880, 1318.5].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const start = now + i * 0.12;
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
            osc.connect(gain).connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 0.32);
        });
        setTimeout(() => ctx.close(), 600);
    } catch {
        // Web Audio indisponible/bloqué (ex: politique navigateur exigeant une interaction
        // utilisateur préalable) : échoue silencieusement, la notification reste affichée.
    }
}

function checkDailyDigest() {
    if (!hasNotificationPermission() || isDndActive()) return;
    if (localStorage.getItem(DAILY_DIGEST_ENABLED_KEY) !== '1') return;

    const todayStr = DateUtils.toLocalDateStr(new Date());
    if (localStorage.getItem(DAILY_DIGEST_SENT_KEY) === todayStr) return;

    const todayEvents = repo.getAll()
        .filter(e => !e.isCanceled && !e.isPlanned && e.start.split('T')[0] === todayStr)
        .sort((a, b) => a.start.localeCompare(b.start));

    localStorage.setItem(DAILY_DIGEST_SENT_KEY, todayStr);
    if (todayEvents.length === 0) return;

    const body = todayEvents.length === 1
        ? `${todayEvents[0].title}${todayEvents[0].heure ? ' · ' + todayEvents[0].heure : ''}`
        : todayEvents.slice(0, 4).map(e => `${e.heure ? e.heure + ' ' : ''}${e.title}`).join('\n') + (todayEvents.length > 4 ? `\n+${todayEvents.length - 4} autre(s)` : '');

    new Notification(`🌅 ${todayEvents.length} session${todayEvents.length > 1 ? 's' : ''} aujourd'hui`, { body, tag: 'daily-digest-' + todayStr });
    playNotificationSound();
}

// Panneau "Suivis individuellement" (abonnements ReminderService, par titre) : affiche la
// prochaine occurrence connue de chaque titre suivi, avec un bouton pour se désabonner.
function renderRemindersList() {
    const container = document.getElementById('reminders-list');
    const reminders = ReminderService.getAll();
    document.getElementById('btn-clear-all-reminders').classList.toggle('hidden', reminders.length === 0);

    if (reminders.length === 0) {
        container.innerHTML = `<div class="text-xxs text-slate-600 italic">Aucun événement suivi individuellement pour l'instant. Ouvrez-en un et cliquez sur "M'envoyer un rappel".</div>`;
        return;
    }

    const now = new Date();
    const all = repo.getAll();
    // Triés par prochaine occurrence (V2.2, QOL) - le plus proche en premier, ceux sans date
    // connue relégués en fin de liste plutôt que mélangés dans l'ordre d'abonnement d'origine.
    const withNext = reminders.map(({ title }) => ({
        title,
        next: all
            .filter(e => e.title === title && !e.isCanceled && new Date(e.start) > now)
            .sort((a, b) => a.start.localeCompare(b.start))[0] || null
    })).sort((a, b) => {
        if (!a.next && !b.next) return 0;
        if (!a.next) return 1;
        if (!b.next) return -1;
        return a.next.start.localeCompare(b.next.start);
    });

    container.innerHTML = withNext.map(({ title, next }) => {
        const nextLabel = next
            ? new Date(next.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + (next.heure ? ' · ' + next.heure : '')
            : "Aucune prochaine date connue";
        // Compte à rebours (V2.3, QOL #2) : "dans 2j 4h" en plus de la date, pour ne pas avoir à
        // calculer soi-même l'écart avec aujourd'hui - voir formatCountdown dans utils/Format.js.
        const countdown = next ? formatCountdown(next.start, now) : null;
        return `
            <div class="glass-card flex items-center justify-between gap-2 p-2.5 rounded-xl">
                <div class="min-w-0">
                    <div class="text-xs font-bold text-slate-200 truncate">${escapeHtml(title)}</div>
                    <div class="text-xxs text-slate-500">Prochaine : ${escapeHtml(nextLabel)}${countdown ? ` <span class="text-indigo-400 font-bold">· ${escapeHtml(countdown)}</span>` : ''}</div>
                </div>
                <button data-remove-title="${escapeHtml(title)}" title="Ne plus suivre" aria-label="Ne plus suivre ${escapeHtml(title)}" class="shrink-0 text-slate-500 hover:text-rose-400 text-xs p-1.5 rounded-md hover:bg-rose-500/10 transition-all">✕</button>
            </div>
        `;
    }).join('');
}

// Sondage communautaire (V2.4) : seule brique dynamique du site, portée par un service n8n
// externe plutôt qu'un vrai backend (voir PollService.js/config.js) - le bouton reste caché
// tant qu'aucun sondage actif n'a été trouvé au chargement, pour ne jamais afficher un bouton
// mort si le service est en panne ou qu'il n'y a simplement rien à voter en ce moment.
let currentPoll = null;
function setupPoll() {
    const overlay = document.getElementById('poll-overlay');
    const content = document.getElementById('poll-content');
    const btn = document.getElementById('btn-open-poll');

    const renderCurrent = () => {
        if (!currentPoll) return;
        renderPoll(content, currentPoll, getMyVote(currentPoll.id));
    };

    const open = () => {
        renderCurrent();
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    };
    const close = () => { overlay.classList.add('hidden'); overlay.classList.remove('flex'); };

    btn.addEventListener('click', open);
    document.getElementById('btn-close-poll').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    content.addEventListener('click', async (e) => {
        const optionBtn = e.target.closest('button[data-poll-option]');
        if (!optionBtn || !currentPoll) return;
        const chosen = optionBtn.dataset.pollOption;

        // Mise à jour optimiste (V2.4) : le round-trip vers n8n peut prendre 1-2 secondes, assez
        // pour qu'un écran figé donne l'impression que le clic n'a rien fait et pousse à
        // recliquer plusieurs fois. On affiche donc IMMÉDIATEMENT le tally comme si le vote était
        // déjà pris en compte (en retirant l'ancien vote de cette personne s'il y en avait un),
        // avec un spinner pendant que la vraie requête part en arrière-plan - remplacé par la
        // vraie réponse du serveur une fois arrivée (ou par un rollback silencieux si ça échoue,
        // voir renderCurrent() dans le else ci-dessous).
        const previousVote = getMyVote(currentPoll.id);
        const optimisticPoll = {
            ...currentPoll,
            options: currentPoll.options.map(o => {
                let count = o.count - (previousVote === o.label ? 1 : 0);
                if (o.label === chosen) count++;
                return { ...o, count };
            })
        };
        optimisticPoll.total = optimisticPoll.options.reduce((sum, o) => sum + o.count, 0);
        renderPoll(content, optimisticPoll, chosen, { pending: true });

        const updated = await submitVote(currentPoll.id, chosen);
        if (updated) {
            currentPoll = updated;
        } else {
            showToast('Vote non enregistré, réessayez plus tard.', { icon: Icons.xCircle('w-3.5 h-3.5 shrink-0 text-rose-300') });
        }
        renderCurrent();
    });

    // Vérifié une seule fois au chargement, pas de polling continu ensuite : un sondage reste
    // ouvert plusieurs heures/jours, pas besoin de solliciter en direct un service externe dont
    // on ne maîtrise pas l'hébergement juste pour rafraîchir la pastille "actif" du bouton.
    fetchCurrentPoll().then(poll => {
        if (!poll) return;
        currentPoll = poll;
        btn.classList.remove('hidden');
    });
}

function setupRemindersOverlay() {
    const overlay = document.getElementById('reminders-overlay');
    const leadSelect = document.getElementById('reminder-lead-select');
    const open = () => {
        updateBlanketReminderButton();
        updateDailyDigestButton();
        updateNotifSoundButton();
        updateDndUI();
        leadSelect.value = String(getReminderLeadMinutes());
        renderRemindersList();
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    };
    const close = () => { overlay.classList.add('hidden'); overlay.classList.remove('flex'); };

    document.getElementById('btn-open-reminders').addEventListener('click', open);
    document.getElementById('btn-close-reminders').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('btn-toggle-all-reminders').addEventListener('click', toggleBlanketReminders);
    document.getElementById('btn-toggle-daily-digest').addEventListener('click', toggleDailyDigest);
    document.getElementById('btn-toggle-notif-sound').addEventListener('click', toggleNotifSound);

    leadSelect.addEventListener('change', () => {
        localStorage.setItem(NOTIF_LEAD_KEY, leadSelect.value);
    });

    // Ne pas déranger (QOL #19) : chaque bouton porte sa propre durée en heures
    // (data-dnd-hours), convertie en timestamp d'expiration stocké tel quel.
    document.getElementById('dnd-options').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-dnd-hours]');
        if (!btn) return;
        const hours = Number(btn.dataset.dndHours);
        localStorage.setItem(NOTIF_DND_UNTIL_KEY, String(Date.now() + hours * 3600000));
        updateDndUI();
    });
    document.getElementById('btn-clear-dnd').addEventListener('click', () => {
        localStorage.removeItem(NOTIF_DND_UNTIL_KEY);
        updateDndUI();
    });

    document.getElementById('reminders-list').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-remove-title]');
        if (!btn) return;
        ReminderService.remove(btn.dataset.removeTitle);
        renderRemindersList();
        updateUIState(); // Rafraîchit le badge 🔔 sur les tuiles concernées.
    });

    document.getElementById('btn-clear-all-reminders').addEventListener('click', () => {
        ReminderService.clear();
        renderRemindersList();
        updateUIState();
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

// Badge sur l'icône de l'app (QOL #10, Badging API) : nombre de sessions du jour, visible sur
// l'icône même app fermée/en arrière-plan (PWA installée - support variable selon plateforme,
// ignoré silencieusement si l'API n'existe pas, ex: Firefox). Rafraîchi au même rythme que les
// notifications (voir son appel dans checkUpcomingNotifications) pour rester à jour toute la
// journée, y compris après minuit (repasse à 0 puis recompte sur le nouveau "aujourd'hui").
function updatePwaBadge() {
    if (!('setAppBadge' in navigator)) return;
    const todayStr = DateUtils.toLocalDateStr(new Date());
    const count = repo.getAll().filter(e => !e.isCanceled && !e.isPlanned && e.start.split('T')[0] === todayStr).length;
    const setter = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
    setter.catch(() => {});
}

// Cherche, sur TOUT le dépôt (pas les filtres actifs à l'écran : le rappel doit sonner pour
// n'importe quelle session à venir), les événements démarrant dans moins du délai configuré
// (voir getReminderLeadMinutes, QOL #8) et concernés par un rappel (global ou par abonnement
// individuel) et déclenche une notification navigateur une seule fois chacun. Vérifie aussi le
// résumé quotidien (QOL #9) et le badge d'icône (QOL #10) au passage, sur le même intervalle
// (voir son appel dans initApp).
// Alerte de changement (V2.3) : signale qu'un événement individuellement suivi (voir
// ReminderService) a changé d'heure ou a été annulé depuis la dernière visite - pas seulement
// "vous serez prévenu avant qu'il commence" (checkUpcomingNotifications ci-dessous), mais "ce que
// vous attendiez a bougé". Contrainte du site 100% statique (pas de backend, pas de push) : ne
// peut comparer qu'à la dernière fois que CETTE PAGE a été chargée (voir SUBSCRIPTION_SNAPSHOT_KEY),
// pas en temps réel pendant qu'un onglet reste ouvert sans être rechargé - suffisant pour la
// plupart des usages (on rouvre le site plutôt que de garder un onglet ouvert en permanence).
const SUBSCRIPTION_SNAPSHOT_KEY = 'reminders:snapshot';
function checkSubscriptionChanges() {
    const subs = ReminderService.getAll();
    let snapshot;
    try { snapshot = JSON.parse(localStorage.getItem(SUBSCRIPTION_SNAPSHOT_KEY) || '{}'); } catch { snapshot = {}; }
    if (subs.length === 0) { localStorage.setItem(SUBSCRIPTION_SNAPSHOT_KEY, '{}'); return; }

    const now = new Date();
    const all = repo.getAll();
    const nextSnapshot = {};

    subs.forEach(({ title }) => {
        const sameTitle = all.filter(e => e.title === title && !e.isPlanned);
        const nextReal = sameTitle
            .filter(e => !e.isCanceled && new Date(e.start) > now)
            .sort((a, b) => a.start.localeCompare(b.start))[0];
        if (nextReal) nextSnapshot[title] = { start: nextReal.start, heure: nextReal.heure || null };

        // Ne compare que si la précédente "prochaine occurrence connue" pour ce titre devrait
        // ENCORE être à venir aujourd'hui - sinon elle a simplement eu lieu normalement entre
        // temps, pas "changé".
        const prev = snapshot[title];
        if (!prev || new Date(prev.start) <= now) return;
        const stillThere = sameTitle.some(e => e.start === prev.start && !e.isCanceled);
        if (stillThere) return;

        const nowCanceled = sameTitle.some(e => e.start === prev.start && e.isCanceled);
        if (nowCanceled) {
            showToast(`🚫 "${title}" a été annulé`, { icon: Icons.xCircle('w-3.5 h-3.5 shrink-0 text-rose-300') });
        } else if (nextReal) {
            const dateLabel = new Date(nextReal.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            showToast(`⏰ "${title}" a changé d'horaire : ${dateLabel}${nextReal.heure ? ' · ' + nextReal.heure : ''}`, { icon: Icons.bell('w-3.5 h-3.5 shrink-0 text-indigo-300') });
        }
    });

    localStorage.setItem(SUBSCRIPTION_SNAPSHOT_KEY, JSON.stringify(nextSnapshot));
}

function checkUpcomingNotifications() {
    checkDailyDigest();
    updatePwaBadge();
    if (!hasNotificationPermission() || isDndActive()) return;
    const now = new Date();
    const leadMs = getReminderLeadMinutes() * 60000;
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
    // Un seul son pour tout le lot (V2.3), pas un par événement dû : plusieurs
    // notifications simultanées ne doivent pas rejouer le même carillon en rafale.
    playNotificationSound();

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
        view: calendarInstance ? calendarInstance.view.type : null,
        // Le Kiosque est pensé pour afficher LE CALENDRIER (listMonth) plein écran : sans ce
        // reset, l'activer alors qu'on était sur Aujourd'hui/Frise/Carte laissait cette vue-là
        // affichée (currentViewMode n'était jamais repris en compte), pas le calendrier attendu.
        viewMode: currentViewMode
    };
    if (currentViewMode !== 'calendar') {
        currentViewMode = 'calendar';
        applyViewButtonStyles();
    }

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
        if (kioskSavedState.viewMode && kioskSavedState.viewMode !== currentViewMode) {
            currentViewMode = kioskSavedState.viewMode;
            applyViewButtonStyles();
        }
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
// d'en-tête), jamais bloquant. Couvre désormais TOUTE l'année (V2.2, voir SEASONS dans
// SeasonalTheme.js) - toujours "compris en un coup d'oeil" via le badge + son survol (title), et
// signalé par un toast au moment où la saison change réellement (pas à chaque rechargement).
const SEASON_LAST_SEEN_KEY = 'seasonal-theme:lastSeenId';

// Dernier emoji de particule effectivement rendu (V2.2) : évite de reconstruire le nuage de
// particules (et de faire sauter leur animation en cours) quand refreshSeasonalTheme() est
// rappelé sans que la saison n'ait réellement changé (ex: réouverture du sélecteur sur "Auto").
let lastRenderedParticle = undefined;

/**
 * (Re)construit le nuage de particules discrètes de la saison active (❄️ à Noël/en hiver, 🍂 en
 * automne...) dans #seasonal-particles, voir le champ `particle` de SEASONS. Purement décoratif
 * et non-interactif (pointer-events:none sur le conteneur) : entièrement sauté sous
 * prefers-reduced-motion plutôt que figé, comme les autres animations d'ambiance de l'app.
 * @param {string|null} season
 */
function setupSeasonalParticles(season) {
    const container = document.getElementById('seasonal-particles');
    const cfg = season && SEASONS[season];
    const particle = cfg?.particle || null;

    if (particle === lastRenderedParticle) return;
    lastRenderedParticle = particle;
    container.innerHTML = '';

    if (!particle) return;
    if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

    const COUNT = 16;
    for (let i = 0; i < COUNT; i++) {
        const span = document.createElement('span');
        span.className = 'seasonal-particle';
        span.textContent = particle;
        span.style.left = `${Math.random() * 100}%`;
        span.style.fontSize = `${10 + Math.random() * 14}px`;
        span.style.setProperty('--particle-opacity', String(0.25 + Math.random() * 0.35));
        span.style.setProperty('--particle-drift', `${(Math.random() - 0.5) * 120}px`);
        const duration = 9 + Math.random() * 10;
        span.style.animationDuration = `${duration}s`;
        span.style.animationDelay = `-${Math.random() * duration}s`;
        container.appendChild(span);
    }
}

function refreshSeasonalTheme() {
    const season = resolveActiveSeason();
    const cfg = applySeasonalTheme(season);
    setupSeasonalParticles(season);
    const badge = document.getElementById('seasonal-badge');
    if (!cfg) {
        badge.classList.add('hidden');
        return;
    }
    badge.textContent = `${cfg.emoji} ${cfg.label}`;
    badge.title = cfg.note;
    badge.style.color = cfg.color;
    badge.style.borderColor = `${cfg.color}40`;
    badge.style.background = `${cfg.color}1a`;
    badge.classList.remove('hidden');

    // Un petit mot dans un toast (pas une vraie popup à fermer) quand la saison affichée vient de
    // changer par rapport au dernier chargement connu - jamais en mode forcé manuellement (ça
    // spammerait le toast à chaque rechargement d'une saison choisie exprès, pas juste "détectée").
    if (getManualOverride() === 'auto' && localStorage.getItem(SEASON_LAST_SEEN_KEY) !== season) {
        localStorage.setItem(SEASON_LAST_SEEN_KEY, season);
        showToast(`${cfg.emoji} ${cfg.label} — ${cfg.note}`);
    }
}

// Thème saisonnier : "Auto" (par défaut) suit la date réelle, ou un choix manuel (forcer un
// thème toute l'année, ou le désactiver complètement) via le sélecteur d'en-tête - persisté
// dans localStorage (voir SeasonalTheme.js). Cliquer le badge rappelle son petit mot (title déjà
// posé par refreshSeasonalTheme, sans effet réel au survol tactile sur mobile - ce clic couvre
// ce cas), il ne désactive rien : le sélecteur reste l'unique commande pour ça.
function setupSeasonalTheme() {
    const select = document.getElementById('theme-select');
    select.value = getManualOverride();
    refreshSeasonalTheme();

    select.addEventListener('change', () => {
        setManualOverride(select.value);
        refreshSeasonalTheme();
    });

    document.getElementById('seasonal-badge').addEventListener('click', () => {
        const season = resolveActiveSeason();
        const cfg = season && SEASONS[season];
        if (cfg) showToast(`${cfg.emoji} ${cfg.label} — ${cfg.note}`);
    });
}

// Thème clair/sombre (V2.2) : bascule manuelle indépendante du thème SAISONNIER ci-dessus (celui-
// ci ne fait que teinter le fond sombre par défaut, jamais l'inverser) - persisté en localStorage,
// posé en attribut sur <html> pour que tout le CSS clair (voir index.html) s'applique d'un coup.
const THEME_KEY = 'ui-theme';
function getStoredTheme() {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.getElementById('theme-toggle-icon-moon').classList.toggle('hidden', theme === 'light');
    document.getElementById('theme-toggle-icon-sun').classList.toggle('hidden', theme !== 'light');
    // Couleur de la barre système/PWA (meta theme-color) : suit le thème actif, comme le reste du chrome.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#161b22');
}
function setupThemeToggle() {
    applyTheme(getStoredTheme());
    document.getElementById('btn-toggle-theme').addEventListener('click', () => {
        const next = getStoredTheme() === 'light' ? 'dark' : 'light';
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
    });
}

async function sha256Hex(text) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Menu déroulant "⋯" regroupant les outils d'organisateur (V2.2, voir #admin-tools-menu dans
// index.html) — même mécanique clic-dehors-pour-fermer que le popover du mini-calendrier
// (setupMiniCalendar) : pas un vrai overlay géré par setupEscapeToClose(), juste un petit menu.
function setupAdminToolsMenu() {
    const toggle = document.getElementById('btn-admin-tools-toggle');
    const dropdown = document.getElementById('admin-tools-dropdown');

    const closeDropdown = () => {
        dropdown.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
    };
    const openDropdown = () => {
        dropdown.classList.remove('hidden');
        toggle.setAttribute('aria-expanded', 'true');
    };

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdown.classList.contains('hidden')) openDropdown(); else closeDropdown();
    });
    dropdown.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== toggle) closeDropdown();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) closeDropdown();
    });
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

    // Export Discord, lien de déclenchement du digest webhook, mode Kiosque et Admin : plutôt
    // des outils d'organisateur que d'usage courant, regroupés derrière le menu "⋯" (voir
    // #admin-tools-menu dans index.html / setupAdminToolsMenu() plus bas) pour ne pas encombrer
    // l'en-tête des visiteurs classiques.
    document.getElementById('admin-tools-menu').classList.remove('hidden');

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

    // Lignes d'anomalies cliquables (V2.2, QOL) quand un événement correspondant a pu être
    // retrouvé (voir renderAnomaliesSection dans AdminView.js) - ferme l'Admin avant d'ouvrir la
    // modale (ModalView z-50 est sous Admin z-60, resterait invisible sinon).
    content.addEventListener('click', (e) => {
        const row = e.target.closest('[data-event-id]');
        if (!row) return;
        overlay.classList.add('hidden');
        openEventById(row.dataset.eventId);
    });
}

let currentRetrospectiveYear = null;
// "Toute l'histoire" (V2.4, "9") : bascule entre le détail d'une année (renderRetrospective,
// par défaut) et le résumé multi-années (renderAllYearsHistory) - voir btn-retro-history dans
// setupRetrospective. Remise à false à chaque (ré)ouverture de l'overlay.
let retroShowingHistory = false;
// Événements du dernier mois/jour de semaine ouvert en détail (voir openBucketDetail) :
// indexé de la même façon que le rendu, pour retrouver l'objet complet au clic sur une carte.
let bucketDetailCache = [];
// D'où vient le détail actuellement affiché (V2.2, voir renderBucketBreadcrumb) : conditionne le
// texte du fil d'ariane ET le comportement du bouton "retour" (closeBucketDetail) puisque les
// deux parents possibles ne se comportent pas pareil - la Rétrospective reste visible en dessous
// (bucket-detail-overlay est simplement posé par-dessus, même z-index empilable), alors que le
// Profil organisateur, lui, est explicitement masqué avant l'ouverture du détail (voir
// openOrganizerWeekdayDetail) et doit donc être explicitement réaffiché au retour.
let bucketDetailOrigin = null;

/** Fil d'ariane "vous êtes ici" du détail mois/jour de semaine : 1er segment cliquable = retour au parent. */
function renderBucketBreadcrumb(parentLabel, currentLabel) {
    document.getElementById('bucket-detail-breadcrumb').innerHTML = `
        <button id="bucket-detail-breadcrumb-back" class="hover:text-indigo-300 transition-colors">${escapeHtml(parentLabel)}</button>
        <span aria-hidden="true">›</span>
        <span class="text-slate-300">${escapeHtml(currentLabel)}</span>
    `;
}

/** Rend bucketDetailCache (déjà rempli par l'appelant) dans #bucket-detail-title/#bucket-detail-content et affiche l'overlay - factorisé entre les 4 origines possibles (mois/jour de semaine × rétrospective/profil, + "événement récurrent" ci-dessous). */
function fillBucketDetailOverlay(titleText) {
    document.getElementById('bucket-detail-title').textContent = titleText;
    document.getElementById('bucket-detail-content').innerHTML = bucketDetailCache.map((e, idx) => {
        const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
        return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate, 'bucket-detail')}</div>`;
    }).join('');
    document.getElementById('bucket-detail-overlay').classList.remove('hidden');
}

/**
 * Liste complète (et non plus seulement le résumé "top 3" de l'infobulle) des sessions d'un
 * mois ou jour de semaine de la rétrospective, ouverte au clic sur une barre des graphiques
 * (voir renderHoverBarChart dans RetrospectiveView.js).
 */
function openBucketDetail(kind, label, index) {
    bucketDetailCache = getBucketEvents(repo.getAll(), currentRetrospectiveYear, kind, index);
    bucketDetailOrigin = 'retrospective';
    renderBucketBreadcrumb(`Rétrospective ${currentRetrospectiveYear}`, label);
    const count = bucketDetailCache.length;
    fillBucketDetailOverlay(`${label} ${currentRetrospectiveYear} · ${count} session${count > 1 ? 's' : ''}`);
}

// Toutes les occurrences d'un même titre (voir renderMostRecurringEvent dans RetrospectiveView.js,
// V2.2 : "augmenter les interactions" de la rétrospective) - ouvert au clic sur la tuile "l'évènement
// qui revient le plus", pour lister ses séances au lieu de se contenter du résumé (nombre + durée).
function openRetroRecurringDetail(title) {
    bucketDetailCache = repo.getAll()
        .filter(e => !e.isCanceled && !e.isPlanned && new Date(e.start).getFullYear() === currentRetrospectiveYear && e.title === title)
        .sort((a, b) => new Date(b.start) - new Date(a.start));
    bucketDetailOrigin = 'retrospective';
    renderBucketBreadcrumb(`Rétrospective ${currentRetrospectiveYear}`, title);
    fillBucketDetailOverlay(`${title} · ${bucketDetailCache.length} session${bucketDetailCache.length > 1 ? 's' : ''}`);
}

// Ouvre l'événement (poster/carte "premier/dernier moment") référencé par data-event-id dans les
// sections enrichies de la rétrospective/du profil organisateur (V2.2) - recherche dans TOUT le
// dépôt plutôt que dans un sous-ensemble : ces tuiles montrent un événement précis et unique,
// identifié par son id stable, pas une position dans une liste filtrée qui pourrait avoir bougé.
function openEventById(id) {
    const event = repo.getAll().find(e => e.id === id);
    if (event) ModalView.open(event);
}

// Lance une recherche par tag depuis un tag cliqué dans la rétrospective/le profil organisateur
// (V2.2) - même geste que le clic sur un tag DANS la modale d'événement (voir ModalView.init),
// pour que "cliquer un tag" se comporte pareil partout dans l'app.
function applyTagSearchFromOverlay(tag) {
    document.getElementById('recherche').value = `#${tag}`;
    document.getElementById('btn-clear-search').classList.remove('hidden');
    document.getElementById('search-icon').classList.add('hidden');
    currentSearchQuery = `#${tag}`;
    updateUIState();
}

// Sessions du dernier organisateur ouvert en profil (voir openOrganizerProfile) : indexé de la
// même façon que le rendu, pour retrouver l'objet complet au clic sur une carte.
let organizerProfileCache = [];
// Mêmes sessions que organizerProfileCache mais non triées (juste facts.realSessions) : source
// pour le filtrage par jour de semaine du graphique "hostWeekday" (voir openOrganizerWeekdayDetail).
let organizerWeekdayCache = [];
// Organisateur actuellement affiché (nom tel que cliqué + facts déjà calculées) : lu par les
// boutons d'export .ics/image du profil (pas besoin de tout recalculer à leur propre clic).
let currentOrganizerHostName = null;
let currentOrganizerFacts = null;

// Fiche de lieu (vue Carte, voir openLocationProfile) : même idée que le profil organisateur
// ci-dessus, mais deux caches séparés (à venir / historique) puisque ce sont deux sections
// distinctes de la fiche plutôt qu'une seule liste unique.
let locationProfileUpcomingCache = [];
let locationProfileHistoryCache = [];
let currentLocationKey = null;

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
    currentOrganizerHostName = hostName;
    currentOrganizerFacts = facts;

    // Lien direct partageable (QOL #13, ?host=<nom>), même mécanique que ModalView pour
    // ?event=<id> : remplace l'entrée d'historique courante plutôt que d'en empiler une.
    const url = new URL(window.location.href);
    url.searchParams.set('host', hostName);
    window.history.replaceState(null, '', url);

    const currentYear = new Date().getFullYear();
    const yearStats = StatsService.compute(allEvents.filter(e => new Date(e.start).getFullYear() === currentYear));
    const isTopHostThisYear = (topN(yearStats.byHost, 1)[0] || [])[0] === normalized;

    document.getElementById('organizer-profile-title').innerHTML = `<span class="inline-flex items-center gap-2">${renderAvatarInitials(hostName, 'w-6 h-6 text-2xs')}<span class="capitalize">${escapeHtml(hostName)}</span></span>`;
    document.getElementById('organizer-profile-summary').innerHTML = `
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-3">
            <div class="glass-panel rounded-xl p-3 text-center">
                <div id="op-stat-sessions" class="text-xl font-black text-white">0</div>
                <div class="text-3xs uppercase tracking-wider text-slate-500 mt-0.5">Sessions organisées</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div id="op-stat-time" class="text-xl font-black text-indigo-400">${formatMinutes(0)}</div>
                <div class="text-3xs uppercase tracking-wider text-slate-500 mt-0.5">Temps animé (cumulé)</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div id="op-stat-types" class="text-xl font-black text-white">0</div>
                <div class="text-3xs uppercase tracking-wider text-slate-500 mt-0.5">Types différents</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div id="op-stat-reliability" class="text-xl font-black text-emerald-400">0%</div>
                <div class="text-3xs uppercase tracking-wider text-slate-500 mt-0.5">Sessions maintenues</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div id="op-stat-streak" class="text-xl font-black text-white">0</div>
                <div class="text-3xs uppercase tracking-wider text-slate-500 mt-0.5">${facts.streak > 1 ? "Semaines d'affilée (record)" : 'Semaine active'}</div>
            </div>
        </div>
        ${isTopHostThisYear ? `<div class="inline-flex items-center gap-1.5 w-full justify-center text-xs font-bold text-amber-300 mb-3">${Icons.crown('w-3.5 h-3.5 shrink-0')}MVP de ${currentYear}</div>` : ''}
        ${renderBadgeShelf(computeBadges(facts))}
    `;
    animateCountUp(document.getElementById('op-stat-sessions'), facts.totalSessions);
    animateCountUp(document.getElementById('op-stat-time'), facts.totalTime, formatMinutes);
    animateCountUp(document.getElementById('op-stat-types'), facts.distinctTypes);
    animateCountUp(document.getElementById('op-stat-reliability'), facts.reliabilityPct, (n) => `${n}%`);
    animateCountUp(document.getElementById('op-stat-streak'), facts.streak);

    // Sections enrichies : mêmes briques que la rétrospective annuelle (voir RetrospectiveView.js),
    // réutilisées telles quelles mais recentrées sur les seules sessions de CET organisateur.
    // "hostWeekday" (au lieu de "weekday") distingue ce graphique de celui de la rétrospective
    // annuelle : son clic doit filtrer organizerWeekdayCache, pas rouvrir getBucketEvents (qui
    // ne connaît qu'une année et tous organisateurs confondus).
    const weekdayChart = facts.weekdayBuckets.some(b => b.count > 0)
        ? renderHoverBarChart(WEEKDAY_LABELS, facts.weekdayBuckets, Icons.calendarDays('w-4 h-4 shrink-0'), (peak) => `Jour préféré pour organiser : ${peak}`, 'hostWeekday')
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
        return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate, 'organizer-profile')}</div>`;
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
    bucketDetailOrigin = 'organizer';
    renderBucketBreadcrumb(`Profil de ${currentOrganizerHostName}`, label);
    // Ferme le profil avant d'ouvrir le détail (ModalView/bucket-detail-overlay ne sont pas
    // empilables par z-index avec ce panneau, voir bucketDetailOrigin plus haut).
    document.getElementById('organizer-profile-overlay').classList.add('hidden');
    fillBucketDetailOverlay(`${label} · ${bucketDetailCache.length} session${bucketDetailCache.length > 1 ? 's' : ''}`);
}

// Même idée qu'openRetroRecurringDetail, mais recentrée sur CET organisateur (toutes années
// confondues, voir currentOrganizerFacts.realSessions déjà scopé par openOrganizerProfile).
function openHostRecurringDetail(title) {
    bucketDetailCache = (currentOrganizerFacts?.realSessions || [])
        .filter(e => e.title === title)
        .sort((a, b) => new Date(b.start) - new Date(a.start));
    bucketDetailOrigin = 'organizer';
    renderBucketBreadcrumb(`Profil de ${currentOrganizerHostName}`, title);
    document.getElementById('organizer-profile-overlay').classList.add('hidden');
    fillBucketDetailOverlay(`${title} · ${bucketDetailCache.length} session${bucketDetailCache.length > 1 ? 's' : ''}`);
}

function setupOrganizerProfile() {
    const overlay = document.getElementById('organizer-profile-overlay');
    const close = () => {
        overlay.classList.add('hidden');
        const url = new URL(window.location.href);
        url.searchParams.delete('host');
        window.history.replaceState(null, '', url);
        currentOrganizerHostName = null;
        currentOrganizerFacts = null;
    };

    document.getElementById('btn-close-organizer-profile').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { close(); return; }
        const bar = e.target.closest('[data-bucket-kind="hostWeekday"]');
        if (bar) { openOrganizerWeekdayDetail(bar.dataset.bucketLabel, Number(bar.dataset.bucketIndex)); return; }
        // Sections enrichies cliquables (V2.2, "augmenter les interactions") : mêmes
        // data-attributes que la rétrospective annuelle, voir RetrospectiveView.js.
        const recurringTile = e.target.closest('[data-recurring-title]');
        if (recurringTile) { openHostRecurringDetail(recurringTile.dataset.recurringTitle); return; }
        const tagBtn = e.target.closest('button[data-tag]');
        if (tagBtn) { close(); applyTagSearchFromOverlay(tagBtn.dataset.tag); return; }
        const eventTile = e.target.closest('[data-event-id]');
        if (eventTile) { close(); openEventById(eventTile.dataset.eventId); return; }
        const card = e.target.closest('[data-idx]');
        if (!card) return;
        const ev = organizerProfileCache[Number(card.dataset.idx)];
        if (ev) { close(); ModalView.open(ev); }
    });

    // Export .ics des seules sessions de cet organisateur (QOL #4) - réutilise IcsExporter
    // telle quelle, comme l'export global de l'en-tête, juste sur un lot d'événements différent.
    document.getElementById('btn-organizer-export-ics').addEventListener('click', () => {
        if (!currentOrganizerFacts) return;
        const filename = `planning-${currentOrganizerHostName.toLowerCase().replace(/\s+/g, '-')}-2gelog.ics`;
        IcsExporter.download(currentOrganizerFacts.realSessions, filename);
    });

    // Image récap partageable (QOL #12) - voir generateOrganizerRecapImage.
    document.getElementById('btn-organizer-export-image').addEventListener('click', () => {
        if (!currentOrganizerFacts || !currentOrganizerHostName) return;
        generateOrganizerRecapImage(currentOrganizerHostName, currentOrganizerFacts);
    });

    // Lien direct vers ce profil (QOL #13, ?host=<nom>) - même geste que 🔗 dans la modale
    // d'un événement (copie, ou repli sur window.prompt si le presse-papiers est indisponible).
    document.getElementById('btn-organizer-copy-link').addEventListener('click', async () => {
        if (!currentOrganizerHostName) return;
        const url = new URL(window.location.href);
        url.searchParams.set('host', currentOrganizerHostName);
        try {
            await navigator.clipboard.writeText(url.href);
            showToast('Lien copié !', { icon: Icons.link('w-3.5 h-3.5 shrink-0 text-indigo-300') });
        } catch {
            window.prompt("Copiez ce lien :", url.href);
        }
    });

    // Délégation de clic sur le "Top organisateurs" de la sidebar (voir renderDashboardStats).
    document.getElementById('stat-hosts-container').addEventListener('click', (e) => {
        const row = e.target.closest('[data-host]');
        if (row) openOrganizerProfile(row.dataset.host);
    });
}

/**
 * Fiche d'un lieu de meetup IRL (vue Carte, refonte V2.2) : résumé + sessions à venir + tout
 * l'historique - toujours calculée sur TOUT le dépôt (comme le profil organisateur), pas les
 * événements actuellement filtrés à l'écran, pour rester une vraie mémoire du lieu.
 * @param {string} cityKey - Clé ville normalisée (voir CityCoordinates.js), ex: "montpellier"
 */
function openLocationProfile(cityKey) {
    if (!cityKey) return;
    const byCity = groupEventsByCity(repo.getAll());
    const cityEvents = byCity.get(cityKey) || [];
    const todayStr = DateUtils.toLocalDateStr(new Date());

    const upcoming = cityEvents
        .filter(e => !e.isCanceled && e.start.split('T')[0] >= todayStr)
        .sort((a, b) => a.start.localeCompare(b.start));
    const history = cityEvents
        .filter(e => e.isCanceled || e.start.split('T')[0] < todayStr)
        .sort((a, b) => new Date(b.start) - new Date(a.start));

    locationProfileUpcomingCache = upcoming;
    locationProfileHistoryCache = history;
    currentLocationKey = cityKey;

    // Lien direct partageable (?lieu=<clé>), même mécanique que ?host= pour le profil organisateur.
    const url = new URL(window.location.href);
    url.searchParams.set('lieu', cityKey);
    window.history.replaceState(null, '', url);

    document.querySelector('#location-profile-title span').textContent = cityLabel(cityKey);

    const realHistory = history.filter(e => !e.isCanceled);
    const first = [...realHistory].sort((a, b) => a.start.localeCompare(b.start))[0];
    document.getElementById('location-profile-summary').innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-1">
            <div class="glass-panel rounded-xl p-3 text-center">
                <div id="lp-stat-total" class="text-xl font-black text-white">0</div>
                <div class="text-3xs uppercase tracking-wider text-slate-500 mt-0.5">Sessions au total</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div id="lp-stat-upcoming" class="text-xl font-black text-indigo-400">0</div>
                <div class="text-3xs uppercase tracking-wider text-slate-500 mt-0.5">À venir</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div class="text-xl font-black text-white">${first ? new Date(first.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}</div>
                <div class="text-3xs uppercase tracking-wider text-slate-500 mt-0.5">Premier meetup ici</div>
            </div>
        </div>
    `;
    animateCountUp(document.getElementById('lp-stat-total'), cityEvents.length);
    animateCountUp(document.getElementById('lp-stat-upcoming'), upcoming.length);

    const upcomingSection = document.getElementById('location-profile-upcoming-section');
    upcomingSection.classList.toggle('hidden', upcoming.length === 0);
    document.getElementById('location-profile-upcoming').innerHTML = upcoming.map((e, idx) => {
        const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return `<div class="cursor-pointer" data-upcoming-idx="${idx}">${renderEventCard(e, readableDate, 'location-profile-upcoming')}</div>`;
    }).join('');

    const historyContent = document.getElementById('location-profile-content');
    historyContent.innerHTML = history.length > 0
        ? history.map((e, idx) => {
            const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return `<div class="cursor-pointer" data-history-idx="${idx}">${renderEventCard(e, readableDate, 'location-profile-history')}</div>`;
        }).join('')
        : `<div class="text-center text-xs text-slate-600 py-8">Aucune session passée pour l'instant.</div>`;

    document.getElementById('location-profile-overlay').classList.remove('hidden');
}

function setupLocationProfile() {
    const overlay = document.getElementById('location-profile-overlay');
    const close = () => {
        overlay.classList.add('hidden');
        const url = new URL(window.location.href);
        url.searchParams.delete('lieu');
        window.history.replaceState(null, '', url);
        currentLocationKey = null;
    };

    document.getElementById('btn-close-location-profile').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { close(); return; }
        const upcomingCard = e.target.closest('[data-upcoming-idx]');
        if (upcomingCard) {
            const ev = locationProfileUpcomingCache[Number(upcomingCard.dataset.upcomingIdx)];
            if (ev) { close(); ModalView.open(ev); }
            return;
        }
        const historyCard = e.target.closest('[data-history-idx]');
        if (historyCard) {
            const ev = locationProfileHistoryCache[Number(historyCard.dataset.historyIdx)];
            if (ev) { close(); ModalView.open(ev); }
        }
    });

    // Export .ics des seules sessions (passées + à venir) de ce lieu.
    document.getElementById('btn-location-export-ics').addEventListener('click', () => {
        if (!currentLocationKey) return;
        const filename = `planning-${currentLocationKey}-2gelog.ics`;
        IcsExporter.download([...locationProfileUpcomingCache, ...locationProfileHistoryCache], filename);
    });

    // Lien direct vers cette fiche (?lieu=<clé>) - même geste que pour le profil organisateur.
    document.getElementById('btn-location-copy-link').addEventListener('click', async () => {
        if (!currentLocationKey) return;
        const url = new URL(window.location.href);
        url.searchParams.set('lieu', currentLocationKey);
        try {
            await navigator.clipboard.writeText(url.href);
            showToast('Lien copié !', { icon: Icons.link('w-3.5 h-3.5 shrink-0 text-indigo-300') });
        } catch {
            window.prompt("Copiez ce lien :", url.href);
        }
    });
}

/** Ouvre directement une fiche de lieu depuis l'URL (?lieu=<clé>), même mécanique que
 * openOrganizerProfileFromUrl pour ?host=. */
function openLocationProfileFromUrl() {
    const cityKey = new URLSearchParams(window.location.search).get('lieu');
    if (cityKey) openLocationProfile(cityKey);
}

// Rétrospective annuelle "vitrine" (voir RetrospectiveView.js) : accessible à tous, contrairement
// au mode Admin (anomalies/tableaux techniques, réservé aux organisateurs via ?admin).
function setupRetrospective() {
    const overlay = document.getElementById('retrospective-overlay');
    const content = document.getElementById('retrospective-content');

    const historyBtn = document.getElementById('btn-retro-history');
    const exportImageBtn = document.getElementById('btn-retro-export-image');
    const renderCurrentYear = () => {
        if (retroShowingHistory) {
            renderAllYearsHistory(content, repo.getAll(), getAvailableYears(repo.getAll()));
        } else {
            renderRetrospective(content, repo.getAll(), currentRetrospectiveYear);
        }
        historyBtn.setAttribute('aria-pressed', String(retroShowingHistory));
        historyBtn.classList.toggle('text-indigo-300', retroShowingHistory);
        historyBtn.classList.toggle('bg-indigo-500/10', retroShowingHistory);
        // N'a de sens que sur le détail d'une année précise (voir le handler de clic plus bas) -
        // réellement masqué ici (pas juste un no-op silencieux au clic) pour ne jamais laisser un
        // bouton cliquable qui ne fait rien en vue "Toute l'histoire".
        exportImageBtn.classList.toggle('hidden', retroShowingHistory);
    };

    const open = () => {
        const years = getAvailableYears(repo.getAll());
        const thisYear = new Date().getFullYear();
        // Ouvre sur l'année en cours si elle a des données, sinon la plus récente disponible.
        currentRetrospectiveYear = years.includes(thisYear) ? thisYear : (years[0] || thisYear);
        retroShowingHistory = false;
        renderCurrentYear();
        overlay.classList.remove('hidden');
    };
    const close = () => overlay.classList.add('hidden');

    document.getElementById('btn-open-retrospective').addEventListener('click', open);
    document.getElementById('btn-close-retrospective').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    historyBtn.addEventListener('click', () => {
        retroShowingHistory = !retroShowingHistory;
        renderCurrentYear();
    });

    // Image récap partageable de l'année (V2.3) - voir generateRetrospectiveRecapImage. N'a de
    // sens que sur le détail d'une année précise (masqué en vue "Toute l'histoire").
    document.getElementById('btn-retro-export-image').addEventListener('click', () => {
        if (retroShowingHistory) return;
        const facts = computeYearFacts(repo.getAll(), currentRetrospectiveYear);
        generateRetrospectiveRecapImage(currentRetrospectiveYear, facts);
    });

    content.addEventListener('click', (e) => {
        const bar = e.target.closest('[data-bucket-kind]');
        if (bar) {
            openBucketDetail(bar.dataset.bucketKind, bar.dataset.bucketLabel, Number(bar.dataset.bucketIndex));
            return;
        }
        // Sections enrichies cliquables (V2.2, "augmenter les interactions") : affiche/mur des
        // affiches/tags favoris/évènement récurrent - voir RetrospectiveView.js pour les
        // data-attributes correspondants posés sur chaque tuile. close() d'abord pour data-event-id
        // (ModalView, z-50, sous la rétrospective z-62 - resterait invisible sinon) ; pas pour
        // data-recurring-title (bucket-detail-overlay, z-63, déjà au-dessus, se pose par-dessus
        // sans avoir besoin de fermer, voir openBucketDetail au-dessus qui fait pareil).
        const eventTile = e.target.closest('[data-event-id]');
        if (eventTile) { close(); openEventById(eventTile.dataset.eventId); return; }
        const recurringTile = e.target.closest('[data-recurring-title]');
        if (recurringTile) { openRetroRecurringDetail(recurringTile.dataset.recurringTitle); return; }
        const tagBtn = e.target.closest('button[data-tag]');
        if (tagBtn) { close(); applyTagSearchFromOverlay(tagBtn.dataset.tag); return; }

        // Carte "Toute l'histoire" (V2.4, "9") : rebascule sur le détail de l'année cliquée.
        const historyCard = e.target.closest('[data-history-year]');
        if (historyCard) {
            currentRetrospectiveYear = Number(historyCard.dataset.historyYear);
            retroShowingHistory = false;
            renderCurrentYear();
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
        if (bar) { e.preventDefault(); openBucketDetail(bar.dataset.bucketKind, bar.dataset.bucketLabel, Number(bar.dataset.bucketIndex)); return; }
        const eventTile = e.target.closest('[data-event-id]');
        if (eventTile) { e.preventDefault(); close(); openEventById(eventTile.dataset.eventId); return; }
        const recurringTile = e.target.closest('[data-recurring-title]');
        if (recurringTile) { e.preventDefault(); openRetroRecurringDetail(recurringTile.dataset.recurringTitle); return; }
        const historyCard = e.target.closest('[data-history-year]');
        if (historyCard) {
            e.preventDefault();
            currentRetrospectiveYear = Number(historyCard.dataset.historyYear);
            retroShowingHistory = false;
            renderCurrentYear();
        }
    });

    const bucketOverlay = document.getElementById('bucket-detail-overlay');
    // Origin-aware (V2.2, voir bucketDetailOrigin) : depuis le Profil organisateur, ce dernier a
    // été explicitement masqué à l'ouverture du détail (z-index non empilable avec bucket-detail,
    // voir openOrganizerWeekdayDetail) et doit donc être explicitement réaffiché ici - depuis la
    // Rétrospective, elle est restée visible en dessous tout du long, rien d'autre à faire.
    const closeBucketDetail = () => {
        bucketOverlay.classList.add('hidden');
        if (bucketDetailOrigin === 'organizer') {
            document.getElementById('organizer-profile-overlay').classList.remove('hidden');
        }
        bucketDetailOrigin = null;
    };
    document.getElementById('btn-close-bucket-detail').addEventListener('click', closeBucketDetail);
    document.getElementById('bucket-detail-breadcrumb').addEventListener('click', (e) => {
        if (e.target.closest('#bucket-detail-breadcrumb-back')) closeBucketDetail();
    });
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

// Lien partageable direct vers un profil organisateur (QOL #13, ?host=<nom>, voir
// openOrganizerProfile) : rouvre son profil au chargement si le paramètre est présent.
function openOrganizerProfileFromUrl() {
    const host = new URLSearchParams(window.location.search).get('host');
    if (host) openOrganizerProfile(host);
}

// Image récap partageable d'un profil organisateur (QOL #12) : dessinée sur un <canvas> (pas de
// dépendance externe façon html2canvas, cohérent avec le reste de l'app qui n'a aucune étape de
// build - voir package.json) puis téléchargée en PNG. Format carré (1080×1080), lisible aussi
// bien en aperçu Discord qu'en story/post réseaux sociaux.
function generateOrganizerRecapImage(hostName, facts) {
    const SIZE = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const FONT = "'Plus Jakarta Sans', sans-serif";

    // Fond : même dégradé que le corps de l'app (voir index.html body { background: radial-gradient(...) }).
    const bgGrad = ctx.createRadialGradient(SIZE / 2, 0, 0, SIZE / 2, 0, SIZE);
    bgGrad.addColorStop(0, '#111827');
    bgGrad.addColorStop(1, '#06080c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // En-tête marque.
    ctx.fillStyle = '#6366f1';
    ctx.font = `800 32px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('2GELOG', 64, 96);
    ctx.fillStyle = '#8b949e';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText('PROFIL ORGANISATEUR', 64, 130);

    // Nom.
    ctx.fillStyle = '#f0f6fc';
    ctx.font = `900 76px ${FONT}`;
    ctx.fillText(hostName, 64, 250, SIZE - 128);

    if (facts.topWeekday) {
        ctx.fillStyle = '#a5b4fc';
        ctx.font = `700 30px ${FONT}`;
        ctx.fillText(`📆 Organise surtout le ${facts.topWeekday === 'Lun' ? 'lundi' : facts.topWeekday}`, 64, 300);
    }

    // Tuiles de stats (2 colonnes x 2 lignes).
    const tiles = [
        { value: String(facts.totalSessions), label: 'SESSIONS ORGANISÉES', color: '#f0f6fc' },
        { value: formatMinutes(facts.totalTime), label: 'TEMPS ANIMÉ CUMULÉ', color: '#818cf8' },
        { value: `${facts.reliabilityPct}%`, label: 'SESSIONS MAINTENUES', color: '#34d399' },
        { value: String(facts.streak), label: "SEMAINES D'AFFILÉE (RECORD)", color: '#f0f6fc' }
    ];
    const tileW = (SIZE - 64 * 2 - 24) / 2;
    const tileH = 190;
    const tileTop = 380;
    tiles.forEach((t, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 64 + col * (tileW + 24);
        const y = tileTop + row * (tileH + 24);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        roundRect(ctx, x, y, tileW, tileH, 24);
        ctx.fill();
        ctx.fillStyle = t.color;
        ctx.font = `900 64px ${FONT}`;
        ctx.fillText(t.value, x + 32, y + 90, tileW - 64);
        ctx.fillStyle = '#8b949e';
        ctx.font = `700 22px ${FONT}`;
        ctx.fillText(t.label, x + 32, y + 130, tileW - 64);
    });

    // Badges débloqués (emojis uniquement, en ligne).
    const achieved = computeBadges(facts).filter(b => b.achieved);
    if (achieved.length > 0) {
        ctx.fillStyle = '#8b949e';
        ctx.font = `700 24px ${FONT}`;
        ctx.fillText('BADGES DÉBLOQUÉS', 64, tileTop + 2 * (tileH + 24) + 40);
        ctx.font = `56px ${FONT}`;
        ctx.fillStyle = '#f0f6fc';
        ctx.fillText(achieved.map(b => b.emoji).join('   '), 64, tileTop + 2 * (tileH + 24) + 110);
    }

    // Pied de page.
    ctx.fillStyle = '#64748b';
    ctx.font = `600 22px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`Généré le ${new Date().toLocaleDateString('fr-FR')} · planning.2gether-asso.fr`, SIZE - 64, SIZE - 48);

    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `profil-${hostName.toLowerCase().replace(/\s+/g, '-')}-2gelog.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, 'image/png');
}

// Image récap partageable de la rétrospective annuelle (V2.3) : même gabarit que
// generateOrganizerRecapImage (voir ci-dessus) - canvas 1080x1080, aucune dépendance externe -
// mais avec les chiffres-clés de l'année entière plutôt que d'un seul organisateur.
function generateRetrospectiveRecapImage(year, facts) {
    const SIZE = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const FONT = "'Plus Jakarta Sans', sans-serif";

    const bgGrad = ctx.createRadialGradient(SIZE / 2, 0, 0, SIZE / 2, 0, SIZE);
    bgGrad.addColorStop(0, '#111827');
    bgGrad.addColorStop(1, '#06080c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = '#6366f1';
    ctx.font = `800 32px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('2GELOG', 64, 96);
    ctx.fillStyle = '#8b949e';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText('RÉTROSPECTIVE ANNUELLE', 64, 130);

    ctx.fillStyle = '#f0f6fc';
    ctx.font = `900 120px ${FONT}`;
    ctx.fillText(String(year), 64, 260);

    if (facts.topHost) {
        ctx.fillStyle = '#a5b4fc';
        ctx.font = `700 30px ${FONT}`;
        ctx.fillText(`👑 Organisateur le plus actif : ${facts.topHost}`, 64, 300);
    }

    const tiles = [
        { value: String(facts.totalSessions), label: 'SESSIONS ORGANISÉES', color: '#f0f6fc' },
        { value: formatDurationLong(facts.totalTime), label: 'TEMPS CUMULÉ', color: '#818cf8' },
        { value: `${facts.reliabilityPct}%`, label: 'SESSIONS MAINTENUES', color: '#34d399' },
        { value: String(facts.distinctHosts), label: 'ORGANISATEURS DIFFÉRENTS', color: '#f0f6fc' }
    ];
    const tileW = (SIZE - 64 * 2 - 24) / 2;
    const tileH = 190;
    const tileTop = 380;
    tiles.forEach((t, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 64 + col * (tileW + 24);
        const y = tileTop + row * (tileH + 24);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        roundRect(ctx, x, y, tileW, tileH, 24);
        ctx.fill();
        ctx.fillStyle = t.color;
        ctx.font = `900 64px ${FONT}`;
        ctx.fillText(t.value, x + 32, y + 90, tileW - 64);
        ctx.fillStyle = '#8b949e';
        ctx.font = `700 22px ${FONT}`;
        ctx.fillText(t.label, x + 32, y + 130, tileW - 64);
    });

    const achieved = computeBadges(facts).filter(b => b.achieved);
    if (achieved.length > 0) {
        ctx.fillStyle = '#8b949e';
        ctx.font = `700 24px ${FONT}`;
        ctx.fillText('BADGES DÉBLOQUÉS', 64, tileTop + 2 * (tileH + 24) + 40);
        ctx.font = `56px ${FONT}`;
        ctx.fillStyle = '#f0f6fc';
        ctx.fillText(achieved.map(b => b.emoji).join('   '), 64, tileTop + 2 * (tileH + 24) + 110);
    }

    ctx.fillStyle = '#64748b';
    ctx.font = `600 22px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`Généré le ${new Date().toLocaleDateString('fr-FR')} · planning.2gether-asso.fr`, SIZE - 64, SIZE - 48);

    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `retrospective-${year}-2gelog.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, 'image/png');
}

/** Rectangle aux coins arrondis, réutilisé par generateOrganizerRecapImage (pas de roundRect natif fiable sur tous les navigateurs ciblés). */
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Image du planning affiché (V2.3, "10", bouton 🖼️ Image de CalendarView.js) : remplace
// l'approche window.print()/@media print initiale (mise en page navigateur - marges, sauts de
// page - trop peu fiable d'un navigateur/OS à l'autre pour un rendu garanti) par un canvas
// dessiné nous-mêmes. Le VRAI rendu dépend de la vue FullCalendar affichée au moment du clic
// (V2.4 - avant ce correctif, un quadrillage mensuel était généré même en vue Planning/Jour, ne
// ressemblant à rien de ce qu'il y avait réellement à l'écran) : Mois/Semaine restent un
// quadrillage (generateGridCalendarImage), Planning/Jour deviennent une vraie liste
// (generateListCalendarImage) qui reprend la mise en page de la vue Planning de FullCalendar.
function generateMonthCalendarImage(calendar) {
    const viewType = calendar.view.type;
    if (viewType === 'listMonth' || viewType === 'timeGridDay') {
        generateListCalendarImage(calendar);
    } else {
        generateGridCalendarImage(calendar);
    }
}

// Fond clair (contrairement aux images récap organisateur/rétrospective) : pensé pour être
// imprimé/partagé tel quel, un fond sombre y gaspillerait de l'encre. `lastFilteredEvents` (pas
// repo.getAll()) : reflète les filtres actuellement actifs, comme les autres exports (.ics...).
function generateGridCalendarImage(calendar) {
    const view = calendar.view;
    const monthStart = view.currentStart;
    const gridStart = view.activeStart;
    const gridEnd = view.activeEnd;
    const monthLabel = monthStart.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const capMonthLabel = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    const days = [];
    for (let d = new Date(gridStart); d < gridEnd; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    const numWeeks = Math.max(1, Math.round(days.length / 7));

    const byDay = {};
    lastFilteredEvents.forEach(e => {
        if (e.isPlanned) return;
        const key = e.start.split('T')[0];
        (byDay[key] = byDay[key] || []).push(e);
    });
    Object.values(byDay).forEach(list => list.sort((a, b) => a.start.localeCompare(b.start)));

    const CELL_W = 240, CELL_H = 190, PAD = 56, HEADER_H = 100, DOW_H = 40;
    const WIDTH = PAD * 2 + 7 * CELL_W;
    const HEIGHT = PAD * 2 + HEADER_H + DOW_H + numWeeks * CELL_H;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    const FONT = "'Plus Jakarta Sans', sans-serif";

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#6366f1';
    ctx.font = `800 24px ${FONT}`;
    ctx.fillText('2GELOG', PAD, PAD + 26);
    ctx.fillStyle = '#14161b';
    ctx.font = `900 42px ${FONT}`;
    ctx.fillText(capMonthLabel, PAD, PAD + 78);

    const dowY = PAD + HEADER_H;
    WEEKDAY_LABELS.forEach((label, i) => {
        ctx.fillStyle = '#8b949e';
        ctx.font = `700 18px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(label.toUpperCase(), PAD + i * CELL_W + CELL_W / 2, dowY + DOW_H - 12);
    });

    const gridTop = dowY + DOW_H;
    const todayStr = DateUtils.toLocalDateStr(new Date());
    const MAX_ROWS = 4;

    days.forEach((day, idx) => {
        const col = idx % 7;
        const row = Math.floor(idx / 7);
        const x = PAD + col * CELL_W;
        const y = gridTop + row * CELL_H;
        const dayStr = DateUtils.toLocalDateStr(day);
        const inMonth = day.getMonth() === monthStart.getMonth();
        const isToday = dayStr === todayStr;

        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, CELL_W, CELL_H);
        if (isToday) {
            ctx.fillStyle = 'rgba(99,102,241,0.08)';
            ctx.fillRect(x, y, CELL_W, CELL_H);
        }

        ctx.textAlign = 'right';
        ctx.fillStyle = inMonth ? (isToday ? '#6366f1' : '#14161b') : '#c3c7cf';
        ctx.font = `800 20px ${FONT}`;
        ctx.fillText(String(day.getDate()), x + CELL_W - 12, y + 26);

        const dayEvents = byDay[dayStr] || [];
        let chipY = y + 42;
        dayEvents.slice(0, MAX_ROWS).forEach(e => {
            ctx.fillStyle = e.col || '#6366f1';
            ctx.fillRect(x + 8, chipY, 4, 18);
            ctx.textAlign = 'left';
            ctx.fillStyle = e.isCanceled ? '#c3c7cf' : '#2a2f3a';
            ctx.font = `${e.isCanceled ? '400' : '600'} 14px ${FONT}`;
            const label = (e.heure ? e.heure + ' ' : '') + e.title;
            let display = label;
            while (ctx.measureText(display).width > CELL_W - 28 && display.length > 3) display = display.slice(0, -2);
            if (display !== label) display += '…';
            ctx.fillText(display, x + 18, chipY + 14);
            chipY += 22;
        });
        if (dayEvents.length > MAX_ROWS) {
            ctx.fillStyle = '#8b949e';
            ctx.font = `700 12px ${FONT}`;
            ctx.textAlign = 'left';
            ctx.fillText(`+${dayEvents.length - MAX_ROWS} de plus`, x + 18, chipY + 10);
        }
    });

    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`Généré le ${new Date().toLocaleDateString('fr-FR')} · planning.2gether-asso.fr`, WIDTH - PAD, HEIGHT - 18);

    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `planning-${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-2gelog.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, 'image/png');
}

// Rendu "Planning"/"Jour" (V2.4) : une vraie liste chronologique (bandeau de jour puis une ligne
// par événement dessous), pas un quadrillage - reprend l'esprit de la vue Planning de
// FullCalendar (.fc-list-day-cushion) plutôt que de forcer un gabarit mensuel qui ne ressemble à
// rien de ce qu'il y a réellement à l'écran dans ces deux vues (voir generateMonthCalendarImage).
function generateListCalendarImage(calendar) {
    const view = calendar.view;
    const gridStart = view.activeStart;
    const gridEnd = view.activeEnd;
    const rawTitle = view.title;
    const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

    const byDay = {};
    lastFilteredEvents.forEach(e => {
        if (e.isPlanned) return;
        const dayStr = e.start.split('T')[0];
        const d = new Date(dayStr + 'T12:00:00');
        if (d < gridStart || d >= gridEnd) return;
        (byDay[dayStr] = byDay[dayStr] || []).push(e);
    });
    const dayKeys = Object.keys(byDay).sort();
    dayKeys.forEach(k => byDay[k].sort((a, b) => a.start.localeCompare(b.start)));

    const PAD = 56, HEADER_H = 100, WIDTH = 900;
    const DAY_HEADER_H = 52, ROW_H = 44, GAP_AFTER_DAY = 16;
    const FONT = "'Plus Jakarta Sans', sans-serif";

    let bodyHeight = 0;
    dayKeys.forEach(k => { bodyHeight += DAY_HEADER_H + byDay[k].length * ROW_H + GAP_AFTER_DAY; });
    const emptyMsgHeight = dayKeys.length === 0 ? 60 : 0;
    const HEIGHT = Math.max(300, PAD * 2 + HEADER_H + bodyHeight + emptyMsgHeight);

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#6366f1';
    ctx.font = `800 24px ${FONT}`;
    ctx.fillText('2GELOG', PAD, PAD + 26);
    ctx.fillStyle = '#14161b';
    ctx.font = `900 34px ${FONT}`;
    ctx.fillText(title, PAD, PAD + 72, WIDTH - PAD * 2);

    let y = PAD + HEADER_H;

    if (dayKeys.length === 0) {
        ctx.fillStyle = '#8b949e';
        ctx.font = `600 18px ${FONT}`;
        ctx.fillText('Aucun événement à afficher avec les filtres actuels.', PAD, y + 30);
    }

    const todayStr = DateUtils.toLocalDateStr(new Date());
    dayKeys.forEach(dayStr => {
        const dateObj = new Date(dayStr + 'T12:00:00');
        const isToday = dayStr === todayStr;
        const dayLabel = dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        const capDayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);

        // Bandeau de jour (même esprit que .fc-list-day-cushion à l'écran : barre colorée à
        // gauche, fond légèrement teinté pour "aujourd'hui").
        ctx.fillStyle = isToday ? 'rgba(99,102,241,0.10)' : 'rgba(15,23,42,0.04)';
        ctx.fillRect(PAD, y, WIDTH - PAD * 2, DAY_HEADER_H - 8);
        ctx.fillStyle = isToday ? '#6366f1' : '#c3c7cf';
        ctx.fillRect(PAD, y, 4, DAY_HEADER_H - 8);
        ctx.fillStyle = isToday ? '#4338ca' : '#14161b';
        ctx.font = `800 18px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(capDayLabel, PAD + 16, y + (DAY_HEADER_H - 8) / 2 + 6);
        y += DAY_HEADER_H;

        byDay[dayStr].forEach(e => {
            ctx.fillStyle = e.col || '#6366f1';
            ctx.fillRect(PAD + 4, y + 8, 4, ROW_H - 20);
            ctx.textAlign = 'left';
            ctx.fillStyle = e.isCanceled ? '#c3c7cf' : '#475569';
            ctx.font = `700 15px ${FONT}`;
            ctx.fillText(e.heure || '', PAD + 20, y + ROW_H / 2 + 5, 70);

            ctx.fillStyle = e.isCanceled ? '#c3c7cf' : '#14161b';
            ctx.font = `${e.isCanceled ? '400' : '600'} 16px ${FONT}`;
            let label = e.title;
            while (ctx.measureText(label).width > WIDTH - PAD * 2 - 100 && label.length > 3) label = label.slice(0, -2);
            if (label !== e.title) label += '…';
            ctx.fillText(label, PAD + 100, y + ROW_H / 2 + 5);
            y += ROW_H;
        });
        y += GAP_AFTER_DAY;
    });

    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`Généré le ${new Date().toLocaleDateString('fr-FR')} · planning.2gether-asso.fr`, WIDTH - PAD, HEIGHT - 18);

    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'planning-liste-2gelog.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, 'image/png');
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
        const [rawRows, fetchedBirthdays] = await Promise.all([
            CSVParser.fetch(CONFIG.CSV_URL),
            fetchBirthdays()
        ]);
        birthdaysList = fetchedBirthdays;
        dataAnomalies = validateRows(rawRows);
        // Badge (V2.2, QOL) : signale des anomalies dans le tableur sans attendre qu'un
        // organisateur pense à ouvrir le Mode Admin par curiosité (voir renderAnomaliesSection).
        const anomalyBadge = document.getElementById('admin-anomaly-badge');
        anomalyBadge.textContent = dataAnomalies.length;
        anomalyBadge.classList.toggle('hidden', dataAnomalies.length === 0);

        repo.clear();
        rawRows.forEach(row => {
            const instances = EventGenerator.generate(row);
            instances.forEach(inst => repo.add(inst));
        });
        computeAndMarkNewEvents(repo.getAll());

        updateTagsFilterBar(repo.getAll());
        renderTypeFilterBar(repo.getAll());
        renderCategoryFilterBar(repo.getAll());
        renderHostFilterBar(repo.getAll());
        // currentViewMode peut déjà valoir 'timeline' au tout premier rendu (défaut mobile, voir
        // sa déclaration plus haut) : sans cet appel ici, le bouton Frise de l'en-tête ne
        // recevrait sa mise en surbrillance "actif" qu'au premier clic, pas dès le chargement.
        applyViewButtonStyles();
        updateUIState();
        updateNextEventBanner();
        checkSubscriptionChanges();
        checkUpcomingNotifications();
        renderActivityHeatmap(document.getElementById('activity-heatmap'), repo.getAll());
        openEventFromUrl();
        openOrganizerProfileFromUrl();
        openLocationProfileFromUrl();
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
// Historique des recherches (QOL #3) : les 8 dernières requêtes non vides, la plus récente en
// tête, dédupliquées (une requête déjà présente remonte en tête plutôt que de créer un doublon).
// Purement local (localStorage), comme les autres préférences de cet appareil.
const SEARCH_HISTORY_KEY = 'ui:searchHistory';
let searchHistory = [];

function loadSearchHistory() {
    try {
        const raw = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
        searchHistory = Array.isArray(raw) ? raw : [];
    } catch {
        searchHistory = [];
    }
}

function pushSearchHistory(query) {
    const trimmed = query.trim();
    if (!trimmed) return;
    searchHistory = [trimmed, ...searchHistory.filter(q => q.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory));
}

// Gestion manuelle de l'historique (V2.2, QOL) : jusque-là seul le repli automatique "8 dernières
// requêtes" existait, sans moyen de retirer une entrée gênante (recherche tapée par erreur) ou de
// tout effacer d'un coup - même logique de reset que btn-hidden-categories pour les catégories masquées.
function removeSearchHistoryItem(query) {
    searchHistory = searchHistory.filter(q => q !== query);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory));
}
function clearSearchHistory() {
    searchHistory = [];
    localStorage.removeItem(SEARCH_HISTORY_KEY);
}

function setupSearchInput() {
    const input = document.getElementById('recherche');
    const clearBtn = document.getElementById('btn-clear-search');
    const icon = document.getElementById('search-icon');
    const suggestions = document.getElementById('search-suggestions');
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

    const hideSuggestions = () => suggestions.classList.add('hidden');
    const renderSuggestions = () => {
        // Vide aussi le contenu (pas seulement masqué) : sans ça, effacer l'historique en cours
        // de session (voir data-clear-history plus bas, V2.2) laissait les anciens boutons morts
        // dans le DOM, invisibles mais toujours là - inoffensif visuellement, mais pas propre.
        if (searchHistory.length === 0) { suggestions.innerHTML = ''; hideSuggestions(); return; }
        suggestions.innerHTML = `
            <div class="flex items-center justify-between px-2 pt-1 pb-1.5">
                <span class="text-3xs font-bold uppercase tracking-wider text-slate-500">🕓 Recherches récentes</span>
                <button data-clear-history class="text-3xs font-bold text-slate-500 hover:text-rose-300 transition-colors">Effacer</button>
            </div>
            ${searchHistory.map(q => `
                <div class="flex items-center group">
                    <button data-query="${escapeHtml(q)}" class="flex-1 min-w-0 text-left text-xs text-slate-300 hover:text-white hover:bg-white/5 px-2 py-1.5 rounded-lg truncate transition-all">${escapeHtml(q)}</button>
                    <button data-remove-query="${escapeHtml(q)}" title="Retirer cette recherche" aria-label="Retirer cette recherche" class="shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-rose-300 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all">${Icons.x('w-3 h-3 shrink-0')}</button>
                </div>
            `).join('')}
        `;
        suggestions.classList.remove('hidden');
    };

    input.addEventListener('input', (e) => {
        toggleClearBtn(e.target.value.length > 0);
        hideSuggestions();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => applyQuery(e.target.value), 200);
    });

    input.addEventListener('focus', () => {
        if (!input.value) renderSuggestions();
    });
    // Délai avant de masquer : sans lui, le blur (déclenché par le mousedown sur une
    // suggestion) masquerait la liste AVANT que son propre clic n'ait pu être traité.
    input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

    suggestions.addEventListener('click', (e) => {
        const clearHistoryBtn = e.target.closest('button[data-clear-history]');
        if (clearHistoryBtn) { clearSearchHistory(); renderSuggestions(); return; }
        const removeBtn = e.target.closest('button[data-remove-query]');
        if (removeBtn) { removeSearchHistoryItem(removeBtn.dataset.removeQuery); renderSuggestions(); return; }
        const btn = e.target.closest('button[data-query]');
        if (!btn) return;
        input.value = btn.dataset.query;
        toggleClearBtn(true);
        applyQuery(btn.dataset.query);
        pushSearchHistory(btn.dataset.query);
        hideSuggestions();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            pushSearchHistory(input.value);
            hideSuggestions();
        }
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

// Halo qui suit le curseur au survol d'une carte (V2.2, voir .glass-card::before dans index.html) :
// UN SEUL écouteur mousemove délégué sur tout le document plutôt qu'un par carte (des dizaines à
// des centaines de cartes existent selon la vue) - throttlé via requestAnimationFrame pour ne
// jamais poser plus d'une mise à jour de style par frame, même si mousemove se déclenche plus
// souvent que ça. Ignore lui-même le tactile (aucun mousemove n'y est émis de toute façon), la
// media query (hover:hover) dans le CSS s'occupe déjà d'exclure visuellement ce cas.
function setupCardCursorGlow() {
    let pendingEvent = null;
    let rafScheduled = false;

    const apply = () => {
        rafScheduled = false;
        const card = pendingEvent.target.closest('.glass-card');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', `${pendingEvent.clientX - rect.left}px`);
        card.style.setProperty('--mouse-y', `${pendingEvent.clientY - rect.top}px`);
    };

    document.addEventListener('mousemove', (e) => {
        pendingEvent = e;
        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(apply);
        }
    });
}

// Raccourcis clavier supplémentaires (QOL #20), en plus de "/" (recherche, voir
// setupSearchInput) et Échap (voir setupEscapeToClose) : T pour aujourd'hui, F/C pour Frise/Carte
// (V2.2, cohérence : T avait son raccourci mais pas ses deux voisins du même groupe de boutons
// d'en-tête), ←/→ pour naviguer dans le calendrier - toujours désactivés pendant la frappe dans
// un champ, et les flèches seulement quand le calendrier est bien la vue affichée (pas en
// recherche/Frise/Carte, où elles n'auraient aucun sens et pourraient surprendre en cas de focus
// resté sur la page).
function setupExtraKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

        if (e.key === 't' || e.key === 'T') {
            e.preventDefault();
            goToTodayView();
            return;
        }
        if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            document.getElementById('btn-toggle-timeline').click();
            return;
        }
        if (e.key === 'c' || e.key === 'C') {
            e.preventDefault();
            document.getElementById('btn-toggle-map').click();
            return;
        }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (!calendarInstance || currentViewMode !== 'calendar' || currentSearchQuery) return;
        e.preventDefault();
        if (e.key === 'ArrowLeft') CalendarView.goPrev(calendarInstance); else CalendarView.goNext(calendarInstance);
    });
}

// Ferme la modale/popup au premier plan avec Échap (celles qui n'ont qu'un clic en dehors
// ou un bouton dédié jusqu'ici) : geste attendu par réflexe sur la plupart des sites.
function setupEscapeToClose() {
    const overlayCloseButtons = [
        ['patchnotes-overlay', 'btn-close-patchnotes'],
        ['help-overlay', 'btn-close-help'],
        ['reminders-overlay', 'btn-close-reminders'],
        ['poll-overlay', 'btn-close-poll'],
        ['bucket-detail-overlay', 'btn-close-bucket-detail'],
        ['organizer-profile-overlay', 'btn-close-organizer-profile'],
        ['location-profile-overlay', 'btn-close-location-profile'],
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
        setupThemeToggle();

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
        // Un lien partagé (voir buildFiltersShareUrl) prime sur les filtres restaurés du
        // localStorage - même logique que ?today=1 ci-dessous : intention explicite de la
        // personne qui vient de cliquer ce lien précis.
        applyFiltersFromUrl();
        loadHiddenCategories();
        loadSavedViews();
        renderSavedViewsSelect();
        loadSearchHistory();
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
        }, () => updateUIState(), (host) => openOrganizerProfile(host), () => repo.getAll());

        // Délégation de clic sur la sidebar "Prochainement" : ouvre la modale
        // avec l'objet événement complet (pas de lookup global requis).
        document.getElementById('upcoming-list').addEventListener('click', (e) => {
            const card = e.target.closest('[data-idx]');
            if (!card) return;
            const ev = upcomingEventsCache[Number(card.dataset.idx)];
            if (ev) ModalView.open(ev);
        });

        // Idem pour le widget "Semaine prochaine" (V2.3, "16").
        document.getElementById('nextweek-list').addEventListener('click', (e) => {
            const card = e.target.closest('[data-idx]');
            if (!card) return;
            const ev = nextWeekEventsCache[Number(card.dataset.idx)];
            if (ev) ModalView.open(ev);
        });

        // Idem pour le listing complet affiché lors d'une recherche.
        document.getElementById('search-results').addEventListener('click', (e) => {
            const orderToggle = e.target.closest('[data-search-order-toggle]');
            if (orderToggle) {
                searchResultsSortOrder = searchResultsSortOrder === 'asc' ? 'desc' : 'asc';
                updateUIState();
                return;
            }
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
            // Bouton persistant "Aujourd'hui" (V2.2, QOL) : re-scroll jusqu'au repère sans
            // attendre le seul auto-scroll à l'ouverture de la Frise (voir justOpened plus bas).
            if (e.target.closest('[data-timeline-scroll-today]')) {
                document.getElementById('timeline-today-marker')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                return;
            }
            // Rail de navigation rapide mois/année (V2.4) - voir renderMonthRail dans
            // TimelineView.js. Un mois désactivé (sans id="timeline-month-N" dans le DOM, pas
            // d'événement cette année-là) ne matche simplement aucun élément ici.
            const monthJump = e.target.closest('[data-timeline-jump-month]');
            if (monthJump) {
                document.getElementById(`timeline-month-${monthJump.dataset.timelineJumpMonth}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                return;
            }
            const yearBtn = e.target.closest('[data-timeline-year]');
            if (yearBtn) {
                timelineYear = Number(yearBtn.dataset.timelineYear);
                updateUIState();
                return;
            }
            const card = e.target.closest('[data-idx]');
            if (!card) return;
            const ev = timelineCache[Number(card.dataset.idx)];
            if (ev) ModalView.open(ev);
        });

        // Idem pour la vue "Aujourd'hui" (voir TodayView.js).
        document.getElementById('today-view').addEventListener('click', (e) => {
            const card = e.target.closest('[data-idx]');
            if (card) { const ev = todayViewCache[Number(card.dataset.idx)]; if (ev) ModalView.open(ev); return; }
            // "Il y a un an, ce jour-là" (V2.3, "14") : ces tuiles ne font pas partie de
            // todayViewCache (voir TodayView.js) - identifiées par data-event-id, pas data-idx.
            const yearAgoCard = e.target.closest('[data-event-id]');
            if (yearAgoCard) openEventById(yearAgoCard.dataset.eventId);
        });

        // Bascule Calendrier <-> Frise/Carte : la recherche (isSearching) prime toujours sur ce
        // choix, voir updateUIState(). Un seul bouton actif à la fois (retour au calendrier si
        // on reclique le bouton déjà actif, ou si on active l'autre vue).
        const timelineBtn = document.getElementById('btn-toggle-timeline');
        const mapBtn = document.getElementById('btn-toggle-map');
        timelineBtn.addEventListener('click', () => {
            const opening = currentViewMode !== 'timeline';
            currentViewMode = opening ? 'timeline' : 'calendar';
            // Recommence toujours sur l'année en cours à l'ouverture (pas seulement la toute
            // première fois de la session) : "commence par défaut par aujourd'hui" doit rester
            // vrai à chaque fois qu'on ouvre la Frise, même après être resté sur une année
            // passée lors d'une visite précédente de cette vue.
            if (opening) timelineYear = new Date().getFullYear();
            applyViewButtonStyles();
            updateUIState();
        });
        mapBtn.addEventListener('click', () => {
            currentViewMode = currentViewMode === 'map' ? 'calendar' : 'map';
            applyViewButtonStyles();
            if (currentViewMode === 'map') {
                const map = initMeetupMap('meetup-map');
                // Le conteneur est encore caché (display:none) à ce stade - Leaflet mesurerait une
                // boîte à 0px s'il fallait attendre updateUIState() plus bas pour le révéler (V2.2,
                // bug corrigé après retour : le cadrage automatique fitBounds du tout premier
                // affichage, calculé par updateMeetupMap DANS updateUIState juste après, se basait
                // alors sur cette taille à 0px et produisait un cadrage aberrant - un
                // invalidateSize() différé de 50ms ne le rattrapait pas, puisqu'il ne fait que
                // corriger la taille, jamais refaire le fitBounds lui-même). Révélé et mesuré ICI,
                // avant tout calcul de cadrage, pour que updateMeetupMap parte d'une taille correcte.
                document.getElementById('map-view').classList.remove('hidden');
                map.invalidateSize();
            }
            updateUIState();
        });

        // Vue Année (V2.4, "5") - même bascule que Frise/Carte/Aujourd'hui ci-dessus.
        const yearBtn = document.getElementById('btn-toggle-year');
        yearBtn.addEventListener('click', () => {
            currentViewMode = currentViewMode === 'year' ? 'calendar' : 'year';
            // Reparle toujours de l'année en cours à l'ouverture (même logique que timelineYear
            // pour la Frise) : "commence par défaut par aujourd'hui" doit rester vrai même après
            // être resté sur une autre année lors d'une visite précédente de cette vue.
            if (currentViewMode === 'year') yearViewYear = new Date().getFullYear();
            applyViewButtonStyles();
            updateUIState();
        });
        document.getElementById('year-view').addEventListener('click', (e) => {
            if (e.target.closest('#year-view-prev')) { yearViewYear--; renderYearView(document.getElementById('year-view'), lastFilteredEvents, yearViewYear); return; }
            if (e.target.closest('#year-view-next')) { yearViewYear++; renderYearView(document.getElementById('year-view'), lastFilteredEvents, yearViewYear); return; }
            const dateBtn = e.target.closest('button[data-year-date]');
            if (dateBtn) jumpToDate(dateBtn.dataset.yearDate);
        });

        document.getElementById('btn-goto-today').addEventListener('click', goToTodayView);

        // "Retour au calendrier" (V2.4) - voir applyViewButtonStyles pour l'affichage/masquage.
        document.getElementById('btn-close-secondary-view').addEventListener('click', () => {
            currentViewMode = 'calendar';
            applyViewButtonStyles();
            updateUIState();
        });

        setupDensityToggle();
        setupLargeTextToggle();
        setupMapRadiusFilter();

        setupSidebarToggle();
        setupStatsToggle();
        setupUpcomingToggle();
        setupNextWeekToggle();
        setupFiltersSidebarToggle();
        setupAdminToolsMenu();
        setupAdminMode();
        setupRetrospective();
        setupOrganizerProfile();
        setupLocationProfile();
        setupOnboardingTour();
        setupPatchNotes();
        setupHelpOverlay();
        setupEscapeToClose();
        setupExtraKeyboardShortcuts();
        setupCardCursorGlow();
        setupRemindersOverlay();
        setupPoll();
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
            // Toast (V2.2, QOL - cohérence avec btn-subscribe-ics/btn-export-discord qui
            // confirment déjà leur action) : sans ça, rien à l'écran ne confirmait que le
            // téléchargement avait bien démarré.
            showToast(`Fichier .ics téléchargé (${lastFilteredEvents.length} événement${lastFilteredEvents.length > 1 ? 's' : ''})`, { icon: Icons.calendarPlus('w-3.5 h-3.5 shrink-0 text-indigo-300') });
        });

        // Lien d'abonnement (webcal://) vers le flux régénéré en continu par la CI (voir
        // scripts/generate-ics.js) : à la différence du bouton 📅 .ics ci-dessus (un instantané
        // ponctuel à réimporter à la main), ce lien ne se copie qu'une fois dans l'appli
        // calendrier de l'utilisateur, qui se resynchronise ensuite tout seul.
        document.getElementById('btn-subscribe-ics').addEventListener('click', async () => {
            const webcalUrl = CONFIG.SITE_URL.replace(/^https?:\/\//, 'webcal://') + 'ics/planning.ics';
            try {
                await navigator.clipboard.writeText(webcalUrl);
                showToast("Lien d'abonnement copié !", { icon: Icons.rss('w-3.5 h-3.5 shrink-0 text-indigo-300') });
            } catch {
                window.prompt("Copiez ce lien d'abonnement dans votre appli calendrier :", webcalUrl);
            }
        });

        document.getElementById('btn-export-discord').addEventListener('click', async () => {
            const copied = await DiscordExporter.copyToClipboard(repo.getAll());
            if (copied) showToast('Message copié !', { icon: Icons.messageCircle('w-3.5 h-3.5 shrink-0 text-indigo-300') });
        });

        // CalendarView pilote entièrement l'instance FullCalendar (rendu + clic).
        calendarInstance = CalendarView.create('calendar', (ev) => ModalView.open(ev), (cal) => generateMonthCalendarImage(cal));
        calendarInstance.render();

        setupSearchInput();
        setupDateRangeFilter();
        setupSavedViews();
        setupMiniCalendar();
        setupActivityHeatmapJump();

        document.getElementById('filter-categories-container').addEventListener('click', (e) => {
            const hideBtn = e.target.closest('button[data-hide-cat]');
            if (hideBtn) {
                const cat = hideBtn.dataset.hideCat;
                if (hiddenCategories.has(cat)) hiddenCategories.delete(cat); else hiddenCategories.add(cat);
                // Une catégorie qu'on vient de masquer ne doit pas rester le filtre actif affiché
                // (sinon le calendrier se retrouve filtré sur une catégorie qu'on vient de dire
                // vouloir ne plus jamais voir) - repli sur "Tous".
                if (currentCategory === cat && hiddenCategories.has(cat)) currentCategory = 'all';
                saveHiddenCategories();
                renderCategoryFilterBar(repo.getAll());
                saveFiltersToStorage();
                updateUIState();
                return;
            }
            const btn = e.target.closest('button[data-cat]');
            if (!btn) return;
            // Reclique sur la catégorie déjà active -> repli sur "Tous" (V2.2, cohérence avec
            // types/tags/organisateurs qui basculent tous de la même façon sur un second clic) :
            // avant, seul le bouton "Tous" permettait de désactiver un filtre de catégorie.
            const cat = btn.dataset.cat;
            currentCategory = (currentCategory === cat && cat !== 'all') ? 'all' : cat;
            setActiveCategoryButton(document.querySelector(`#filter-categories-container button[data-cat="${currentCategory === 'all' ? 'all' : CSS.escape(currentCategory)}"]`));
            saveFiltersToStorage();
            updateUIState();
        });

        document.getElementById('btn-hidden-categories').addEventListener('click', () => {
            hiddenCategories.clear();
            saveHiddenCategories();
            renderCategoryFilterBar(repo.getAll());
            updateUIState();
        });

        document.getElementById('filter-types-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const type = btn.dataset.type;
            currentTypeFilter = (currentTypeFilter === type || type === "") ? null : type;
            renderTypeFilterBar(repo.getAll());
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

        document.getElementById('filter-hosts-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-host]');
            if (!btn) return;
            const host = btn.dataset.host;
            currentHostFilter = (currentHostFilter === host) ? null : host;
            renderHostFilterBar(repo.getAll());
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
