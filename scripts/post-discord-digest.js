// Poste automatiquement le programme de la semaine dans un salon Discord via webhook (voir
// .github/workflows/jekyll-gh-pages.yml, déclenchement hebdomadaire séparé du rafraîchissement
// horaire des pages d'aperçu). Réutilise DiscordExporter.generate() à l'identique (100%
// portable en Node, mêmes DateUtils/CONFIG que la version copiée manuellement par le bouton
// 💬 Discord de l'app) - pas de logique de formatage dupliquée.
//
// Nécessite un secret GitHub Actions DISCORD_WEBHOOK_URL (créé manuellement par un
// organisateur : Discord → Paramètres du salon → Intégrations → Webhooks → Nouveau webhook,
// puis coller l'URL dans Settings → Secrets and variables → Actions de ce dépôt). Sans ce
// secret, le script s'arrête proprement (pas d'erreur) : le digest est juste "pas encore activé".
import Papa from 'papaparse';
import { CONFIG } from '../src/config.js';
import { EventGenerator } from '../src/services/EventGenerator.js';
import { DiscordExporter } from '../src/services/DiscordExporter.js';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_MESSAGE_LIMIT = 2000;

async function main() {
    if (!WEBHOOK_URL) {
        console.log("DISCORD_WEBHOOK_URL non configuré (secret GitHub Actions absent) : digest hebdomadaire ignoré.");
        return;
    }

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
            // Une ligne invalide ne doit pas casser la génération du digest.
        }
    });

    let message = DiscordExporter.generate(instances);
    // Une semaine très chargée peut dépasser la limite de 2000 caractères d'un message Discord
    // (l'export manuel laisse un humain raccourcir avant de coller ; ici personne ne le fera).
    if (message.length > DISCORD_MESSAGE_LIMIT) {
        const note = '\n… (message tronqué, voir le site pour le programme complet)';
        message = message.slice(0, DISCORD_MESSAGE_LIMIT - note.length) + note;
    }

    const webhookRes = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message })
    });
    if (!webhookRes.ok) {
        throw new Error(`Webhook Discord : HTTP ${webhookRes.status} — ${await webhookRes.text()}`);
    }

    console.log("Digest hebdomadaire posté sur Discord.");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
