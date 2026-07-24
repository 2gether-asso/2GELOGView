// Génère une page HTML statique par occurrence d'événement (dossier /e/) avec ses
// propres balises og:*/twitter:*. Discord (et les autres unfurlers de liens) ne charge
// jamais le JS de l'app : il lit uniquement le HTML brut renvoyé pour l'URL collée. Comme
// index.html est unique et statique (GitHub Pages, pas de backend), un lien direct vers
// "?event=<id>" donnerait toujours le même aperçu générique quel que soit l'événement visé.
// Ce script tourne en CI (voir .github/workflows/jekyll-gh-pages.yml, sur push + toutes les
// heures) : il régénère /e/*.html à partir du tableur en direct, chaque page redirigeant les
// vrais visiteurs vers l'app (?event=<id>) tout en exposant un aperçu correct au robot.
import Papa from 'papaparse';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { CONFIG } from '../src/config.js';
import { EventGenerator } from '../src/services/EventGenerator.js';
import { embedFileName } from '../src/utils/EmbedId.js';

const OUTPUT_DIR = new URL('../e/', import.meta.url);

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// theme.image/@image de l'événement sont des chemins relatifs ("./assets/...") pensés
// pour être servis depuis index.html : og:image exige une URL absolue et joignable par
// le robot Discord, donc on les rebase ici sur CONFIG.SITE_URL.
function resolveImageUrl(image) {
    const fallback = CONFIG.SITE_URL + 'assets/img/default/Mystery Banner.png';
    if (!image) return encodeURI(fallback);
    if (/^https?:\/\//i.test(image)) return image;
    const relative = image.replace(/^\.\//, '');
    return encodeURI(CONFIG.SITE_URL + relative);
}

function buildDescription(instance) {
    const dateLong = new Date(instance.start).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const parts = [instance.type || 'Événement'];
    parts.push(instance.heure ? `${dateLong} à ${instance.heure}` : dateLong);
    if (instance.location) parts.push(instance.location);
    return parts.join(' • ');
}

function renderEmbedPage(instance, targetUrl) {
    const title = escapeHtml(instance.title || '2GELOG');
    const description = escapeHtml(buildDescription(instance));
    const image = resolveImageUrl(instance.image);
    const safeTarget = escapeHtml(targetUrl);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — 2GELOG</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="2GELOG — 2GETHER">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${safeTarget}">
<link rel="canonical" href="${safeTarget}">
</head>
<body>
<script>location.replace(${JSON.stringify(targetUrl)});</script>
<p>Redirection vers <a href="${safeTarget}">${title}</a>…</p>
</body>
</html>
`;
}

async function main() {
    const res = await fetch(CONFIG.CSV_URL);
    if (!res.ok) throw new Error(`Échec du téléchargement du CSV : HTTP ${res.status}`);
    const csvText = await res.text();
    const { data: rows } = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    await rm(OUTPUT_DIR, { recursive: true, force: true });
    await mkdir(OUTPUT_DIR, { recursive: true });

    const usedNames = new Map(); // filename -> id (détecte une éventuelle collision de hash)
    let written = 0;

    for (const row of rows) {
        const title = row["Nom de l'event"]?.trim();
        if (!title) continue;

        let instances;
        try {
            instances = EventGenerator.generate(row);
        } catch {
            continue; // Une ligne invalide ne doit pas casser la génération des autres.
        }

        for (const instance of instances) {
            let fileName = embedFileName(instance.id);
            // Collision de hash (chance infime) : on suffixe pour ne jamais écraser une
            // page existante plutôt que de planter la génération entière.
            let suffix = 2;
            while (usedNames.has(fileName) && usedNames.get(fileName) !== instance.id) {
                fileName = `${embedFileName(instance.id)}-${suffix++}`;
            }
            usedNames.set(fileName, instance.id);

            const targetUrl = `${CONFIG.SITE_URL}?event=${encodeURIComponent(instance.id)}`;
            const html = renderEmbedPage(instance, targetUrl);
            await writeFile(new URL(`${fileName}.html`, OUTPUT_DIR), html, 'utf8');
            written++;
        }
    }

    console.log(`${written} page(s) d'aperçu générées dans /e/.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
