import { DateUtils } from '../utils/DateUtils.js';
import { CONFIG } from '../config.js';

/**
 * Analyse les lignes brutes du CSV (avant génération d'instances) et détecte les
 * anomalies de saisie les plus fréquentes (date de fin avant le début, type
 * inconnu, dates illisibles, incohérence avec les épisodes datés...).
 * Ne bloque jamais l'affichage du calendrier : sert uniquement de rapport pour
 * la personne qui remplit le tableur (visible dans le mode ?admin).
 * @param {Array<Object>} rows - Lignes issues de PapaParse (header: true)
 * @returns {Array<{row:number, title:string, severity:'error'|'warning', message:string}>}
 */
export function validateRows(rows) {
    const anomalies = [];

    rows.forEach((row, idx) => {
        const title = row["Nom de l'event"]?.trim();
        if (!title) return; // Ligne vide, ignorée aussi par EventGenerator.

        // +2 : la ligne 1 du tableur est l'en-tête, et idx est 0-based.
        const rowNumber = idx + 2;
        const startRaw = row["Date de début"];
        const endRaw = row["Date de fin"];
        const type = row["Type d'event"];

        const start = DateUtils.parseDate(startRaw);
        const end = DateUtils.parseDate(endRaw);

        if (startRaw && startRaw.trim() && !start) {
            anomalies.push({ row: rowNumber, title, severity: 'error', message: `Date de début illisible : "${startRaw}"` });
        }
        if (endRaw && endRaw.trim() && !end) {
            anomalies.push({ row: rowNumber, title, severity: 'error', message: `Date de fin illisible : "${endRaw}"` });
        }

        if (start && end && end < start) {
            anomalies.push({ row: rowNumber, title, severity: 'error', message: `Date de fin (${endRaw}) antérieure à la date de début (${startRaw})` });
        }

        if (type && !CONFIG.THEMES[type]) {
            anomalies.push({ row: rowNumber, title, severity: 'warning', message: `Type d'événement inconnu : "${type}" (icône par défaut utilisée)` });
        }

        // Incohérence entre "Date de fin" et le dernier épisode daté noté dans les Notes
        // (ex: fin en septembre alors que le dernier épisode listé est en juin).
        // Fusionne Tags+Notes comme EventGenerator : un épisode daté peut désormais être
        // dans l'une ou l'autre colonne selon l'avancement de la migration de la ligne.
        const rawNotes = [row["Tags"], row["Notes"]].filter(Boolean).join("\n");
        const episodes = DateUtils.extractEpisodes(rawNotes);
        if (episodes.length > 0 && end) {
            const lastEpisodeDate = episodes[episodes.length - 1].date; // format YYYY-MM-DD
            const endIso = end.toISOString().split('T')[0];
            if (lastEpisodeDate !== endIso) {
                anomalies.push({ row: rowNumber, title, severity: 'warning', message: `Date de fin (${endIso}) différente de la date du dernier épisode noté (${lastEpisodeDate})` });
            }
        }
    });

    return anomalies;
}
