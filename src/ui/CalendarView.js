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
                left: 'prev,next today',
                center: 'title',
                right: isMobile ? 'listMonth,timeGridDay' : 'dayGridMonth,timeGridWeek,listMonth'
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
                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">${weekday}</span>
                    <span class="flex items-center justify-center w-7 h-7 rounded-full text-sm font-black ${arg.isToday ? 'bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'text-slate-200'}">${arg.date.getDate()}</span>
                `;
                return { domNodes: [wrapper] };
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

            // Vues à créneaux horaires : la journée complète (0h) plutôt qu'une fenêtre resserrée,
            // avec 6h de marge sur le jour suivant (30h = 6h du matin) pour qu'un événement tardif
            // (23h50 → 01h50, voire plus tard) reste toujours entièrement visible dans la colonne
            // de son jour de départ sans jamais être coupé.
            slotMinTime: '00:00:00',
            slotMaxTime: '30:00:00',
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

            // Mémorise la vue active (séparément valide pour mobile et desktop, voir
            // validViews plus haut) et reconstruit les événements FullCalendar : le bornage
            // anti-débordement (voir _buildFcEvents) dépend de la vue affichée, donc changer
            // de vue seul (sans que les données filtrées elles-mêmes changent) doit aussi
            // redéclencher ce calcul.
            datesSet: function(info) {
                localStorage.setItem('ui:calendarView', info.view.type);
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
