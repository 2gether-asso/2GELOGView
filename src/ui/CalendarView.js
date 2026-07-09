import { renderEventCard, renderCompactEventChip, renderContinuationChip } from './EventCardTemplate.js';

export class CalendarView {
    /**
     * Initialise et configure l'instance FullCalendar.
     * @param {string} elementId - L'id de la div HTML cible (ex: 'calendar')
     * @param {Function} onEventClick - Callback appelé avec l'événement d'origine (evt) lors d'un clic
     * @returns {Object} L'instance du calendrier FullCalendar
     */
    static create(elementId, onEventClick = null) {
        const calendarEl = document.getElementById(elementId);
        if (!calendarEl) {
            console.error(`Élément #${elementId} introuvable pour initialiser FullCalendar.`);
            return null;
        }

        // Sur mobile, les vues en grille (Mois/Semaine) sont peu lisibles sur un petit
        // écran : on verrouille la vue Planning (liste) en masquant les boutons qui
        // permettraient de basculer vers les autres vues.
        const isMobile = window.matchMedia('(max-width: 639px)').matches;

        // Sur desktop, on rouvre l'app sur la dernière vue utilisée plutôt que de
        // toujours retomber sur "Mois" (non applicable sur mobile, verrouillé sur Planning).
        const savedView = !isMobile && localStorage.getItem('ui:calendarView');
        const validViews = ['dayGridMonth', 'timeGridWeek', 'listMonth'];
        const initialView = isMobile ? 'listMonth' : (validViews.includes(savedView) ? savedView : 'dayGridMonth');

        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView,
            locale: 'fr',
            firstDay: 1, // Lundi
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: isMobile ? '' : 'dayGridMonth,timeGridWeek,listMonth'
            },
            buttonText: {
                today: "Aujourd'hui",
                month: "Mois",
                week: "Semaine",
                list: "Planning"
            },
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

            // Vues à créneaux horaires : plage resserrée à la fenêtre réellement utilisée
            // (les sessions ont toujours lieu entre ~14h et ~2h du matin) plutôt que 00h-24h.
            // Sans ça, un événement tardif (23h50 → 01h50) se retrouvait tout en bas d'une
            // colonne de 24h à faire défiler, presque invisible sans défiler énormément — il
            // ne "manquait" pas de place, mais fallait défiler bien plus que ce qui semblait
            // nécessaire pour l'atteindre. `slotMaxTime` dépasse volontairement minuit (26h =
            // 2h du matin) pour que ces événements de fin de soirée restent bien dans la
            // colonne de leur jour de départ.
            slotMinTime: '14:00:00',
            slotMaxTime: '26:00:00',
            slotDuration: '00:30:00',
            slotLabelInterval: '01:00:00',
            scrollTime: '17:00:00',
            slotEventOverlap: false,
            nowIndicator: true,
            eventMinHeight: 24,

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
                    wrapper.innerHTML = renderContinuationChip(originalData, arg.isEnd);
                } else {
                    wrapper.innerHTML = isTimeGrid ? renderCompactEventChip(originalData) : renderEventCard(originalData);
                }
                return { domNodes: [wrapper] };
            },

            eventClick: function(info) {
                const originalData = info.event.extendedProps.originalData;
                if (originalData && typeof onEventClick === 'function') {
                    onEventClick(originalData);
                }
            },

            // Mémorise la vue active (desktop uniquement, mobile reste verrouillé sur Planning),
            // et reconstruit les événements FullCalendar : le bornage anti-débordement (voir
            // _buildFcEvents) dépend de la vue affichée, donc change de vue seul (sans que les
            // données filtrées elles-mêmes changent) doit aussi redéclencher ce calcul.
            datesSet: function(info) {
                if (!isMobile) localStorage.setItem('ui:calendarView', info.view.type);
                CalendarView._applyEvents(info.view.calendar, CalendarView._lastEvents);
            }
        });

        return calendar;
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
