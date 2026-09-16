import { CONFIG } from '../config.js';
import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { renderStatusBadge, getOvernightSuffix, getIconSrc, resolveEventImage } from './EventCardTemplate.js';
import { getCachedTmdbInfo, fetchTmdbInfo, isTmdbEligible, parseSeasonNumber, parseEpisodeNumbers, parseSeasonEpisode, getCachedSeasonEpisodes, fetchTmdbSeason } from '../services/TMDBService.js';
import { ReminderService } from '../services/ReminderService.js';
import { embedFileName } from '../utils/EmbedId.js';
import { renderHighlightsRow, enhanceHighlightTitles, hasHighlights, isLightboxOpen, closeLightbox, renderInlineYouTubePlayer } from './HighlightsView.js';
import { extractYouTubeId } from '../utils/YouTube.js';
import { IcsExporter } from '../services/IcsExporter.js';
import { Icons } from './Icons.js';
import { showToast } from './Toast.js';
import { renderAvatarInitials } from '../utils/Avatar.js';
import { formatCountdown, formatMinutes } from '../utils/Format.js';

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

        // Glisser gauche/droite (V3.0, tactile) pour passer à l'événement chronologiquement
        // suivant/précédent, même geste que le carrousel Highlights (voir attachGallerySwipeHandlers
        // dans HighlightsView.js, mêmes seuils) - sans preventDefault : un vrai scroll vertical du
        // contenu (grand dy, petit dx) n'est jamais intercepté, seul un geste surtout HORIZONTAL
        // déclenche la navigation.
        const modalBox = document.getElementById('custom-modal-box');
        let touchStartX = 0, touchStartY = 0;
        modalBox.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].clientX;
            touchStartY = e.changedTouches[0].clientY;
        }, { passive: true });
        modalBox.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            this._navigateToAdjacentEvent(dx < 0 ? 1 : -1);
        }, { passive: true });
        // Accessibilité clavier : Échap ferme la modale, quel que soit l'élément focus.
        // Sauf si la visionneuse Highlights (voir HighlightsView.js) est ouverte par-dessus :
        // elle doit se fermer en premier (topmost d'abord), pas les deux d'un coup sur un seul
        // Échap.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || container.classList.contains('pointer-events-none')) return;
            if (isLightboxOpen()) return;
            this.hide();
        });

        // Rappel suivi par titre, pas par instance (voir ReminderService) : fonctionne sur
        // tout type d'événement, et couvre automatiquement chaque nouvelle diffusion pour
        // une série (même titre répété sur plusieurs dates), pas seulement celle ouverte ici.
        // Demande la permission de notification au premier clic si besoin.
        document.getElementById('modal-reminder-btn').addEventListener('click', async (e) => {
            // Capturé AVANT tout `await` : `Event.currentTarget` est remis à `null` par le
            // navigateur une fois la phase de dispatch de l'événement terminée (dès le premier
            // point de suspension asynchrone, même sur une Promise déjà résolue) - le lire APRÈS
            // un await (comme c'était le cas juste avant `.classList.remove` plus bas) plantait
            // silencieusement dès que ce chemin passait effectivement par un `await` (constaté
            // avec la permission de notification déjà accordée).
            const btn = e.currentTarget;
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
    /**
     * Ouvre l'événement chronologiquement suivant (+1) ou précédent (-1) par rapport à celui
     * actuellement affiché (V3.0, voir le glisser tactile dans init()) - s'appuie sur le même
     * callback `getAllEvents` que les suggestions "Vous aimerez peut-être", trié sur `start` à la
     * volée (pas de tri mémorisé : la liste peut changer entre deux ouvertures de modale).
     * Silencieux (rien à ouvrir) en bout de liste ou si l'événement courant n'y figure plus.
     */
    static _navigateToAdjacentEvent(direction) {
        if (!this._getAllEvents || !this._currentEvent) return;
        const sorted = [...this._getAllEvents()].filter(e => !e.isCanceled).sort((a, b) => a.start.localeCompare(b.start));
        const idx = sorted.findIndex(e => e.id === this._currentEventId);
        if (idx === -1) return;
        const next = sorted[idx + direction];
        if (next) this.open(next);
    }

    /**
     * Mémorise la position de défilement de la vue liste actuellement visible (Frise/Recherche/
     * Aujourd'hui/Année/Planning-Mois-Semaine) AVANT de l'obscurcir par la modale (V3.0) - restaurée
     * par _restoreListScroll au ferme (voir hide()), pour ne pas perdre sa place en refermant.
     * Chaque vue liste a son propre scroll indépendant SAUF le calendrier FullCalendar en
     * `height:'auto'` (voir CalendarView.js), qui ne scrolle pas lui-même : c'est son conteneur
     * englobant (`<section>`) qui le fait, d'où le repli sur `.closest('section')`.
     */
    static _captureListScroll() {
        const paneIds = ['timeline-view', 'search-results', 'today-view', 'year-view'];
        for (const id of paneIds) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
                this._savedScrollEl = el;
                this._savedScrollTop = el.scrollTop;
                return;
            }
        }
        const section = document.getElementById('calendar')?.closest('section');
        this._savedScrollEl = section || null;
        this._savedScrollTop = section ? section.scrollTop : 0;
    }

    static _restoreListScroll() {
        if (!this._savedScrollEl) return;
        this._savedScrollEl.scrollTop = this._savedScrollTop;
        this._savedScrollEl = null;
    }

    static open(event) {
        this.init();
        if (!event) return;

        // Seulement au changement RÉEL de vue liste (pas d'une modale à l'autre via le glisser
        // tactile/les suggestions, où la vue liste sous-jacente n'a de toute façon pas bougé
        // pendant que la modale la recouvrait) - éviter d'écraser une valeur déjà correcte par
        // une lecture inutile ne coûte rien mais reste plus explicite ainsi.
        if (!this._currentEvent) this._captureListScroll();

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
            `Le ${new Date(event.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ${event.heure ? 'à ' + event.heure + getOvernightSuffix(event) : ''}`;

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

        // Affiche/jaquette du film, de la série ou du jeu (@image de l'événement > affiche TMDB
        // déjà en cache > bannière par défaut du type, voir resolveEventImage) - fond du bandeau
        // d'en-tête (V2.7.1, voir #modal-header/#modal-header-scrim dans index.html), pas un
        // bloc séparé. Peut être remplacée un peu plus tard par une vraie affiche TMDB si pas
        // encore en cache à cet instant précis - voir _renderTmdbInfo, même logique "placeholder
        // puis enrichi" que le titre des clips YouTube (HighlightsView.js).
        this._setHeaderImage(resolveEventImage(event), { instant: true });

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

        this._renderTmdbInfo(event, episode);

        // Métadonnées avancées (@host ou @orga, Helldwin par défaut si non précisé, @plateforme)
        const hostContainer = document.getElementById('modal-host-container');
        this._currentEventHost = event.meta?.host || event.meta?.orga || CONFIG.DEFAULT_HOST;
        // Compteur "X sessions" (V3.0) - déjà visible sur le PROFIL dédié de l'organisateur, mais
        // fallait jusque-là le quitter la modale pour le voir. Affiché seulement au-delà d'une
        // session (le cas courant "1 session" n'apporte rien d'utile à signaler ici).
        let hostCountLabel = '';
        if (this._getAllEvents) {
            const count = this._getAllEvents().filter(e => !e.isCanceled && (e.meta?.host || e.meta?.orga || CONFIG.DEFAULT_HOST) === this._currentEventHost).length;
            if (count > 1) hostCountLabel = ` <span class="text-3xs text-slate-500 font-normal">· ${count} sessions</span>`;
        }
        document.getElementById('modal-event-host').innerHTML = `${renderAvatarInitials(this._currentEventHost)}<span class="group-hover:underline">${escapeHtml(this._currentEventHost)}</span>${hostCountLabel}`;
        hostContainer.classList.remove('hidden');

        // Plateforme (@plateforme) si renseignée, sinon Durée réelle en repli (V2.7.1), sinon
        // durée officielle TMDB en second repli (V2.9, voir _renderPlatform/_renderTmdbInfo) :
        // pour un film pas encore diffusé, event.dur (Durée Réelle du tableur) est encore vide.
        this._renderPlatform(event);

        // Masqué entièrement (pas un texte de repli "Aucune note...") quand il n'y a réellement
        // rien à montrer - un bloc vide n'apporte rien, contrairement aux autres cartes qui ont
        // toutes une valeur par défaut significative (lieu, host...).
        const notesContainer = document.getElementById('modal-notes-container');
        if (event.notes) {
            document.getElementById('modal-event-notes').innerText = event.notes;
            notesContainer.classList.remove('hidden');
        } else {
            notesContainer.classList.add('hidden');
        }
        this._renderNotesVideo(event.notes);

        this._renderHighlights(event);

        // Le rappel est suivi par titre, pas par occurrence : reste pertinent même si CETTE
        // occurrence précise est déjà terminée (une prochaine diffusion peut exister,
        // notamment pour une série).
        this._applyReminderButtonStyle();

        // Tags cliquables - masqué entièrement (pas un texte de repli "Aucun tag") quand
        // l'événement n'en a réellement aucun.
        const tagsContainer = document.getElementById('modal-tags-container');
        const tagsBox = document.getElementById('modal-event-tags');
        if (event.tags && event.tags.length > 0) {
            tagsBox.innerHTML = event.tags.map(t =>
                `<button data-tag="${escapeHtml(t)}" class="text-2xs bg-white/5 border border-white/5 text-indigo-400 hover:text-white hover:bg-indigo-600 px-2 py-0.5 rounded-md transition-all">#${escapeHtml(t)}</button>`
            ).join('');
            tagsContainer.classList.remove('hidden');
        } else {
            tagsContainer.classList.add('hidden');
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
     * l'afficher dès qu'un lien traine dans les métadonnées (voir EventGenerator). Rendu et
     * lecteur plein écran partagés avec les autres vues qui affichent des highlights (ex:
     * "Aujourd'hui sur 2GETHER") - voir HighlightsView.js, pas de logique dupliquée ici.
     */
    static _renderHighlights(event) {
        const block = document.getElementById('modal-highlights-block');
        const row = document.getElementById('modal-highlights-row');
        if (!hasHighlights(event)) {
            block.classList.add('hidden');
            block.classList.remove('flex');
            row.innerHTML = '';
            return;
        }
        block.classList.remove('hidden');
        block.classList.add('flex');
        row.innerHTML = renderHighlightsRow(event);
        enhanceHighlightTitles(row);
    }

    /**
     * Lien YouTube détecté TEL QUEL dans les Notes complémentaires libres (V2.9, voir
     * #modal-notes-video dans index.html) - un organisateur colle souvent un lien de
     * rediffusion directement dans les Notes sans passer par la métadonnée @clip: dédiée
     * (réservée aux événements tagués #highlight, voir _renderHighlights ci-dessus) : cette
     * vignette fonctionne pour N'IMPORTE QUEL événement, indépendamment du tag #highlight.
     * Masqué s'il n'y a aucune note ou qu'aucun lien YouTube n'y est trouvé.
     * @param {string} notes
     */
    static _renderNotesVideo(notes) {
        const el = document.getElementById('modal-notes-video');
        const videoId = notes ? extractYouTubeId(notes) : null;
        if (!videoId) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }
        el.innerHTML = renderInlineYouTubePlayer(videoId);
        el.classList.remove('hidden');
    }

    /**
     * Carte "Plateforme"/"Durée" (V2.7.1, repli TMDB V2.9 - voir #modal-platform-container dans
     * index.html) : @plateforme > Durée Réelle du tableur (event.dur) > durée officielle TMDB
     * (`runtimeMinutes`, uniquement pour un FILM pas encore diffusé - une série n'a pas UNE durée
     * unique). Appelée deux fois par open() : une première fois sans `runtimeMinutes` (donnée pas
     * encore disponible, synchrone), une seconde depuis _renderTmdbInfo si la fiche TMDB arrive
     * avec une durée ET qu'aucun des deux premiers cas n'a déjà rempli la carte - idempotente,
     * un appel qui ne change rien au résultat ne fait que réécrire la même chose.
     * @param {Object} event
     * @param {number|null} [runtimeMinutes]
     */
    static _renderPlatform(event, runtimeMinutes = null) {
        const platformContainer = document.getElementById('modal-platform-container');
        const platformLabel = document.getElementById('modal-platform-label');
        const TV_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"></rect><line x1="8" y1="3" x2="12" y2="6"></line><line x1="16" y1="3" x2="12" y2="6"></line></svg>';
        if (event.meta?.plateforme) {
            platformLabel.innerHTML = `${TV_ICON}Plateforme`;
            document.getElementById('modal-event-platform').innerText = event.meta.plateforme;
            platformContainer.classList.remove('hidden');
        } else if (event.dur > 0) {
            platformLabel.innerHTML = `${Icons.clock('w-3 h-3')}Durée`;
            document.getElementById('modal-event-platform').innerText = formatMinutes(event.dur);
            platformContainer.classList.remove('hidden');
        } else if (runtimeMinutes) {
            platformLabel.innerHTML = `${Icons.clock('w-3 h-3')}Durée (TMDB)`;
            document.getElementById('modal-event-platform').innerText = formatMinutes(runtimeMinutes);
            platformContainer.classList.remove('hidden');
        } else {
            platformContainer.classList.add('hidden');
        }
    }

    /**
     * Applique le style actif/inactif au bouton de rappel selon l'abonnement de CE titre
     * (V2.7.1 : simple icône cloche dans le bandeau d'en-tête, plus un bouton pleine largeur -
     * voir index.html). Couleur (indigo si actif) plutôt qu'une icône différente (cloche
     * barrée...) : cohérent avec les autres boutons du bandeau, qui ne changent jamais de forme
     * selon leur état, seulement de teinte.
     */
    static _applyReminderButtonStyle() {
        const btn = document.getElementById('modal-reminder-btn');
        const isActive = ReminderService.isSet(this._currentEventTitle);
        btn.className = `p-1.5 rounded-lg transition-all ${isActive ? 'text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20' : 'text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10'}`;
        btn.innerHTML = Icons.bell('w-4 h-4');

        // Compte à rebours (V2.3, QOL #2), seulement si CETTE occurrence précise est encore à
        // venir ("dans -3h" n'aurait sinon aucun sens) - plus de place pour l'afficher en dur une
        // fois le bouton réduit à une icône : replié dans le title/aria-label (info au survol).
        const countdown = this._currentEvent ? formatCountdown(this._currentEvent.start) : null;
        const label = isActive
            ? `Rappel activé${countdown ? ' — ' + countdown : ''} (cliquer pour désactiver)`
            : "M'envoyer un rappel avant le début de cet événement";
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }

    /**
     * Fiche TMDB (V2.7) : uniquement pour les événements Film/Série (catégorie "visionnage" -
     * voir config.js, ça couvre aussi "Hors Prog" qui héberge pas mal de séries en pratique).
     * Applique immédiatement ce qui est déjà en cache (voir getCachedTmdbInfo, synchrone), puis
     * enrichit en second temps si pas encore en cache (fetchTmdbInfo, async) - même logique
     * "placeholder puis enrichi" que le titre des clips YouTube. `eventId` capturé au moment de
     * l'appel : si l'utilisateur a déjà refermé/changé de modale quand la réponse arrive, elle
     * est silencieusement ignorée plutôt que d'écraser le contenu d'un événement différent.
     * `@tmdb:` (event.meta.tmdb) prime sur la recherche par titre - voir parseTmdbRef dans
     * TMDBService.js, pour les cas où la recherche automatique se trompe ou ne trouve rien.
     * @param {Object} event
     * @param {string} [episodeText] - Texte "Episode(s)" déjà calculé par open() (§ ci-dessus),
     *   réutilisé pour retrouver les numéros d'épisode à afficher (voir _renderEpisodeThumbnails).
     */
    static _renderTmdbInfo(event, episodeText) {
        this._resetTmdbBlocks();
        if (!isTmdbEligible(event)) {
            this._toggleModalLink('modal-event-tmdb', null);
            return;
        }
        const eventId = event.id;
        const apply = (info) => {
            document.getElementById('modal-tmdb-skeleton').classList.add('hidden');
            document.getElementById('modal-tmdb-skeleton').classList.remove('flex');
            if (this._currentEventId !== eventId || !info) return;
            this._toggleModalLink('modal-event-tmdb', sanitizeUrl(info.tmdbUrl));
            if (!event.hasCustomImage && info.imageUrl) this._setHeaderImage(sanitizeUrl(info.imageUrl));
            if (info.mediaType === 'tv' && info.id) {
                this._renderEpisodeThumbnails(event, episodeText, info.id);
            }
            this._renderTmdbSummary(info);
            // Durée officielle en repli (V2.9) : seulement utile pour un FILM (une série n'a
            // pas une durée unique) sans @plateforme ni Durée Réelle déjà renseignées - voir
            // _renderPlatform, qui garde la priorité déjà établie si l'une des deux existe.
            if (info.mediaType === 'movie' && info.runtime) this._renderPlatform(event, info.runtime);
        };

        const cached = getCachedTmdbInfo(event.title);
        if (cached) { apply(cached); return; }
        this._toggleModalLink('modal-event-tmdb', null);
        // Squelette (V2.10) : rien d'utilisable en cache (ni frais, ni stale) - un vrai aller-
        // retour réseau va suivre, affiche un signal de chargement plutôt qu'un bloc vide en
        // attendant (voir #modal-tmdb-skeleton dans index.html).
        const skeleton = document.getElementById('modal-tmdb-skeleton');
        skeleton.classList.remove('hidden');
        skeleton.classList.add('flex');
        fetchTmdbInfo(event).then(apply);
    }

    /** Remet à zéro tout ce que _renderTmdbInfo peut poser (vignettes d'épisodes, progression de
     * saison, épisodes déjà couverts, résumé/genres/certification/bande-annonce/casting/
     * fournisseurs) - centralisé ici plutôt que dispersé, pour ne rien oublier d'effacer entre
     * deux événements ouverts à la suite (voir l'historique des blocs qui restaient affichés
     * d'un événement sur l'autre avant que ce genre de reset ne soit systématique). */
    static _resetTmdbBlocks() {
        const episodesRow = document.getElementById('modal-episodes-row');
        episodesRow.classList.add('hidden');
        episodesRow.innerHTML = '';

        ['modal-season-progress', 'modal-covered-episodes'].forEach(id => {
            const el = document.getElementById(id);
            el.classList.add('hidden');
            el.classList.remove('flex');
        });
        document.getElementById('modal-covered-episodes').innerHTML = '';

        const skeletonReset = document.getElementById('modal-tmdb-skeleton');
        skeletonReset.classList.add('hidden');
        skeletonReset.classList.remove('flex');

        const summaryReset = document.getElementById('modal-tmdb-summary');
        summaryReset.classList.add('hidden');
        summaryReset.classList.remove('flex');
        ['modal-tmdb-genres', 'modal-tmdb-trailer', 'modal-tmdb-cast', 'modal-tmdb-providers'].forEach(id => {
            const el = document.getElementById(id);
            el.classList.add('hidden');
            el.classList.remove('flex');
        });
        document.getElementById('modal-tmdb-certification').classList.add('hidden');
        document.getElementById('modal-tmdb-certification').classList.remove('flex');
    }

    /**
     * Synopsis + note TMDB (V2.8, voir #modal-tmdb-summary dans index.html) - un aperçu du
     * pitch/de la réception directement dans la modale, réservé jusque-là au seul lien externe
     * "Voir sur TMDB". Masqué s'il n'y a vraiment rien à montrer (ni résumé, ni note - un item
     * tout juste ajouté sur TMDB par exemple) plutôt qu'un bloc vide.
     * @param {{overview?: string, rating?: number}} info
     */
    static _renderTmdbSummary(info) {
        const hasOverview = Boolean(info.overview);
        const hasRating = typeof info.rating === 'number' && info.rating > 0;
        const hasCertification = Boolean(info.certification);
        const hasGenres = Array.isArray(info.genres) && info.genres.length > 0;
        const hasTrailer = Boolean(info.trailerKey);
        const hasCast = Array.isArray(info.cast) && info.cast.length > 0;
        const hasProviders = Array.isArray(info.providers) && info.providers.length > 0;
        // Champs "enrichis" (genres/certification/bande-annonce/casting/fournisseurs, V2.9) :
        // absents tant que le proxy n8n n'est pas étendu pour les renvoyer (voir
        // GUIDE_METADONNEES.md §12) - la fiche de base (résumé/note) continue de s'afficher
        // normalement en attendant, aucun de ces blocs n'apparaît juste tant qu'ils sont vides.
        if (!hasOverview && !hasRating && !hasCertification && !hasGenres && !hasTrailer && !hasCast && !hasProviders) return;

        const ratingEl = document.getElementById('modal-tmdb-rating');
        if (hasRating) {
            ratingEl.innerHTML = `${Icons.star('w-3 h-3')}${info.rating.toFixed(1)}`;
            ratingEl.classList.remove('hidden');
            ratingEl.classList.add('flex');
        } else {
            ratingEl.classList.add('hidden');
            ratingEl.classList.remove('flex');
        }

        const certificationEl = document.getElementById('modal-tmdb-certification');
        if (hasCertification) {
            certificationEl.textContent = info.certification;
            certificationEl.classList.remove('hidden');
            certificationEl.classList.add('flex');
        }

        const genresEl = document.getElementById('modal-tmdb-genres');
        if (hasGenres) {
            genresEl.innerHTML = info.genres.slice(0, 4).map(g =>
                `<span class="text-xxs font-bold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">${escapeHtml(g)}</span>`
            ).join('');
            genresEl.classList.remove('hidden');
            genresEl.classList.add('flex');
        }

        const overviewEl = document.getElementById('modal-tmdb-overview');
        overviewEl.textContent = hasOverview ? info.overview : '';
        overviewEl.classList.toggle('hidden', !hasOverview);

        if (hasTrailer) {
            document.getElementById('modal-tmdb-trailer-player').innerHTML = renderInlineYouTubePlayer(info.trailerKey);
            const trailerEl = document.getElementById('modal-tmdb-trailer');
            trailerEl.classList.remove('hidden');
            trailerEl.classList.add('flex');
        }

        if (hasCast) {
            // `w-16` + `line-clamp-2` sur le nom (V2.10, au lieu de `w-14` + `truncate` une seule
            // ligne) : un nom un peu long ("Anne Hathaway") se coupait en plein mot ("Anne
            // Hat…") - la place gagnée + une deuxième ligne autorisée laisse la plupart des noms
            // se lire en entier. Le personnage (info secondaire) reste sur une seule ligne tronquée.
            document.getElementById('modal-tmdb-cast-row').innerHTML = info.cast.slice(0, 8).map(c => `
                <div class="w-16 shrink-0 text-center">
                    ${c.photoUrl
                        ? `<img src="${escapeHtml(c.photoUrl)}" alt="" loading="lazy" class="w-12 h-12 rounded-full object-cover mx-auto border border-white/10" onerror="this.style.display='none'">`
                        : `<div class="w-12 h-12 rounded-full mx-auto bg-white/10 border border-white/10"></div>`}
                    <div class="text-2xs text-slate-300 font-semibold mt-1 line-clamp-2" title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '')}</div>
                    ${c.character ? `<div class="text-3xs text-slate-500 truncate" title="${escapeHtml(c.character)}">${escapeHtml(c.character)}</div>` : ''}
                </div>`).join('');
            const castEl = document.getElementById('modal-tmdb-cast');
            castEl.classList.remove('hidden');
            castEl.classList.add('flex');
        }

        if (hasProviders) {
            // Fond blanc derrière chaque logo (V2.10) : plusieurs services (Apple TV+...) ont un
            // logo clair/transparent qui se fondait dans le fond sombre de la modale - un petit
            // cadre blanc arrondi (même idée que JustWatch/TMDB eux-mêmes) rend TOUS les logos
            // lisibles quel que soit leur propre jeu de couleurs, sans avoir à connaître chacun.
            document.getElementById('modal-tmdb-providers-row').innerHTML = info.providers.slice(0, 6).map(p =>
                `<div class="w-7 h-7 rounded-md bg-white p-0.5 shadow-sm shrink-0" title="${escapeHtml(p.name || '')}"><img src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.name || '')}" loading="lazy" class="w-full h-full rounded object-contain" onerror="this.parentElement.style.display='none'"></div>`
            ).join('');
            const providersEl = document.getElementById('modal-tmdb-providers');
            providersEl.classList.remove('hidden');
            providersEl.classList.add('flex');
        }

        const summaryEl = document.getElementById('modal-tmdb-summary');
        summaryEl.classList.remove('hidden');
        summaryEl.classList.add('flex');
    }

    /**
     * Vignettes + noms des épisodes couverts par CETTE occurrence (V2.7.1) : illustrent le
     * texte "Episode(s)" déjà affiché juste au-dessus (même bloc, voir index.html), pas une
     * info séparée. Saison+épisode(s) déterminés dans cet ordre : la forme combinée "S<N> E<M>"
     * dans le texte "Episode(s)" lui-même (voir parseSeasonEpisode) si présente - la SEULE
     * option pour un événement dont le TITRE ne porte pas la saison (ex: "Road to AHS 13", un
     * titre "teasing" qui ne suit pas la convention "... S<N>") ; sinon, saison tirée du titre
     * (parseSeasonNumber) + numéro(s) d'épisode tirés du texte (parseEpisodeNumbers). Sans l'un
     * ou l'autre, impossible de savoir QUELS épisodes TMDB afficher, la ligne reste alors
     * simplement masquée (le texte "Episode(s)", lui, reste affiché). Un seul appel réseau par
     * SAISON (pas par épisode, voir fetchTmdbSeason), réutilisable par toutes les occurrences de
     * cette même saison une fois en cache.
     */
    static _renderEpisodeThumbnails(event, episodeText, tmdbId) {
        const combined = parseSeasonEpisode(episodeText);
        const season = combined ? combined.season : (parseSeasonNumber(event.title) || 1);
        const episodeNumbers = combined ? combined.episodes : parseEpisodeNumbers(episodeText || '');
        if (episodeNumbers.length === 0) return;

        const row = document.getElementById('modal-episodes-row');
        const eventId = event.id;
        const apply = (episodes) => {
            if (this._currentEventId !== eventId || !episodes) return;
            const matched = episodeNumbers
                .map(n => episodes.find(ep => ep.episodeNumber === n))
                .filter(Boolean);
            if (matched.length > 0) {
                row.innerHTML = matched.map(ep => `
                    <div class="w-32 shrink-0">
                        <div class="aspect-video rounded-lg overflow-hidden border border-white/10 bg-black/40">
                            ${ep.stillUrl ? `<img src="${escapeHtml(ep.stillUrl)}" alt="" class="w-full h-full object-cover" loading="lazy">` : ''}
                        </div>
                        <div class="text-2xs text-slate-300 font-semibold mt-1 line-clamp-2">${escapeHtml(ep.name || `Épisode ${ep.episodeNumber}`)}</div>
                    </div>`).join('');
                row.classList.remove('hidden');
                row.classList.add('flex');
            }
            // Progression + épisodes déjà couverts (V2.9) : indépendants du fait que CETTE
            // occurrence précise ait trouvé ses propres vignettes ci-dessus (episodeNumbers reste
            // exploitable même si `matched` est vide, ex: un numéro d'épisode qui dépasse ceux
            // listés par TMDB pour cette saison).
            this._renderSeasonProgress(episodeNumbers, episodes.length);
            this._renderCoveredEpisodes(event, season, episodes.length);
        };

        const cached = getCachedSeasonEpisodes(tmdbId, season);
        if (cached) { apply(cached); return; }
        fetchTmdbSeason(tmdbId, season).then(apply);
    }

    /** Barre "Épisode X/Y de la saison" (V2.9) - X = le plus grand numéro d'épisode couvert par
     * CETTE occurrence (une occurrence peut en couvrir plusieurs, ex: "Episodes 4 à 6"), Y = le
     * nombre total d'épisodes de la saison sur TMDB (déjà en main, voir fetchTmdbSeason). */
    static _renderSeasonProgress(episodeNumbers, totalEpisodes) {
        if (!totalEpisodes || episodeNumbers.length === 0) return;
        const maxEp = Math.max(...episodeNumbers);
        const pct = Math.max(0, Math.min(100, (maxEp / totalEpisodes) * 100));
        const bar = document.getElementById('modal-season-progress-bar');
        bar.style.width = `${pct}%`;
        // Couleur qui évolue avec l'avancement (V2.10, indigo -> émeraude) plutôt qu'un remplissage
        // toujours de la même teinte - un simple coup d'oeil à la COULEUR (pas juste la largeur)
        // suffit alors à distinguer "on démarre la saison" de "on l'a presque terminée".
        const t = pct / 100;
        const r = Math.round(129 + (52 - 129) * t);
        const g = Math.round(140 + (211 - 140) * t);
        const b = Math.round(248 + (153 - 248) * t);
        bar.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        document.getElementById('modal-season-progress-text').textContent = `Épisode ${maxEp} / ${totalEpisodes}`;
        const wrap = document.getElementById('modal-season-progress');
        wrap.classList.remove('hidden');
        wrap.classList.add('flex');
    }

    /**
     * Liste des numéros d'épisode de CETTE saison déjà couverts par une occurrence PASSÉE du
     * même titre (V2.9, § "épisodes déjà couverts") - l'ENSEMBLE réel (peut avoir des trous, ex:
     * un épisode sauté/mal renseigné une semaine), distinct de la simple progression ci-dessus
     * (qui ne dit que "jusqu'où", pas "lesquels exactement"). Croise le dépôt complet
     * (_getAllEvents, voir ModalView.init) avec le même parsing saison/épisode que les vignettes
     * - silencieusement absent si _getAllEvents n'a pas été fourni plutôt que de planter.
     */
    static _renderCoveredEpisodes(event, season, totalEpisodes) {
        if (!this._getAllEvents) return;

        const now = new Date();
        const numbers = new Set();
        this._getAllEvents()
            .filter(e => e.title === event.title && new Date(e.start) <= now)
            .forEach(e => {
                const epText = e.meta?.episode || e.meta?.diffusion || e.sub || e.episode || '';
                const combinedEv = parseSeasonEpisode(epText);
                const evSeason = combinedEv ? combinedEv.season : (parseSeasonNumber(e.title) || 1);
                if (evSeason !== season) return;
                (combinedEv ? combinedEv.episodes : parseEpisodeNumbers(epText)).forEach(n => numbers.add(n));
            });
        if (numbers.size === 0) return;

        const sorted = [...numbers].sort((a, b) => a - b);
        const el = document.getElementById('modal-covered-episodes');
        el.innerHTML = `<span class="font-bold text-slate-300">Épisodes déjà couverts</span> (${sorted.length}${totalEpisodes ? '/' + totalEpisodes : ''}) : ${sorted.join(', ')}`;
        el.classList.remove('hidden');
    }

    /**
     * Pose (ou retire) l'image de fond du bandeau d'en-tête (V2.7.1, fondu enchaîné V2.8 - voir
     * #modal-header-bg-a/-b dans index.html) - `url` est déjà passée par
     * sanitizeUrl/resolveEventImage par l'appelant, pas re-vérifiée ici. Chaîne vide/`null` :
     * masque les deux calques, le bandeau retombe alors sur son fond plein uni
     * (bg-[var(--surface-2)], déjà posé en dessous dans la classe HTML).
     * @param {string} url
     * @param {{instant?: boolean}} [opts] - `instant: true` pour la toute première pose à
     *   l'ouverture de la modale (voir open()) : rien à fondre depuis un état précédent, la
     *   transition ne sert qu'au remplacement plus tard (voir _renderTmdbInfo), quand la fiche
     *   TMDB arrive après coup et remplace une image déjà affichée depuis un moment.
     */
    static _setHeaderImage(url, { instant = false } = {}) {
        const showEl = document.getElementById(this._headerBgCurrentIsA ? 'modal-header-bg-b' : 'modal-header-bg-a');
        const hideEl = document.getElementById(this._headerBgCurrentIsA ? 'modal-header-bg-a' : 'modal-header-bg-b');
        if (instant) { showEl.style.transition = 'none'; hideEl.style.transition = 'none'; }
        showEl.style.backgroundImage = url ? `url('${url}')` : '';
        showEl.style.opacity = url ? '1' : '0';
        hideEl.style.opacity = '0';
        if (instant) {
            void showEl.offsetWidth; // Force le calcul de style ci-dessus avant de réactiver la transition (voir le même besoin dans HighlightsView.updateGalleryBackdrop).
            showEl.style.transition = '';
            hideEl.style.transition = '';
        }
        this._headerBgCurrentIsA = !this._headerBgCurrentIsA;
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
        closeLightbox();

        if (this._currentEventId) {
            const url = new URL(window.location.href);
            url.searchParams.delete('event');
            window.history.replaceState(null, '', url);
        }
        this._currentEvent = null;
        this._currentEventId = null;
        this._currentEventTitle = null;
        this._currentEventHost = null;
        this._restoreListScroll();

        // Restaure le focus sur l'élément qui avait ouvert la modale.
        if (this._lastFocused && typeof this._lastFocused.focus === 'function') {
            this._lastFocused.focus();
        }
        this._lastFocused = null;
    }
}
