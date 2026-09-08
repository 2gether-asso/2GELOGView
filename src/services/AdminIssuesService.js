const STORAGE_KEY = 'admin:issues:v1';
// Borne dure (V2.8) : si un jour beaucoup de titres posent problème d'un coup (ex: proxy TMDB en
// panne prolongée), on garde les plus récents plutôt que de laisser localStorage grossir sans fin.
const MAX_ISSUES = 200;

/**
 * Journal léger de "problèmes détectés en arrière-plan" (V2.8) - pas des anomalies de LIGNE CSV
 * (déjà couvertes par DataValidator/renderAnomaliesSection dans AdminView.js), mais des soucis
 * détectés à l'usage, un service tiers à la fois (ex : recherche TMDB infructueuse ou ambiguë
 * pour un titre - voir TMDBService.fetchTmdbInfo). Purement local (localStorage), affiché dans le
 * Mode Admin (voir AdminView.renderIssuesSection) plutôt que remonté nulle part automatiquement.
 *
 * Dédoublonné par (type, key) plutôt qu'accumulé à chaque nouvelle détection du même problème :
 * un même titre re-cherché à chaque chargement de page ne doit pas empiler des dizaines
 * d'entrées identiques, juste garder la plus récente (et disparaître de lui-même via `resolve`
 * si le souci ne se reproduit plus la fois suivante).
 */
export const AdminIssuesService = {
    _readAll() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    },

    _writeAll(list) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* quota plein - tant pis, juste pas de journal persistant */ }
    },

    /** @returns {Array<{type: string, key: string, message: string, detectedAt: string}>} */
    getAll() {
        return this._readAll();
    },

    /**
     * Signale (ou met à jour) un problème. `type` + `key` identifient ENSEMBLE une entrée unique
     * (ex: type "tmdb-not-found", key = titre normalisé) - un signalement répété du même
     * (type, key) remplace l'entrée existante (nouvelle date) plutôt que d'en empiler une autre.
     * @param {string} type
     * @param {string} key
     * @param {string} message - Texte affiché tel quel dans le Mode Admin.
     */
    report(type, key, message) {
        const all = this._readAll();
        const idx = all.findIndex(i => i.type === type && i.key === key);
        const entry = { type, key, message, detectedAt: new Date().toISOString() };
        if (idx >= 0) all[idx] = entry; else all.unshift(entry);
        this._writeAll(all.slice(0, MAX_ISSUES));
    },

    /** Retire un problème une fois qu'il ne se reproduit plus (voir TMDBService.fetchTmdbInfo,
     * qui appelle resolve() dès qu'une recherche later aboutit proprement pour ce même titre). */
    resolve(type, key) {
        const all = this._readAll();
        const next = all.filter(i => !(i.type === type && i.key === key));
        if (next.length !== all.length) this._writeAll(next);
    },

    /** Vide tout le journal (bouton "Tout effacer" du Mode Admin). */
    clear() {
        this._writeAll([]);
    }
};
