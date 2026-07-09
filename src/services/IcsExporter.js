function pad(n) {
    return String(n).padStart(2, '0');
}

// Toutes les dates de l'app sont des chaînes ISO locales sans fuseau (ex: "2026-06-27T23:30:00") ;
// new Date(...) les interprète comme heure locale du visiteur, on relit ensuite en UTC pour
// produire un horodatage "Z" — le format le plus sûr en .ics (pas besoin de bloc VTIMEZONE,
// chaque logiciel de calendrier reconvertit vers le fuseau local de son utilisateur).
function toIcsUtc(dateInput) {
    const d = new Date(dateInput);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function toIcsDate(dateStr) {
    const [y, m, d] = dateStr.split('T')[0].split('-');
    return `${y}${m}${d}`;
}

function escapeIcsText(text) {
    return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

// RFC5545 : une ligne de contenu doit être repliée au-delà de 75 octets, avec un espace en
// début de ligne suivante. Sans ça, certains clients (Outlook notamment) tronquent ou
// rejettent les lignes trop longues (titres/descriptions longs).
function foldLine(line) {
    if (line.length <= 75) return line;
    let result = '';
    let remaining = line;
    while (remaining.length > 75) {
        result += remaining.slice(0, 75) + '\r\n ';
        remaining = remaining.slice(75);
    }
    return result + remaining;
}

export class IcsExporter {
    /**
     * Génère un fichier .ics (RFC5545) à partir d'une liste d'événements de l'app.
     * Les événements annulés/reportés et les "Prévu" (sans date fiable) sont exclus.
     * @param {Array<Object>} events
     * @returns {string}
     */
    static generate(events) {
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//2GELOG//Planning//FR',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH'
        ];
        const stamp = toIcsUtc(new Date());

        events.filter(e => !e.isCanceled && !e.isPlanned).forEach(e => {
            lines.push('BEGIN:VEVENT');
            lines.push(`UID:${e.id}@2gelog`);
            lines.push(`DTSTAMP:${stamp}`);
            if (e.allDay) {
                lines.push(`DTSTART;VALUE=DATE:${toIcsDate(e.start)}`);
                if (e.end) lines.push(`DTEND;VALUE=DATE:${toIcsDate(e.end)}`);
            } else {
                lines.push(`DTSTART:${toIcsUtc(e.start)}`);
                if (e.end) lines.push(`DTEND:${toIcsUtc(e.end)}`);
            }
            lines.push(foldLine(`SUMMARY:${escapeIcsText(e.title)}`));
            if (e.location) lines.push(foldLine(`LOCATION:${escapeIcsText(e.location)}`));
            const descParts = [e.type, e.notes].filter(Boolean);
            if (descParts.length) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(descParts.join(' — '))}`));
            lines.push('END:VEVENT');
        });

        lines.push('END:VCALENDAR');
        return lines.join('\r\n');
    }

    /** Déclenche le téléchargement d'un .ics généré depuis `events`. */
    static download(events, filename = 'planning-2gelog.ics') {
        const blob = new Blob([this.generate(events)], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
}
