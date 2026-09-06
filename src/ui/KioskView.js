import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { DateUtils } from '../utils/DateUtils.js';
import { getIconSrc, getOvernightSuffix } from './EventCardTemplate.js';
import { EmptyIllustrations, renderEmptyState } from './EmptyState.js';
import { Icons } from './Icons.js';

/**
 * Construit une tuile-affiche façon Netflix (voir renderKioskShowcase) : image de l'événement
 * en fond (ou dégradé + icône du thème si aucune @image), titre et heure en incrustation.
 * `big` (panneau "Aujourd'hui") = tuile large avec plus de détails ; sinon tuile compacte pour
 * le défilement du reste du mois.
 */
function renderTile(e, big = false) {
    const posterUrl = sanitizeUrl(e.image);
    const bgStyle = posterUrl ? `background-image:url('${posterUrl}')` : `background: linear-gradient(160deg, ${e.col}40, ${e.col}0d)`;
    const sizeClass = big ? 'w-64 aspect-[3/4]' : 'w-40 aspect-[3/4]';
    return `
        <div class="${sizeClass} shrink-0 relative rounded-xl overflow-hidden border border-white/10 bg-cover bg-center shadow-lg shadow-black/40" style="${bgStyle}">
            ${!posterUrl ? `<img src="${getIconSrc(e)}" alt="" class="absolute inset-0 w-full h-full object-cover opacity-50">` : ''}
            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"></div>
            <div class="absolute inset-x-0 bottom-0 p-3 space-y-1">
                <div class="${big ? 'text-base' : 'text-xs'} font-black text-white leading-tight line-clamp-2">${escapeHtml(e.title)}</div>
                ${e.heure ? `<div class="${big ? 'text-sm' : 'text-2xs'} font-bold" style="color:${e.col}">${e.heure}${getOvernightSuffix(e)}</div>` : ''}
            </div>
        </div>`;
}

/**
 * Vue Mode Kiosque (V2.6) : showcase animé façon Netflix pour un écran dédié affiché en continu
 * (partagé dans un salon vocal Discord, écran d'accueil...) - remplace l'ancienne rotation
 * Aujourd'hui/Cette semaine sur la vue Planning FullCalendar, jugée trop "tableur" pour un
 * affichage passif. Deux zones : un panneau "Aujourd'hui" FIXE (les sessions du jour) et un
 * défilement HORIZONTAL CONTINU en boucle (CSS pur, voir @keyframes kioskScroll dans index.html)
 * des affiches du reste des événements du mois en cours qui n'ont pas encore été diffusés.
 * @param {HTMLElement} container
 * @param {Array<Object>} events - Repo complet (pas les événements filtrés par l'utilisateur :
 * un affichage passif partagé n'a pas de raison de dépendre des filtres de qui l'a démarré).
 */
export function renderKioskShowcase(container, events) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = DateUtils.toLocalDateStr(today);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const real = events.filter(ev => !ev.isCanceled && !ev.isPlanned);

    const todayEvents = real
        .filter(ev => DateUtils.toLocalDateStr(new Date(ev.start)) === todayStr)
        .sort((a, b) => new Date(a.start) - new Date(b.start));

    // "reste à diffuser" : le reste du mois, en excluant aujourd'hui (déjà couvert par le
    // panneau fixe ci-dessus) et tout ce qui est déjà Terminé.
    const monthEndStr = DateUtils.toLocalDateStr(monthEnd);
    const upcoming = real
        .filter(ev => {
            // Comparaison par JOUR (pas par horodatage exact) : un événement de ce soir à 20h
            // est bien "aujourd'hui" (déjà dans todayEvents ci-dessus), pas "après aujourd'hui"
            // au sens de `new Date(ev.start) > today` (minuit) - qui l'aurait laissé passer ici
            // aussi et affiché en double dans le panneau fixe ET le défilement.
            const dStr = DateUtils.toLocalDateStr(new Date(ev.start));
            return dStr > todayStr && dStr <= monthEndStr && ev.progressStatus !== 'Terminé';
        })
        .sort((a, b) => new Date(a.start) - new Date(b.start));

    const monthLabel = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const todayHtml = todayEvents.length > 0
        ? `<div class="flex gap-4 overflow-x-auto custom-scroll pb-1">${todayEvents.map(e => renderTile(e, true)).join('')}</div>`
        : renderEmptyState({
            illustration: EmptyIllustrations.calendarEmpty('w-14 h-14'),
            title: "Rien de prévu aujourd'hui.",
            subtitle: "Le reste du mois arrive juste en dessous."
        });

    // Boucle infinie façon carrousel Netflix : la liste est dupliquée une fois, la seconde
    // moitié prenant le relais pile où la première translateX(-50%) s'arrête (voir CSS) - un
    // pur défilement JS (scrollLeft en boucle) scinterait visiblement à chaque retour au début.
    const tickerHtml = upcoming.length > 0
        ? `
            <div class="overflow-hidden w-full">
                <div class="kiosk-ticker-track flex gap-4" style="--kiosk-tile-count:${upcoming.length}">
                    ${upcoming.map(e => renderTile(e)).join('')}
                    ${upcoming.map(e => renderTile(e)).join('')}
                </div>
            </div>`
        : renderEmptyState({
            illustration: EmptyIllustrations.calendarEmpty('w-14 h-14'),
            title: "Plus rien de prévu ce mois-ci."
        });

    container.innerHTML = `
        <div class="w-full h-full flex flex-col justify-center gap-8 px-8 py-6">
            <div class="text-center space-y-1">
                <div class="flex justify-center text-indigo-400" aria-hidden="true">${Icons.film('w-8 h-8')}</div>
                <h1 class="text-xl font-black text-white tracking-tight">2GETHER</h1>
                <p class="text-slate-500 text-xs uppercase tracking-widest font-bold">${monthLabel}</p>
            </div>

            <div class="space-y-3">
                <h2 class="text-sm font-black text-white uppercase tracking-wider px-1">Aujourd'hui</h2>
                ${todayHtml}
            </div>

            <div class="space-y-3">
                <h2 class="text-sm font-black text-white uppercase tracking-wider px-1">Le reste du mois</h2>
                ${tickerHtml}
            </div>
        </div>`;
}
