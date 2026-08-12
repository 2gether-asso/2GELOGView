// Poste le programme de la semaine dans un salon Discord via webhook - UNIQUEMENT sur un
// lancement manuel du workflow (voir .github/workflows/jekyll-gh-pages.yml, case à cocher
// "post_discord_digest" du workflow_dispatch), jamais automatiquement : le bouton "🔗 Lancer le
// digest Discord" du mode Admin du site (index.html) ouvre la page Actions du dépôt, où cette
// case doit être cochée avant de lancer. Le digest est un visuel PNG (lundi -> dimanche de la
// semaine EN COURS, voir generate-weekly-image.js) envoyé en pièce jointe du webhook, accompagné
// d'un court message de mention - plus lisible d'un coup d'œil qu'un mur de texte ou une liste de
// liens pour une semaine chargée.
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
import { bucketEventsByWeekday, renderWeeklySchedulePng } from './generate-weekly-image.js';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MEMBER_ROLE_ID = process.env.DISCORD_MEMBER_ROLE_ID;

function isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/** Lundi 00:00 -> dimanche 23:59:59 de la semaine ISO contenant `date` (pas une fenêtre glissante
 * de 7 jours à partir d'aujourd'hui : le programme doit correspondre à "cette semaine-ci" quel
 * que soit le jour où le workflow est lancé manuellement). */
function getIsoWeekRange(date) {
    const day = date.getDay(); // 0 = dimanche ... 6 = samedi
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diffToMonday);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { monday, sunday };
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

    const { monday, sunday } = getIsoWeekRange(new Date());
    const weekNumber = isoWeekNumber(monday);
    // Ni annulées ni "Prévu" (même filtre que DiscordExporter côté app) : le digest montre ce qui
    // va réellement avoir lieu.
    const realSessions = instances.filter(e => !e.isCanceled && !e.isPlanned);
    const eventsByDay = bucketEventsByWeekday(realSessions, monday);
    const pngBuffer = renderWeeklySchedulePng({ monday, sunday, weekNumber, eventsByDay });

    const roleMention = MEMBER_ROLE_ID ? `<@&${MEMBER_ROLE_ID}>` : '@✨ Membres 2GETHER';
    const siteUrl = CONFIG.SITE_URL.replace(/\/$/, '');
    const message = `${roleMention}\n📅 **Programme de la semaine** — le planning complet en temps réel sur ${siteUrl}`;

    // multipart/form-data (FormData/Blob natifs à Node 20+, pas de dépendance supplémentaire) :
    // Discord accepte un fichier joint via `files[0]`, accompagné du payload JSON habituel dans
    // `payload_json` plutôt que dans le Content-Type JSON classique utilisé par l'ancien digest
    // texte (voir historique du fichier) - fetch pose lui-même le bon Content-Type multipart
    // (avec sa boundary) tant qu'on lui laisse un objet FormData comme body, sans l'imposer à la main.
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: message }));
    form.append('files[0]', new Blob([pngBuffer], { type: 'image/png' }), 'programme-semaine.png');

    const webhookRes = await fetch(WEBHOOK_URL, { method: 'POST', body: form });
    if (!webhookRes.ok) {
        throw new Error(`Webhook Discord : HTTP ${webhookRes.status} — ${await webhookRes.text()}`);
    }

    console.log(`Digest hebdomadaire (semaine ${weekNumber}, ${realSessions.length} session(s)) posté sur Discord.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
