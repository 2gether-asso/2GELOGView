import { escapeHtml } from '../utils/Html.js';
import { CITY_COORDINATES } from '../data/CityCoordinates.js';

// Une seule instance Leaflet réutilisée (initMeetupMap n'agit qu'au premier appel) : la
// détruire/recréer à chaque bascule de vue casserait le zoom/pan choisi par l'utilisateur.
let leafletMap = null;
let markersLayer = null;

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
                const ev = marker._eventsList?.[Number(row.dataset.eventIndex)];
                if (ev && leafletMap._onMeetupEventClick) leafletMap._onMeetupEventClick(ev);
            });
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

/**
 * Regroupe les événements par ville reconnue et pose un marqueur par ville avec un popup
 * listant les événements correspondants (cliquables). Les lieux non reconnus (ville hors
 * liste, "Chez Mati"...) n'obtiennent simplement pas de marqueur - non bloquant.
 * @param {Array<Object>} events
 * @param {Function} onEventClick - Appelé avec l'événement cliqué dans un popup
 */
export function updateMeetupMap(events, onEventClick) {
    if (!leafletMap) return;
    leafletMap._onMeetupEventClick = onEventClick;
    markersLayer.clearLayers();

    const byCity = new Map();
    events.forEach(e => {
        const city = matchCity(e.location);
        if (!city) return;
        if (!byCity.has(city)) byCity.set(city, []);
        byCity.get(city).push(e);
    });

    byCity.forEach((cityEvents, city) => {
        const [lat, lng] = CITY_COORDINATES[city];
        const label = city.replace(/\b\w/g, c => c.toUpperCase());
        const sorted = [...cityEvents].sort((a, b) => new Date(b.start) - new Date(a.start));
        const listHtml = sorted.slice(0, 8).map((e, i) => {
            const date = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return `<div class="meetup-popup-row" data-event-index="${i}" style="cursor:pointer;padding:2px 0;">${escapeHtml(e.title)} <span style="opacity:.6">(${date})</span></div>`;
        }).join('');
        const moreCount = sorted.length - Math.min(sorted.length, 8);

        const marker = L.marker([lat, lng]).addTo(markersLayer);
        marker._eventsList = sorted;
        marker.bindPopup(`
            <b>${escapeHtml(label)}</b><br>
            ${cityEvents.length} événement(s)
            <div style="margin-top:4px;">${listHtml}</div>
            ${moreCount > 0 ? `<div style="opacity:.6;margin-top:2px;">+${moreCount} autre(s)</div>` : ''}
        `);
    });
}
