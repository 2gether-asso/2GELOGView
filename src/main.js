import { CONFIG } from './config.js';
import { CSVParser } from './parsers/CSVParser.js';
import { EventGenerator } from './services/EventGenerator.js';
import { EventRepository } from './repositories/EventRepository.js';
import { CalendarView } from './ui/CalendarView.js';
import { ModalView } from './ui/ModalView.js';
import { renderEventCard } from './ui/EventCardTemplate.js';
import { renderSearchResults } from './ui/SearchResultsView.js';
import { renderAdminView } from './ui/AdminView.js';
import { StatsService } from './services/StatsService.js';
import { SearchEngine } from './services/SearchEngine.js';
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

const CATEGORY_BTN_ACTIVE = "px-3 py-1 rounded-lg bg-indigo-600 text-white font-bold shadow-[0_0_15px_rgba(99,102,241,0.4)]";
const CATEGORY_BTN_INACTIVE = "px-3 py-1 rounded-lg bg-white/5 border border-white/5 text-slate-400 hover:text-slate-200 transition-all";

function setActiveCategoryButton(selectedBtn) {
    document.querySelectorAll('#filter-categories-container button').forEach(b => {
        b.className = (b === selectedBtn) ? CATEGORY_BTN_ACTIVE : CATEGORY_BTN_INACTIVE;
    });
}

function renderDashboardStats(events) {
    const stats = StatsService.compute(events);
    document.getElementById('stat-watch-sessions').innerText = stats.watch.n;
    document.getElementById('stat-watch-time').innerText = formatMinutes(stats.watch.t);
    document.getElementById('stat-game-sessions').innerText = stats.game.n;
    document.getElementById('stat-game-time').innerText = formatMinutes(stats.game.t);
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

function renderUpcomingSidebar(events) {
    const container = document.getElementById('upcoming-list');
    const countLabel = document.getElementById('upcoming-count');
    const todayStr = new Date().toISOString().split('T')[0];

    const upcoming = events
        .filter(e => e.start.split('T')[0] >= todayStr && !e.isCanceled)
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, 15);

    upcomingEventsCache = upcoming;
    countLabel.innerText = upcoming.length;
    if (upcoming.length === 0) {
        container.innerHTML = `<div class="text-center text-xs text-slate-600 py-12">Aucun événement à venir</div>`;
        return;
    }

    container.innerHTML = upcoming.map((e, idx) => {
        const dateObj = new Date(e.start);
        const readableDate = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        return `<div class="cursor-pointer" data-idx="${idx}">${renderEventCard(e, readableDate)}</div>`;
    }).join('');
}

function updateUIState() {
    let filtered = repo.getAll();

    // Filtrage corrigé sur e.category ("watch", "game") plutôt que "e.type"
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
    version: "2026-07-06",
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

        updateTagsFilterBar(repo.getAll());
        renderTypeFilterBar();
        updateUIState();
        loadingEl.classList.add('hidden');
    } catch (error) {
        console.error("❌ Erreur de chargement du planning :", error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

async function initApp() {
    try {
        console.log("🚀 Lancement final en Production...");

        // ModalView pilote la modale existante ; le clic sur un tag relance une recherche.
        ModalView.init((tag) => {
            document.getElementById('recherche').value = `#${tag}`;
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
        setupFiltersToggle();
        setupAdminMode();
        setupPatchNotes();

        document.getElementById('btn-retry-load').addEventListener('click', () => loadData());

        // CalendarView pilote entièrement l'instance FullCalendar (rendu + clic).
        calendarInstance = CalendarView.create('calendar', (ev) => ModalView.open(ev));
        calendarInstance.render();

        document.getElementById('recherche').addEventListener('input', (e) => {
            currentSearchQuery = e.target.value;
            updateUIState();
        });

        document.getElementById('filter-categories-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            setActiveCategoryButton(btn);
            currentCategory = btn.dataset.cat;
            updateUIState();
        });

        document.getElementById('filter-types-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const type = btn.dataset.type;
            currentTypeFilter = (currentTypeFilter === type || type === "") ? null : type;
            renderTypeFilterBar();
            updateUIState();
        });

        document.getElementById('filter-tags-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const tag = btn.dataset.tag;
            currentTagFilter = (currentTagFilter === tag) ? null : tag;
            updateTagsFilterBar(repo.getAll());
            updateUIState();
        });

        document.getElementById('btn-clear-filters').addEventListener('click', () => {
            currentCategory = "all";
            currentTypeFilter = null;
            currentTagFilter = null;
            currentSearchQuery = "";
            document.getElementById('recherche').value = "";
            setActiveCategoryButton(document.querySelector('#filter-categories-container button[data-cat="all"]'));
            renderTypeFilterBar();
            updateTagsFilterBar(repo.getAll());
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
