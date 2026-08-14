import { CONFIG } from '../config.js';

// Mois français -> index 0-based, avec/sans accent (le tableur est saisi à la main par les
// membres, donc on tolère les deux graphies plutôt que de silencieusement ignorer une ligne).
const MONTH_INDEX = {
    janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
    juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11, decembre: 11
};

/** Parse "18 janvier" (voir tableur anniversaires) en {day, month} (mois 0-based, pas d'année : un anniversaire se répète chaque année). */
function parseBirthdayDate(text) {
    if (!text) return null;
    const match = text.trim().toLowerCase().match(/^(\d{1,2})\s+([a-zéû]+)$/i);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = MONTH_INDEX[match[2]];
    if (month === undefined || !day) return null;
    return { day, month };
}

/**
 * Télécharge et parse le tableur public des anniversaires des membres (feuille séparée du
 * planning principal, voir CONFIG.BIRTHDAY_CSV_URL) : deux lignes d'en-tête décoratives (titre
 * de la feuille, puis intitulés de colonnes) précèdent les données, d'où un parsing sans
 * header:true (colonnes repérées par index fixe : B=nom, D=date, F=affiché sur le log) plutôt
 * que le CSVParser.fetch habituel. Ne garde que les lignes avec "Affiché sur le log" = Oui
 * (opt-in explicite des membres) et une date reconnaissable.
 * @returns {Promise<Array<{name: string, day: number, month: number}>>}
 */
export function fetchBirthdays() {
    return new Promise((resolve) => {
        Papa.parse(CONFIG.BIRTHDAY_CSV_URL, {
            download: true,
            header: false,
            skipEmptyLines: true,
            complete: (results) => {
                const out = [];
                results.data.slice(2).forEach(row => {
                    const name = (row[1] || '').trim();
                    const displayed = (row[5] || '').trim().toLowerCase();
                    if (!name || displayed !== 'oui') return;
                    const parsed = parseBirthdayDate(row[3]);
                    if (!parsed) return;
                    out.push({ name, day: parsed.day, month: parsed.month });
                });
                resolve(out);
            },
            // Feuille annexe, purement décorative (bandeau "Aujourd'hui") : une erreur réseau ne
            // doit jamais faire échouer le chargement du planning principal, on résout à vide.
            error: () => resolve([])
        });
    });
}

/** Anniversaires tombant exactement à la date donnée (jour+mois, année ignorée). */
export function birthdaysOn(birthdays, date) {
    return birthdays.filter(b => b.day === date.getDate() && b.month === date.getMonth());
}
