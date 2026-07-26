import { DateUtils } from '../utils/DateUtils.js';
import { CONFIG } from '../config.js';
import { embedFileName } from '../utils/EmbedId.js';

export class DiscordExporter {
    /**
     * Événements réels (ni annulés ni "Prévu") dont le début tombe dans les 7 prochains jours,
     * triés chronologiquement — logique de fenêtre partagée par generate() et
     * generateLinkDigest() ci-dessous, pour n'avoir qu'un seul endroit qui la définit.
     * @param {Array<Object>} events
     * @returns {Array<Object>}
     */
    static _getUpcomingWeek(events) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayStr = DateUtils.toLocalDateStr(today);
        const limit = new Date(today); limit.setDate(limit.getDate() + 7);
        const limitStr = DateUtils.toLocalDateStr(limit);

        return events
            .filter(e => !e.isCanceled && !e.isPlanned)
            .filter(e => {
                const day = e.start.split('T')[0];
                return day >= todayStr && day < limitStr;
            })
            .sort((a, b) => a.start.localeCompare(b.start));
    }

    /**
     * Génère un message texte pré-formaté (Markdown Discord) résumant les sessions des 7
     * prochains jours, prêt à coller dans un salon d'annonces — pour ne plus avoir à
     * ressaisir le programme de la semaine à la main. Toujours calculé sur TOUT le dépôt
     * (pas les filtres actifs à l'écran) : c'est une annonce globale, pas une vue personnelle.
     * @param {Array<Object>} events
     * @returns {string}
     */
    static generate(events) {
        const upcoming = this._getUpcomingWeek(events);

        if (upcoming.length === 0) {
            return "📅 **Programme de la semaine**\n\nAucune session prévue pour l'instant.";
        }

        const lines = ["📅 **Programme de la semaine**", ""];
        let lastDay = null;
        upcoming.forEach(e => {
            const dayStr = e.start.split('T')[0];
            if (dayStr !== lastDay) {
                lastDay = dayStr;
                const label = new Date(e.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                lines.push(`**${label.charAt(0).toUpperCase() + label.slice(1)}**`);
            }
            const host = e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST;
            const heure = e.heure ? `${e.heure} — ` : '';
            lines.push(`• ${heure}**${e.title}** _(${e.type})_ — par ${host}`);
        });

        return lines.join('\n');
    }

    /**
     * Variante "liens" du programme de la semaine, pensée pour le webhook automatique (voir
     * scripts/post-discord-digest.js, qui l'entoure de son propre en-tête personnalisé) : au
     * lieu de détailler chaque session en texte, un lien nu vers sa page d'aperçu (voir
     * scripts/generate-embeds.js, même hash `embedFileName` des deux côtés) — collé seul sur sa
     * ligne (jamais en lien markdown `[texte](url)`, qui supprimerait l'unfurl), Discord le
     * déplie automatiquement en une carte enrichie (affiche, titre, date). Beaucoup plus lisible
     * qu'un mur de texte pour une semaine chargée, et épuré : la carte dépliée porte déjà la
     * date/heure, pas besoin de la répéter en légende. Le bouton manuel 💬 Discord garde lui le
     * format texte (generate()) : un organisateur qui colle ce message veut tout voir d'un coup
     * d'œil, sans dépendre du rendu d'unfurl (parfois coupé selon les paramètres du salon).
     * @param {Array<Object>} events
     * @returns {string}
     */
    static generateLinkDigest(events) {
        const upcoming = this._getUpcomingWeek(events);
        if (upcoming.length === 0) return "Aucune session prévue pour l'instant.";
        return upcoming.map(e => `${CONFIG.SITE_URL}e/${embedFileName(e.id)}.html`).join('\n');
    }

    /**
     * Copie le message généré dans le presse-papier ; si l'API Clipboard est indisponible,
     * repli sur une invite `prompt` (comme le lien partageable de la modale, voir ModalView).
     * @param {Array<Object>} events
     * @returns {Promise<boolean>} true si copié directement dans le presse-papier
     */
    static async copyToClipboard(events) {
        const text = this.generate(events);
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            window.prompt("Copiez ce texte :", text);
            return false;
        }
    }
}
