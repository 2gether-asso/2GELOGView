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
            const m = l.match(/(\d{2}\/\d{2}\/\d{4})(?:\s+à)?\s*(\d{1,2}:\d{2}(?::\d{2})?)?:\s*(.*)/i);
            return m ? { 
                date: `${m[1].split('/')[2]}-${m[1].split('/')[1]}-${m[1].split('/')[0]}`, 
                heure: m[2] ? this.formatHeure(m[2]) : null, 
                text: m[3].trim() 
            } : null;
        }).filter(x => x);
    }
}