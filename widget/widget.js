// Widget autonome, pensé pour être intégré en <iframe> ailleurs (description de salon
// Discord, Notion, un autre site...) : affiche les N prochains événements sans dépendre du
// reste de l'app (pas de filtres, pas de modale, pas de FullCalendar). Réutilise telles
// quelles les mêmes briques que l'app principale (CSVParser/EventGenerator/renderEventCard),
// juste sans la couche UI complète.
import { CONFIG } from '../src/config.js';
import { CSVParser } from '../src/parsers/CSVParser.js';
import { EventGenerator } from '../src/services/EventGenerator.js';
import { renderEventCard } from '../src/ui/EventCardTemplate.js';

const params = new URLSearchParams(window.location.search);
const count = Math.min(Math.max(parseInt(params.get('count'), 10) || 6, 1), 20);

async function init() {
    const container = document.getElementById('widget-list');
    try {
        const rows = await CSVParser.fetch(CONFIG.CSV_URL);
        const now = new Date();
        const instances = [];
        rows.forEach(row => {
            try {
                instances.push(...EventGenerator.generate(row));
            } catch {
                // Une ligne invalide ne doit jamais faire planter tout le widget.
            }
        });

        const upcoming = instances
            .filter(e => !e.isCanceled && !e.isPlanned && new Date(e.start) >= now)
            .sort((a, b) => new Date(a.start) - new Date(b.start))
            .slice(0, count);

        if (upcoming.length === 0) {
            container.innerHTML = `<p class="text-center text-sm text-slate-500 py-8">Aucun événement à venir.</p>`;
            return;
        }

        container.innerHTML = upcoming.map(e => {
            const readableDate = new Date(e.start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            const targetUrl = `${CONFIG.SITE_URL}?event=${encodeURIComponent(e.id)}`;
            return `<a href="${targetUrl}" target="_blank" rel="noopener" class="block">${renderEventCard(e, readableDate)}</a>`;
        }).join('');
    } catch (err) {
        container.innerHTML = `<p class="text-center text-sm text-rose-400 py-8">Impossible de charger le planning.</p>`;
        console.error(err);
    }
}

init();
