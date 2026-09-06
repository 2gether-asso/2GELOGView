// Petit jeu d'icônes ligne (SVG inline, sans dépendance/CDN) utilisé pour remplacer les emojis
// dans le "chrome" de l'appli (boutons d'en-tête, titres de section, boutons d'action des
// modales/overlays, badges de carte). Les emojis restent utilisés dans le contenu éditorial
// (aide, notes de version) : voir le plan V2.2 pour le découpage exact.
//
// Chaque fonction retourne une chaîne <svg> autonome (viewBox 24x24, stroke="currentColor",
// donc hérite la couleur du texte du bouton qui l'entoure) prête à être injectée via innerHTML.

function svg(inner, cls) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${inner}</svg>`;
}

export const Icons = {
    helpCircle: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="12" r="9"></circle><path d="M9.2 9a3 3 0 1 1 4.6 2.5c-1 0.6-1.8 1.1-1.8 2.5"></path><line x1="12" y1="17.2" x2="12" y2="17.3"></line>`, cls),
    sun: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22"></line><line x1="2" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22" y2="12"></line><line x1="4.6" y1="4.6" x2="6.8" y2="6.8"></line><line x1="17.2" y1="17.2" x2="19.4" y2="19.4"></line><line x1="4.6" y1="19.4" x2="6.8" y2="17.2"></line><line x1="17.2" y1="6.8" x2="19.4" y2="4.6"></line>`, cls),
    timeline: (cls = 'w-4 h-4') => svg(`<line x1="4" y1="12" x2="20" y2="12"></line><circle cx="7" cy="12" r="1.6" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"></circle><circle cx="17" cy="12" r="1.6" fill="currentColor" stroke="none"></circle>`, cls),
    mapPin: (cls = 'w-4 h-4') => svg(`<path d="M12 22s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12z"></path><circle cx="12" cy="10" r="2.5"></circle>`, cls),
    calendarPlus: (cls = 'w-4 h-4') => svg(`<rect x="3" y="4" width="18" height="17" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="16" y1="2" x2="16" y2="6"></line><line x1="12" y1="13" x2="12" y2="18"></line><line x1="9.5" y1="15.5" x2="14.5" y2="15.5"></line>`, cls),
    calendarDays: (cls = 'w-4 h-4') => svg(`<rect x="3" y="4" width="18" height="17" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="16" y1="2" x2="16" y2="6"></line><circle cx="8" cy="14" r="1" fill="currentColor" stroke="none"></circle><circle cx="12" cy="14" r="1" fill="currentColor" stroke="none"></circle><circle cx="16" cy="14" r="1" fill="currentColor" stroke="none"></circle>`, cls),
    rss: (cls = 'w-4 h-4') => svg(`<circle cx="6" cy="18" r="1.8" fill="currentColor" stroke="none"></circle><path d="M5 11a8 8 0 0 1 8 8"></path><path d="M5 5a14 14 0 0 1 14 14"></path>`, cls),
    link: (cls = 'w-4 h-4') => svg(`<circle cx="8" cy="16" r="3"></circle><circle cx="16" cy="8" r="3"></circle><line x1="10.2" y1="13.8" x2="13.8" y2="10.2"></line>`, cls),
    bell: (cls = 'w-4 h-4') => svg(`<path d="M12 3a5 5 0 0 0-5 5v2c0 3-1.5 4.5-2 5h14c-0.5-0.5-2-2-2-5V8a5 5 0 0 0-5-5z"></path><path d="M9.5 19a2.5 2.5 0 0 0 5 0"></path>`, cls),
    bellOff: (cls = 'w-4 h-4') => svg(`<path d="M12 3a5 5 0 0 0-5 5v2c0 3-1.5 4.5-2 5h14c-0.5-0.5-2-2-2-5V8a5 5 0 0 0-5-5z"></path><path d="M9.5 19a2.5 2.5 0 0 0 5 0"></path><line x1="3" y1="3" x2="21" y2="21"></line>`, cls),
    sparkles: (cls = 'w-4 h-4') => svg(`<path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"></path><path d="M19 3v4"></path><path d="M17 5h4"></path>`, cls),
    sliders: (cls = 'w-4 h-4') => svg(`<line x1="4" y1="6" x2="20" y2="6"></line><circle cx="9" cy="6" r="2"></circle><line x1="4" y1="12" x2="20" y2="12"></line><circle cx="15" cy="12" r="2"></circle><line x1="4" y1="18" x2="20" y2="18"></line><circle cx="7" cy="18" r="2"></circle>`, cls),
    palette: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="12" r="9"></circle><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"></circle><circle cx="14" cy="9" r="1" fill="currentColor" stroke="none"></circle><circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"></circle>`, cls),
    moreHorizontal: (cls = 'w-4 h-4') => svg(`<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"></circle>`, cls),
    messageCircle: (cls = 'w-4 h-4') => svg(`<path d="M4 12a8 8 0 1 1 8 8H8l-4 3z"></path>`, cls),
    zap: (cls = 'w-4 h-4') => svg(`<polygon points="13 2 4 14 11 14 10 22 20 10 13 10"></polygon>`, cls),
    monitor: (cls = 'w-4 h-4') => svg(`<rect x="3" y="4" width="18" height="12" rx="2"></rect><line x1="8" y1="20" x2="16" y2="20"></line><line x1="12" y1="16" x2="12" y2="20"></line>`, cls),
    shieldAlert: (cls = 'w-4 h-4') => svg(`<path d="M12 3l7 3v6c0 5-3 8-7 9c-4-1-7-4-7-9V6z"></path><line x1="12" y1="9" x2="12" y2="13"></line><circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none"></circle>`, cls),
    funnel: (cls = 'w-4 h-4') => svg(`<path d="M3 5h18"></path><path d="M7 5l5 7v7l4 2v-9l5-7"></path>`, cls),
    filterX: (cls = 'w-4 h-4') => svg(`<path d="M3 5h13"></path><path d="M3 5l6 7v7l3 1.5v-8.5l2-2.3"></path><line x1="17" y1="4" x2="22" y2="9"></line><line x1="22" y1="4" x2="17" y2="9"></line>`, cls),
    search: (cls = 'w-4 h-4') => svg(`<circle cx="10.5" cy="10.5" r="6.5"></circle><line x1="15.5" y1="15.5" x2="20" y2="20"></line>`, cls),
    x: (cls = 'w-4 h-4') => svg(`<line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line>`, cls),
    star: (cls = 'w-4 h-4') => svg(`<path d="M12 3l2.7 5.9l6.3 0.7l-4.7 4.4l1.3 6.2L12 17l-5.6 3.2l1.3-6.2L3 9.6l6.3-0.7z"></path>`, cls),
    tag: (cls = 'w-4 h-4') => svg(`<path d="M11 3h6a2 2 0 0 1 2 2v6l-9 9l-8-8z"></path><circle cx="15" cy="7" r="1.2" fill="currentColor" stroke="none"></circle>`, cls),
    hash: (cls = 'w-4 h-4') => svg(`<line x1="5" y1="9" x2="19" y2="9"></line><line x1="5" y1="15" x2="19" y2="15"></line><line x1="9" y1="4" x2="7" y2="20"></line><line x1="17" y1="4" x2="15" y2="20"></line>`, cls),
    film: (cls = 'w-4 h-4') => svg(`<rect x="3" y="4" width="18" height="16" rx="1"></rect><line x1="8" y1="4" x2="8" y2="20"></line><line x1="16" y1="4" x2="16" y2="20"></line><line x1="3" y1="9" x2="8" y2="9"></line><line x1="3" y1="15" x2="8" y2="15"></line><line x1="16" y1="9" x2="21" y2="9"></line><line x1="16" y1="15" x2="21" y2="15"></line>`, cls),
    tv: (cls = 'w-4 h-4') => svg(`<rect x="3" y="6" width="18" height="13" rx="2"></rect><line x1="8" y1="3" x2="12" y2="6"></line><line x1="16" y1="3" x2="12" y2="6"></line>`, cls),
    user: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="8" r="3.5"></circle><path d="M4 20l2-5h12l2 5z"></path>`, cls),
    barChart: (cls = 'w-4 h-4') => svg(`<line x1="4" y1="20" x2="20" y2="20"></line><rect x="6" y="12" width="3" height="8"></rect><rect x="11" y="7" width="3" height="13"></rect><rect x="16" y="10" width="3" height="10"></rect>`, cls),
    xCircle: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="12" r="9"></circle><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line>`, cls),
    trendingUp: (cls = 'w-4 h-4') => svg(`<polyline points="3 17 9 11 13 15 21 6"></polyline><polyline points="15 6 21 6 21 12"></polyline>`, cls),
    arrowRightCircle: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="12" r="9"></circle><polyline points="10 8 14 12 10 16"></polyline>`, cls),
    save: (cls = 'w-4 h-4') => svg(`<path d="M5 4h11l3 3v13H5z"></path><rect x="8" y="4" width="7" height="5"></rect><rect x="7" y="14" width="10" height="6"></rect>`, cls),
    trash: (cls = 'w-4 h-4') => svg(`<line x1="4" y1="7" x2="20" y2="7"></line><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"></path><line x1="9" y1="4" x2="15" y2="4"></line><line x1="9" y1="4" x2="9" y2="7"></line><line x1="15" y1="4" x2="15" y2="7"></line><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>`, cls),
    eye: (cls = 'w-4 h-4') => svg(`<path d="M2 12c2.5-4.5 6-7 10-7s7.5 2.5 10 7c-2.5 4.5-6 7-10 7s-7.5-2.5-10-7z"></path><circle cx="12" cy="12" r="3"></circle>`, cls),
    eyeOff: (cls = 'w-4 h-4') => svg(`<path d="M2 12c2.5-4.5 6-7 10-7s7.5 2.5 10 7c-2.5 4.5-6 7-10 7s-7.5-2.5-10-7z"></path><circle cx="12" cy="12" r="3"></circle><line x1="3" y1="3" x2="21" y2="21"></line>`, cls),
    chevronDown: (cls = 'w-4 h-4') => svg(`<polyline points="6 9 12 15 18 9"></polyline>`, cls),
    image: (cls = 'w-4 h-4') => svg(`<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9.5" r="1.5"></circle><path d="M21 16l-5-5l-4 4l-2-2l-6 6"></path>`, cls),
    clock: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="7" x2="12" y2="12"></line><line x1="12" y1="12" x2="16" y2="14"></line>`, cls),
    badgePlus: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line>`, cls),
    externalLink: (cls = 'w-4 h-4') => svg(`<path d="M9 15L20 4"></path><path d="M14 4h6v6"></path><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"></path>`, cls),
    share: (cls = 'w-4 h-4') => svg(`<circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="6" r="2.5"></circle><circle cx="18" cy="18" r="2.5"></circle><line x1="8.2" y1="10.8" x2="15.8" y2="7.2"></line><line x1="8.2" y1="13.2" x2="15.8" y2="16.8"></line>`, cls),
    repeat: (cls = 'w-4 h-4') => svg(`<path d="M4 7h13l-3-3"></path><path d="M4 7l3 3"></path><path d="M20 17H7l3-3"></path><path d="M20 17l-3 3"></path>`, cls),
    arrowDown: (cls = 'w-4 h-4') => svg(`<line x1="12" y1="5" x2="12" y2="19"></line><polyline points="18 13 12 19 6 13"></polyline>`, cls),
    arrowUp: (cls = 'w-4 h-4') => svg(`<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="6 11 12 5 18 11"></polyline>`, cls),
    flag: (cls = 'w-4 h-4') => svg(`<path d="M5 3v18"></path><path d="M5 4h13l-3 4l3 4H5"></path>`, cls),
    medal: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="9" r="5"></circle><path d="M9 13l-2 8l5-3l5 3l-2-8"></path>`, cls),
    crown: (cls = 'w-4 h-4') => svg(`<path d="M4 18h16l-1-9l-4 3l-3-6l-3 6l-4-3z"></path><line x1="4" y1="20" x2="20" y2="20"></line>`, cls),
    users: (cls = 'w-4 h-4') => svg(`<circle cx="8" cy="8" r="3"></circle><path d="M2 19l1.5-4.5h9L14 19"></path><circle cx="17" cy="8" r="2.5"></circle><path d="M13.5 19l1-3.2h5L20.5 19"></path>`, cls),
    checkCircle: (cls = 'w-4 h-4') => svg(`<circle cx="12" cy="12" r="9"></circle><polyline points="8 12.5 11 15.5 16 9"></polyline>`, cls),
    gamepad: (cls = 'w-4 h-4') => svg(`<rect x="2" y="8" width="20" height="10" rx="5"></rect><line x1="7" y1="11" x2="7" y2="15"></line><line x1="5" y1="13" x2="9" y2="13"></line><circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"></circle><circle cx="18.5" cy="14" r="1" fill="currentColor" stroke="none"></circle>`, cls),
    alertTriangle: (cls = 'w-4 h-4') => svg(`<path d="M12 3l10 18H2z"></path><line x1="12" y1="9" x2="12" y2="14"></line><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"></circle>`, cls),
    chevronLeft: (cls = 'w-4 h-4') => svg(`<polyline points="15 6 9 12 15 18"></polyline>`, cls),
    chevronRight: (cls = 'w-4 h-4') => svg(`<polyline points="9 6 15 12 9 18"></polyline>`, cls),
    refresh: (cls = 'w-4 h-4') => svg(`<path d="M4 12a8 8 0 0 1 14-5.3"></path><polyline points="18 3 18 7 14 7"></polyline><path d="M20 12a8 8 0 0 1-14 5.3"></path><polyline points="6 21 6 17 10 17"></polyline>`, cls),
    play: (cls = 'w-4 h-4') => svg(`<polygon points="8 5 19 12 8 19" fill="currentColor" stroke="none"></polygon>`, cls)
};
