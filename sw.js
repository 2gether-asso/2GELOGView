// Service worker de l'app (voir manifest.webmanifest) : script classique (pas de type:module)
// pour rester compatible avec les navigateurs qui ne supportent pas encore les service workers
// ES module. Une seule stratégie, appliquée partout (coquille ET CSV) : network-first, avec
// repli sur la dernière copie connue en cache SEULEMENT si le réseau échoue. Un cache-first sur
// la coquille (JS/HTML/CSS) a été essayé puis abandonné : sans revalidation, un navigateur qui
// a chargé l'app une seule fois continue de servir cette version figée indéfiniment, même après
// des dizaines de mises à jour du code — des boutons ajoutés depuis n'apparaissent jamais, ou
// pire, un HTML neuf se retrouve appairé à un JS ancien (état "chimère" incohérent). Le cache
// ne sert donc plus qu'à un scénario précis : rester utilisable hors-ligne, jamais à économiser
// une requête réseau quand une connexion est disponible.
//
// Bump VERSION à chaque déploiement pour purger l'ancien cache (moins critique maintenant que
// le réseau prime toujours quand il est disponible, mais garde les caches d'éviter de gonfler).
const VERSION = 'v3';
const SHELL_CACHE = `2gelog-shell-${VERSION}`;
const CSV_CACHE = `2gelog-csv-${VERSION}`;

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== SHELL_CACHE && k !== CSV_CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

function networkFirst(request, cacheName) {
    // fetch(request) tel quel resterait soumis au cache HTTP ordinaire du navigateur (une
    // seconde couche de cache, en plus de celle du Service Worker) : une réponse "fraîche selon
    // les heuristiques HTTP" pourrait être servie sans jamais retoucher le réseau, recréant
    // exactement le problème de staleness qu'on essaie d'éviter ici. { cache: 'no-store' } force
    // un aller-retour réseau réel à chaque fois.
    //
    // Une requête de navigation (le document HTML lui-même, `request.mode === 'navigate'`) ne
    // peut pas être réinstanciée avec un override (Chrome lève une exception) : on repart alors
    // de l'URL seule, sans risque puisqu'une navigation est toujours same-origin. Pour tout le
    // reste, repartir de l'URL seule serait une RÉGRESSION : ça réinitialise le `mode` de la
    // requête à 'cors' par défaut, alors qu'un <script src> cross-origin sans attribut
    // `crossorigin` (FullCalendar/Tailwind/PapaParse/Leaflet/Google Fonts, tous chargés ainsi)
    // est en 'no-cors' — repartir de l'URL faisait donc échouer ces requêtes ("Failed to fetch",
    // CDN sans en-têtes CORS) dès que le Service Worker prenait le contrôle de la page, cassant
    // silencieusement tout le style/toutes les libs après le tout premier chargement. Reconstruire
    // depuis `request` (pas juste son URL) préserve son `mode` d'origine.
    const fetchRequest = request.mode === 'navigate'
        ? new Request(request.url, { cache: 'no-store' })
        : new Request(request, { cache: 'no-store' });

    return fetch(fetchRequest)
        .then(response => {
            // N'archive qu'une réponse exploitable (200 same-origin, ou opaque cross-origin
            // réussie pour les scripts CDN) : jamais une erreur, pour ne pas figer un 404/500.
            if (response && (response.ok || response.type === 'opaque')) {
                const clone = response.clone();
                caches.open(cacheName).then(cache => cache.put(request, clone));
            }
            return response;
        })
        .catch(() => caches.match(request));
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const cacheName = url.hostname.endsWith('docs.google.com') ? CSV_CACHE : SHELL_CACHE;
    event.respondWith(networkFirst(request, cacheName));
});
