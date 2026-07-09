import { DateUtils } from '../utils/DateUtils.js';
import { CONFIG } from '../config.js';

export class DiscordExporter {
    /**
     * Génère un message texte pré-formaté (Markdown Discord) résumant les sessions des 7
     * prochains jours, prêt à coller dans un salon d'annonces — pour ne plus avoir à
     * ressaisir le programme de la semaine à la main. Toujours calculé sur TOUT le dépôt
     * (pas les filtres actifs à l'écran) : c'est une annonce globale, pas une vue personnelle.
     * @param {Array<Object>} events
     * @returns {string}
     */
    static generate(events) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayStr = DateUtils.toLocalDateStr(today);
        const limit = new Date(today); limit.setDate(limit.getDate() + 7);
        const limitStr = DateUtils.toLocalDateStr(limit);

        const upcoming = events
            .filter(e => !e.isCanceled && !e.isPlanned)
            .filter(e => {
                const day = e.start.split('T')[0];
                return day >= todayStr && day < limitStr;
            })
            .sort((a, b) => a.start.localeCompare(b.start));

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
