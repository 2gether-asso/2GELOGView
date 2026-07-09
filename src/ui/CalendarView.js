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
            editable: false,
            selectable: true,
            dayMaxEvents: false,
            eventDisplay: 'block',
            height: 'auto',
            themeSystem: 'standard',

            // Vues à créneaux horaires : plage resserrée + créneaux de 30min pour éviter
            // les longues colonnes vides qui rendaient le planning illisible.
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

            // Mémorise la vue active (desktop uniquement, mobile reste verrouillé sur Planning).
            datesSet: function(info) {
                if (!isMobile) localStorage.setItem('ui:calendarView', info.view.type);
            }
        });

        return calendar;
    }

    /**
     * Synchronise les données du dépôt d'événements vers FullCalendar.
     */
    static sync(calendarInstance, customEvents) {
        if (!calendarInstance) return;

        calendarInstance.removeAllEvents();

        const fullCalendarEvents = customEvents.map(evt => {
            // Un événement ponctuel qui chevauche minuit (ex: 23h30 → 01h10, voir isMultiDay
            // dans EventGenerator) garde sa vraie heure de fin pour l'indice visuel affiché sur
            // la tuile (getOvernightSuffix, lu depuis originalData ci-dessous), mais on borne la
            // fin transmise à FullCalendar à la fin de la journée de départ : sinon FullCalendar
            // le découpe en un second segment sur le jour suivant, ce qui provoque un débordement
            // visuel et une hauteur de ligne du calendrier incohérente (recalculée différemment
            // selon les jours, y compris au clic sur une tuile). Les vrais bandeaux multi-jours
            // (Meet Up/Partenaire/Sanctuaire, allDay) continuent eux à s'étaler normalement.
            let fcEnd = evt.end || undefined;
            if (evt.isMultiDay && !evt.allDay && fcEnd && fcEnd.split('T')[0] !== evt.start.split('T')[0]) {
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
