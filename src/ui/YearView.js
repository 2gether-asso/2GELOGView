import { DateUtils } from '../utils/DateUtils.js';
import { sanitizeUrl } from '../utils/Html.js';
import { Icons } from './Icons.js';

const MONTH_LABELS_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Jours du mois donné ayant au moins un événement réel, et la première vignette disponible par
 * jour (V2.4, même logique que computeMiniCalendarDayInfo/renderMiniCalendarDay pour le
 * mini-calendrier sidebar dans main.js, dupliquée ici plutôt que partagée - ce module n'a pas
 * accès à `repo`/aux mêmes imports, et la logique est assez courte pour ne pas justifier une
 * factorisation inter-fichiers). */
function computeYearDayInfo(year, month, events) {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const hasEvent = new Set();
    const images = new Map();
    events
        .filter(e => !e.isCanceled && e.start.startsWith(monthPrefix))
        .sort((a, b) => a.start.localeCompare(b.start))
        .forEach(e => {
            const day = parseInt(e.start.split('T')[0].split('-')[2], 10);
            hasEvent.add(day);
            if (!images.has(day)) {
                const url = sanitizeUrl(e.image);
                if (url) images.set(day, url);
            }
        });
    return { hasEvent, images };
}

/** Une case-jour : vignette (fond assombri en dégradé pour garder le numéro lisible) si un
 * événement de ce jour en a une, sinon une simple pastille s'il y a au moins un événement - même
 * gabarit que renderMiniCalendarDay (mini-calendrier sidebar, main.js), juste avec
 * data-year-date au lieu de data-minical-date. */
function renderYearDay(dateStr, day, monthLabel, isToday, imageUrl, hasEvent) {
    const bgAttr = imageUrl ? ` style="background-image:url('${imageUrl}')"` : '';
    const todayRing = isToday ? 'ring-2 ring-indigo-400 ring-inset' : '';
    const colorClasses = imageUrl
        ? 'text-white hover:brightness-125'
        : (isToday ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:bg-white/10 hover:text-white');
    return `
        <button data-year-date="${dateStr}"${bgAttr} aria-label="${day} ${monthLabel}" class="relative aspect-square w-full rounded text-3xs font-bold transition-all overflow-hidden bg-cover bg-center flex items-center justify-center ${todayRing} ${colorClasses}">
            ${imageUrl ? '<span class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" aria-hidden="true"></span>' : ''}
            <span class="relative z-10">${day}</span>
            ${hasEvent && !imageUrl ? '<span class="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-400" aria-hidden="true"></span>' : ''}
        </button>`;
}

function renderMonthCard(year, month, events, todayStr) {
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // 0 = Lundi
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const { hasEvent, images } = computeYearDayInfo(year, month, events);
    const monthLabel = MONTH_LABELS_FULL[month];

    let cells = '';
    for (let i = 0; i < startOffset; i++) cells += `<span></span>`;
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells += renderYearDay(dateStr, d, monthLabel, dateStr === todayStr, images.get(d), hasEvent.has(d));
    }

    return `
        <div class="glass-panel rounded-xl p-3">
            <div class="text-xs font-black text-slate-200 mb-2 text-center capitalize">${monthLabel}</div>
            <div class="grid grid-cols-7 gap-0.5 text-center text-3xs font-bold text-slate-600 mb-1">
                ${WEEKDAY_INITIALS.map(d => `<span>${d}</span>`).join('')}
            </div>
            <div class="grid grid-cols-7 gap-0.5">${cells}</div>
        </div>
    `;
}

/**
 * Vue "Année" (V2.4, "5") : les 12 mois de l'année en un coup d'oeil, pour visualiser la
 * densité globale plutôt que mois par mois - chaque jour reste cliquable (data-year-date,
 * délégué par l'appelant, voir jumpToDate dans main.js) pour sauter directement dessus en vue
 * Calendrier. Toujours calculée sur TOUT le dépôt (comme le mini-calendrier sidebar), pas les
 * événements déjà filtrés ailleurs - annuler un filtre ne doit pas faire "apparaître" des
 * pastilles qui semblaient absentes.
 * @param {HTMLElement} container
 * @param {Array<Object>} events - Tous les événements du dépôt (toutes années confondues)
 * @param {number} year
 */
export function renderYearView(container, events, year) {
    const todayStr = DateUtils.toLocalDateStr(new Date());
    const totalSessions = events.filter(e => !e.isCanceled && !e.isPlanned && new Date(e.start).getFullYear() === year).length;

    const monthsHtml = Array.from({ length: 12 }, (_, month) => renderMonthCard(year, month, events, todayStr)).join('');

    container.innerHTML = `
        <div class="max-w-5xl mx-auto pb-8">
            <div class="flex items-center justify-center gap-3 pt-6 pb-1">
                <button id="year-view-prev" aria-label="Année précédente" class="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all">${Icons.chevronLeft('w-4 h-4')}</button>
                <h1 class="text-2xl font-black text-white tracking-tight w-24 text-center">${year}</h1>
                <button id="year-view-next" aria-label="Année suivante" class="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all">${Icons.chevronRight('w-4 h-4')}</button>
            </div>
            <p class="text-center text-xs text-slate-500 mb-6">${totalSessions} session${totalSessions > 1 ? 's' : ''} sur l'année</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 px-2">${monthsHtml}</div>
        </div>
    `;
}
