export class CSVParser {
    /**
     * Télécharge et parse de manière asynchrone le flux CSV public du Google Sheet.
     * @param {string} url - L'url du Google Sheet au format CSV
     * @returns {Promise<Array<Object>>} Tableau de lignes (objets clés/valeurs)
     */
    static fetch(url) {
        // Anti-cache : PapaParse (download:true) télécharge l'URL telle quelle, sans option
        // de cache particulière - un rechargement manuel (ex: clic sur le logo, voir goHome
        // dans main.js) vers exactement la même URL pouvait alors être servi directement depuis
        // le cache HTTP du navigateur, SANS repasser par le réseau (et donc sans jamais voir les
        // modifications faites entre-temps sur le tableur) - constaté en observant qu'une
        // deuxième requête vers la même URL n'atteignait jamais le réseau. Un paramètre unique à
        // chaque appel force une VRAIE URL différente à chaque fois, donc un vrai aller-retour
        // réseau garanti (le Service Worker, voir sw.js, applique déjà cache:'no-store' sur ce
        // qu'il intercepte, mais ne protège pas contre le cache HTTP natif du navigateur en
        // amont de lui).
        const cacheBustedUrl = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
        return new Promise((resolve, reject) => {
            Papa.parse(cacheBustedUrl, {
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