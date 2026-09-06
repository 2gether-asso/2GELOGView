import { renderEventCard, renderCompactEventChip, renderContinuationChip } from './EventCardTemplate.js';
import { DateUtils } from '../utils/DateUtils.js';
import { showToast } from './Toast.js';

// Garde-fou anti-boucle infinie pour _maybeSkipEmptyRange (navigation qui saute les mois/semaines
// vides sous filtre, voir plus bas) : ~3 ans de mois d'affilée sans résultat n'a physiquement
// aucune chance d'arriver avec un vrai filtre qui matche AU MOINS un événement quelque part
// (déjà vérifié avant de se mettre à sauter) - au-delà, on arrête plutôt que de tourner sans fin.
const MAX_SKIP_ATTEMPTS = 36;

export class CalendarView {
    /**
     * Initialise et configure l'instance FullCalendar.
     * @param {string} elementId - L'id de la div HTML cible (ex: 'calendar')
     * @param {Function} onEventClick - Callback appelé avec l'événement d'origine (evt) lors d'un clic
     * @param {Function} [onExportImageClick] - Callback du bouton 🖼️ Image de la barre d'outils
     *   (V2.3, "10") : appelé avec l'instance FullCalendar elle-même, pour que l'appelant (voir
     *   generateMonthCalendarImage dans main.js) puisse lire la vue/plage actuellement affichée.
     * @returns {Object} L'instance du calendrier FullCalendar
     */
    static create(elementId, onEventClick = null, onExportImageClick = null) {
        const calendarEl = document.getElementById(elementId);
        if (!calendarEl) {
            console.error(`Élément #${elementId} introuvable pour initialiser FullCalendar.`);
            return null;
        }

        // Navigation qui saute les mois/semaines/jours vides quand un filtre est actif (voir
        // CalendarView.setFilterActive, appelé depuis updateUIState dans main.js) : capture
        // (3e argument `true`) plutôt que bubble, pour mémoriser la direction AVANT que le
        // gestionnaire de clic interne de FullCalendar ne déclenche son propre changement de
        // date (et donc `datesSet`, voir plus bas) de façon synchrone dans le même clic.
        calendarEl.addEventListener('click', (e) => {
            if (e.target.closest('.fc-prev-button')) CalendarView._pendingNavDirection = 'prev';
            else if (e.target.closest('.fc-next-button')) CalendarView._pendingNavDirection = 'next';
        }, true);

        // Navigation clavier complète de la grille Mois (V2.4, "18") : chaque case reçoit un
        // tabIndex "roving" (une seule à la fois vaut 0, voir dayCellDidMount plus bas) plutôt
        // que tabIndex=0 sur les 42 cases - le pattern ARIA grid standard, sans quoi Tab
        // s'arrêterait 42 fois pour traverser un seul mois. `kbdFocusDate` retient la case
        // "courante" d'une page à l'autre (survit à un changement de mois déclenché autrement,
        // ex: bouton prev/next) - `data-date` est posé nativement par FullCalendar sur chaque
        // `.fc-daygrid-day`, pas besoin d'un attribut à nous.
        let kbdFocusDate = new Date();
        calendarEl.addEventListener('keydown', (e) => {
            const cell = e.target.closest?.('.fc-daygrid-day[data-date]');
            if (!cell) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                calendar.changeView('timeGridDay', cell.dataset.date);
                return;
            }
            const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
            if (!(e.key in deltas)) return;
            e.preventDefault();
            // stopPropagation obligatoire ici : un raccourci global existant (voir main.js,
            // ←/→ = mois précédent/suivant en vue Calendrier) écoute aussi ces mêmes touches au
            // niveau document et ne s'exclut que sur INPUT/TEXTAREA/SELECT focusé - pas sur une
            // case de la grille. Sans stopPropagation, les deux se déclenchaient l'un après
            // l'autre sur le même appui : le raccourci mois faisait sauter toute la page
            // (re-render complet des cases), détruisant la case qu'on venait tout juste de
            // focaliser et renvoyant le focus sur <body>.
            e.stopPropagation();
            const target = new Date(cell.dataset.date + 'T12:00:00');
            target.setDate(target.getDate() + deltas[e.key]);
            kbdFocusDate = target;
            const targetStr = DateUtils.toLocalDateStr(target);
            const targetCell = calendarEl.querySelector(`.fc-daygrid-day[data-date="${targetStr}"]`);
            if (targetCell) {
                cell.tabIndex = -1;
                targetCell.tabIndex = 0;
                targetCell.focus();
            } else {
                // Hors de la page affichée (ex: ← depuis le 1er du mois) : navigue vers ce
                // mois, puis retente la mise au focus une fois la nouvelle page montée
                // (dayCellDidMount aura déjà posé tabIndex=0 dessus via kbdFocusDate à jour).
                calendar.gotoDate(targetStr);
                requestAnimationFrame(() => calendarEl.querySelector(`.fc-daygrid-day[data-date="${targetStr}"]`)?.focus());
            }
        });

        // Sur mobile, la grille 7 colonnes de la vue Semaine est illisible sur un petit
        // écran : on propose à la place Planning (liste, par défaut) et Jour (grille
        // horaire à une seule colonne, tout aussi précise mais qui tient dans la largeur).
        const isMobile = window.matchMedia('(max-width: 639px)').matches;

        // Rouvre l'app sur la dernière vue utilisée plutôt que de toujours retomber sur le
        // même défaut, mais seulement si cette vue a du sens pour le type d'écran actuel
        // (ex: "Semaine" mémorisée sur desktop ne doit pas s'appliquer en rouvrant sur mobile).
        const desktopViews = ['dayGridMonth', 'timeGridWeek', 'listMonth'];
        const mobileViews = ['listMonth', 'timeGridDay'];
        const validViews = isMobile ? mobileViews : desktopViews;
        const savedView = localStorage.getItem('ui:calendarView');
        const initialView = validViews.includes(savedView) ? savedView : (isMobile ? 'listMonth' : 'dayGridMonth');

        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView,
            locale: 'fr',
            firstDay: 1, // Lundi
            headerToolbar: {
                // Sur mobile, "today" fait doublon avec le 📍 Aujourd'hui déjà présent dans
                // l'en-tête de l'appli et la page dédiée ☀️ Aujourd'hui - retiré uniquement là
                // (refonte Planning V2.2) pour laisser prev/next/titre respirer sur leur ligne.
                left: isMobile ? 'prev,next' : 'prev,next today',
                center: 'title',
                // printBtn (V2.3, "10") : son propre groupe pour rester bien séparé des boutons
                // de bascule de vue. Génère une image PNG structurée de la grille du mois plutôt
                // que de déclencher window.print() - la mise en page navigateur (marges, sauts de
                // page, densité des cases) s'est révélée trop peu fiable d'un navigateur à l'autre
                // pour un rendu "propre" garanti, contrairement à un canvas dessiné nous-mêmes
                // (même logique que generateOrganizerRecapImage/generateRetrospectiveRecapImage).
                right: (isMobile ? 'listMonth,timeGridDay' : 'dayGridMonth,timeGridWeek,listMonth') + ' printBtn'
            },
            customButtons: {
                printBtn: {
                    text: '🖼️ Image',
                    click: () => { if (onExportImageClick) onExportImageClick(calendar); }
                }
            },
            buttonText: {
                today: "📍 Aujourd'hui",
                month: "🗓️ Mois",
                week: "📆 Semaine",
                day: "☀️ Jour",
                list: "📋 Planning"
            },
            // Vue Semaine/Jour : "14h30" plutôt que "14:30", plus naturel en français et
            // cohérent avec le reste de l'UI (aucune donnée n'utilise le format 24h à deux
            // points ailleurs dans l'app).
            slotLabelContent: (arg) => {
                const h = arg.date.getHours();
                const m = arg.date.getMinutes();
                return h + 'h' + (m ? String(m).padStart(2, '0') : '');
            },
            // En-tête de colonne des vues à créneaux horaires (Semaine/Jour) : jour abrégé +
            // numéro dans un badge rond, mis en évidence pour "aujourd'hui" — plus lisible et
            // plus rapide à repérer que le texte plat par défaut de FullCalendar. Les autres
            // vues (Mois) gardent leur rendu par défaut via `arg.text`.
            dayHeaderContent: (arg) => {
                if (!arg.view.type.startsWith('timeGrid')) return arg.text;
                const weekday = arg.date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
                const wrapper = document.createElement('div');
                wrapper.className = 'flex flex-col items-center gap-1 py-1';
                wrapper.innerHTML = `
                    <span class="text-2xs font-bold uppercase tracking-wider text-slate-500">${weekday}</span>
                    <span class="flex items-center justify-center w-7 h-7 rounded-full text-sm font-black ${arg.isToday ? 'bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'text-slate-200'}">${arg.date.getDate()}</span>
                `;
                return { domNodes: [wrapper] };
            },
            // Roving tabIndex + libellé accessible pour la navigation clavier de la grille Mois
            // (V2.4, "18", voir le keydown sur calendarEl plus haut) - une seule case à la fois
            // reçoit tabIndex=0 (celle de kbdFocusDate), toutes les autres -1.
            dayCellDidMount: (arg) => {
                if (arg.view.type !== 'dayGridMonth') return;
                const cellStr = DateUtils.toLocalDateStr(arg.date);
                arg.el.tabIndex = cellStr === DateUtils.toLocalDateStr(kbdFocusDate) ? 0 : -1;
                arg.el.setAttribute('aria-label', arg.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
            },
            // Vue Planning : un seul intitulé par jour ("mercredi 12 août" via CSS
            // text-transform:capitalize) plutôt que le texte secondaire par défaut
            // (abréviation du jour) redondant avec l'intitulé principal.
            listDayFormat: { weekday: 'long', month: 'long', day: 'numeric' },
            listDaySideFormat: false,
            // Le calendrier n'a pas son propre scroller interne (height:'auto' → tout défile
            // dans la section parente), donc le mécanisme natif "en-têtes collants" de
            // FullCalendar viserait cette même section, en concurrence directe avec notre barre
            // d'outils déjà sticky (voir CSS .fc-header-toolbar) et sur un fond transparent
            // (--fc-page-bg-color) : désactivé pour éviter un chevauchement visuel, notre
            // propre design d'en-tête de jour (voir CSS .fc-list-day-cushion) reste lisible
            // sans avoir besoin d'être collant.
            stickyHeaderDates: false,
            // Filet de sécurité : le placeholder "No events to display" de la vue Planning
            // n'est pas toujours traduit malgré locale:'fr' (dépend du chargement effectif
            // du pack de langue) — explicite ici pour ne jamais l'afficher en anglais.
            noEventsText: "Aucun événement à afficher",
            editable: false,
            selectable: true,
            dayMaxEvents: false,
            eventDisplay: 'block',
            height: 'auto',
            themeSystem: 'standard',

            // Vues à créneaux horaires : la journée complète (0h) plutôt qu'une fenêtre resserrée.
            // Vue Semaine arrêtée à 1h du matin le lendemain (25h, V2.2 - demande explicite : une
            // grille plus courte à parcourir, quitte à ce qu'un événement se prolongeant après 1h
            // soit visuellement coupé en bas de grille plutôt que d'agrandir la colonne pour lui).
            slotMinTime: '00:00:00',
            slotMaxTime: '25:00:00',
            slotDuration: '00:30:00',
            slotLabelInterval: '01:00:00',
            scrollTime: '17:00:00',
            slotEventOverlap: false,
            nowIndicator: true,
            // Hauteur mini d'un événement (V2.2, relevée de 24 à 38px) : à 24px, un événement
            // court (ex: 15-20 min) compressait le gabarit compact à 2 lignes (titre + heure/
            // épisode) jusqu'à tronquer le texte - 38px reste proche de la hauteur d'un créneau de
            // 30 min (~42px via .fc-timegrid-slot) donc lisible sans dominer la grille pour autant.
            eventMinHeight: 38,

            // Rendu personnalisé des cases d'événements. Les vues en grille horaire
            // (semaine/jour) utilisent un rendu compact : la carte complète déborde
            // dans une colonne étroite et devenait illisible.
            eventContent: function(arg) {
                const originalData = arg.event.extendedProps.originalData || {};
                const isTimeGrid = arg.view.type === 'timeGridWeek' || arg.view.type === 'timeGridDay';
                const wrapper = document.createElement('div');
                wrapper.className = "w-full h-full cursor-pointer";

                // Un événement multi-jours (chevauchement de minuit, ou bandeau Meet Up
                // étalé) est découpé par FullCalendar en un segment par jour traversé.
                // Seul le premier segment affiche la carte complète ; les suivants
                // n'auraient qu'un fragment tronqué et redondant du même contenu.
                if (originalData.isMultiDay && !arg.isStart) {
                    wrapper.innerHTML = renderContinuationChip(originalData, arg.isEnd, 'calendar');
                } else {
                    wrapper.innerHTML = isTimeGrid ? renderCompactEventChip(originalData, 'calendar') : renderEventCard(originalData, null, 'calendar');
                }
                return { domNodes: [wrapper] };
            },

            eventClick: function(info) {
                const originalData = info.event.extendedProps.originalData;
                if (originalData && typeof onEventClick === 'function') {
                    onEventClick(originalData);
                }
            },

            // Mémorise la vue active (séparément valide pour mobile et desktop, voir
            // validViews plus haut) et reconstruit les événements FullCalendar : le bornage
            // anti-débordement (voir _buildFcEvents) dépend de la vue affichée, donc changer
            // de vue seul (sans que les données filtrées elles-mêmes changent) doit aussi
            // redéclencher ce calcul.
            datesSet: function(info) {
                localStorage.setItem('ui:calendarView', info.view.type);
                CalendarView._applyEvents(info.view.calendar, CalendarView._lastEvents);

                // Consommée immédiatement (une seule tentative de saut par navigation explicite) :
                // un datesSet déclenché autrement (gotoDate depuis le mini-calendrier, chargement
                // initial...) laisse `_pendingNavDirection` à null et ne saute donc jamais - seul
                // un vrai pas prev/next (bouton ou ←/→) arme cette mécanique.
                const direction = CalendarView._pendingNavDirection;
                CalendarView._pendingNavDirection = null;
                if (direction && CalendarView._filterActive) {
                    CalendarView._maybeSkipEmptyRange(info.view.calendar, direction);
                }
            }
        });

        // Filet de sécurité : avec height:'auto', FullCalendar calcule la hauteur des lignes à
        // partir du texte réellement rendu au moment du calcul. Si la police web (Google Fonts)
        // finit de charger APRÈS ce premier calcul (typiquement au tout premier chargement d'un
        // visiteur, police pas encore en cache navigateur), les métriques de la police de repli
        // restent utilisées et les cases apparaissent anormalement grandes jusqu'à ce qu'un
        // reflow quelconque (ex: cliquer dessus) force FullCalendar à recalculer. `document.fonts`
        // est absent de certains navigateurs anciens : no-op silencieux dans ce cas.
        document.fonts?.ready.then(() => calendar.updateSize());

        return calendar;
    }

    /**
     * Étape prev/next explicite (bouton de la barre d'outils déjà géré via le clic capturé dans
     * create(), ceci couvre les autres déclencheurs - ex: raccourcis clavier ←/→, voir main.js)
     * qui doit elle aussi pouvoir sauter les périodes vides sous filtre.
     */
    static goPrev(calendarInstance) {
        if (!calendarInstance) return;
        CalendarView._pendingNavDirection = 'prev';
        calendarInstance.prev();
    }
    static goNext(calendarInstance) {
        if (!calendarInstance) return;
        CalendarView._pendingNavDirection = 'next';
        calendarInstance.next();
    }

    /**
     * Active/désactive la navigation "saute les périodes vides" (voir datesSet ci-dessus) - reflète
     * simplement si AU MOINS un filtre de navigation est actif côté main.js (même condition que le
     * bouton "Annuler les filtres", voir updateUIState) : par défaut (aucun filtre), parcourir le
     * planning ne doit jamais sauter de périodes de sa propre initiative.
     * @param {boolean} active
     */
    static setFilterActive(active) {
        CalendarView._filterActive = active;
    }

    /**
     * Si la période actuellement affichée (mois/semaine/jour selon la vue) ne contient AUCUN
     * événement du dernier jeu filtré, continue automatiquement dans la même direction jusqu'à
     * en retrouver un - évite de cliquer "suivant" une dizaine de fois à travers des mois vides
     * pour un filtre ciblé sur quelques événements épars dans l'année.
     * @param {Object} calendar - Instance FullCalendar (info.view.calendar)
     * @param {'prev'|'next'} direction
     */
    static _maybeSkipEmptyRange(calendar, direction) {
        const events = CalendarView._lastEvents;
        // Rien à trouver nulle part : sauter indéfiniment ne mènerait qu'à MAX_SKIP_ATTEMPTS
        // tentatives pour rien - autant rester sur place tout de suite.
        if (!events || events.length === 0) return;

        const startStr = DateUtils.toLocalDateStr(calendar.view.currentStart);
        const endStr = DateUtils.toLocalDateStr(calendar.view.currentEnd); // exclusif
        const hasEventInRange = events.some(e => {
            const day = e.start.split('T')[0];
            return day >= startStr && day < endStr;
        });

        if (hasEventInRange) {
            // Toast (V2.2, QOL) uniquement si on a VRAIMENT sauté (au moins 1 tentative) - sinon
            // ce serait une simple navigation manuelle normale, rien à confirmer. Sans repère,
            // plusieurs sauts silencieux d'affilée pouvaient donner l'impression d'un clic qui ne
            // répond pas plutôt que d'une navigation qui avance plus vite que d'habitude.
            if (CalendarView._skipAttempts > 0) {
                showToast(`Périodes vides ignorées — ${calendar.view.title}`);
            }
            CalendarView._skipAttempts = 0;
            return;
        }

        CalendarView._skipAttempts++;
        if (CalendarView._skipAttempts > MAX_SKIP_ATTEMPTS) {
            CalendarView._skipAttempts = 0;
            return;
        }

        // Se ré-arme pour le PROCHAIN datesSet déclenché par ce pas supplémentaire - sans ça,
        // `_pendingNavDirection` viendrait d'être remis à null juste avant cet appel.
        CalendarView._pendingNavDirection = direction;
        if (direction === 'prev') calendar.prev(); else calendar.next();
    }

    /**
     * Synchronise les données du dépôt d'événements vers FullCalendar.
     */
    static sync(calendarInstance, customEvents) {
        if (!calendarInstance) return;
        this._lastEvents = customEvents;
        this._applyEvents(calendarInstance, customEvents);
    }

    /** Reconstruit et applique les événements FullCalendar pour la vue actuellement affichée. */
    static _applyEvents(calendarInstance, customEvents) {
        if (!calendarInstance) return;
        calendarInstance.removeAllEvents();

        // Seule la vue Mois (dayGridMonth) a besoin d'un événement borné à une seule journée :
        // chaque jour y est une case de hauteur variable, et un segment de continuation qui
        // déborde sur le jour suivant y provoquait un débordement visuel et une hauteur de
        // ligne incohérente (recalculée différemment selon les jours, y compris au clic sur une
        // tuile). En Semaine/Jour (grille horaire), au contraire, garder la vraie fin est ce qui
        // permet à l'événement de s'étaler sur toute sa durée réelle au lieu d'être écrasé sur
        // quelques minutes visibles en fin de journée (ex: un événement démarrant à 23h50).
        const isMonthView = calendarInstance.view.type === 'dayGridMonth';

        const fullCalendarEvents = customEvents.map(evt => {
            // Un événement ponctuel qui chevauche minuit (ex: 23h30 → 01h10, voir isMultiDay
            // dans EventGenerator) garde toujours sa vraie heure de fin pour l'indice visuel
            // affiché sur la tuile (getOvernightSuffix, lu depuis originalData ci-dessous). Les
            // vrais bandeaux multi-jours (Meet Up/Partenaire/Sanctuaire, allDay) s'étalent eux
            // toujours normalement, quelle que soit la vue.
            let fcEnd = evt.end || undefined;
            if (isMonthView && evt.isMultiDay && !evt.allDay && fcEnd && fcEnd.split('T')[0] !== evt.start.split('T')[0]) {
                fcEnd = evt.start.split('T')[0] + 'T23:59:59';
            }

            return {
                title: evt.title,
                start: evt.start, // La chaîne ISO complète positionnera l'événement à la bonne heure
                end: fcEnd,
                // Calculé par EventGenerator : tout-la-journée pour les bandeaux IRL multi-jours
                // ou les événements sans heure connue, ponctuel (avec heure précise) sinon —
                // y compris pour un événement ponctuel qui chevauche minuit (voir isMultiDay).
                allDay: evt.allDay,
                backgroundColor: evt.col || '#6366f1',
                borderColor: 'transparent',
                extendedProps: {
                    heure: evt.heure,
                    type: evt.type,
                    isCanceled: evt.isCanceled,
                    isPlanned: evt.isPlanned,
                    originalData: evt
                }
            };
        });

        calendarInstance.addEventSource(fullCalendarEvents);
    }
}

CalendarView._lastEvents = [];
CalendarView._filterActive = false;
CalendarView._pendingNavDirection = null;
CalendarView._skipAttempts = 0;
