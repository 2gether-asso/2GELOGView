import { CONFIG } from '../config.js';
import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { renderStatusBadge, getOvernightSuffix, getIconSrc } from './EventCardTemplate.js';
import { ReminderService } from '../services/ReminderService.js';
import { embedFileName } from '../utils/EmbedId.js';
import { extractYouTubeId, fetchYouTubeTitle } from '../utils/YouTube.js';
import { IcsExporter } from '../services/IcsExporter.js';
import { Icons } from './Icons.js';
import { showToast } from './Toast.js';
import { renderAvatarInitials } from '../utils/Avatar.js';
import { formatCountdown } from '../utils/Format.js';

const REMINDER_IDLE_CLASS = "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200";
const REMINDER_ACTIVE_CLASS = "bg-indigo-600/80 border-indigo-400 text-white";

// Lieu par défaut (voir EventGenerator) : la carte "Lieu" est masquée quand elle ne
// contient rien de plus informatif que cette valeur par défaut.
const DEFAULT_LOCATION = CONFIG.DEFAULT_LOCATION;

export class ModalView {
    /**
     * Attache les écouteurs d'événements de la modale (fermeture, clic sur tag).
     * Idempotent : peut être appelé plusieurs fois sans dupliquer les listeners.
     * @param {Function} onTagClick - Callback appelé avec le tag (sans #) cliqué dans la modale
     * @param {Function} onReminderChange - Callback appelé (sans argument) après un changement d'abonnement rappel
     * @param {Function} onHostClick - Callback appelé avec le nom (non normalisé) de l'organisateur cliqué
     * @param {Function} getAllEvents - Renvoie le dépôt complet (pour les suggestions "événements similaires")
     */
    static init(onTagClick = null, onReminderChange = null, onHostClick = null, getAllEvents = null) {
        if (this._initialized) return;
        this._initialized = true;
        this._onTagClick = onTagClick;
        this._onReminderChange = onReminderChange;
        this._onHostClick = onHostClick;
        this._getAllEvents = getAllEvents;

        const container = document.getElementById('custom-modal-container');
        const closeBtn = document.getElementById('modal-close-btn');

        closeBtn.addEventListener('click', () => this.hide());
        container.addEventListener('click', (e) => {
            if (e.target === container) this.hide();
        });
        // Accessibilité clavier : Échap ferme la modale, quel que soit l'élément focus.
        // Sauf si la visionneuse Highlights (voir _initLightbox) est ouverte par-dessus : elle
        // doit se fermer en premier (topmost d'abord), pas les deux d'un coup sur un seul Échap.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || container.classList.contains('pointer-events-none')) return;
            const lightbox = document.getElementById('highlight-lightbox');
            if (!lightbox.classList.contains('hidden')) return;
            this.hide();
        });

        this._initLightbox();

        document.getElementById('modal-highlight-clips').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-clip-id]');
            if (btn) this._openLightboxClip(btn.dataset.clipId, btn.dataset.clipFormat);
        });
        document.getElementById('modal-highlight-screens').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-screen-url]');
            if (btn) this._openLightboxImage(btn.dataset.screenUrl);
        });

        // Rappel suivi par titre, pas par instance (voir ReminderService) : fonctionne sur
        // tout type d'événement, et couvre automatiquement chaque nouvelle diffusion pour
        // une série (même titre répété sur plusieurs dates), pas seulement celle ouverte ici.
        // Demande la permission de notification au premier clic si besoin.
        document.getElementById('modal-reminder-btn').addEventListener('click', async (e) => {
            if (!this._currentEventTitle) return;
            if (typeof Notification === 'undefined') {
                window.alert("Les notifications ne sont pas prises en charge par ce navigateur.");
                return;
            }
            if (Notification.permission !== 'granted') {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') return;
            }
            const nowSubscribed = ReminderService.toggle(this._currentEventTitle);
            this._applyReminderButtonStyle();
            // Petit tassement/rebond (V2.2) en plus du changement de couleur, pour un retour bien
            // visible au clic - voir @keyframes confirmPulse dans index.html.
            const btn = e.currentTarget;
            btn.classList.remove('confirm-pulse');
            void btn.offsetWidth;
            btn.classList.add('confirm-pulse');
            showToast(nowSubscribed ? 'Rappel activé !' : 'Rappel désactivé', { icon: Icons.bell('w-3.5 h-3.5 shrink-0 text-indigo-300') });
            if (nowSubscribed) {
                new Notification('2GELOG', { body: `Rappel activé pour "${this._currentEventTitle}" : vous serez prévenu avant chaque prochaine diffusion.` });
            }
            if (this._onReminderChange) this._onReminderChange();
        });

        document.getElementById('modal-event-tags').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const tag = btn.dataset.tag;
            this.hide();
            if (this._onTagClick) this._onTagClick(tag);
        });

        document.getElementById('modal-event-host').addEventListener('click', () => {
            const host = this._currentEventHost;
            if (!host) return;
            this.hide();
            if (this._onHostClick) this._onHostClick(host);
        });

        // Lien partageable : pointe vers la page d'aperçu statique (e/<hash>.html, générée
        // par scripts/generate-embeds.js) plutôt que directement vers "?event=<id>". Collé
        // sur Discord, c'est cette page qui fournit l'aperçu (titre/date/affiche) car le
        // robot ne lit que le HTML statique ; un vrai visiteur y est aussitôt redirigé vers
        // l'app (?event=<id>) sans rien y voir. embedFileName() doit rester identique à celui
        // utilisé côté génération pour que le lien retombe sur le bon fichier.
        // Partage natif (QOL #11) si le navigateur le permet (surtout mobile, feuille de
        // partage vers n'importe quelle appli) ; repli sur la copie presse-papiers sinon
        // (desktop, ou navigateur sans Web Share API) - même bouton, comportement choisi au clic.
        document.getElementById('modal-copy-link-btn').addEventListener('click', async () => {
            if (!this._currentEventId) return;
            const base = new URL('.', window.location.href);
            const url = new URL(`e/${embedFileName(this._currentEventId)}.html`, base);

            if (navigator.share) {
                try {
                    await navigator.share({ title: this._currentEventTitle || '2GELOG', url: url.href });
                    return;
                } catch {
                    // Partage annulé par l'utilisateur (ou échec) : repli silencieux sur la copie
                    // ci-dessous plutôt que de laisser croire que rien ne s'est passé.
                }
            }
            try {
                await navigator.clipboard.writeText(url.href);
                // Toast (V2.2, voir Toast.js) plutôt que de basculer temporairement le contenu du
                // bouton : plus besoin de jongler avec innerHTML/textContent pour préserver son
                // icône SVG inline (l'ancien piège textContent qui l'effaçait, voir historique).
                showToast('Lien copié !', { icon: Icons.link('w-3.5 h-3.5 shrink-0 text-indigo-300') });
            } catch {
                window.prompt("Copiez ce lien :", url.href);
            }
        });

        // Ajout au calendrier (QOL #5) : un seul événement exporté en .ics, distinct de
        // l'export global de l'en-tête (tout le planning affiché) ou du profil organisateur
        // (toutes ses sessions) - réutilise IcsExporter telle quelle sur un lot d'un seul élément.
        document.getElementById('modal-add-to-cal-btn').addEventListener('click', () => {
            if (!this._currentEvent) return;
            const filename = `${(this._currentEvent.title || 'evenement').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-2gelog.ics`;
            IcsExporter.download([this._currentEvent], filename);
        });

        document.getElementById('modal-similar-events').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-similar-id]');
            if (!btn || !this._getAllEvents) return;
            const found = this._getAllEvents().find(ev => ev.id === btn.dataset.similarId);
            if (found) this.open(found);
        });
    }

    /**
     * Ouvre la modale et injecte les données enrichies de l'événement cliqué.
     * @param {Object} event - L'instance de l'événement (tags cliquables, métadonnées, sous-épisodes)
     */
    static open(event) {
        this.init();
        if (!event) return;

        this._currentEvent = event;
        this._currentEventId = event.id || null;
        this._currentEventTitle = event.title || null;
        // Rend l'URL partageable (?event=<id>) sans recharger la page ni polluer
        // l'historique de navigation (remplace l'entrée courante plutôt que d'en empiler une).
        if (event.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('event', event.id);
            window.history.replaceState(null, '', url);
        }

        document.getElementById('modal-event-type').innerText = event.type || "ÉVÉNEMENT";
        document.getElementById('modal-event-status').innerHTML = renderStatusBadge(event.progressStatus);
        document.getElementById('modal-event-title').innerText = event.title;
        document.getElementById('modal-event-time').innerText =
            `Le ${new Date(event.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} ${event.heure ? 'à ' + event.heure + getOvernightSuffix(event) : ''}`;

        // event.location est toujours renseigné par EventGenerator (avec "Discord 2GETHER" par défaut) ;
        // on masque la carte quand elle ne dit rien de plus que cette valeur par défaut.
        const locationContainer = document.getElementById('modal-location-container');
        const timeContainer = document.getElementById('modal-time-container');
        if (event.location && event.location !== DEFAULT_LOCATION) {
            document.getElementById('modal-event-location').innerText = event.location;
            locationContainer.classList.remove('hidden');
            timeContainer.classList.remove('col-span-2');
        } else {
            locationContainer.classList.add('hidden');
            timeContainer.classList.add('col-span-2');
        }

        const iconEl = document.getElementById('modal-event-icon');
        if (event.img) {
            iconEl.src = `./assets/img/badges/${event.img}`;
            iconEl.alt = event.type ? `Icône ${event.type}` : "";
            iconEl.style.display = 'block';
        } else {
            iconEl.style.display = 'none';
        }

        // Affiche/jaquette du film, de la série ou du jeu (event.image résolu par
        // EventGenerator : @image de l'événement, sinon celle par défaut du type).
        const posterContainer = document.getElementById('modal-poster-container');
        const posterUrl = sanitizeUrl(event.image);
        if (posterUrl) {
            const posterEl = document.getElementById('modal-event-poster');
            posterEl.src = posterUrl;
            posterEl.alt = `Affiche : ${event.title}`;
            posterContainer.classList.remove('hidden');
        } else {
            posterContainer.classList.add('hidden');
        }

        // Lien externe (event.url résolu par EventGenerator : @url/@lien/@link de
        // l'événement, sinon celui par défaut du type ; ex: IMDB, Steam, chaîne...).
        this._toggleModalLink('modal-event-link', sanitizeUrl(event.url));
        // @salon : lien direct vers le salon Discord (vocal/textuel) de l'événement.
        this._toggleModalLink('modal-event-salon', sanitizeUrl(event.meta?.salon || event.meta?.discord));
        // @sondage : lien vers un vote externe (Google Form, sondage Discord...), utile
        // pour les événements "à définir" (prochain film/jeu à choisir par la communauté).
        this._toggleModalLink('modal-event-sondage', sanitizeUrl(event.meta?.sondage || event.meta?.vote));

        // Episode(s) : @episode/@diffusion explicite > texte de la ligne datée (sous-épisode)
        // > numéro auto-généré pour les séries. Un seul bloc pour éviter toute confusion
        // entre "diffusion" et "sous-épisode" quand les deux étaient renseignés.
        const episode = event.meta?.episode || event.meta?.diffusion || event.sub || event.episode;
        const subBlock = document.getElementById('modal-sub-block');
        if (episode) {
            document.getElementById('modal-event-sub').innerText = episode;
            subBlock.classList.remove('hidden');
        } else {
            subBlock.classList.add('hidden');
        }

        // Métadonnées avancées (@host ou @orga, Helldwin par défaut si non précisé, @plateforme)
        const hostContainer = document.getElementById('modal-host-container');
        this._currentEventHost = event.meta?.host || event.meta?.orga || CONFIG.DEFAULT_HOST;
        document.getElementById('modal-event-host').innerHTML = `${renderAvatarInitials(this._currentEventHost)}<span class="group-hover:underline">${escapeHtml(this._currentEventHost)}</span>`;
        hostContainer.classList.remove('hidden');

        const platformContainer = document.getElementById('modal-platform-container');
        if (event.meta?.plateforme) {
            document.getElementById('modal-event-platform').innerText = event.meta.plateforme;
            platformContainer.classList.remove('hidden');
        } else {
            platformContainer.classList.add('hidden');
        }

        document.getElementById('modal-event-notes').innerText = event.notes || "Aucune note ou description pour cet événement.";

        this._renderHighlights(event);

        // Le rappel est suivi par titre, pas par occurrence : reste pertinent même si CETTE
        // occurrence précise est déjà terminée (une prochaine diffusion peut exister,
        // notamment pour une série).
        this._applyReminderButtonStyle();

        // Tags cliquables
        const tagsBox = document.getElementById('modal-event-tags');
        if (event.tags && event.tags.length > 0) {
            tagsBox.innerHTML = event.tags.map(t =>
                `<button data-tag="${escapeHtml(t)}" class="text-2xs bg-white/5 border border-white/5 text-indigo-400 hover:text-white hover:bg-indigo-600 px-2 py-0.5 rounded-md transition-all">#${escapeHtml(t)}</button>`
            ).join('');
        } else {
            tagsBox.innerHTML = `<span class="text-slate-600 text-xs italic">Aucun tag</span>`;
        }

        this._renderSimilarEvents(event);

        const modalContainer = document.getElementById('custom-modal-container');
        const modalBox = document.getElementById('custom-modal-box');
        modalContainer.classList.remove('opacity-0', 'pointer-events-none');
        modalBox.classList.remove('scale-95');

        // Accessibilité clavier : mémorise l'élément d'origine et déplace le focus dans la modale.
        this._lastFocused = document.activeElement;
        document.getElementById('modal-close-btn').focus();
    }

    /**
     * Suggestions "événements similaires" (QOL #14) : mêmes tags (le plus significatif, x2),
     * même organisateur, même type - exclut l'événement lui-même ET les autres occurrences du
     * MÊME titre (déjà couvertes par le rappel par titre, voir ReminderService - suggérer "la
     * même série à une autre date" n'apporterait rien de nouveau ici). Uniquement des sessions
     * À VENIR (progressStatus "Prévu") : suggérer un événement déjà terminé (ou même "En Cours",
     * pas encore fini mais déjà entamé) n'aiderait pas à planifier la suite.
     */
    static _renderSimilarEvents(event) {
        const wrap = document.getElementById('modal-similar-container');
        const container = document.getElementById('modal-similar-events');
        const all = this._getAllEvents ? this._getAllEvents() : [];
        const host = event.meta?.host || event.meta?.orga || CONFIG.DEFAULT_HOST;
        const tags = new Set((event.tags || []).map(t => t.toLowerCase()));

        const scored = all
            .filter(e => e.id !== event.id && e.title !== event.title && !e.isCanceled && !e.isPlanned && e.progressStatus === 'Prévu')
            .map(e => {
                let score = 0;
                if (e.type === event.type) score += 1;
                if ((e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST) === host) score += 1;
                score += (e.tags || []).filter(t => tags.has(t.toLowerCase())).length * 2;
                return { e, score };
            })
            .filter(x => x.score > 0)
            // À score égal, la session la plus proche dans le temps d'abord (plutôt que la plus
            // lointaine) : plus utile pour "planifier la suite" que ce qui n'arrivera que dans
            // plusieurs mois.
            .sort((a, b) => b.score - a.score || new Date(a.e.start) - new Date(b.e.start))
            .slice(0, 8);

        if (scored.length === 0) {
            wrap.classList.add('hidden');
            wrap.classList.remove('flex');
            return;
        }

        const VISIBLE_COUNT = 3;
        container.innerHTML = scored.map(({ e }, i) => {
            const dateLabel = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            return `
                <button data-similar-id="${escapeHtml(e.id)}" class="similar-event-row w-full flex items-center gap-2 text-left p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-all ${i >= VISIBLE_COUNT ? 'hidden' : ''}">
                    <img src="${getIconSrc(e)}" alt="" class="w-8 aspect-[8/9] rounded object-cover shrink-0" onerror="this.style.display='none'">
                    <div class="min-w-0 flex-1">
                        <div class="text-xs font-bold text-slate-200 truncate">${escapeHtml(e.title)}</div>
                        <div class="text-2xs text-slate-500">${dateLabel}${e.heure ? ' · ' + e.heure : ''}</div>
                    </div>
                </button>`;
        }).join('') + (scored.length > VISIBLE_COUNT ? `
                <button id="modal-similar-more-btn" class="w-full text-center text-2xs font-bold text-indigo-400 hover:text-indigo-300 py-1.5 transition-colors">Voir plus (${scored.length - VISIBLE_COUNT})</button>` : '');
        wrap.classList.remove('hidden');
        wrap.classList.add('flex');

        const moreBtn = document.getElementById('modal-similar-more-btn');
        if (moreBtn) {
            moreBtn.addEventListener('click', () => {
                container.querySelectorAll('.similar-event-row.hidden').forEach(row => row.classList.remove('hidden'));
                moreBtn.remove();
            });
        }
    }

    /**
     * Bloc "Highlights" (V2.6) : clips/shorts YouTube (@clip:/@short:) et captures d'écran
     * (@screen:), réservé aux événements portant le tag #highlight - avoir ces métadonnées
     * sans ce tag ne suffit pas, pour garder le bloc réservé aux moments choisis plutôt que de
     * l'afficher dès qu'un lien traine dans les métadonnées (voir EventGenerator).
     * @clip (horizontal 16:9) et @short (vertical 9:16, Shorts YouTube) partagent la même
     * extraction d'id (voir extractYouTubeId, un Short reste une vidéo YouTube comme une autre)
     * mais s'affichent dans un format de lecteur différent, distingué via data-clip-format.
     * Uniquement des vignettes ici (miniature + titre) qui ouvrent la visionneuse plein écran
     * au clic (voir _openLightboxClip/_openLightboxImage) - un clip embarqué directement dans
     * la modale gonflait sa hauteur de plusieurs centaines de pixels par clip (empilés) et
     * "coupait" visuellement le reste du contenu, repoussé loin sous le fold.
     */
    static _renderHighlights(event) {
        const container = document.getElementById('modal-highlights-container');
        const clipsBox = document.getElementById('modal-highlight-clips');
        const screensBox = document.getElementById('modal-highlight-screens');
        const isHighlighted = (event.tags || []).includes('highlight');

        const toItems = (values, format) => (values || [])
            .map(v => ({ id: extractYouTubeId(v), format }))
            .filter(item => item.id);
        const clipItems = isHighlighted
            ? [...toItems(event.clips, 'video'), ...toItems(event.shorts, 'short')]
            : [];
        const screenUrls = isHighlighted ? (event.screens || []).map(v => this._resolveScreenUrl(v)).filter(Boolean) : [];

        if (clipItems.length === 0 && screenUrls.length === 0) {
            container.classList.add('hidden');
            container.classList.remove('flex');
            return;
        }
        container.classList.remove('hidden');
        container.classList.add('flex');

        const playIcon = '<svg viewBox="0 0 24 24" class="w-4 h-4 text-white translate-x-[1px]" aria-hidden="true"><polygon points="8 5 19 12 8 19" fill="currentColor" stroke="none"></polygon></svg>';
        clipsBox.innerHTML = clipItems.map(({ id, format }) => {
            const isShort = format === 'short';
            return `
            <button data-clip-id="${id}" data-clip-format="${format}" class="${isShort ? 'w-24' : 'w-40'} shrink-0 snap-start text-left group" aria-label="Voir ${isShort ? 'le short' : 'le clip'} en plein écran">
                <div class="relative ${isShort ? 'aspect-[9/16]' : 'aspect-video'} rounded-lg overflow-hidden border border-white/10 bg-black">
                    <img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-black/25 group-hover:bg-black/10 flex items-center justify-center transition-all">
                        <div class="w-8 h-8 rounded-full bg-rose-600/90 flex items-center justify-center shadow-lg">${playIcon}</div>
                    </div>
                </div>
                <div data-clip-title="${id}" class="text-2xs text-slate-400 font-semibold mt-1 line-clamp-2">${isShort ? 'Short' : 'Clip vidéo'}</div>
            </button>`;
        }).join('');
        clipsBox.classList.toggle('hidden', clipItems.length === 0);

        // Titre réel affiché en second temps (voir fetchYouTubeTitle) : le placeholder
        // générique ci-dessus s'affiche immédiatement, jamais bloqué par ce fetch optionnel.
        clipItems.forEach(({ id }) => {
            fetchYouTubeTitle(id).then(title => {
                if (!title) return;
                const el = clipsBox.querySelector(`[data-clip-title="${id}"]`);
                if (el) el.textContent = title;
            });
        });

        screensBox.innerHTML = screenUrls.map(url => `
            <button data-screen-url="${escapeHtml(url)}" class="block aspect-video rounded-lg overflow-hidden border border-white/10 bg-black/20" aria-label="Voir la capture en plein écran">
                <img src="${escapeHtml(url)}" alt="Capture d'écran" class="w-full h-full object-cover hover:scale-105 transition-transform" loading="lazy">
            </button>`).join('');
        screensBox.classList.toggle('hidden', screenUrls.length === 0);
    }

    /**
     * Une valeur `@screen:` sans schéma (juste un nom de fichier, ex: "zevent-2026.png") est
     * résolue dans assets/img/highlights/ (voir son README.md et GUIDE_METADONNEES.md §11) -
     * pour ne pas obliger à coller une URL complète à chaque capture uploadée dans le repo.
     * Une URL http(s) complète (ex: imgbb, pour qui n'a pas accès en écriture au repo) reste
     * utilisable telle quelle.
     */
    static _resolveScreenUrl(value) {
        if (!value) return '';
        const trimmed = String(value).trim();
        return /^https?:\/\//i.test(trimmed) ? sanitizeUrl(trimmed) : sanitizeUrl(`./assets/img/highlights/${trimmed}`);
    }

    /** Visionneuse plein écran partagée (clip ou capture) - voir #highlight-lightbox. */
    static _initLightbox() {
        const overlay = document.getElementById('highlight-lightbox');
        document.getElementById('btn-close-highlight-lightbox').addEventListener('click', () => this._closeLightbox());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeLightbox(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !overlay.classList.contains('hidden')) this._closeLightbox();
        });
    }

    /**
     * @param {string} format - 'video' (16:9, @clip:) ou 'short' (9:16, @short:) - voir
     * _renderHighlights. Embed natif YouTube (youtube.com, pas youtube-nocookie.com) sur les
     * deux formats.
     */
    static _openLightboxClip(id, format = 'video') {
        const isShort = format === 'short';
        const wrapperClass = isShort ? 'w-full max-w-xs mx-auto aspect-[9/16]' : 'w-full aspect-video';
        document.getElementById('highlight-lightbox-content').innerHTML = `
            <div class="${wrapperClass}">
                <iframe class="w-full h-full rounded-xl" src="https://www.youtube.com/embed/${id}?autoplay=1" title="${isShort ? 'Short' : 'Clip'} YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
            </div>`;
        this._showLightbox();
    }

    static _openLightboxImage(url) {
        document.getElementById('highlight-lightbox-content').innerHTML =
            `<img src="${escapeHtml(url)}" alt="Capture d'écran" class="max-w-full max-h-[85vh] object-contain rounded-xl">`;
        this._showLightbox();
    }

    static _showLightbox() {
        const overlay = document.getElementById('highlight-lightbox');
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }

    static _closeLightbox() {
        const overlay = document.getElementById('highlight-lightbox');
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        // Décharge le contenu (iframe/img) pour couper net une éventuelle lecture vidéo,
        // plutôt que de la laisser tourner en arrière-plan derrière la modale rouverte.
        document.getElementById('highlight-lightbox-content').innerHTML = '';
    }

    /** Applique le style actif/inactif au bouton de rappel selon l'abonnement de CE titre. */
    static _applyReminderButtonStyle() {
        const btn = document.getElementById('modal-reminder-btn');
        const isActive = ReminderService.isSet(this._currentEventTitle);
        btn.className = `w-full flex items-center justify-center gap-2 text-xxs font-bold px-3 py-2 rounded-lg border transition-all ${isActive ? REMINDER_ACTIVE_CLASS : REMINDER_IDLE_CLASS}`;
        const bellIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 shrink-0" aria-hidden="true"><path d="M12 3a5 5 0 0 0-5 5v2c0 3-1.5 4.5-2 5h14c-0.5-0.5-2-2-2-5V8a5 5 0 0 0-5-5z"></path><path d="M9.5 19a2.5 2.5 0 0 0 5 0"></path></svg>';
        btn.innerHTML = `${bellIcon}${isActive ? 'Rappel activé' : "M'envoyer un rappel"}`;

        // Compte à rebours (V2.3, QOL #2) : seulement si CETTE occurrence précise est encore à
        // venir - une fois passée, "dans -3h" n'aurait aucun sens (une prochaine diffusion,
        // si elle existe, sera visible via le panneau Rappels plutôt qu'ici).
        const countdownEl = document.getElementById('modal-reminder-countdown');
        const countdown = this._currentEvent ? formatCountdown(this._currentEvent.start) : null;
        countdownEl.textContent = countdown ? `⏱️ ${countdown}` : '';
        countdownEl.classList.toggle('hidden', !countdown);
    }

    /** Affiche/masque un des boutons-lien optionnels de la modale (fiche/salon/sondage). */
    static _toggleModalLink(elementId, url) {
        const el = document.getElementById(elementId);
        if (url) {
            el.href = url;
            el.classList.remove('hidden');
            el.classList.add('flex');
        } else {
            el.classList.add('hidden');
            el.classList.remove('flex');
        }
    }

    static hide() {
        const modalContainer = document.getElementById('custom-modal-container');
        const modalBox = document.getElementById('custom-modal-box');
        modalContainer.classList.add('opacity-0', 'pointer-events-none');
        modalBox.classList.add('scale-95');

        // Ferme aussi la visionneuse Highlights si elle était restée ouverte par-dessus (ex:
        // clic sur le ✕ de la modale plutôt qu'Échap, qui lui referme la visionneuse en
        // premier) - sans ça un clip lancé continuerait à jouer (son compris) en arrière-plan,
        // la modale n'étant que masquée en CSS (opacity/pointer-events), pas retirée du DOM.
        this._closeLightbox();

        if (this._currentEventId) {
            const url = new URL(window.location.href);
            url.searchParams.delete('event');
            window.history.replaceState(null, '', url);
        }
        this._currentEvent = null;
        this._currentEventId = null;
        this._currentEventTitle = null;
        this._currentEventHost = null;

        // Restaure le focus sur l'élément qui avait ouvert la modale.
        if (this._lastFocused && typeof this._lastFocused.focus === 'function') {
            this._lastFocused.focus();
        }
        this._lastFocused = null;
    }
}
