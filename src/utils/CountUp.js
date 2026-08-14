/**
 * Anime un chiffre-clé de 0 vers sa valeur finale (V2.2) : une tuile de stat qui "grimpe" à
 * l'ouverture attire l'oeil sur les nombres qui comptent (sessions organisées, temps cumulé...)
 * plutôt qu'un texte qui apparaît d'un coup - décoratif, donc court-circuité sous
 * prefers-reduced-motion (valeur finale posée directement, sans animation).
 * @param {HTMLElement|null} el - élément dont le textContent sera animé
 * @param {number} target - valeur finale (nombre brut : sessions, minutes, %, ...)
 * @param {(n: number) => string} [formatter] - transforme la valeur courante (entière) en texte affiché
 * @param {number} [duration] - durée en ms
 */
export function animateCountUp(el, target, formatter = (n) => String(n), duration = 900) {
    if (!el) return;
    if (!Number.isFinite(target)) { el.textContent = formatter(target); return; }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = formatter(target);
        return;
    }
    const start = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = formatter(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = formatter(target);
    };
    requestAnimationFrame(step);
}
