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
    // Fond de carte sombre : CARTO dark_all (public, sans clé API à l'origine) a fini par
    // exiger une clé - chaque tuile renvoyait un filigrane "API KEY REQUIRED" par-dessus la
    // carte (constaté début septembre 2026, confirmé en interrogeant directement l'URL). Basculé
    // sur le fond "Dark Gray Canvas" d'Esri (services.arcgisonline.com), lui aussi public/sans
    // clé, zoom natif jusqu'à 16 (large couverture Europe/France, largement suffisant pour ce
    // niveau ville/région) - vérifié tuile par tuile avant de l'adopter, pas de filigrane.
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © Esri, HERE, Garmin',
        maxZoom: 16
    }).addTo(leafletMap);
    markersLayer = L.layerGroup().addTo(leafletMap);

    // Délégation sur le CONTENEUR du popup (un seul écouteur, pas un par bouton/ligne) plutôt
    // que des écouteurs posés directement sur chaque élément : `_contentNode` lui-même n'est
    // jamais recréé par Leaflet (seul son innerHTML l'est, voir requestAnimationFrame plus bas)
    // - des écouteurs posés à même les boutons seraient donc perdus dès le recalcul de taille.
    leafletMap.on('popupopen', (e) => {
        const marker = e.popup._source;
        const contentNode = e.popup._contentNode;
        contentNode.addEventListener('click', (evt) => {
            const row = evt.target.closest('.meetup-popup-row');
            if (row) {
                const ev = marker._upcomingList?.[Number(row.dataset.eventIndex)];
                if (ev && leafletMap._onMeetupEventClick) leafletMap._onMeetupEventClick(ev);
                return;
            }
            // "Voir la fiche du lieu" ET "+N autres" (V2.2, QOL) mènent au même endroit.
            if (evt.target.closest('.meetup-popup-profile-btn, .meetup-popup-more-btn') && leafletMap._onViewLocationProfile) {
                leafletMap._onViewLocationProfile(marker._cityKey);
            }
        });

        // Filet de sécurité : Leaflet calcule la largeur du popup en mesurant son contenu
        // SYNCHRONEMENT juste après l'avoir injecté (voir Popup._updateLayout). Sur la toute
        // première ouverture d'un popup, la règle CSS de la classe Tailwind "w-52" (utilisée
        // nulle part ailleurs dans l'app, donc jamais encore générée) n'existe pas encore à cet
        // instant précis : le CDN Tailwind (moteur JIT, génération asynchrone via
        // MutationObserver) ne l'injecte que quelques millisecondes plus tard. Leaflet mesure
        // donc un contenu plus étroit que sa taille réelle, et le bouton "Voir la fiche du lieu"
        // déborde du popup - jusqu'à la prochaine ouverture, où la règle est déjà en cache.
        // Reproduit et confirmé : sans ce recalcul différé au frame suivant (le temps que
        // Tailwind ait eu l'occasion d'injecter sa règle), le popup reste trop étroit ; avec,
        // toujours correctement dimensionné dès le premier clic. `popup.update()` réécrit
        // l'innerHTML de `_contentNode` (voir Popup._updateContent) - d'où la délégation
        // ci-dessus plutôt que des écouteurs directs, qui seraient sinon détruits ici même.
        requestAnimationFrame(() => e.popup.update());
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
