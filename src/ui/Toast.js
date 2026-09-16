// Notification "toast" unifiée (V2.2) : remplace le pattern répété un peu partout dans l'app
// (échanger le contenu d'un bouton pour "✅ Copié !" puis le restaurer après un délai) par un
// seul mécanisme cohérent, qui ne dépend plus de la taille/forme du bouton cliqué et fonctionne
// aussi pour des confirmations qui n'ont pas de bouton précis à modifier (ex: rappel activé).
let container = null;

/**
 * Affiche un toast bref en bas d'écran, qui s'efface tout seul.
 * @param {string} message
 * @param {{ icon?: string, duration?: number }} [options] - `icon` : HTML d'icône déjà prêt
 *   (voir Icons.js), affiché avant le texte.
 */
export function showToast(message, { icon = '', duration = 2200 } = {}) {
    if (!container) container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    // `relative overflow-hidden` (V2.10) : accueille la barre de progression ci-dessous, posée en
    // `absolute` tout en bas du toast - visualise le temps restant avant disparition automatique
    // plutôt qu'une disparition sans prévenir.
    el.className = 'toast-item relative overflow-hidden flex items-center gap-2 bg-[var(--surface-2)]/95 border border-white/10 text-slate-100 text-xs font-bold px-4 py-2.5 rounded-full shadow-2xl pointer-events-auto';
    el.setAttribute('role', 'status');
    el.innerHTML = `${icon}<span>${message}</span><div class="toast-progress absolute left-0 bottom-0 h-0.5 bg-white/40" style="width:100%; transition: width ${duration}ms linear;"></div>`;
    container.appendChild(el);

    // Classe ajoutée sur la frame suivante (pas immédiatement) : sans ce décalage, le navigateur
    // peut fusionner l'état initial et l'état "in" en un seul rendu et sauter la transition. Même
    // raison pour lancer la barre de progression vers 0 ici plutôt qu'à la création de l'élément.
    requestAnimationFrame(() => {
        el.classList.add('toast-in');
        const progress = el.querySelector('.toast-progress');
        if (progress) progress.style.width = '0%';
    });

    setTimeout(() => {
        el.classList.remove('toast-in');
        el.classList.add('toast-out');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        // Filet de sécurité si transitionend ne se déclenche pas (onglet en arrière-plan...).
        setTimeout(() => el.remove(), 500);
    }, duration);
}
