// Badges communautaires "à débloquer" (voir RetrospectiveView.js renderBadgeShelf) : purement
// dérivés des statistiques déjà calculées par computeYearFacts() (RetrospectiveView.js), aucune
// nouvelle donnée nécessaire. Pas de badge "MVP" ici : celui-ci n'a de sens qu'à l'échelle d'un
// organisateur précis (est-il/elle le/la topHost de l'année ?), pas de la communauté entière -
// il sera géré séparément par le futur profil organisateur plutôt que forcé dans cette liste.
const BADGE_DEFINITIONS = [
    { id: 'regulier', emoji: '🏃', label: 'Régulier', description: '4 semaines actives d\'affilée ou plus', test: f => f.streak >= 4 },
    { id: 'explorateur', emoji: '🗺️', label: 'Explorateur', description: '6 types d\'événements différents ou plus', test: f => f.distinctTypes >= 6 },
    { id: 'cinephile', emoji: '🎬', label: 'Cinéphile', description: '10 films/séries différents ou plus', test: f => f.distinctWatched >= 10 },
    { id: 'gamer', emoji: '🎮', label: 'Gamer', description: '10 jeux différents ou plus', test: f => f.distinctGames >= 10 },
    { id: 'marathonien', emoji: '⏳', label: 'Marathonien', description: 'Plus de 80h cumulées sur l\'année', test: f => f.totalTime >= 5000 },
    { id: 'fiable', emoji: '✅', label: 'Fiable', description: 'Au moins 5 sessions et 95% maintenues (peu d\'annulations)', test: f => f.totalSessions >= 5 && f.reliabilityPct >= 95 }
];

/**
 * @param {Object} facts - Le résultat de RetrospectiveView.js computeYearFacts()
 * @returns {Array<{id:string, emoji:string, label:string, description:string, achieved:boolean}>}
 */
export function computeBadges(facts) {
    return BADGE_DEFINITIONS.map(def => ({
        id: def.id,
        emoji: def.emoji,
        label: def.label,
        description: def.description,
        achieved: def.test(facts)
    }));
}
