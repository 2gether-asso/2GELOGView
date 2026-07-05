export class CSVParser {
    /**
     * Télécharge et parse de manière asynchrone le flux CSV public du Google Sheet.
     * @param {string} url - L'url du Google Sheet au format CSV
     * @returns {Promise<Array<Object>>} Tableau de lignes (objets clés/valeurs)
     */
    static fetch(url) {
        return new Promise((resolve, reject) => {
            Papa.parse(url, {
                download: true,
                header: true, // Utilise la première ligne pour nommer les colonnes
                skipEmptyLines: true,
                complete: (results) => {
                    resolve(results.data);
                },
                error: (error) => {
                    reject(error);
                }
            });
        });
    }
}