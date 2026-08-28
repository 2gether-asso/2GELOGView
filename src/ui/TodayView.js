import { escapeHtml } from '../utils/Html.js';
import { DateUtils } from '../utils/DateUtils.js';
import { renderEventCard, isGenuinelyLive } from './EventCardTemplate.js';
import { Icons } from './Icons.js';
import { EmptyIllustrations, renderEmptyState } from './EmptyState.js';
import { resolveActiveSeason, SEASONS } from '../services/SeasonalTheme.js';
import { birthdaysOn } from '../services/BirthdayService.js';

/** Numéro de semaine ISO 8601 (lundi = 1er jour, semaine 1 = celle contenant le 1er jeudi de l'année). */
function isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    return 1 + Math.round((d - firstThursday) / (7 * 86400000));
}

function dayOfYear(date) {
    return Math.floor((date - new Date(date.getFullYear(), 0, 1)) / 86400000) + 1;
}

function daysInYear(year) {
    return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

/**
 * Page dédiée "Aujourd'hui sur 2GETHER" (bouton 📍 Aujourd'hui de l'en-tête / raccourci clavier
 * T, voir goToTodayView dans main.js) : une vraie page de présentation du programme du jour,
 * plutôt qu'un simple raccourci de navigation dans le calendrier. Toujours calculée sur TOUT le
 * dépôt (l'appelant ne passe que les catégories masquées en moins, voir updateUIState) - comme
 * le bandeau "Prochain événement" ou le résumé quotidien, "aujourd'hui" doit rester une photo
 * fidèle de la vraie journée, indépendante des filtres de navigation actifs ailleurs.
 * @param {HTMLElement} container
 * @param {Array<Object>} events
 * @param {Array<{name: string, day: number, month: number}>} [birthdays] - tableur annexe des
 *   anniversaires de membres opt-in (voir BirthdayService.js), pour le bandeau "C'est
 *   l'anniversaire de..." ci-dessous - vide si le tableur n'a pas pu être chargé.
 * @param {Array<Object>} [allEvents] - TOUT le dépôt (V2.3, "14", "il y a un an ce jour-là") :
 *   contrairement à `events` ci-dessus (déjà réduit aux catégories visibles par l'appelant),
 *   celui-ci doit couvrir toutes les années pour retrouver un éventuel événement au même
 *   jour+mois l'an dernier - vide si non fourni (widget simplement absent).
 * @returns {Array<Object>} Les événements du jour affichés, triés par heure - pour que
 *   l'appelant puisse retrouver l'objet complet au clic (délégation par data-idx).
 */
export function renderTodayView(container, events, birthdays = [], allEvents = []) {
    const now = new Date();
    const todayStr = DateUtils.toLocalDateStr(now);
    const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const todayEvents = events
        .filter(e => !e.isCanceled && !e.isPlanned && e.start.split('T')[0] === todayStr)
        .sort((a, b) => a.start.localeCompare(b.start));
    const canceledToday = events.filter(e => e.isCanceled && e.start.split('T')[0] === todayStr);

    // Quelques repères sur la journée elle-même (V2.2, "remplir de quelques détails") : semaine
    // ISO, avancement dans l'année, et saison active (même résolution "auto/forcée/aucune" que le
    // badge d'en-tête, voir resolveActiveSeason) - purement informatif, aucun effet sur les filtres.
    const dayNum = dayOfYear(now);
    const totalDays = daysInYear(now.getFullYear());
    const seasonCfg = SEASONS[resolveActiveSeason(now)] || null;
    const dayInfoHtml = `
        <div class="flex items-center justify-center gap-x-2 gap-y-1 flex-wrap text-3xs font-bold text-slate-500 mt-1.5" aria-hidden="true">
            <span>Semaine ${isoWeekNumber(now)}</span>
            <span>·</span>
            <span>${dayNum}ᵉ jour sur ${totalDays} (${Math.round((dayNum / totalDays) * 100)}%)</span>
            ${seasonCfg ? `<span>·</span><span>${seasonCfg.emoji} ${escapeHtml(seasonCfg.label)}</span>` : ''}
        </div>
    `;

    // Bandeau anniversaires (V2.3) : purement informatif, alimenté par un tableur annexe
    // distinct du planning (opt-in des membres, voir BirthdayService.js) - un ou plusieurs noms
    // possibles le même jour.
    const todaysBirthdays = birthdaysOn(birthdays, now);
    const birthdayHtml = todaysBirthdays.length > 0 ? `
        <div class="flex items-center justify-center gap-2 max-w-md mx-auto mb-6 px-4 py-2.5 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-200 text-xs font-bold text-center">
            <img src="./assets/img/Birthday_Pin_W.png" alt="" class="w-5 h-5 shrink-0" aria-hidden="true">
            <span>Joyeux anniversaire ${todaysBirthdays.map(b => escapeHtml(b.name)).join(', ')} ! 🎉</span>
        </div>
    ` : '';

    // "Il y a un an, ce jour-là" (V2.3, "14") : même jour+mois l'année précédente, sur TOUT le
    // dépôt (voir allEvents ci-dessus) - un petit clin d'oeil nostalgique, purement informatif.
    // Cliquable (data-event-id, comme les tuiles de la rétrospective) plutôt que data-idx : ces
    // événements ne font pas partie de `todayEvents` retourné à l'appelant pour la délégation
    // habituelle, un identifiant direct est plus simple qu'un second tableau à exposer.
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    // Le 29 février d'une année bissextile n'existe pas l'année précédente (non bissextile) :
    // new Date() ne lève pas d'erreur, il déborde silencieusement sur le 1er mars - détecté ici
    // via le mois obtenu (différent de celui demandé) pour traiter ce cas comme "rien l'an
    // dernier ce jour-là" plutôt que d'afficher les événements de la mauvaise date sous ce titre.
    const oneYearAgoValid = oneYearAgo.getMonth() === now.getMonth();
    const oneYearAgoStr = DateUtils.toLocalDateStr(oneYearAgo);
    const lastYearEvents = oneYearAgoValid ? allEvents
        .filter(e => !e.isCanceled && !e.isPlanned && e.start.split('T')[0] === oneYearAgoStr)
        .sort((a, b) => a.start.localeCompare(b.start)) : [];
    const yearAgoHtml = lastYearEvents.length > 0 ? `
        <div class="max-w-2xl mx-auto mb-6 space-y-2">
            <div class="flex items-center gap-1.5 justify-center text-2xs font-bold uppercase tracking-wider text-slate-500">
                ${Icons.clock('w-3.5 h-3.5 shrink-0')}
                Il y a un an, ce jour-là
            </div>
            <div class="space-y-1.5">
                ${lastYearEvents.map(e => `<div class="cursor-pointer opacity-90 hover:opacity-100 transition-opacity" data-event-id="${escapeHtml(e.id)}">${renderEventCard(e, null, 'today-lastyear')}</div>`).join('')}
            </div>
        </div>
    ` : '';

    const heroHtml = `
        <div class="text-center pt-8 pb-6 space-y-2">
            <div class="flex justify-center text-indigo-400" aria-hidden="true">${Icons.sun('w-12 h-12')}</div>
            <h1 class="text-2xl sm:text-3xl font-black text-white tracking-tight">Aujourd'hui sur 2GETHER</h1>
            <p class="text-slate-400 text-sm capitalize">${escapeHtml(dateLabel)}</p>
            ${dayInfoHtml}
        </div>
    `;

    if (todayEvents.length === 0) {
        container.innerHTML = `
            <div class="max-w-md mx-auto">
                ${heroHtml}
                ${birthdayHtml}
                ${renderEmptyState({
                    illustration: EmptyIllustrations.moon('w-16 h-16'),
                    title: "Rien de programmé aujourd'hui.",
                    subtitle: 'Profitez-en, la suite arrive vite !',
                    extra: canceledToday.length > 0 ? `<p class="inline-flex items-center gap-1 text-xxs text-rose-400/80">${Icons.xCircle('w-3 h-3 shrink-0')}${canceledToday.length} session${canceledToday.length > 1 ? 's' : ''} annulée${canceledToday.length > 1 ? 's' : ''} aujourd'hui</p>` : ''
                })}
            </div>
            ${yearAgoHtml}
        `;
        return [];
    }

    const liveCount = todayEvents.filter(isGenuinelyLive).length;
    const summaryHtml = `
        <div class="flex items-center justify-center gap-2 flex-wrap text-xxs font-bold mb-6">
            <span class="text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-lg">${todayEvents.length} session${todayEvents.length > 1 ? 's' : ''} au programme</span>
            ${liveCount > 0 ? `<span class="inline-flex items-center gap-1.5 text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg animate-pulse"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true"></span>${liveCount} en cours</span>` : ''}
            ${canceledToday.length > 0 ? `<span class="inline-flex items-center gap-1 text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-lg">${Icons.xCircle('w-3 h-3 shrink-0')}${canceledToday.length} annulée${canceledToday.length > 1 ? 's' : ''}</span>` : ''}
        </div>
    `;

    // Repère visuel "maintenant" (comme la ligne rouge des vues Semaine/Jour, voir CalendarView.js) :
    // inséré entre deux cartes à la position chronologique réelle, pas juste devant la première
    // session "à venir" - une frise de la journée doit rester lisible même passé minuit de retard.
    const nowIso = DateUtils.toLocalIso(now);
    let nowMarkerInserted = false;
    const cardsHtml = todayEvents.map((e, idx) => {
        let marker = '';
        if (!nowMarkerInserted && e.start > nowIso) {
            marker = `
                <div class="flex items-center gap-2 py-1" aria-hidden="true">
                    <span class="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] shrink-0"></span>
                    <span class="text-2xs font-black text-rose-400 uppercase tracking-widest">Maintenant · ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span class="flex-1 h-px bg-rose-500/30"></span>
                </div>
            `;
            nowMarkerInserted = true;
        }
        const live = isGenuinelyLive(e);
        return `${marker}<div class="cursor-pointer ${live ? 'ring-2 ring-emerald-500/40 rounded-xl' : ''}" data-idx="${idx}">${renderEventCard(e, null, 'today')}</div>`;
    }).join('');

    container.innerHTML = `
        <div class="max-w-2xl mx-auto pb-8">
            ${heroHtml}
            ${birthdayHtml}
            ${summaryHtml}
            <div class="space-y-1.5">${cardsHtml}</div>
        </div>
        ${yearAgoHtml}
    `;

    return todayEvents;
}
