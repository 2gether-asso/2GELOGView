import { escapeHtml } from '../utils/Html.js';
import { DateUtils } from '../utils/DateUtils.js';
import { CITY_COORDINATES } from '../data/CityCoordinates.js';
import { umamiCardAttrs } from './EventCardTemplate.js';

// Une seule instance Leaflet réutilisée (initMeetupMap n'agit qu'au premier appel) : la
// détruire/recréer à chaque bascule de vue casserait le zoom/pan choisi par l'utilisateur.
let leafletMap = null;
let markersLayer = null;

// Heatmap de fréquentation (V2.4, "16") : une seule teinte (indigo) du plus clair au plus
// foncé selon le nombre de sessions RELATIF aux autres villes affichées, plutôt qu'une palette
// multi-couleurs qui suggérerait à tort des catégories distinctes (même règle "sequential = une
// teinte" que la palette CATEGORY_COLORS de RetrospectiveView.js). Le chiffre déjà affiché dans
// le pin reste l'encodage principal (règle du "relief" du skill dataviz : la couleur seule ne
// suffit jamais) - la teinte n'est qu'un renfort visuel pour repérer les lieux actifs d'un coup
// d'oeil avant même de lire les chiffres.
const PIN_COLOR_LIGHT = [165, 180, 252]; // indigo-300
const PIN_COLOR_DARK = [67, 56, 202]; // indigo-700
function pinColorForCount(count, maxCount) {
    const t = maxCount > 1 ? (count - 1) / (maxCount - 1) : 1;
    const rgb = PIN_COLOR_LIGHT.map((c, i) => Math.round(c + (PIN_COLOR_DARK[i] - c) * t));
    return `rgb(${rgb.join(',')})`;
}

/** Pin plein avec le nombre de sessions dedans, teinté selon `pinColorForCount` (V2.4), plutôt
 * que l'épingle bleue/rouge par défaut de Leaflet (voir CSS .meetup-marker-pin dans index.html
 * pour l'ombre portée). */
function meetupDivIcon(count, color) {
    return L.divIcon({
        className: 'meetup-marker',
        html: `
            <div class="meetup-marker-pin relative w-8 h-9" style="color: ${color}">
                <svg viewBox="0 0 24 24" class="w-8 h-9" fill="currentColor" stroke="#0d1117" stroke-width="1"><path d="M12 22s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12z"></path></svg>
                <span class="absolute inset-x-0 top-[7px] text-center text-xxs font-black text-white leading-none">${count}</span>
            </div>`,
        iconSize: [32, 36],
        iconAnchor: [16, 34],
        popupAnchor: [0, -32]
    });
}

/** Distance à vol d'oiseau en km entre deux [lat, lng] (formule de Haversine) - utilisé par le
 * filtre carte par rayon (V2.4, "15", voir updateMeetupMap). */
function haversineKm([lat1, lng1], [lat2, lng2]) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Villes reconnues disponibles pour le sélecteur "centre" du filtre par rayon (voir index.html
 * #map-radius-city, peuplé depuis main.js) - juste les clés de CITY_COORDINATES, ré-exposées ici
 * pour ne pas obliger l'appelant à importer directement le fichier de données. */
export function getKnownCityKeys() {
    return Object.keys(CITY_COORDINATES);
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
        // "Voir la fiche du lieu" ET "+N autres" (V2.2, QOL) mènent au même endroit - deux
        // classes distinctes (pas une querySelector unique partagée) pour que les deux gardent
        // chacun leur propre écouteur plutôt que de se marcher dessus.
        e.popup._contentNode.querySelectorAll('.meetup-popup-profile-btn, .meetup-popup-more-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (leafletMap._onViewLocationProfile) leafletMap._onViewLocationProfile(marker._cityKey);
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
 * @param {boolean} [fitBounds] - Cadre la vue sur les marqueurs réels (V2.2, QOL) - seulement à
 *   l'ouverture de la vue Carte (voir mapJustOpened dans main.js), jamais à chaque changement de
 *   filtre une fois déjà dessus, sous peine de faire sauter le zoom/pan choisi par l'utilisateur.
 * @param {{city: string, km: number}|null} [radiusFilter] - Filtre par rayon (V2.4, "15") : ne
 *   garde que les villes à `km` ou moins de la ville centre choisie (voir #map-radius-city dans
 *   index.html) - `null`/ville inconnue = aucun filtre, toutes les villes reconnues s'affichent.
 */
export function updateMeetupMap(events, onEventClick, onViewLocationProfile, fitBounds = false, radiusFilter = null) {
    if (!leafletMap) return;
    leafletMap._onMeetupEventClick = onEventClick;
    leafletMap._onViewLocationProfile = onViewLocationProfile;
    markersLayer.clearLayers();

    const byCity = groupEventsByCity(events);
    if (radiusFilter && CITY_COORDINATES[radiusFilter.city]) {
        const center = CITY_COORDINATES[radiusFilter.city];
        [...byCity.keys()].forEach(city => {
            if (haversineKm(center, CITY_COORDINATES[city]) > radiusFilter.km) byCity.delete(city);
        });
    }
    const todayStr = DateUtils.toLocalDateStr(new Date());
    const maxCount = Math.max(1, ...[...byCity.values()].map(list => list.length));

    byCity.forEach((cityEvents, city) => {
        const [lat, lng] = CITY_COORDINATES[city];
        const label = cityLabel(city);
        const upcoming = cityEvents
            .filter(e => !e.isCanceled && e.start.split('T')[0] >= todayStr)
            .sort((a, b) => a.start.localeCompare(b.start));
        const pastCount = cityEvents.length - upcoming.length;

        const listHtml = upcoming.slice(0, 4).map((e, i) => {
            const date = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            return `<button data-event-index="${i}" class="meetup-popup-row block w-full text-left text-xs text-slate-200 hover:text-white truncate py-1 transition-colors" ${umamiCardAttrs(e, 'meetup-map')}>${escapeHtml(e.title)} <span class="text-slate-500">· ${date}</span></button>`;
        }).join('');
        const moreCount = upcoming.length - Math.min(upcoming.length, 4);

        const marker = L.marker([lat, lng], { icon: meetupDivIcon(cityEvents.length, pinColorForCount(cityEvents.length, maxCount)) }).addTo(markersLayer);
        marker._upcomingList = upcoming;
        marker._cityKey = city;
        marker.bindPopup(`
            <div class="w-52">
                <div class="font-black text-sm text-white">${escapeHtml(label)}</div>
                <div class="text-xxs text-slate-400 mb-2">${upcoming.length} à venir · ${pastCount} passé(s)</div>
                ${listHtml ? `<div class="border-t border-white/10 pt-1.5 mb-1.5">${listHtml}${moreCount > 0 ? `<button class="meetup-popup-more-btn block w-full text-left text-2xs text-slate-500 hover:text-indigo-300 pt-0.5 transition-colors">+${moreCount} autre(s) à venir →</button>` : ''}</div>` : ''}
                <button class="meetup-popup-profile-btn w-full text-center text-xxs font-bold text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg py-1.5 mt-1 transition-all">Voir la fiche du lieu →</button>
            </div>
        `);
    });

    // Cadrage automatique (V2.2, QOL, voir doc du paramètre plus haut) : plafonne le zoom pour
    // qu'une seule ville ne s'affiche pas collée plein cadre, et ignore silencieusement s'il n'y
    // a rien à cadrer (repli sur la vue par défaut centrée sur la France posée par initMeetupMap).
    if (fitBounds && byCity.size > 0) {
        const bounds = L.latLngBounds([...byCity.keys()].map(city => CITY_COORDINATES[city]));
        leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
    }
}
