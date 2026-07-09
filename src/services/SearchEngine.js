export class SearchEngine {
    /**
     * Génère un index de recherche textuel unique et aplati pour un événement.
     * @param {Object} event - L'instance d'événement générée par EventGenerator
     * @returns {string} L'index textuel normalisé en minuscules
     */
    static createIndex(event) {
        const components = [
            event.title || "",
            event.notes || "",
            event.location || "",
            event.type || "",
            event.sub || "", // Sous-épisode éventuel
            event.meta?.host || "", // Organisateur / Host s'il existe
            event.meta?.plateforme || "", // Plateforme de diffusion
            ...(event.tags || [])
        ];

        // On assemble tout, supprime les espaces inutiles et passe en minuscules
        return components
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    /**
     * Filtre une liste d'événements selon une chaîne de recherche et/ou une catégorie/thématique.
     * @param {Array<Object>} events - Liste des événements issus du dépôt
     * @param {Object} criteria - { query: "terme", category: "Thématique" }
     * @returns {Array<Object>} Événements correspondants
     */
    static search(events, { query = "", category = null } = {}) {
        const cleanedQuery = query.trim().toLowerCase();

        return events.filter(event => {
            // 1. Filtre par catégorie / type (ex: "Soirée Film")
            if (category && event.type !== category) {
                return false;
            }

            // 2. Filtre par recherche textuelle globale via l'index enrichi
            if (cleanedQuery) {
                // Si l'événement n'a pas encore d'index, on le génère à la volée (sécurité)
                if (!event.searchIndex) {
                    event.searchIndex = this.createIndex(event);
                }
                
                // Vérification multi-mots (tous les mots de la requête doivent être dans l'index).
                // Un "#" de tête est retiré de chaque mot : l'index stocke les tags sans "#"
                // (voir createIndex), alors qu'un clic sur un tag (modale, barre "Tags
                // Récurrents") ou une saisie manuelle "#tag" préfixe la requête avec "#" —
                // sans ce retrait, ces recherches ne trouvaient jamais aucun résultat.
                const searchWords = cleanedQuery.split(" ").map(w => w.replace(/^#/, "")).filter(Boolean);
                return searchWords.every(word => event.searchIndex.includes(word));
            }

            return true;
        });
    }
}