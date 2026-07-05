export class StatsService {
    /**
     * Calcule l'ensemble des métriques de statistiques avancées à partir des événements filtrés.
     * @param {Array<Object>} events - Liste de toutes les instances d'événements du dépôt
     * @returns {Object} Un objet structuré contenant toutes les métriques V2
     */
    static compute(events) {
        const stats = {
            watch: { n: 0, t: 0 },
            game: { n: 0, t: 0 },
            byTag: {},
            byType: {},
            byPlatform: {},
            byHost: {},
            counters: {
                annulations: 0,
                reports: 0,
                totalPlanned: 0
            }
        };

        events.forEach(event => {
            if (event.isPlanned) {
                stats.counters.totalPlanned++;
                return;
            }

            if (event.isCanceled) {
                stats.counters.annulations++;
                if (/report[eé]/i.test(event.notes)) {
                    stats.counters.reports++;
                }
                return;
            }

            const duration = event.dur || 0;
            const type = (event.type || "Inconnu").toLowerCase(); // Normalisation

            if (event.category === "watch") {
                stats.watch.n++;
                stats.watch.t += duration;
            } else if (event.category === "game") {
                stats.game.n++;
                stats.game.t += duration;
            }

            if (!stats.byType[type]) stats.byType[type] = 0;
            stats.byType[type] += duration;

            // Normalisation .toLowerCase() pour l'organisateur (@host ou @orga)
            const host = (event.meta?.host || event.meta?.orga || "Aucun").trim().toLowerCase();
            if (!stats.byHost[host]) stats.byHost[host] = 0;
            stats.byHost[host] += duration;

            // Normalisation .toLowerCase() pour la plateforme
            const platform = (event.meta?.plateforme || "Aucune").trim().toLowerCase();
            if (!stats.byPlatform[platform]) stats.byPlatform[platform] = 0;
            stats.byPlatform[platform] += duration;

            if (event.tags && Array.isArray(event.tags)) {
                event.tags.forEach(tag => {
                    const cleanTag = tag.trim().toLowerCase(); // Normalisation
                    if (!stats.byTag[cleanTag]) stats.byTag[cleanTag] = 0;
                    stats.byTag[cleanTag] += duration;
                });
            }
        });

        return stats;
    }

    /**
     * Regroupe les événements par année et calcule les métriques V2 pour chacune.
     * Utilisé par la vue Admin pour les rétrospectives annuelles.
     * @param {Array<Object>} events
     * @returns {Object} { [year]: statsObject } trié de l'année la plus récente à la plus ancienne
     */
    static computeByYear(events) {
        const byYear = {};
        events.forEach(event => {
            const year = new Date(event.start).getFullYear();
            if (!byYear[year]) byYear[year] = [];
            byYear[year].push(event);
        });

        const result = {};
        Object.keys(byYear)
            .sort((a, b) => b - a)
            .forEach(year => { result[year] = this.compute(byYear[year]); });

        return result;
    }
}