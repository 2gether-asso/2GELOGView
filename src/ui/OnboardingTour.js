/**
 * Visite guidée interactive (V2.2, premier lancement) : met en surbrillance un élément réel de la
 * page à la fois - un halo type "spotlight" (box-shadow géant plutôt qu'un masque SVG, même
 * principe que .jump-highlight dans index.html) creuse un trou dans un voile sombre plein écran -
 * avec une bulle expliquant à quoi il sert, skippable à tout moment. Injecté dynamiquement (pas de
 * markup statique dans index.html) : cette vue n'existe que pendant la visite, retirée du DOM une
 * fois terminée/passée, plutôt qu'un overlay de plus à garder caché en permanence comme les autres.
 * @param {Array<{target: string|null, title: string, text: string}>} steps - `target` est un
 *   sélecteur CSS (élément réel mis en surbrillance) ou null (étape "centrée", sans cible - intro).
 * @param {{onDone?: Function}} [opts] - `onDone` appelé aussi bien en fin de parcours qu'au skip
 *   (main.js s'en sert pour marquer la visite comme terminée en localStorage dans les deux cas).
 */
export function startOnboardingTour(steps, { onDone } = {}) {
    let index = 0;

    const overlay = document.createElement('div');
    overlay.id = 'onboarding-tour';
    overlay.className = 'fixed inset-0 z-[90]';
    overlay.innerHTML = `
        <div id="onboarding-spotlight" class="fixed rounded-xl pointer-events-none transition-all duration-300 ease-out" style="opacity:0;"></div>
        <div id="onboarding-card" class="fixed bg-[var(--surface-2-95)] border border-indigo-400/30 rounded-2xl shadow-2xl p-4 transition-all duration-300 ease-out">
            <div class="flex items-center justify-between gap-2 mb-1.5">
                <span id="onboarding-step-counter" class="text-3xs font-black text-indigo-300 uppercase tracking-wider"></span>
                <button id="onboarding-skip" class="text-3xs font-bold text-slate-500 hover:text-rose-300 transition-colors">Passer la visite</button>
            </div>
            <h3 id="onboarding-title" class="text-sm font-black text-white mb-1"></h3>
            <p id="onboarding-text" class="text-xs text-slate-300 leading-relaxed mb-3"></p>
            <div class="flex items-center justify-between gap-2">
                <button id="onboarding-prev" class="text-xs font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg transition-all disabled:opacity-0 disabled:pointer-events-none">← Précédent</button>
                <button id="onboarding-next" class="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 rounded-lg transition-all"></button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const spotlight = overlay.querySelector('#onboarding-spotlight');
    const card = overlay.querySelector('#onboarding-card');
    const counter = overlay.querySelector('#onboarding-step-counter');
    const titleEl = overlay.querySelector('#onboarding-title');
    const textEl = overlay.querySelector('#onboarding-text');
    const prevBtn = overlay.querySelector('#onboarding-prev');
    const nextBtn = overlay.querySelector('#onboarding-next');
    const skipBtn = overlay.querySelector('#onboarding-skip');

    const CARD_WIDTH = 320;

    function positionAround(target) {
        const rect = target.getBoundingClientRect();
        const pad = 8;
        spotlight.style.left = `${rect.left - pad}px`;
        spotlight.style.top = `${rect.top - pad}px`;
        spotlight.style.width = `${rect.width + pad * 2}px`;
        spotlight.style.height = `${rect.height + pad * 2}px`;
        spotlight.style.boxShadow = '0 0 0 9999px rgba(6,8,12,0.78), 0 0 0 2px rgba(99,102,241,0.7)';
        spotlight.style.opacity = '1';

        // Sous la cible si la place le permet, sinon au-dessus - centrée horizontalement sur la
        // cible mais toujours contenue dans le viewport (bords compris, pour un petit écran).
        let left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - CARD_WIDTH - 12));
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow > 220 ? rect.bottom + 16 : Math.max(12, rect.top - 216);
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.style.width = `${CARD_WIDTH}px`;
    }

    function positionCentered() {
        // Pas de "trou" à découper (étape sans cible) : le halo garde son opacité à 1 - c'est le
        // box-shadow géant qui assombrit l'écran, une opacité à 0 l'aurait effacé lui aussi et
        // laissé la page derrière la carte totalement éclairée (bug corrigé après test visuel).
        // Boîte réduite à un point (0×0), sans "trou" perceptible : tout l'écran s'assombrit
        // uniformément, comme un simple fond de modale.
        spotlight.style.left = `${window.innerWidth / 2}px`;
        spotlight.style.top = `${window.innerHeight / 2}px`;
        spotlight.style.width = '0px';
        spotlight.style.height = '0px';
        spotlight.style.boxShadow = '0 0 0 9999px rgba(6,8,12,0.78)';
        spotlight.style.opacity = '1';

        card.style.width = `${CARD_WIDTH + 20}px`;
        card.style.left = `${window.innerWidth / 2 - (CARD_WIDTH + 20) / 2}px`;
        card.style.top = `${window.innerHeight / 2 - 110}px`;
    }

    function renderStep() {
        const step = steps[index];
        counter.textContent = `Étape ${index + 1} / ${steps.length}`;
        titleEl.textContent = step.title;
        textEl.textContent = step.text;
        prevBtn.disabled = index === 0;
        nextBtn.textContent = index === steps.length - 1 ? 'Terminer' : 'Suivant →';

        // `target` peut être introuvable OU présent mais masqué (ex: panneau replié sur mobile,
        // largeur/hauteur nulle) : repli sur une étape "centrée" plutôt qu'un halo à 0×0px.
        let target = step.target ? document.querySelector(step.target) : null;
        if (target) {
            const r = target.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) target = null;
        }
        if (target) {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            // Laisse le temps au scroll de s'installer avant de mesurer/positionner dessus.
            requestAnimationFrame(() => requestAnimationFrame(() => positionAround(target)));
        } else {
            positionCentered();
        }
    }

    function finish() {
        window.removeEventListener('resize', renderStep);
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        if (onDone) onDone();
    }

    function next() {
        if (index === steps.length - 1) { finish(); return; }
        index++;
        renderStep();
    }
    function prev() {
        if (index === 0) return;
        index--;
        renderStep();
    }
    function onKeydown(e) {
        if (e.key === 'Escape') { finish(); return; }
        if (e.key === 'ArrowRight') next();
        else if (e.key === 'ArrowLeft') prev();
    }

    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', prev);
    skipBtn.addEventListener('click', finish);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', renderStep, { passive: true });

    renderStep();
}
