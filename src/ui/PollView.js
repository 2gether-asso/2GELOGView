import { escapeHtml } from '../utils/Html.js';
import { Icons } from './Icons.js';

/**
 * Sondage communautaire (V2.4) : question + une barre de résultat par option, alimenté par
 * le petit service n8n externe (voir PollService.js) - juste du HTML généré à partir du JSON
 * renvoyé par le webhook, aucune dépendance ajoutée. Chaque option reste cliquable pour voter
 * (ou changer son vote, voir data-poll-option, délégué par l'appelant dans main.js).
 * @param {HTMLElement} container
 * @param {{id: string, question: string, options: Array<{label: string, count: number}>, total: number}} poll
 * @param {string|null} myVote - option déjà votée par ce visiteur (voir getMyVote), ou null
 * @param {{pending?: boolean}} [opts] - `pending` (V2.4) : le round-trip vers n8n peut prendre
 *   1-2 secondes - affiché tel quel entre le clic et la réponse, l'écran resterait figé assez
 *   longtemps pour donner l'impression que rien ne s'est passé et pousser à recliquer. `pending`
 *   grise les options (pointer-events coupés, pas juste visuellement) et affiche un petit
 *   spinner - l'appelant doit lui fournir un tally optimiste (vote déjà compté) AVANT même la
 *   réponse du serveur pour que le retour visuel soit instantané.
 */
export function renderPoll(container, poll, myVote, { pending = false } = {}) {
    const maxCount = Math.max(1, ...poll.options.map(o => o.count));
    const rowsHtml = poll.options.map(o => {
        const pct = poll.total > 0 ? Math.round((o.count / poll.total) * 100) : 0;
        const barPct = o.count > 0 ? Math.max(4, Math.round((o.count / maxCount) * 100)) : 0;
        const isMine = myVote === o.label;
        return `
            <button data-poll-option="${escapeHtml(o.label)}" class="w-full text-left group">
                <div class="flex items-center justify-between text-xs mb-1 gap-2">
                    <span class="font-bold ${isMine ? 'text-indigo-300' : 'text-slate-200'} flex items-center gap-1.5 min-w-0 truncate">
                        ${isMine ? Icons.checkCircle('w-3.5 h-3.5 shrink-0') : ''}
                        <span class="truncate">${escapeHtml(o.label)}</span>
                    </span>
                    <span class="text-slate-500 font-bold shrink-0">${o.count} · ${pct}%</span>
                </div>
                <div class="h-3 rounded-full bg-white/5 overflow-hidden">
                    <div class="h-full rounded-full transition-all ${isMine ? 'bg-indigo-500' : 'bg-white/20 group-hover:bg-indigo-500/60'}" style="width:${barPct}%"></div>
                </div>
            </button>
        `;
    }).join('');

    container.innerHTML = `
        <div class="space-y-4">
            <p class="text-sm font-bold text-white text-center">${escapeHtml(poll.question)}</p>
            <div class="space-y-3 transition-opacity ${pending ? 'opacity-60 pointer-events-none' : ''}">${rowsHtml}</div>
            <p class="text-center text-3xs text-slate-500 flex items-center justify-center gap-1.5">
                ${pending
                    ? `<span class="inline-block w-3 h-3 border-2 border-slate-600 border-t-indigo-400 rounded-full animate-spin" aria-hidden="true"></span>Vote en cours d'enregistrement…`
                    : `${poll.total} vote${poll.total > 1 ? 's' : ''} ${myVote ? '· cliquez une autre option pour changer votre vote' : '· cliquez une option pour voter'}`}
            </p>
        </div>
    `;
}
