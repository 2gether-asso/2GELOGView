const STORAGE_KEY = 'rsvp:responses';

/**
 * "Je viens ?" léger et purement local (pas de backend, voir CLAUDE.md/README) : la réponse
 * n'est visible que sur l'appareil qui l'a saisie, c'est un pense-bête personnel, pas un
 * système de présence partagé avec le reste de la communauté.
 */
export class RsvpService {
    static _readAll() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    /** @returns {'yes'|'maybe'|'no'|null} */
    static get(eventId) {
        if (!eventId) return null;
        return this._readAll()[eventId] || null;
    }

    /** @param {'yes'|'maybe'|'no'|null} status - null efface la réponse. */
    static set(eventId, status) {
        if (!eventId) return;
        const all = this._readAll();
        if (status) all[eventId] = status;
        else delete all[eventId];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
}
