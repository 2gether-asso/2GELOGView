import { CONFIG } from '../config.js';

const VOTER_ID_KEY = 'poll:voterId';
const MY_VOTE_PREFIX = 'poll:myVote:';

/** Identifiant anonyme du visiteur (V2.4, sondages) : généré une fois, persisté en
 * localStorage - sert uniquement à éviter les votes multiples côté n8n (colonne "ID Votant"
 * du Sheet 2GEPOLL, voir workflow "POST /vote"), PAS une vraie identité/authentification. */
function getVoterId() {
    let id = localStorage.getItem(VOTER_ID_KEY);
    if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(VOTER_ID_KEY, id);
    }
    return id;
}

/** Vote déjà enregistré localement pour ce sondage (pour mettre en avant l'option choisie au
 * ré-affichage) - purement indicatif côté client, la vraie source de vérité reste le Sheet
 * Votes (voir workflow n8n, qui dédoublonne lui-même par ID Votant). */
export function getMyVote(pollId) {
    return localStorage.getItem(MY_VOTE_PREFIX + pollId);
}

/**
 * Récupère le sondage actif (voir workflow n8n "GET /poll/current"). Résout à `null` sur
 * toute erreur, réponse invalide, absence de sondage actif ou timeout - jamais de rejet : un
 * sondage est un bonus purement cosmétique, une panne du service externe ne doit jamais faire
 * échouer quoi que ce soit dans le reste de l'app (même philosophie que fetchBirthdays dans
 * BirthdayService.js). Le timeout explicite (6s) évite qu'une instance n8n endormie/indisponible
 * ne laisse le bouton "Sondage" indéfiniment dans un état incertain.
 * @returns {Promise<{id: string, question: string, options: Array<{label: string, count: number}>, total: number}|null>}
 */
export async function fetchCurrentPoll() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(CONFIG.POLL_CURRENT_URL, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.id || !Array.isArray(data.options)) return null;
        return data;
    } catch {
        return null;
    }
}

/**
 * Envoie un vote (voir workflow n8n "POST /vote") puis relit le sondage pour renvoyer un
 * tally à jour (le workflow ne répond lui-même qu'un simple accusé de succès). Retourne
 * `null` en cas d'échec - l'appelant garde alors l'affichage précédent plutôt que de casser
 * l'UI pour une fonctionnalité bonus.
 * @param {string} pollId
 * @param {string} option
 */
export async function submitVote(pollId, option) {
    try {
        const res = await fetch(CONFIG.POLL_VOTE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pollId, option, voterId: getVoterId() })
        });
        if (!res.ok) return null;
        localStorage.setItem(MY_VOTE_PREFIX + pollId, option);
        return fetchCurrentPoll();
    } catch {
        return null;
    }
}
