import { CONFIG } from '../config.js';
import { escapeHtml, sanitizeUrl } from '../utils/Html.js';
import { renderStatusBadge, getOvernightSuffix } from './EventCardTemplate.js';

// Lieu par défaut (voir EventGenerator) : la carte "Lieu" est masquée quand elle ne
// contient rien de plus informatif que cette valeur par défaut.
const DEFAULT_LOCATION = CONFIG.DEFAULT_LOCATION;

export class ModalView {
    /**
     * Attache les écouteurs d'événements de la modale (fermeture, clic sur tag).
     * Idempotent : peut être appelé plusieurs fois sans dupliquer les listeners.
     * @param {Function} onTagClick - Callback appelé avec le tag (sans #) cliqué dans la modale
     */
    static init(onTagClick = null) {
        if (this._initialized) return;
        this._initialized = true;
        this._onTagClick = onTagClick;

        const container = document.getElementById('custom-modal-container');
        const closeBtn = document.getElementById('modal-close-btn');

        closeBtn.addEventListener('click', () => this.hide());
        container.addEventListener('click', (e) => {
            if (e.target === container) this.hide();
        });
        // Accessibilité clavier : Échap ferme la modale, quel que soit l'élément focus.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !container.classList.contains('pointer-events-none')) {
                this.hide();
            }
        });

        document.getElementById('modal-event-tags').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const tag = btn.dataset.tag;
            this.hide();
            if (this._onTagClick) this._onTagClick(tag);
        });

        // Lien partageable direct vers l'événement ouvert (?event=<id>).
        document.getElementById('modal-copy-link-btn').addEventListener('click', async (e) => {
            if (!this._currentEventId) return;
            const url = new URL(window.location.href);
            url.search = '';
            url.searchParams.set('event', this._currentEventId);
            const btn = e.currentTarget;
            try {
                await navigator.clipboard.writeText(url.href);
                const original = btn.textContent;
                btn.textContent = '✅';
                setTimeout(() => { btn.textContent = original; }, 1500);
            } catch {
                window.prompt("Copiez ce lien :", url.href);
            }
        });
    }

    /**
     * Ouvre la modale et injecte les données enrichies de l'événement cliqué.
     * @param {Object} event - L'instance de l'événement (tags cliquables, métadonnées, sous-épisodes)
     */
    static open(event) {
        this.init();
        if (!event) return;

        this._currentEventId = event.id || null;
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
        const linkContainer = document.getElementById('modal-link-container');
        const linkUrl = sanitizeUrl(event.url);
        if (linkUrl) {
            document.getElementById('modal-event-link').href = linkUrl;
            linkContainer.classList.remove('hidden');
        } else {
            linkContainer.classList.add('hidden');
        }

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
        document.getElementById('modal-event-host').innerText = event.meta?.host || event.meta?.orga || CONFIG.DEFAULT_HOST;
        hostContainer.classList.remove('hidden');

        const platformContainer = document.getElementById('modal-platform-container');
        if (event.meta?.plateforme) {
            document.getElementById('modal-event-platform').innerText = event.meta.plateforme;
            platformContainer.classList.remove('hidden');
        } else {
            platformContainer.classList.add('hidden');
        }

        document.getElementById('modal-event-notes').innerText = event.notes || "Aucune note ou description pour cet événement.";

        // Tags cliquables
        const tagsBox = document.getElementById('modal-event-tags');
        if (event.tags && event.tags.length > 0) {
            tagsBox.innerHTML = event.tags.map(t =>
                `<button data-tag="${escapeHtml(t)}" class="text-[10px] bg-white/5 border border-white/5 text-indigo-400 hover:text-white hover:bg-indigo-600 px-2 py-0.5 rounded-md transition-all">#${escapeHtml(t)}</button>`
            ).join('');
        } else {
            tagsBox.innerHTML = `<span class="text-slate-600 text-xs italic">Aucun tag</span>`;
        }

        const modalContainer = document.getElementById('custom-modal-container');
        const modalBox = document.getElementById('custom-modal-box');
        modalContainer.classList.remove('opacity-0', 'pointer-events-none');
        modalBox.classList.remove('scale-95');

        // Accessibilité clavier : mémorise l'élément d'origine et déplace le focus dans la modale.
        this._lastFocused = document.activeElement;
        document.getElementById('modal-close-btn').focus();
    }

    static hide() {
        const modalContainer = document.getElementById('custom-modal-container');
        const modalBox = document.getElementById('custom-modal-box');
        modalContainer.classList.add('opacity-0', 'pointer-events-none');
        modalBox.classList.add('scale-95');

        if (this._currentEventId) {
            const url = new URL(window.location.href);
            url.searchParams.delete('event');
            window.history.replaceState(null, '', url);
        }
        this._currentEventId = null;

        // Restaure le focus sur l'élément qui avait ouvert la modale.
        if (this._lastFocused && typeof this._lastFocused.focus === 'function') {
            this._lastFocused.focus();
        }
        this._lastFocused = null;
    }
}
