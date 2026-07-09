import { CONFIG } from './config.js';
import { CSVParser } from './parsers/CSVParser.js';
import { EventGenerator } from './services/EventGenerator.js';
import { EventRepository } from './repositories/EventRepository.js';
import { CalendarView } from './ui/CalendarView.js';
import { ModalView } from './ui/ModalView.js';
import { renderEventCard, isGenuinelyLive } from './ui/EventCardTemplate.js';
import { renderSearchResults } from './ui/SearchResultsView.js';
import { renderAdminView } from './ui/AdminView.js';
import { StatsService } from './services/StatsService.js';
import { SearchEngine } from './services/SearchEngine.js';
import { IcsExporter } from './services/IcsExporter.js';
import { renderActivityHeatmap } from './ui/ActivityHeatmap.js';
import { DateUtils } from './utils/DateUtils.js';
import { escapeHtml } from './utils/Html.js';
import { formatMinutes } from './utils/Format.js';
import { validateRows } from './services/DataValidator.js';

const repo = new EventRepository();
let calendarInstance = null;

let currentCategory = "all";
let currentTagFilter = null;
let currentTypeFilter = null;
let currentSearchQuery = "";
let dataAnomalies = [];

// La sidebar "Prochainement" et le listing de recherche conservent en mémoire
// les événements affichés pour retrouver l'objet complet lors d'un clic (délégation).
let upcomingEventsCache = [];
let searchResultsCache = [];
// Dernier ensemble filtré affiché (calendrier ou recherche) : utilisé par l'export .ics
// pour exporter "ce que l'utilisateur voit" plutôt que tout le dépôt.
let lastFilteredEvents = [];
// Événement à ouvrir si l'utilisateur clique sur le bandeau "Prochain événement".
let nextEventForBanner = null;

const FILTERS_STORAGE_KEY = 'ui:activeFilters';
const SEEN_EVENTS_KEY = 'seen:upcomingEventIds';

const CATEGORY_BTN_ACTIVE = "px-3 py-1 rounded-lg bg-indigo-600 text-white font-bold shadow-[0_0_15px_rgba(99,102,241,0.4)]";
const CATEGORY_BTN_INACTIVE = "px-3 py-1 rounded-lg bg-white/5 border border-white/5 text-slate-400 hover:text-slate-200 transition-all";

// Libellés lisibles pour quelques catégories courtes (config.js THEMES[...].cat) qui ne se
// prêtent pas bien à une simple capitalisation ("irl" -> "IRL" plutôt que "Irl").
const CATEGORY_LABEL_OVERRIDES = { irl: "IRL", jdr: "JDR" };

function formatCategoryLabel(cat) {
    if (CATEGORY_LABEL_OVERRIDES[cat]) return CATEGORY_LABEL_OVERRIDES[cat];
    return cat.replace(/\b\w/g, (c) => c.toUpperCase());
}

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
        return `<button data-tag="${safeTag}" class="px-3 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-all backdrop-blur-md ${isSelected ? 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10'}" >#${safeTag} <span class="text-[9px] opacity-60 ml-0.5">(${count})</span></button>`;
    }).join('');
}

// Chips "Types" générées dynamiquement à partir de CONFIG.THEMES : offre un filtrage
// fin par type exact (Soirée Série, Meet Up, JDR, ...) en plus des 2 catégories larges.
function renderTypeFilterBar() {
    const container = document.getElementById('filter-types-container');
    const types = Object.keys(CONFIG.THEMES).filter(name => name !== 'default');

    const allBtn = `<button data-type="" class="px-2.5 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-all ${!currentTypeFilter ? 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10'}">Tous les types</button>`;

    const typeBtns = types.map(name => {
        const theme = CONFIG.THEMES[name];
        const isSelected = currentTypeFilter === name;
        const style = isSelected ? `background:${theme.col}33; border-color:${theme.col}; color:#fff;` : '';
        return `<button data-type="${name}" class="px-2.5 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-all ${isSelected ? 'font-bold' : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10'}" style="${style}">${name}</button>`;
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

    const calendarEl = document.getElementById('calendar');
    const searchResultsEl = document.getElementById('search-results');
    const isSearching = currentSearchQuery.trim().length > 0;

    if (isSearching) {
        filtered = SearchEngine.search(filtered, { query: currentSearchQuery });
        searchResultsCache = [...filtered].sort((a, b) => a.start.localeCompare(b.start));
        // Remplace le calendrier par un listing complet dédié (plus d'infos qu'une tuile)
        calendarEl.classList.add('hidden');
        searchResultsEl.classList.remove('hidden');
        renderSearchResults(searchResultsEl, searchResultsCache);
    } else {
        calendarEl.classList.remove('hidden');
        searchResultsEl.classList.add('hidden');
        CalendarView.sync(calendarInstance, filtered);
    }

    renderDashboardStats(filtered);
    renderUpcomingSidebar(filtered);
    lastFilteredEvents = filtered;

    const clearBtn = document.getElementById('btn-clear-filters');
    if (currentCategory !== "all" || currentTypeFilter || currentTagFilter || isSearching) {
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
    version: "2026-07-09b",
    sections: [
        {
            title: "🚀 Nouveautés",
            items: [
                "Nouvelle colonne <b>Tags</b> dans le tableur : toutes les balises (#tag, @host, @lieu...) peuvent désormais y être saisies séparément, en laissant Notes pour du texte libre uniquement. La migration est progressive, rien ne casse pour les lignes pas encore migrées.",
                "Organisateur affiché par défaut : « Helldwin » si aucun @host n'est précisé, au lieu de rester vide.",
                "Statuts Prévu/En Cours/Terminé recalculés plus finement par occurrence (et plus par ligne entière du tableur) : une série sans durée réelle connue reste \"En Cours\" plutôt que d'être annoncée \"Terminée\" sur une simple estimation, et un événement ponctuel ne reste plus \"En Cours\" indéfiniment.",
                "Le bandeau \"En direct\" et la pastille animée ne se fient plus indéfiniment à un statut \"En Cours\" incertain (durée non confirmée) : passé quelques heures sans confirmation, l'événement n'est plus annoncé comme diffusé \"maintenant\".",
                "Vue Semaine : la plage horaire affichée est resserrée à la fenêtre réellement utilisée (14h → 2h du matin), pour ne plus avoir à défiler énormément et perdre de vue les événements tardifs."
            ]
        },
        {
            title: "ℹ️ À savoir",
            items: [
                "Le lieu par défaut des événements est désormais « Discord 2GETHER » sauf indication contraire, et certains horaires par défaut ont été corrigés dans le tableur.",
                "Un événement peut toujours être annulé ou reporté à la dernière minute : pensez à vérifier le calendrier avant chaque session.",
                "L'export .ics est un instantané ponctuel à réimporter manuellement, pas un abonnement synchronisé automatiquement (le site est 100% statique, sans serveur)."
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

// Lien partageable direct (?event=<id>, voir ModalView) : rouvre la modale de
// l'événement visé si l'id est encore présent dans le dépôt fraîchement chargé.
function openEventFromUrl() {
    const id = new URLSearchParams(window.location.search).get('event');
    if (!id) return;
    const ev = repo.getAll().find(e => e.id === id);
    if (ev) ModalView.open(ev);
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
        renderActivityHeatmap(document.getElementById('activity-heatmap'), repo.getAll());
        openEventFromUrl();
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
        ['admin-overlay', 'btn-close-admin']
    ];
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        for (const [overlayId, btnId] of overlayCloseButtons) {
            const overlay = document.getElementById(overlayId);
            if (!overlay.classList.contains('hidden')) {
                document.getElementById(btnId).click();
                return;
            }
        }
    });
}

async function initApp() {
    try {
        // Restaure les filtres de la dernière visite avant le premier rendu, pour que
        // les barres de filtres et le calendrier reflètent directement le bon état.
        restoreFiltersFromStorage();

        // ModalView pilote la modale existante ; le clic sur un tag relance une recherche.
        ModalView.init((tag) => {
            document.getElementById('recherche').value = `#${tag}`;
            document.getElementById('btn-clear-search').classList.remove('hidden');
            document.getElementById('search-icon').classList.add('hidden');
            currentSearchQuery = `#${tag}`;
            updateUIState();
        });

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

        setupSidebarToggle();
        setupStatsToggle();
        setupFiltersToggle();
        setupAdminMode();
        setupPatchNotes();
        setupHelpOverlay();
        setupEscapeToClose();

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
        // Rafraîchit le compte à rebours régulièrement sans dépendre d'un rechargement des données.
        setInterval(updateNextEventBanner, 30000);

        document.getElementById('btn-export-ics').addEventListener('click', () => {
            const filename = `planning-2gelog-${DateUtils.toLocalDateStr(new Date())}.ics`;
            IcsExporter.download(lastFilteredEvents, filename);
        });

        // CalendarView pilote entièrement l'instance FullCalendar (rendu + clic).
        calendarInstance = CalendarView.create('calendar', (ev) => ModalView.open(ev));
        calendarInstance.render();

        setupSearchInput();

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
            currentCategory = "all";
            currentTypeFilter = null;
            currentTagFilter = null;
            currentSearchQuery = "";
            document.getElementById('recherche').value = "";
            document.getElementById('btn-clear-search').classList.add('hidden');
            document.getElementById('search-icon').classList.remove('hidden');
            setActiveCategoryButton(document.querySelector('#filter-categories-container button[data-cat="all"]'));
            renderTypeFilterBar();
            updateTagsFilterBar(repo.getAll());
            saveFiltersToStorage();
            updateUIState();
        });

        await loadData();

    } catch (error) {
        console.error("❌ Erreur d'initialisation de l'UI Glassmorphism :", error);
        document.getElementById('loading-overlay').classList.add('hidden');
        document.getElementById('error-banner').classList.remove('hidden');
    }
}

document.addEventListener('DOMContentLoaded', initApp);
