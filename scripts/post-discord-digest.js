// Poste le programme de la semaine dans un salon Discord via webhook - UNIQUEMENT sur un
// lancement manuel du workflow (voir .github/workflows/jekyll-gh-pages.yml, case à cocher
// "post_discord_digest" du workflow_dispatch), jamais automatiquement : le bouton "🔗 Lancer le
// digest Discord" du mode Admin du site (index.html) ouvre la page Actions du dépôt, où cette
// case doit être cochée avant de lancer. Réutilise DiscordExporter.generateLinkDigest() (100%
// portable en Node) : plutôt que du texte, un lien nu par événement vers sa page d'aperçu —
// Discord les déplie en cartes enrichies (affiche, titre, date), bien plus épuré qu'un mur de texte.
//
// Nécessite un secret GitHub Actions DISCORD_WEBHOOK_URL (créé manuellement par un
// organisateur : Discord → Paramètres du salon → Intégrations → Webhooks → Nouveau webhook,
// puis coller l'URL dans Settings → Secrets and variables → Actions de ce dépôt). Sans ce
// secret, le script s'arrête proprement (pas d'erreur) : le digest est juste "pas encore activé".
//
// DISCORD_MEMBER_ROLE_ID (optionnel, même méthode que le webhook) : l'ID du rôle à notifier
// (mode développeur Discord → clic droit sur le rôle → Copier l'ID) ; sans lui, le rôle est
// mentionné en texte simple (pas de notification réelle) plutôt que de faire échouer le script.
import Papa from 'papaparse';
import { CONFIG } from '../src/config.js';
import { EventGenerator } from '../src/services/EventGenerator.js';
import { DiscordExporter } from '../src/services/DiscordExporter.js';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MEMBER_ROLE_ID = process.env.DISCORD_MEMBER_ROLE_ID;
const DISCORD_MESSAGE_LIMIT = 2000;
// Discord ne déplie de façon fiable qu'un nombre limité de liens en cartes dans un même
// message ; au-delà, les événements restants sont comptés mais pas listés individuellement
// (le lien vers le planning complet, déjà dans l'en-tête, prend le relais).
const MAX_EMBEDDED_LINKS = 10;

function isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatDateFr(date) {
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Reproduit le format utilisé manuellement chaque semaine par l'association : à ajuster ici
// directement si le libellé doit changer un jour, c'est le seul endroit qui le définit.
function buildHeader(today) {
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const roleMention = MEMBER_ROLE_ID ? `<@&${MEMBER_ROLE_ID}>` : '@✨ Membres 2GETHER';
    const siteUrl = CONFIG.SITE_URL.replace(/\/$/, '');

    return [
        `# Semaine ${isoWeekNumber(today)} - du ${formatDateFr(today)} au ${formatDateFr(weekEnd)}`,
        `*Nous vous invitons ${roleMention} à découvrir de nouveaux jeux, film et séries en notre compagnie !*`,
        '',
        ':warning:  les évènements sont toujours à 22h00 pour le moment ! :warning:',
        `:small_blue_diamond: Vous pouvez aussi accéder au planning en temps réel également sur : ${siteUrl}`,
        ''
    ].join('\n');
}

async function main() {
    if (!WEBHOOK_URL) {
        console.log("DISCORD_WEBHOOK_URL non configuré (secret GitHub Actions absent) : digest hebdomadaire ignoré.");
        return;
    }
    if (!MEMBER_ROLE_ID) {
        console.log("DISCORD_MEMBER_ROLE_ID non configuré : le rôle sera mentionné en texte simple, sans notifier réellement.");
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

    const linksBlock = DiscordExporter.generateLinkDigest(instances);
    const lines = linksBlock.split('\n');
    const embedded = lines.slice(0, MAX_EMBEDDED_LINKS).join('\n');
    const overflowCount = lines.length - MAX_EMBEDDED_LINKS;
    const overflowNote = overflowCount > 0
        ? `\n\n+${overflowCount} autre(s) événement(s) cette semaine, voir le planning complet ci-dessus.`
        : '';

    let message = buildHeader(new Date()) + embedded + overflowNote;
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
