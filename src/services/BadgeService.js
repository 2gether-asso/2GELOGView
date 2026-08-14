// Badges communautaires "à débloquer" (voir RetrospectiveView.js renderBadgeShelf) : purement
// dérivés des statistiques déjà calculées par computeYearFacts() (RetrospectiveView.js), aucune
// nouvelle donnée nécessaire. Pas de badge "MVP" ici : celui-ci n'a de sens qu'à l'échelle d'un
// organisateur précis (est-il/elle le/la topHost de l'année ?), pas de la communauté entière -
// il sera géré séparément par le futur profil organisateur plutôt que forcé dans cette liste.
// Créneau horaire d'une session ("HH:MM" -> booléen), pour les badges noctambule/matinal
// ci-dessous - même découpage que timeOfDayBucketIndex dans RetrospectiveView.js, mais sans en
// dépendre (import circulaire évité : BadgeService n'a besoin que d'un simple test d'heure).
function isLateNight(heure) {
    const h = parseInt(heure, 10);
    return h >= 23 || h < 5;
}
function isMorning(heure) {
    const h = parseInt(heure, 10);
    return h >= 5 && h < 12;
}

const BADGE_DEFINITIONS = [
    { id: 'regulier', emoji: '🏃', label: 'Régulier', description: '4 semaines actives d\'affilée ou plus', test: f => f.streak >= 4 },
    { id: 'explorateur', emoji: '🗺️', label: 'Explorateur', description: '6 types d\'événements différents ou plus', test: f => f.distinctTypes >= 6 },
    { id: 'cinephile', emoji: '🎬', label: 'Cinéphile', description: '10 films/séries différents ou plus', test: f => f.distinctWatched >= 10 },
    { id: 'gamer', emoji: '🎮', label: 'Gamer', description: '10 jeux différents ou plus', test: f => f.distinctGames >= 10 },
    { id: 'marathonien', emoji: '⏳', label: 'Marathonien', description: 'Plus de 80h cumulées sur l\'année', test: f => f.totalTime >= 5000 },
    { id: 'fiable', emoji: '✅', label: 'Fiable', description: 'Au moins 5 sessions et 95% maintenues (peu d\'annulations)', test: f => f.totalSessions >= 5 && f.reliabilityPct >= 95 },
    { id: 'centurion', emoji: '💯', label: 'Centurion', description: '100 sessions ou plus', test: f => f.totalSessions >= 100 },
    { id: 'polyvalent', emoji: '🎨', label: 'Polyvalent', description: 'Au moins 3 catégories différentes représentées', test: f => Object.keys(f.stats?.byCategory || {}).length >= 3 },
    { id: 'noctambule', emoji: '🦉', label: 'Noctambule', description: '5 sessions ou plus commencées après 23h', test: f => (f.realSessions || []).filter(e => e.heure && isLateNight(e.heure)).length >= 5 },
    { id: 'matinal', emoji: '🌅', label: 'Matinal', description: '5 sessions ou plus commencées avant midi', test: f => (f.realSessions || []).filter(e => e.heure && isMorning(e.heure)).length >= 5 }
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
