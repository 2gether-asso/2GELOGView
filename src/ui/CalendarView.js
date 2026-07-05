import { renderEventCard, renderCompactEventChip } from './EventCardTemplate.js';

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

        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'fr',
            firstDay: 1, // Lundi
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,listMonth'
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
                wrapper.innerHTML = isTimeGrid ? renderCompactEventChip(originalData) : renderEventCard(originalData);
                return { domNodes: [wrapper] };
            },

            eventClick: function(info) {
                const originalData = info.event.extendedProps.originalData;
                if (originalData && typeof onEventClick === 'function') {
                    onEventClick(originalData);
                }
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
            // Un événement multi-jours (Meet Up étalé) est traité en allDay pour s'afficher
            // comme un bandeau continu ; sinon allDay seulement s'il n'a pas d'heure définie.
            const isAllDay = evt.isMultiDay ? true : !evt.heure;

            return {
                title: evt.title,
                start: evt.start, // La chaîne ISO complète positionnera l'événement à la bonne heure
                end: evt.end || undefined,
                allDay: isAllDay,
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
