/**
 * Illustrations SVG pour les états vides (V2.2) : remplace les emoji ponctuels par un dessin
 * cohérent avec le reste des icônes de l'app (trait, currentColor) - un état vide reste un
 * moment de l'UI qu'un visiteur peut rencontrer souvent (recherche sans résultat, journée sans
 * session...), autant qu'il soit soigné plutôt qu'un simple caractère emoji au rendu variable.
 */
export const EmptyIllustrations = {
    moon: (cls = 'w-16 h-16') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"></path><path d="M17 3.5l0.6 1.4 1.4 0.6-1.4 0.6-0.6 1.4-0.6-1.4-1.4-0.6 1.4-0.6z" fill="currentColor" stroke="none" opacity="0.8"></path></svg>`,
    search: (cls = 'w-16 h-16') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><line x1="15.3" y1="15.3" x2="20.5" y2="20.5"></line><line x1="8" y1="10.5" x2="13" y2="10.5"></line></svg>`,
    calendarEmpty: (cls = 'w-16 h-16') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line><line x1="8" y1="3" x2="8" y2="7"></line><line x1="16" y1="3" x2="16" y2="7"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`
};

/**
 * Bloc "état vide" prêt à l'emploi : illustration + titre + sous-texte optionnel, mise en page
 * commune à TodayView/SearchResultsView/RetrospectiveView/TimelineView.
 * @param {{ illustration: string, title: string, subtitle?: string, extra?: string }} opts
 */
export function renderEmptyState({ illustration, title, subtitle = '', extra = '' }) {
    return `
        <div class="text-center py-14 space-y-3">
            <div class="flex justify-center text-slate-600" aria-hidden="true">${illustration}</div>
            <p class="text-slate-500 text-sm leading-relaxed">${title}${subtitle ? `<br>${subtitle}` : ''}</p>
            ${extra}
        </div>
    `;
}
