export class DateUtils {
    static parseDate(s) { 
        if (!s || !s.includes('/')) return null; 
        const [d, m, y] = s.split(' ')[0].split('/'); 
        return new Date(y, m - 1, d, 12, 0); 
    }

    static parseDuration(d) { 
        if (!d || !d.includes(':')) return 0; 
        const [h, m] = d.split(':'); 
        return (parseInt(h) || 0) * 60 + (parseInt(m) || 0); 
    }

    /**
     * Formate un Date en chaîne locale "YYYY-MM-DDTHH:MM:SS" (sans passer par
     * toISOString(), qui convertit en UTC et décalerait l'heure affichée).
     */
    static toLocalIso(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    /**
     * Formate un Date en chaîne locale "YYYY-MM-DD" — jamais via toISOString(), qui convertit
     * en UTC et décale la date d'un jour pour les fuseaux positifs (France : minuit local
     * devient la veille 22h/23h UTC). À utiliser pour toute comparaison "aujourd'hui" /
     * regroupement par jour (sinon "aujourd'hui" est en réalité calculé comme hier).
     */
    static toLocalDateStr(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    static formatHeure(h) {
        if (!h) return null;
        let parts = h.split(':').slice(0, 2);
        if (parts[0].length === 1) parts[0] = '0' + parts[0];
        return parts.join(':');
    }

    static extractSpecificDate(text, kw) { 
        const m = text.match(new RegExp(`${kw}\\s+(\\d{2}/\\d{2}/\\d{4})`, "i")); 
        return m ? this.parseDate(m[1]) : null; 
    }

    static extractDate(text) { 
        const m = text?.match(/\d{2}\/\d{2}\/\d{4}/); 
        return m ? this.parseDate(m[0]) : null; 
    }

    static extractEpisodes(notes) {
        if (!notes) return [];
        return notes.split('\n').map(l => {
            // Espace optionnel entre l'heure et le ":" final (ex: "11/07/2026 20:30 : texte") :
            // sans lui, une ligne écrite avec cet espace ne matchait pas DU TOUT (le ":" collé
            // à l'heure était obligatoire), et perdait silencieusement son heure ET son texte
            // au profit de l'heure/numérotation par défaut de la ligne entière.
            const m = l.match(/(\d{2}\/\d{2}\/\d{4})(?:\s+à)?\s*(\d{1,2}:\d{2}(?::\d{2})?)?\s*:\s*(.*)/i);
            if (!m) return null;
            const { text, durations } = this._extractInlineDurations(m[3].trim());
            return {
                date: `${m[1].split('/')[2]}-${m[1].split('/')[1]}-${m[1].split('/')[0]}`,
                heure: m[2] ? this.formatHeure(m[2]) : null,
                text,
                durations
            };
        }).filter(x => x);
    }

    /**
     * Détecte une liste de durées explicites entre parenthèses en toute fin de texte (ex:
     * "Episodes 3 à 6 (1h,23min,45min,1h)") : une durée réelle par épisode couvert, pour les
     * séries dont la durée varie trop d'un épisode à l'autre pour qu'une simple moyenne de
     * "Durée Réelle" sur toute la ligne soit fiable (voir EventGenerator._computeEpisodeDurations).
     * Chaque jeton entre parenthèses doit ressembler à une durée (que des chiffres/h/min) pour
     * être reconnu — une parenthèse "normale" (ex: "Episode 5 (rediffusion)") reste intacte.
     * @param {string} text
     * @returns {{ text: string, durations: Array<number>|null }} `text` sans la parenthèse
     * de durées si elle a été reconnue (sinon inchangé) ; `durations` en minutes, ou `null`.
     */
    static _extractInlineDurations(text) {
        const match = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (!match) return { text, durations: null };

        const tokens = match[2].split(',').map(t => t.trim()).filter(Boolean);
        const isDurationToken = (t) => /^\d+\s*h(?:\s*\d+)?(?:\s*min)?$/i.test(t) || /^\d+\s*min$/i.test(t) || /^\d+$/.test(t);
        if (tokens.length === 0 || !tokens.every(isDurationToken)) return { text, durations: null };

        return { text: match[1].trim(), durations: tokens.map(t => this.parseHumanDuration(t)) };
    }

    /**
     * Convertit une durée écrite en langage court ("1h", "1h30", "23min", "90") en minutes.
     * Accepte aussi le format "HH:MM" de la colonne "Durée Réelle", par cohérence.
     * @param {string} token
     * @returns {number}
     */
    static parseHumanDuration(token) {
        const t = (token || '').trim().toLowerCase();
        if (!t) return 0;
        if (t.includes(':')) return this.parseDuration(t);

        let minutes = 0;
        let rest = t;
        const h = rest.match(/(\d+)\s*h/);
        if (h) {
            minutes += parseInt(h[1], 10) * 60;
            rest = rest.slice(h.index + h[0].length);
        }
        const m = rest.match(/(\d+)/);
        if (m) minutes += parseInt(m[1], 10);
        return minutes;
    }
}