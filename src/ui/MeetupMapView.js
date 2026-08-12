import { escapeHtml } from '../utils/Html.js';
import { DateUtils } from '../utils/DateUtils.js';
import { CITY_COORDINATES } from '../data/CityCoordinates.js';

// Une seule instance Leaflet réutilisée (initMeetupMap n'agit qu'au premier appel) : la
// détruire/recréer à chaque bascule de vue casserait le zoom/pan choisi par l'utilisateur.
let leafletMap = null;
let markersLayer = null;

/** Pin plein indigo avec le nombre de sessions dedans, plutôt que l'épingle bleue/rouge par
 * défaut de Leaflet (voir CSS .meetup-marker-pin dans index.html pour l'ombre portée). */
function meetupDivIcon(count) {
    return L.divIcon({
        className: 'meetup-marker',
        html: `
            <div class="meetup-marker-pin relative w-8 h-9">
                <svg viewBox="0 0 24 24" class="w-8 h-9 text-indigo-500" fill="currentColor" stroke="#0d1117" stroke-width="1"><path d="M12 22s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12z"></path></svg>
                <span class="absolute inset-x-0 top-[7px] text-center text-[11px] font-black text-white leading-none">${count}</span>
            </div>`,
        iconSize: [32, 36],
        iconAnchor: [16, 34],
        popupAnchor: [0, -32]
    });
}

/**
 * Initialise la carte Leaflet (une seule fois) dans le conteneur donné. Nécessite `L` global,
 * chargé via le CDN Leaflet dans index.html (même pattern que FullCalendar/Tailwind/PapaParse).
 * @param {string} containerId
 */
export function initMeetupMap(containerId) {
    if (leafletMap) return leafletMap;
    // Centré sur la France, zoom raisonnable pour voir plusieurs villes de meetup à la fois.
    leafletMap = L.map(containerId, { scrollWheelZoom: true }).setView([46.6, 2.5], 5.2);
    // Fond de carte sombre (CARTO dark_all, public, sans clé API) pour rester cohérent avec le
    // thème sombre de l'app - le fond clair par défaut de Leaflet jurerait autrement.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19
    }).addTo(leafletMap);
    markersLayer = L.layerGroup().addTo(leafletMap);

    // Un seul écouteur delegué (pas un par marqueur) : le contenu du popup ouvert change à
    // chaque fois, on relit donc `_source`/`_eventsList` au moment de l'ouverture plutôt que
    // d'attacher un écouteur par ligne à la création (qui serait de toute façon détruit par
    // Leaflet qui régénère le DOM du popup à chaque ouverture).
    leafletMap.on('popupopen', (e) => {
        const marker = e.popup._source;
        const rows = e.popup._contentNode.querySelectorAll('.meetup-popup-row');
        rows.forEach(row => {
            row.addEventListener('click', () => {
                const ev = marker._upcomingList?.[Number(row.dataset.eventIndex)];
                if (ev && leafletMap._onMeetupEventClick) leafletMap._onMeetupEventClick(ev);
            });
        });
        const profileBtn = e.popup._contentNode.querySelector('.meetup-popup-profile-btn');
        profileBtn?.addEventListener('click', () => {
            if (leafletMap._onViewLocationProfile) leafletMap._onViewLocationProfile(marker._cityKey);
        });
    });

    return leafletMap;
}

/** Ville reconnue (CITY_COORDINATES) contenue dans le texte du lieu, ou null si aucune ne correspond. */
function matchCity(location) {
    if (!location) return null;
    const normalized = location.trim().toLowerCase();
    if (CITY_COORDINATES[normalized]) return normalized;
    return Object.keys(CITY_COORDINATES).find(city => normalized.includes(city)) || null;
}

/** Libellé affichable d'une clé ville ("montpellier" -> "Montpellier"). */
export function cityLabel(cityKey) {
    return cityKey.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Regroupe les événements par ville reconnue (voir matchCity/CITY_COORDINATES). Les lieux non
 * reconnus (ville hors liste, "Chez Mati"...) sont simplement exclus - non bloquant.
 * @param {Array<Object>} events
 * @returns {Map<string, Array<Object>>} clé ville -> événements de cette ville
 */
export function groupEventsByCity(events) {
    const byCity = new Map();
    events.forEach(e => {
        const city = matchCity(e.location);
        if (!city) return;
        if (!byCity.has(city)) byCity.set(city, []);
        byCity.get(city).push(e);
    });
    return byCity;
}

/**
 * Pose un marqueur par ville avec un popup résumé (compte à venir/passés + quelques prochaines
 * sessions cliquables + bouton vers la fiche complète du lieu, voir openLocationProfile dans
 * main.js). Un lieu sans la moindre session à venir n'affiche que son historique dans le popup
 * (rien à lister en haut) - toujours au moins la fiche complète pour le détail.
 * @param {Array<Object>} events
 * @param {Function} onEventClick - Appelé avec l'événement cliqué dans un popup
 * @param {Function} onViewLocationProfile - Appelé avec la clé ville au clic sur "Voir la fiche"
 */
export function updateMeetupMap(events, onEventClick, onViewLocationProfile) {
    if (!leafletMap) return;
    leafletMap._onMeetupEventClick = onEventClick;
    leafletMap._onViewLocationProfile = onViewLocationProfile;
    markersLayer.clearLayers();

    const byCity = groupEventsByCity(events);
    const todayStr = DateUtils.toLocalDateStr(new Date());

    byCity.forEach((cityEvents, city) => {
        const [lat, lng] = CITY_COORDINATES[city];
        const label = cityLabel(city);
        const upcoming = cityEvents
            .filter(e => !e.isCanceled && e.start.split('T')[0] >= todayStr)
            .sort((a, b) => a.start.localeCompare(b.start));
        const pastCount = cityEvents.length - upcoming.length;

        const listHtml = upcoming.slice(0, 4).map((e, i) => {
            const date = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            return `<button data-event-index="${i}" class="meetup-popup-row block w-full text-left text-xs text-slate-200 hover:text-white truncate py-1 transition-colors">${escapeHtml(e.title)} <span class="text-slate-500">· ${date}</span></button>`;
        }).join('');
        const moreCount = upcoming.length - Math.min(upcoming.length, 4);

        const marker = L.marker([lat, lng], { icon: meetupDivIcon(cityEvents.length) }).addTo(markersLayer);
        marker._upcomingList = upcoming;
        marker._cityKey = city;
        marker.bindPopup(`
            <div class="w-52">
                <div class="font-black text-sm text-white">${escapeHtml(label)}</div>
                <div class="text-[11px] text-slate-400 mb-2">${upcoming.length} à venir · ${pastCount} passé(s)</div>
                ${listHtml ? `<div class="border-t border-white/10 pt-1.5 mb-1.5">${listHtml}${moreCount > 0 ? `<div class="text-[10px] text-slate-500 pt-0.5">+${moreCount} autre(s) à venir</div>` : ''}</div>` : ''}
                <button class="meetup-popup-profile-btn w-full text-center text-[11px] font-bold text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg py-1.5 mt-1 transition-all">Voir la fiche du lieu →</button>
            </div>
        `);
    });
}
