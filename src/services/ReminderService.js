const STORAGE_KEY = 'reminders:subscriptions';

/**
 * Rappels suivis par TITRE (pas par instance/id) : fonctionne sur n'importe quel type
 * d'événement. L'intérêt de suivre par titre plutôt que par occurrence précise se voit
 * surtout pour une série (hebdo, ou épisodes datés dans les Notes/Tags) : EventGenerator
 * génère une instance distincte par date à partir d'une même ligne, mais leur donne toutes
 * le même `title` — l'abonnement couvre donc automatiquement CHAQUE prochaine diffusion du
 * planning, pas seulement celle ouverte au moment du clic. Purement local (localStorage) :
 * pas de backend, chaque appareil a ses propres abonnements.
 */
export class ReminderService {
    static _readAll() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    static _writeAll(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    /** @returns {Array<{title: string, addedAt: string}>} */
    static getAll() {
        return this._readAll();
    }

    static isSet(title) {
        if (!title) return false;
        return this._readAll().some(r => r.title === title);
    }

    static add(title) {
        if (!title) return;
        const all = this._readAll();
        if (!all.some(r => r.title === title)) {
            all.push({ title, addedAt: new Date().toISOString() });
            this._writeAll(all);
        }
    }

    static remove(title) {
        this._writeAll(this._readAll().filter(r => r.title !== title));
    }

    /** Bascule l'abonnement et renvoie le nouvel état (true = maintenant suivi). */
    static toggle(title) {
        if (this.isSet(title)) {
            this.remove(title);
            return false;
        }
        this.add(title);
        return true;
    }
}
