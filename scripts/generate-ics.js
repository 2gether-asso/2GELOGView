// Génère un flux .ics statique régénéré en continu (voir .github/workflows/jekyll-gh-pages.yml,
// même step que generate-embeds.js : sur push + toutes les heures) à la différence de l'export
// .ics déclenché manuellement depuis l'app (src/services/IcsExporter.js, un instantané ponctuel
// à réimporter à la main) : celui-ci vit à une URL fixe qu'on ajoute UNE fois comme abonnement
// (webcal://) dans Google/Apple/Outlook Calendar, qui se resynchronise ensuite tout seul à
// chaque régénération. Réutilise IcsExporter.generate() à l'identique (100% portable en Node,
// aucune API navigateur) — pas de logique de formatage dupliquée.
import Papa from 'papaparse';
import { mkdir, writeFile } from 'node:fs/promises';
import { CONFIG } from '../src/config.js';
import { EventGenerator } from '../src/services/EventGenerator.js';
import { IcsExporter } from '../src/services/IcsExporter.js';

const OUTPUT_DIR = new URL('../ics/', import.meta.url);
const OUTPUT_FILE = new URL('planning.ics', OUTPUT_DIR);

async function main() {
    const res = await fetch(CONFIG.CSV_URL);
    if (!res.ok) throw new Error(`Échec du téléchargement du CSV : HTTP ${res.status}`);
    const csvText = await res.text();
    const { data: rows } = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    const instances = [];
    rows.forEach(row => {
        if (!row["Nom de l'event"]?.trim()) return;
        try {
            instances.push(...EventGenerator.generate(row));
        } catch {
            // Une ligne invalide ne doit pas casser la génération du reste du flux.
        }
    });

    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(OUTPUT_FILE, IcsExporter.generate(instances), 'utf8');

    console.log(`Flux .ics régénéré (${instances.length} occurrence(s)) : ${OUTPUT_FILE.pathname}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
