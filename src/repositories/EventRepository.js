export class EventRepository {
    constructor() {
        this.events = [];
        this.index = new Set();
    }

    /**
     * Ajoute un événement s'il n'est pas déjà présent
     * @param {Object} event 
     * @returns {boolean} true si inséré, false si doublon ignoré
     */
    add(event) {
        const key = [
            event.title?.trim(),
            event.start?.split('T')[0], // On isole la date
            event.heure || ""
        ].join("|").toLowerCase();

        if (this.index.has(key)) {
            return false; // Doublon détecté
        }

        this.index.add(key);
        this.events.push(event);
        return true;
    }

    getAll() {
        return this.events;
    }

    clear() {
        this.events = [];
        this.index.clear();
    }
}