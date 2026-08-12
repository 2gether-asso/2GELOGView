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
import { initMeetupMap, updateMeetupMap, groupEventsByCity, cityLabel } from './ui/MeetupMapView.js';
import { renderAdminView } from './ui/AdminView.js';
import { StatsService } from './services/StatsService.js';
import { SearchEngine } from './services/SearchEngine.js';
import { IcsExporter } from './services/IcsExporter.js';
import { DiscordExporter } from './services/DiscordExporter.js';
import { renderActivityHeatmap } from './ui/ActivityHeatmap.js';
import { DateUtils } from './utils/DateUtils.js';
import { escapeHtml, sanitizeUrl } from './utils/Html.js';
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
import { Icons } from './ui/Icons.js';

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
let searchResultsCache = [];
let timelineCache = [];
let todayViewCache = [];
// Sens d'affichage et année affichée de la vue Frise, modifiables via leurs propres contrôles
// (voir TimelineView.js data-timeline-order-toggle / data-timeline-year) - indépendants du
// reste des filtres.
let timelineSortOrder = 'asc'; // 'asc' | 'desc'
let timelineYear = new Date().getFullYear();
// La recherche (isSearching) prime toujours sur ce mode : basculer en Frise/Carte/Aujourd'hui
// n'empêche pas de chercher, ça change juste ce qui s'affiche quand la recherche est vide.
// Sur mobile, la grille du calendrier (Mois) est étroite et peu confortable au doigt : la Frise
// (liste verticale, scroll naturel) est un bien meilleur point d'entrée par défaut - inline plutôt
// que via isMobileWidth() (définie plus bas dans le fichier, pas encore accessible ici vu l'ordre
// d'exécution des `let`/`const` de haut en bas).
let currentViewMode = window.matchMedia('(max-width: 639px)').matches ? 'timeline' : 'calendar'; // 'calendar' | 'timeline' | 'map' | 'today'
// Dernière vue principale réellement affichée (voir updateUIState) : sert uniquement à savoir
// si la vue affichée à CET appel diffère du précédent, pour ne jouer l'animation .view-fade-in
// (V2.5, voir index.html) que lors d'une vraie bascule de vue, pas à chaque filtre/recherche.
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
function renderCategoryFilterBar() {
    const container = document.getElementById('filter-categories-container');
    const categories = [...new Set(
        Object.entries(CONFIG.THEMES).filter(([name]) => name !== 'default').map(([, theme]) => theme.cat)
    )];

    const allBtn = `<button data-cat="all" class="${!currentCategory || currentCategory === 'all' ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE}">Tous</button>`;
    const catBtns = categories.map(cat => {
        const isHidden = hiddenCategories.has(cat);
        const label = escapeHtml(formatCategoryLabel(cat));
        return `
            <span class="inline-flex items-center gap-0.5 ${isHidden ? 'opacity-40' : ''}">
                <button data-cat="${escapeHtml(cat)}" class="${currentCategory === cat ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE} ${isHidden ? 'line-through' : ''}">${label}</button>
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
        container.innerHTML = `<span class="text-[11px] text-slate-600 italic">Aucun organisateur</span>`;
        return;
    }

    container.innerHTML = sorted.map(([host, count]) => {
        const isSelected = currentHostFilter === host;
        const safeHost = escapeHtml(host);
        return `<button data-host="${safeHost}" class="px-3 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-all ${isSelected ? 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white hover:bg-white/10'}">${safeHost} <span class="text-[9px] opacity-70 ml-0.5">(${count})</span></button>`;
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
        renderTypeFilterBar();
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
}

// Mini-calendrier (QOL #16) : intégré en permanence en haut de la sidebar Statistiques (V2.5,
// remplace l'ancien popover ouvert depuis "Aller à une date..." dans la sidebar Filtres) - un
// coup d'oeil suffit pour voir le mois entier ET sauter directement à une date précise, plus
// rapide que d'enchaîner les boutons prev/next de FullCalendar quand la cible est éloignée (ex:
// dans 3 mois). Pure navigation (comme prev/next), ne touche à aucun filtre - juste la date
// affichée par le calendrier.
let miniCalendarDate = new Date();

/**
 * Pour un mois donné : quels jours ont au moins un événement (pastille), et pour lesquels
 * peut-on afficher en fond la vignette d'un de ses événements (@image de l'événement, ou celle
 * par défaut du type - voir sanitizeUrl/getIconSrc) ? Toujours calculé sur TOUT le dépôt
 * (repo.getAll(), pas les événements filtrés) : comme "Aujourd'hui" ou le bandeau "Prochain
 * événement", ce calendrier reste une photo fidèle du programme réel, pas de ce qui est
 * actuellement filtré ailleurs dans l'appli - annuler un filtre ne doit pas faire "apparaître"
 * des pastilles qui semblaient absentes.
 * @param {number} year
 * @param {number} month - 0-11
 * @param {Array<Object>} events
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
        <button data-minical-date="${dateStr}"${bgAttr} aria-label="${day}" class="relative aspect-square w-full rounded-md text-[11px] font-bold transition-all overflow-hidden bg-cover bg-center ${todayRing} ${colorClasses}">
            ${imageUrl ? '<span class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" aria-hidden="true"></span>' : ''}
            <span class="relative z-10">${day}</span>
            ${hasEvent && !imageUrl ? '<span class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-400" aria-hidden="true"></span>' : ''}
        </button>`;
}

function renderMiniCalendar() {
    const container = document.getElementById('sidebar-minical');
    if (!container) return;
    const year = miniCalendarDate.getFullYear();
    const month = miniCalendarDate.getMonth();
    const monthLabel = miniCalendarDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // 0 = Lundi
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = DateUtils.toLocalDateStr(new Date());
    const { hasEvent, images } = computeMiniCalendarDayInfo(year, month, repo.getAll());

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
                <span class="text-[11px] font-bold text-slate-200 capitalize">${monthLabel}</span>
                <button id="minical-next" aria-label="Mois suivant" class="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition-all">${Icons.chevronRight('w-3.5 h-3.5')}</button>
            </div>
            <div class="grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-slate-500 mb-1.5">
                ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span>${d}</span>`).join('')}
            </div>
            <div class="grid grid-cols-7 gap-1">${cells}</div>
        </div>
    `;
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
        const dateStr = dateBtn.dataset.minicalDate;

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
        // Même pastille animée que sur les cartes (isGenuinelyLive/renderLiveDot) plutôt qu'un
        // emoji 🔴 statique, pour une cohérence visuelle "live" à travers toute l'app.
        icon.innerHTML = `<span class="relative flex h-2.5 w-2.5" aria-hidden="true"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span><span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span></span>`;
        text.innerHTML = `<b>En direct :</b> ${escapeHtml(result.event.title)}${result.event.heure ? ' · depuis ' + escapeHtml(result.event.heure) : ''}`;
    } else {
        icon.innerHTML = Icons.clock('w-3.5 h-3.5');
        text.innerHTML = `<b>Prochain :</b> ${escapeHtml(result.event.title)} — ${formatCountdown(new Date(result.event.start))}`;
    }
}

// Reflète currentViewMode sur les boutons Frise/Carte (surbrillance du mode actif) - factorisé
// pour être appelable aussi bien depuis leurs propres clics que depuis goHome() (retour logo).
function applyViewButtonStyles() {
    const timelineBtn = document.getElementById('btn-toggle-timeline');
    const mapBtn = document.getElementById('btn-toggle-map');
    const todayBtn = document.getElementById('btn-goto-today');
    [[timelineBtn, 'timeline'], [mapBtn, 'map'], [todayBtn, 'today']].forEach(([btn, mode]) => {
        const active = currentViewMode === mode;
        btn.classList.toggle('bg-indigo-500/10', active);
        btn.classList.toggle('border-indigo-500/20', active);
        btn.classList.toggle('text-indigo-300', active);
    });
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
    renderTypeFilterBar();
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
    const isSearching = currentSearchQuery.trim().length > 0;

    // Cinq vues mutuellement exclusives sur la même sélection filtrée : la recherche prime
    // toujours sur Frise/Carte/Aujourd'hui (voir currentViewMode plus haut), qui priment sur le
    // calendrier.
    calendarEl.classList.add('hidden');
    searchResultsEl.classList.add('hidden');
    timelineEl.classList.add('hidden');
    mapEl.classList.add('hidden');
    todayEl.classList.add('hidden');

    if (isSearching) {
        filtered = SearchEngine.search(filtered, { query: currentSearchQuery });
        searchResultsCache = [...filtered].sort((a, b) => a.start.localeCompare(b.start));
        searchResultsEl.classList.remove('hidden');
        renderSearchResults(searchResultsEl, searchResultsCache);
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
        timelineCache = renderTimeline(timelineEl, filtered, timelineSortOrder, timelineYear, justOpened);
    } else if (currentViewMode === 'map') {
        mapEl.classList.remove('hidden');
        updateMeetupMap(filtered, (ev) => ModalView.open(ev), (cityKey) => openLocationProfile(cityKey));
    } else if (currentViewMode === 'today') {
        todayEl.classList.remove('hidden');
        todayViewCache = renderTodayView(todayEl, eventsForToday);
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
    // Indépendant des filtres (voir computeMiniCalendarDayInfo) : se rafraîchit ici simplement
    // pour rester à jour à chaque rechargement des données, comme le reste de la sidebar.
    renderMiniCalendar();
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
// l'essentiel (heatmap d'activité + Prochainement), sans les cartes de stats qui prennent
// le plus de hauteur.
function setupStatsToggle() {
    const content = document.getElementById('stats-content');
    const btnToggle = document.getElementById('btn-toggle-stats');
    const chevron = document.getElementById('stats-chevron');

    const panelCtrl = createCollapsiblePanel('ui:statsCollapsed', (collapsed) => {
        content.classList.toggle('hidden', collapsed);
        // Rotation CSS (-90deg) plutôt qu'un second glyphe ▸ : un seul SVG qui pivote en douceur
        // (transition déjà posée dans index.html) au lieu d'un changement de caractère instantané.
        chevron.classList.toggle('-rotate-90', collapsed);
        btnToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    btnToggle.addEventListener('click', () => {
        panelCtrl.toggle(content.classList.contains('hidden'));
    });
}

// Panneau "Prochainement" repliable (V2.5) : même mécanique que setupStatsToggle juste au-dessus -
// utile une fois qu'on a déjà repéré ce qui vient, pour laisser plus de place au mini-calendrier/
// aux stats sans avoir à tout refermer d'un coup via #btn-toggle-sidebar.
function setupUpcomingToggle() {
    const content = document.getElementById('upcoming-content');
    const btnToggle = document.getElementById('btn-toggle-upcoming');
    const chevron = document.getElementById('upcoming-chevron');

    const panelCtrl = createCollapsiblePanel('ui:upcomingCollapsed', (collapsed) => {
        content.classList.toggle('hidden', collapsed);
        chevron.classList.toggle('-rotate-90', collapsed);
        btnToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    btnToggle.addEventListener('click', () => {
        panelCtrl.toggle(content.classList.contains('hidden'));
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
        overlay.classList.remove('flex');
        localStorage.setItem('patchnotes:seenVersion', PATCH_NOTES.version);
    };

    document.getElementById('btn-close-patchnotes').addEventListener('click', close);
    document.getElementById('btn-dismiss-patchnotes').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    if (localStorage.getItem('patchnotes:seenVersion') !== PATCH_NOTES.version) {
        // classList.add('flex') en plus de remove('hidden') : sans ça, l'overlay retombe en
        // display:block par défaut (aucune classe flex/grid statique) et "items-center
        // justify-center" n'a plus aucun effet - la carte se retrouve collée en haut à gauche
        // au lieu d'être centrée (même mécanique que reminders-overlay/help-overlay).
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
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
    btn.className = `shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${enabled ? 'bg-indigo-600/80 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`;
}

function updateDailyDigestButton() {
    const btn = document.getElementById('btn-toggle-daily-digest');
    const enabled = hasNotificationPermission() && localStorage.getItem(DAILY_DIGEST_ENABLED_KEY) === '1';
    btn.innerHTML = `<span class="inline-flex items-center gap-1.5">${enabled ? Icons.bell('w-3.5 h-3.5 shrink-0') : Icons.bellOff('w-3.5 h-3.5 shrink-0')}${enabled ? 'Activé' : 'Désactivé'}</span>`;
    btn.setAttribute('aria-pressed', String(enabled));
    btn.className = `shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${enabled ? 'bg-indigo-600/80 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'}`;
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
}

// Panneau "Suivis individuellement" (abonnements ReminderService, par titre) : affiche la
// prochaine occurrence connue de chaque titre suivi, avec un bouton pour se désabonner.
function renderRemindersList() {
    const container = document.getElementById('reminders-list');
    const reminders = ReminderService.getAll();

    if (reminders.length === 0) {
        container.innerHTML = `<div class="text-[11px] text-slate-600 italic">Aucun événement suivi individuellement pour l'instant. Ouvrez-en un et cliquez sur "M'envoyer un rappel".</div>`;
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
    const leadSelect = document.getElementById('reminder-lead-select');
    const open = () => {
        updateBlanketReminderButton();
        updateDailyDigestButton();
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

// Menu déroulant "⋯" regroupant les outils d'organisateur (V2.5, voir #admin-tools-menu dans
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

    document.getElementById('organizer-profile-title').innerHTML = `<span class="inline-flex items-center gap-2">${Icons.user('w-4 h-4 shrink-0 text-slate-400')}<span class="capitalize">${escapeHtml(hostName)}</span></span>`;
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
        ${isTopHostThisYear ? `<div class="inline-flex items-center gap-1.5 w-full justify-center text-xs font-bold text-amber-300 mb-3">${Icons.crown('w-3.5 h-3.5 shrink-0')}MVP de ${currentYear}</div>` : ''}
        ${renderBadgeShelf(computeBadges(facts))}
    `;

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
    document.getElementById('btn-organizer-copy-link').addEventListener('click', async (e) => {
        if (!currentOrganizerHostName) return;
        const url = new URL(window.location.href);
        url.searchParams.set('host', currentOrganizerHostName);
        const btn = e.currentTarget;
        try {
            await navigator.clipboard.writeText(url.href);
            const original = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => { btn.innerHTML = original; }, 1500);
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
 * Fiche d'un lieu de meetup IRL (vue Carte, refonte V2.5) : résumé + sessions à venir + tout
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
                <div class="text-xl font-black text-white">${cityEvents.length}</div>
                <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">Sessions au total</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div class="text-xl font-black text-indigo-400">${upcoming.length}</div>
                <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">À venir</div>
            </div>
            <div class="glass-panel rounded-xl p-3 text-center">
                <div class="text-xl font-black text-white">${first ? new Date(first.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}</div>
                <div class="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">Premier meetup ici</div>
            </div>
        </div>
    `;

    const upcomingSection = document.getElementById('location-profile-upcoming-section');
    upcomingSection.classList.toggle('hidden', upcoming.length === 0);
    document.getElementById('location-profile-upcoming').innerHTML = upcoming.map((e, idx) => {
        const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return `<div class="cursor-pointer" data-upcoming-idx="${idx}">${renderEventCard(e, readableDate)}</div>`;
    }).join('');

    const historyContent = document.getElementById('location-profile-content');
    historyContent.innerHTML = history.length > 0
        ? history.map((e, idx) => {
            const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return `<div class="cursor-pointer" data-history-idx="${idx}">${renderEventCard(e, readableDate)}</div>`;
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
    document.getElementById('btn-location-copy-link').addEventListener('click', async (e) => {
        if (!currentLocationKey) return;
        const url = new URL(window.location.href);
        url.searchParams.set('lieu', currentLocationKey);
        const btn = e.currentTarget;
        try {
            await navigator.clipboard.writeText(url.href);
            const original = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => { btn.innerHTML = original; }, 1500);
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
        renderHostFilterBar(repo.getAll());
        // currentViewMode peut déjà valoir 'timeline' au tout premier rendu (défaut mobile, voir
        // sa déclaration plus haut) : sans cet appel ici, le bouton Frise de l'en-tête ne
        // recevrait sa mise en surbrillance "actif" qu'au premier clic, pas dès le chargement.
        applyViewButtonStyles();
        updateUIState();
        updateNextEventBanner();
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
        if (searchHistory.length === 0) { hideSuggestions(); return; }
        suggestions.innerHTML = `
            <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-2 pt-1 pb-1.5">🕓 Recherches récentes</div>
            ${searchHistory.map(q => `<button data-query="${escapeHtml(q)}" class="w-full text-left text-xs text-slate-300 hover:text-white hover:bg-white/5 px-2 py-1.5 rounded-lg truncate transition-all">${escapeHtml(q)}</button>`).join('')}
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

// Raccourcis clavier supplémentaires (QOL #20), en plus de "/" (recherche, voir
// setupSearchInput) et Échap (voir setupEscapeToClose) : T pour aujourd'hui, ←/→ pour
// naviguer dans le calendrier - toujours désactivés pendant la frappe dans un champ, et les
// flèches seulement quand le calendrier est bien la vue affichée (pas en recherche/Frise/Carte,
// où elles n'auraient aucun sens et pourraient surprendre en cas de focus resté sur la page).
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
            if (!card) return;
            const ev = todayViewCache[Number(card.dataset.idx)];
            if (ev) ModalView.open(ev);
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
                // Le conteneur était caché (display:none) lors de l'init : Leaflet a calculé sa
                // taille sur une boîte à 0px, invalidateSize() la recalcule maintenant qu'elle
                // est visible (sinon la carte reste tronquée/mal centrée tant qu'on ne zoome pas).
                setTimeout(() => map.invalidateSize(), 50);
            }
            updateUIState();
        });

        document.getElementById('btn-goto-today').addEventListener('click', goToTodayView);
        setupDensityToggle();

        setupSidebarToggle();
        setupStatsToggle();
        setupUpcomingToggle();
        setupFiltersSidebarToggle();
        setupAdminToolsMenu();
        setupAdminMode();
        setupRetrospective();
        setupOrganizerProfile();
        setupLocationProfile();
        setupPatchNotes();
        setupHelpOverlay();
        setupEscapeToClose();
        setupExtraKeyboardShortcuts();
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
        setupSavedViews();
        setupMiniCalendar();

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
                renderCategoryFilterBar();
                saveFiltersToStorage();
                updateUIState();
                return;
            }
            const btn = e.target.closest('button[data-cat]');
            if (!btn) return;
            setActiveCategoryButton(btn);
            currentCategory = btn.dataset.cat;
            saveFiltersToStorage();
            updateUIState();
        });

        document.getElementById('btn-hidden-categories').addEventListener('click', () => {
            hiddenCategories.clear();
            saveHiddenCategories();
            renderCategoryFilterBar();
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
