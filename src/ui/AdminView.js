import { StatsService } from '../services/StatsService.js';
import { AdminIssuesService } from '../services/AdminIssuesService.js';
import { forceRewarmTmdbCache, getTmdbSourceStats } from '../services/TMDBService.js';
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
                    <div class="inline-flex items-center gap-1 text-2xs text-slate-500 uppercase font-bold">${Icons.xCircle('w-3 h-3 shrink-0')}Annulés / Reportés</div>
                    <div class="text-lg font-black text-rose-400">${s.counters.annulations}</div>
                    <div class="text-xxs text-slate-500">${s.counters.reports} report(s)</div>
                </div>
                <div class="bg-black/20 p-3 rounded-xl border border-white/5">
                    <div class="inline-flex items-center gap-1 text-2xs text-slate-500 uppercase font-bold">${Icons.arrowRightCircle('w-3 h-3 shrink-0')}Prévus</div>
                    <div class="text-lg font-black text-white">${s.counters.totalPlanned}</div>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                    <div class="inline-flex items-center gap-1 text-2xs text-slate-500 uppercase font-bold mb-1">${Icons.barChart('w-3 h-3 shrink-0')}Par catégorie</div>
                    <div class="space-y-1">${categories.map(([k, v]) => categoryRow(k, v)).join('') || emptyRow()}</div>
                </div>
                <div>
                    <div class="inline-flex items-center gap-1 text-2xs text-slate-500 uppercase font-bold mb-1">${Icons.tag('w-3 h-3 shrink-0')}Top Tags</div>
                    <div class="space-y-1">${topN(s.byTag).map(([k, v]) => rankedRow(k, v)).join('') || emptyRow()}</div>
                </div>
                <div>
                    <div class="inline-flex items-center gap-1 text-2xs text-slate-500 uppercase font-bold mb-1">${Icons.user('w-3 h-3 shrink-0')}Top Organisateurs</div>
                    <div class="space-y-1">${topN(s.byHost).map(([k, v]) => rankedRow(k, v)).join('') || emptyRow()}</div>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                    <div class="inline-flex items-center gap-1 text-2xs text-slate-500 uppercase font-bold mb-1">${Icons.tv('w-3 h-3 shrink-0')}Top Plateformes</div>
                    <div class="space-y-1">${topN(s.byPlatform).map(([k, v]) => rankedRow(k, v)).join('') || emptyRow()}</div>
                </div>
                <div class="sm:col-span-2">
                    <div class="inline-flex items-center gap-1 text-2xs text-slate-500 uppercase font-bold mb-1">${Icons.film('w-3 h-3 shrink-0')}Répartition par type</div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        ${topN(s.byType, 12).map(([k, v]) => rankedRow(k, v)).join('') || emptyRow()}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Anomalies détectées AVANT génération (voir DataValidator.validateRows) : certaines (date
// illisible, fin < début) empêchent EventGenerator de produire une instance pour cette ligne -
// une anomalie n'a donc pas TOUJOURS d'événement correspondant dans le dépôt. Best-effort par
// titre (premier événement trouvé) plutôt qu'un id précis, qu'une ligne cassée ne peut pas avoir.
function renderAnomaliesSection(anomalies, events = []) {
    if (!anomalies || anomalies.length === 0) {
        return `
            <div class="glass-panel rounded-2xl p-5">
                <h3 class="flex items-center gap-2 text-sm font-black text-emerald-400 mb-1">${Icons.checkCircle('w-4 h-4 shrink-0')}Aucune anomalie détectée</h3>
                <p class="text-xs text-slate-500">Les dates et types de toutes les lignes du tableur semblent cohérents.</p>
            </div>
        `;
    }

    const byTitle = new Map();
    events.forEach(e => { if (!byTitle.has(e.title)) byTitle.set(e.title, e); });

    const rows = anomalies.map(a => {
        const match = byTitle.get(a.title);
        const interactiveAttrs = match
            ? `role="button" tabindex="0" aria-label="Ouvrir ${escapeHtml(a.title)}" data-event-id="${escapeHtml(match.id)}" class="cursor-pointer hover:brightness-125 transition-all"`
            : '';
        return `
        <div class="flex items-start gap-2 px-3 py-2 rounded-lg ${a.severity === 'error' ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-amber-500/10 border border-amber-500/20'}" ${interactiveAttrs}>
            <span class="shrink-0 ${a.severity === 'error' ? 'text-rose-400' : 'text-amber-400'}">${a.severity === 'error' ? Icons.xCircle('w-4 h-4') : Icons.alertTriangle('w-4 h-4')}</span>
            <div class="min-w-0">
                <div class="text-xs font-bold text-slate-200">Ligne ${a.row} — ${escapeHtml(a.title)}</div>
                <div class="text-xxs text-slate-400">${escapeHtml(a.message)}</div>
            </div>
        </div>
    `;
    }).join('');

    return `
        <div class="glass-panel rounded-2xl p-5 space-y-2">
            <h3 class="flex items-center gap-2 text-sm font-black text-white">${Icons.alertTriangle('w-4 h-4 shrink-0 text-amber-400')}${anomalies.length} anomalie${anomalies.length > 1 ? 's' : ''} détectée${anomalies.length > 1 ? 's' : ''} dans le tableur</h3>
            <div class="space-y-1.5">${rows}</div>
        </div>
    `;
}

function renderIssueRow(issue) {
    const detected = new Date(issue.detectedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `
        <div class="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <span class="shrink-0 text-amber-400">${Icons.alertTriangle('w-4 h-4')}</span>
            <div class="min-w-0 flex-1">
                <div class="text-xs font-bold text-slate-200">${escapeHtml(issue.message)}</div>
                <div class="text-xxs text-slate-500">Détecté le ${detected}</div>
            </div>
            <button data-issue-dismiss data-issue-type="${escapeHtml(issue.type)}" data-issue-key="${escapeHtml(issue.key)}" title="Ignorer" aria-label="Ignorer ce problème" class="shrink-0 text-slate-500 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-white/10 transition-all">✕</button>
        </div>
    `;
}

/**
 * Panneau "Problèmes détectés en arrière-plan" (V2.8, voir AdminIssuesService.js) - distinct des
 * anomalies de LIGNE CSV ci-dessus (celles-là bloquent la génération d'un événement ; celles-ci
 * sont détectées à l'usage par un service tiers, ex: recherche TMDB infructueuse ou ambiguë pour
 * un titre - voir TMDBService.fetchTmdbInfo). Section indépendante avec son propre cycle de
 * rendu : ignorer une entrée ou tout effacer ne redessine QUE ce panneau (issues relues à chaque
 * fois depuis AdminIssuesService, jamais figées) plutôt que toute la vue Admin - `events`/
 * `anomalies` de renderAdminView n'ont pas besoin d'être reçus ici pour rester à jour.
 * @param {HTMLElement} root - Wrapper vide dédié, injecté par renderAdminView.
 */
function mountIssuesPanel(root) {
    function draw() {
        const issues = AdminIssuesService.getAll();
        if (issues.length === 0) { root.innerHTML = ''; return; }
        root.innerHTML = `
            <div class="glass-panel rounded-2xl p-5 space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <h3 class="flex items-center gap-2 text-sm font-black text-white">${Icons.alertTriangle('w-4 h-4 shrink-0 text-amber-400')}${issues.length} problème${issues.length > 1 ? 's' : ''} détecté${issues.length > 1 ? 's' : ''} en arrière-plan</h3>
                    <button data-issues-clear class="text-2xs font-bold text-slate-400 hover:text-rose-300 transition-all">Tout effacer</button>
                </div>
                <div class="space-y-1.5">${issues.map(renderIssueRow).join('')}</div>
            </div>
        `;
    }

    root.addEventListener('click', (e) => {
        if (e.target.closest('[data-issues-clear]')) { AdminIssuesService.clear(); draw(); return; }
        const dismissBtn = e.target.closest('[data-issue-dismiss]');
        if (dismissBtn) { AdminIssuesService.resolve(dismissBtn.dataset.issueType, dismissBtn.dataset.issueKey); draw(); }
    });
    draw();
}

/**
 * Panneau "Cache TMDB (Grist)" (V2.9) : bouton Admin pour forcer un remplissage complet du cache
 * partagé côté n8n/Grist (voir forceRewarmTmdbCache dans TMDBService.js) - sans lui, ce cache ne
 * se peuple qu'organiquement au fil des visites (une recherche déclenchée seulement quand QUELQU'UN
 * ouvre/prefetch ce titre précis). Même schéma auto-contenu que mountIssuesPanel (son propre root +
 * draw()), mais l'état affiché ici (en cours/terminé/résultat) est purement local à cette fonction
 * - il ne survit pas à un rechargement de page, contrairement au journal d'AdminIssuesService.
 * @param {HTMLElement} root - Wrapper vide dédié, injecté par renderAdminView.
 * @param {Array<Object>} events - Tous les événements du dépôt (non filtrés).
 */
// Trois portées distinctes (V2.9) plutôt qu'un unique bouton "tout" : une fois les fiches déjà
// correctes en cache (Grist + local), rafraîchir aussi les saisons à chaque fois gâche des appels
// TMDB pour rien - et inversement, ne corriger QUE des fiches (ex: après un correctif de titre)
// ne doit pas rouvrir des saisons déjà bonnes. Voir le paramètre `scope` de forceRewarmTmdbCache.
const REWARM_SCOPES = {
    all: {
        label: 'Tout recharger',
        icon: Icons.refresh('w-3 h-3 shrink-0'),
        confirm: "Forcer une recherche TMDB pour TOUS les titres Film/Série du planning, puis leurs saisons ? Ça peut prendre plusieurs minutes et solliciter fortement le proxy n8n/TMDB."
    },
    fiches: {
        label: 'Fiches uniquement',
        icon: Icons.film('w-3 h-3 shrink-0'),
        confirm: "Forcer une recherche TMDB pour chaque titre (sans toucher aux saisons déjà en cache) ?"
    },
    seasons: {
        label: 'Saisons uniquement',
        icon: Icons.tv('w-3 h-3 shrink-0'),
        confirm: "Rafraîchir les épisodes de saison des séries déjà en cache (aucune nouvelle recherche de fiche, aucun appel TMDB supplémentaire pour ça) ?"
    }
};

function rewarmResultText(scope, result) {
    if (scope === 'seasons') {
        const skipped = result.seasonsSkippedNoFiche > 0 ? ` (${result.seasonsSkippedNoFiche} série(s) ignorée(s), pas encore de fiche en cache local)` : '';
        return `Terminé : ${result.seasonsFound}/${result.seasonsTotal} saison(s) rafraîchie(s)${skipped}.`;
    }
    if (scope === 'fiches') {
        return `Terminé : ${result.fichesFound}/${result.fichesTotal} fiche(s) trouvée(s).`;
    }
    return `Terminé : ${result.fichesFound}/${result.fichesTotal} fiche(s) trouvée(s), ${result.seasonsFound}/${result.seasonsTotal} saison(s).`;
}

function mountTmdbCachePanel(root, events) {
    let running = false;
    let runningScope = null;
    let progress = null; // { phase: 'fiches'|'seasons', done, total }
    let lastScope = null;
    let result = null;

    function draw() {
        const statusHtml = running
            ? `<div class="text-xs text-slate-400">${progress ? `${progress.phase === 'fiches' ? 'Fiches' : 'Saisons'} : ${progress.done} / ${progress.total}` : 'Démarrage...'}</div>`
            : result
                ? `<div class="text-xs text-slate-400">${rewarmResultText(lastScope, result)}</div>`
                : '';

        const buttonsHtml = Object.entries(REWARM_SCOPES).map(([scope, def]) => `
            <button data-tmdb-rewarm data-scope="${scope}" ${running ? 'disabled' : ''} class="inline-flex items-center gap-1.5 text-2xs font-bold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-all">
                ${running && runningScope === scope ? 'En cours...' : `${def.icon}${def.label}`}
            </button>
        `).join('');

        // Compteur Grist-hit vs vrai-appel-TMDB (V2.10, voir getTmdbSourceStats dans
        // TMDBService.js) : repose sur un champ `_source` optionnel que le proxy n8n peut renvoyer
        // - tant qu'il n'est pas ajouté côté n8n, tout retombe dans "inconnu", ce qui reste un
        // signal utile en soi (rappelle que ce diagnostic n'est pas encore câblé côté serveur).
        const stats = getTmdbSourceStats();
        const statsHtml = `<div class="text-3xs text-slate-500">Depuis ce chargement de page : ${stats.grist} via Grist, ${stats.tmdb} appel(s) TMDB direct, ${stats.unknown} source inconnue${stats.unknown > 0 ? ' (le proxy n8n ne renvoie pas encore de champ `_source`)' : ''}.</div>`;

        root.innerHTML = `
            <div class="glass-panel rounded-2xl p-5 space-y-2">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <h3 class="flex items-center gap-2 text-sm font-black text-white">${Icons.film('w-4 h-4 shrink-0 text-sky-400')}Cache TMDB (Grist)</h3>
                    <div class="flex items-center gap-1.5 flex-wrap">${buttonsHtml}</div>
                </div>
                <p class="text-xxs text-slate-500">Relance une recherche TMDB pour les titres Film/Série du planning (même déjà en cache localement) et alimente le cache partagé côté n8n/Grist. "Saisons uniquement" réutilise les fiches déjà en cache local, sans nouvel appel de recherche. Peut prendre plusieurs minutes sur un gros planning.</p>
                ${statsHtml}
                ${statusHtml}
            </div>
        `;
    }

    root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-tmdb-rewarm]');
        if (!btn || running) return;
        const scope = btn.dataset.scope;
        if (!window.confirm(REWARM_SCOPES[scope].confirm)) return;

        running = true;
        runningScope = scope;
        progress = null;
        result = null;
        draw();

        result = await forceRewarmTmdbCache(events, (p) => { progress = p; draw(); }, { scope });
        lastScope = scope;
        running = false;
        runningScope = null;
        draw();
    });

    draw();
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
    const anomaliesHtml = renderAnomaliesSection(anomalies, events);

    if (years.length === 0) {
        container.innerHTML = `<div class="space-y-6 max-w-5xl mx-auto">${anomaliesHtml}<div id="admin-issues-panel"></div><div id="admin-tmdb-cache-panel"></div><div class="text-center text-slate-500 py-24">Aucune donnée disponible.</div></div>`;
    } else {
        container.innerHTML = `<div class="space-y-6 max-w-5xl mx-auto">${anomaliesHtml}<div id="admin-issues-panel"></div><div id="admin-tmdb-cache-panel"></div>${years.map(year => renderYearCard(year, byYear[year])).join('')}</div>`;
    }

    mountIssuesPanel(container.querySelector('#admin-issues-panel'));
    mountTmdbCachePanel(container.querySelector('#admin-tmdb-cache-panel'), events);
}
