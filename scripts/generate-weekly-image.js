// Dessine le programme d'une semaine (lundi -> dimanche) en PNG, pour le digest hebdomadaire
// Discord (voir post-discord-digest.js) : un visuel type "story" que Discord affiche directement
// dans le salon, plus lisible d'un coup d'œil qu'un mur de texte pour une semaine chargée.
// @napi-rs/canvas (binaires précompilés, pas de compilation native requise en CI) plutôt que
// node-canvas : même API Canvas 2D que le navigateur (voir generateOrganizerRecapImage dans
// src/main.js, dont ce fichier reprend les mêmes couleurs/proportions pour rester cohérent avec
// l'identité visuelle du site), mais fiable à installer sur les runners GitHub Actions.
//
// Police : 'sans-serif' générique (résolue par fontconfig sur le runner Ubuntu, pas exactement
// "Plus Jakarta Sans" utilisée par le site faute de pouvoir embarquer le fichier de police ici) -
// suffisant pour un visuel lisible, mais pas un pixel-perfect de la police de marque.
import { createCanvas } from '@napi-rs/canvas';

const WIDTH = 1080;
const PAD = 56;
const FONT = 'sans-serif';
const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const HEADER_HEIGHT = 190;
const FOOTER_HEIGHT = 70;
const DAY_HEADER_HEIGHT = 52;
const EVENT_ROW_HEIGHT = 50;
const EMPTY_DAY_HEIGHT = 40;
const DAY_GAP = 16;
const MAX_TITLE_CHARS = 42;

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function truncate(str, maxChars) {
    return str.length > maxChars ? str.slice(0, maxChars - 1) + '…' : str;
}

function formatDateFr(date) {
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/**
 * Répartit des événements (déjà filtrés : ni annulés ni "Prévu") dans 7 tableaux (lundi -> dimanche)
 * selon leur date de début, triés par heure au sein de chaque jour.
 * @param {Array<Object>} events
 * @param {Date} monday - Minuit du lundi de la semaine ciblée
 * @returns {Array<Array<Object>>} 7 tableaux (index 0 = lundi ... 6 = dimanche)
 */
export function bucketEventsByWeekday(events, monday) {
    const buckets = Array.from({ length: 7 }, () => []);
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        buckets[i].dayStr = dayStr;
    }
    events.forEach(e => {
        const dayStr = e.start.split('T')[0];
        const idx = buckets.findIndex(b => b.dayStr === dayStr);
        if (idx !== -1) buckets[idx].push(e);
    });
    buckets.forEach(b => b.sort((a, b2) => a.start.localeCompare(b2.start)));
    return buckets;
}

/**
 * Génère le PNG du programme de la semaine (lundi -> dimanche), hauteur calculée dynamiquement
 * selon le nombre de sessions (une semaine chargée donne une image plus haute, pas un contenu
 * tassé/débordant dans un cadre fixe).
 * @param {Object} params
 * @param {Date} params.monday - Minuit du lundi de la semaine
 * @param {Date} params.sunday - Le dimanche de la même semaine
 * @param {number} params.weekNumber - Numéro de semaine ISO
 * @param {Array<Array<Object>>} params.eventsByDay - 7 tableaux (voir bucketEventsByWeekday)
 * @returns {Buffer} PNG
 */
export function renderWeeklySchedulePng({ monday, sunday, weekNumber, eventsByDay }) {
    const todayStr = new Date().toISOString().split('T')[0];

    let contentHeight = 0;
    eventsByDay.forEach(dayEvents => {
        contentHeight += DAY_HEADER_HEIGHT;
        contentHeight += dayEvents.length > 0 ? dayEvents.length * EVENT_ROW_HEIGHT : EMPTY_DAY_HEIGHT;
        contentHeight += DAY_GAP;
    });
    const height = HEADER_HEIGHT + contentHeight + FOOTER_HEIGHT;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    // Fond : même dégradé que le corps du site (voir index.html body { background: radial-gradient(...) }).
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#111827');
    bgGrad.addColorStop(1, '#06080c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, WIDTH, height);

    // En-tête marque.
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6366f1';
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText('2GELOG', PAD, 76);
    ctx.fillStyle = '#8b949e';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText('PROGRAMME DE LA SEMAINE', PAD, 106);

    ctx.fillStyle = '#f0f6fc';
    ctx.font = `900 42px ${FONT}`;
    ctx.fillText(`Semaine ${weekNumber} — du ${formatDateFr(monday)} au ${formatDateFr(sunday)}`, PAD, 160, WIDTH - PAD * 2);

    let y = HEADER_HEIGHT;
    eventsByDay.forEach((dayEvents, i) => {
        const dayDate = new Date(monday);
        dayDate.setDate(monday.getDate() + i);
        const dayStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
        const isToday = dayStr === todayStr;

        // Barre d'accent + libellé du jour.
        ctx.fillStyle = isToday ? '#6366f1' : 'rgba(255,255,255,0.08)';
        roundRect(ctx, PAD, y + 4, 6, DAY_HEADER_HEIGHT - 18, 3);
        ctx.fill();
        ctx.fillStyle = isToday ? '#a5b4fc' : '#f0f6fc';
        ctx.font = `800 25px ${FONT}`;
        ctx.fillText(`${DAY_LABELS[i].toUpperCase()} ${dayDate.getDate()}`, PAD + 24, y + 28);
        if (isToday) {
            ctx.fillStyle = '#a5b4fc';
            ctx.font = `700 16px ${FONT}`;
            ctx.fillText("AUJOURD'HUI", PAD + 24, y + 46);
        }
        y += DAY_HEADER_HEIGHT;

        if (dayEvents.length === 0) {
            ctx.fillStyle = '#475569';
            ctx.font = `italic 21px ${FONT}`;
            ctx.fillText('Rien de prévu', PAD + 24, y + 24);
            y += EMPTY_DAY_HEIGHT;
        } else {
            dayEvents.forEach(e => {
                ctx.fillStyle = e.col || '#6366f1';
                ctx.beginPath();
                ctx.arc(PAD + 32, y + 20, 6, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#a5b4fc';
                ctx.font = `700 21px ${FONT}`;
                ctx.fillText(e.heure || '', PAD + 52, y + 27, 76);

                ctx.fillStyle = '#f0f6fc';
                ctx.font = `700 23px ${FONT}`;
                ctx.fillText(truncate(e.title, MAX_TITLE_CHARS), PAD + 140, y + 27, WIDTH - PAD - 140 - PAD);
                y += EVENT_ROW_HEIGHT;
            });
        }
        y += DAY_GAP;
    });

    ctx.fillStyle = '#64748b';
    ctx.font = `600 19px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText('planning.2gether-asso.fr', WIDTH - PAD, height - 32);

    return canvas.toBuffer('image/png');
}
