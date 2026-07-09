import { DateUtils } from '../utils/DateUtils.js';
import { MetadataParser } from '../parsers/MetadataParser.js';
import { CONFIG } from '../config.js';
import { SearchEngine } from './SearchEngine.js';

// Repli utilisé pour estimer la fin d'un épisode quand sa ligne n'a aucune "Durée Réelle"
// renseignée (ex: dates ajoutées avant d'avoir le chrono exact) : une fois la vraie durée
// notée dans le tableur, elle reprend automatiquement le dessus (voir Priorités 1 et 2 de
// generate()) — ce n'est qu'un repère visuel temporaire, jamais utilisé pour les statistiques.
const DEFAULT_EPISODE_DURATION_MINUTES = 40;

export class EventGenerator {
    /**
     * Génère une liste d'instances d'événements calibrées à partir d'une ligne brute du CSV.
     * @param {Object} row - Ligne du CSV issue de PapaParse
     * @returns {Array<Object>} Liste des instances générées
     */
    static generate(row) {
        const instances = [];
        const title = row["Nom de l'event"]?.trim();
        const startRaw = row["Date de début"];
        
        // Validation renforcée issue du plan
        if (!title) return instances;

        const rawNotes = row["Notes"] || "";
        const parsedNotes = MetadataParser.parse(rawNotes);
        let type = row["Type d'event"];

        // Application des métadonnées de statut et rétro-compatibilité
        const isPartenaire = parsedNotes.meta.partenaire === "true";
        const isSanctuaire = parsedNotes.meta.sanctuaire === "true";
        const hasGenericAnnule = /annul[eé]/i.test(rawNotes);
        const hasGenericReporte = /report[eé]/i.test(rawNotes);
        const isCanceledBase = hasGenericAnnule || type === "Annulé / Reporté" || hasGenericReporte;

        if (isPartenaire) type = "Partenaire";
        else if (isSanctuaire) type = "Sanctuaire";
        else if (isCanceledBase) type = "Annulé / Reporté";

        const theme = CONFIG.THEMES[type] || CONFIG.THEMES.default;
        const start = DateUtils.parseDate(startRaw);
        const end = DateUtils.parseDate(row["Date de fin"]);

        // Gestion du cas "Planifié / Prévu" (Pas de date de début définie)
        if (!start) {
            const datePrevue = DateUtils.extractDate(rawNotes);
            if (datePrevue) {
                instances.push(this._createBaseInstance(title, parsedNotes, type, theme, row, {
                    start: datePrevue.toISOString().split('T')[0],
                    isPlanned: true,
                    progressStatus: "Prévu",
                    title: `[PRÉVU] ${title}`,
                    allDay: true
                }));
            }
            return instances;
        }

        const heureGlobale = startRaw?.includes(' ') ? DateUtils.formatHeure(startRaw.split(' ')[1]) : null;
        const isContre = rawNotes.toLowerCase().includes("remplacé");
        const today = new Date(); today.setHours(0,0,0,0);
        const now = new Date(); // Heure réelle actuelle (contrairement à `today`, tronqué à minuit)

        // Statut affiché sur la tuile, basé sur l'heure réelle et pas seulement la date :
        // DateUtils.parseDate ignore toujours l'heure et fixe la date à midi, donc un
        // événement qui se termine aujourd'hui restait auparavant "En Cours" jusqu'à
        // minuit même si son heure de fin réelle était déjà passée. On reconstruit ici
        // l'heure de début/fin réelle à partir des chaînes brutes du tableur.
        const startWithTime = new Date(start);
        if (heureGlobale) {
            const [sh, sm] = heureGlobale.split(':').map(Number);
            startWithTime.setHours(sh, sm, 0, 0);
        } else {
            startWithTime.setHours(0, 0, 0, 0);
        }

        const endRawGlobal = row["Date de fin"];
        const heureFinGlobale = endRawGlobal?.includes(' ') ? DateUtils.formatHeure(endRawGlobal.split(' ')[1]) : null;
        let endWithTime = null;
        if (end) {
            endWithTime = new Date(end);
            if (heureFinGlobale) {
                const [eh, em] = heureFinGlobale.split(':').map(Number);
                endWithTime.setHours(eh, em, 0, 0);
            } else {
                endWithTime.setHours(23, 59, 59, 999); // Pas d'heure de fin précisée : fin de journée
            }
        }

        // "Prévu" tant que l'heure de début n'est pas arrivée, "Terminé" seulement si une
        // date de fin existe et son heure est dépassée (sans date de fin, un événement
        // démarré reste "En Cours" indéfiniment).
        let progressStatus;
        if (startWithTime > now) {
            progressStatus = "Prévu";
        } else if (endWithTime && endWithTime < now) {
            progressStatus = "Terminé";
        } else {
            progressStatus = "En Cours";
        }

        // Objet de base commun à toutes les déclinaisons de cette ligne
        const baseConfig = {
            heure: heureGlobale,
            isContre,
            isCanceled: isCanceledBase,
            progressStatus
        };

        // Extraction des pauses / reprises
        const pauseDate = DateUtils.extractSpecificDate(rawNotes, "pause");
        const repriseDate = DateUtils.extractSpecificDate(rawNotes, "reprise");

        // -------------------------------------------------------------
        // APPLICATION DES PRIORITÉS DU PLAN (PAS DE MÉLANGE)
        // -------------------------------------------------------------
        const episodes = DateUtils.extractEpisodes(rawNotes);
        // Index par date (YYYY-MM-DD) pour retrouver l'annotation explicite d'une semaine
        // donnée dans l'expansion hebdomadaire (ex: une semaine à double épisode).
        const episodesByDate = new Map(episodes.map(ep => [ep.date, ep]));

        // Numérotation automatique des épisodes pour les séries (affichée sur la tuile calendrier)
        const isSeries = type === "Soirée Série";
        const hasHebdoKeyword = rawNotes.toLowerCase().includes("hebdo");
        let episodeCounter = 0;

        // "Durée Réelle" est la durée CUMULÉE de toute la ligne (ex: 8h16 pour 8 épisodes).
        // Quand une ligne génère plusieurs occurrences, on la répartit en durée moyenne par
        // occurrence pour ne pas fausser les cumuls de statistiques (sinon chaque occurrence
        // compterait la durée totale, multipliant artificiellement le temps cumulé).
        const totalDuration = DateUtils.parseDuration(row["Durée Réelle"]);

        // Priorité 1 : Expansion Hebdomadaire (le cas "Soirée Série" standard). Certaines
        // semaines peuvent porter une annotation explicite ("11/07/2025: Episode 1 et 2")
        // pour signaler un double épisode ou tout autre cas particulier ; la numérotation
        // continue alors correctement pour les semaines suivantes (ex: la semaine d'après
        // reprend à "Épisode 3", pas "Épisode 2").
        if (hasHebdoKeyword || isSeries) {
            // Sans date de fin explicite, on ne projette pas des mois de "Prévu" spéculatifs :
            // seules les occurrences passées et celle de la semaine prochaine sont générées.
            const limit = end || new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000));
            const validEntries = [];
            let cur = new Date(start);
            while (cur <= limit) {
                const iso = cur.toISOString().split('T')[0];
                if (!this._isPaused(iso, pauseDate, repriseDate)) {
                    validEntries.push({ iso, explicit: episodesByDate.get(iso) || null });
                }
                cur.setDate(cur.getDate() + 7);
            }
            const avgDuration = validEntries.length > 0 ? Math.round(totalDuration / validEntries.length) : totalDuration;

            validEntries.forEach(({ iso, explicit }) => {
                const count = explicit ? this._countEpisodesInText(explicit.text) : 1;
                const startNum = episodeCounter + 1;
                episodeCounter += count;
                const label = count > 1 ? `Épisodes ${startNum}-${episodeCounter}` : `Épisode ${episodeCounter}`;
                const heureInst = explicit?.heure || heureGlobale;
                // Durée moyenne de cet épisode (pas de "Date de fin" par occurrence pour une
                // série hebdo : celle du tableur ne concerne que la fin de la série entière).
                // Sans "Durée Réelle" du tout, on part d'un repère par défaut par épisode
                // (voir DEFAULT_EPISODE_DURATION_MINUTES) en attendant la vraie donnée.
                const effectiveDuration = avgDuration > 0 ? avgDuration : count * DEFAULT_EPISODE_DURATION_MINUTES;
                const durationEnd = this.computeDurationEnd(iso, heureInst, effectiveDuration);

                instances.push(this._createBaseInstance(title, parsedNotes, type, theme, row, {
                    ...baseConfig,
                    start: iso + 'T' + (heureInst || '12:00') + ':00',
                    heure: heureInst,
                    allDay: !heureInst,
                    end: durationEnd?.endValue || null,
                    isMultiDay: durationEnd?.isMultiDay || false,
                    sub: explicit ? explicit.text : null,
                    episode: isSeries ? label : null,
                    dur: avgDuration
                }));
            });
        }
        // Priorité 2 : Épisodes explicites seuls (pas de mot-clé "hebdo" ni de série
        // continue : uniquement les dates listées, sans reconduction automatique).
        else if (episodes.length > 0) {
            const validEpisodes = episodes.filter(ep => !this._isPaused(ep.date, pauseDate, repriseDate));
            const avgDuration = validEpisodes.length > 0 ? Math.round(totalDuration / validEpisodes.length) : totalDuration;

            validEpisodes.forEach(ep => {
                episodeCounter++;
                const heureInst = ep.heure || heureGlobale;
                // Une ligne "Episode 4 à 6" couvre 3 épisodes : sans "Durée Réelle", le repère
                // par défaut (voir DEFAULT_EPISODE_DURATION_MINUTES) est multiplié d'autant.
                const count = this._countEpisodesInText(ep.text);
                const effectiveDuration = avgDuration > 0 ? avgDuration : count * DEFAULT_EPISODE_DURATION_MINUTES;
                const durationEnd = this.computeDurationEnd(ep.date, heureInst, effectiveDuration);
                instances.push(this._createBaseInstance(title, parsedNotes, type, theme, row, {
                    ...baseConfig,
                    start: ep.date + 'T' + (heureInst || '12:00') + ':00',
                    heure: heureInst,
                    allDay: !heureInst,
                    end: durationEnd?.endValue || null,
                    isMultiDay: durationEnd?.isMultiDay || false,
                    sub: ep.text,
                    episode: isSeries ? `Épisode ${episodeCounter}` : null,
                    dur: avgDuration
                }));
            });
        }
        // Priorité 3 : Événement Unique / IRL (Meet Up, Partenaire, Sanctuaire)
        // Un seul événement, allongé sur toute la période réelle (Date de début -> Date de fin)
        // au lieu d'une instance dupliquée par jour, pour que le calendrier affiche un bandeau
        // continu sur toute sa durée réelle.
        else if (type === "Meet Up" || isPartenaire || isSanctuaire) {
            const endDateObj = end || start;
            const startIso = start.toISOString().split('T')[0];
            const endIso = endDateObj.toISOString().split('T')[0];
            const isMultiDay = startIso !== endIso;

            const endRaw = row["Date de fin"];
            const heureFin = endRaw?.includes(' ') ? DateUtils.formatHeure(endRaw.split(' ')[1]) : null;

            let endValue;
            if (isMultiDay) {
                // Borne de fin exclusive attendue par FullCalendar pour qu'un bandeau
                // recouvre visuellement le dernier jour de l'événement.
                const endExclusive = new Date(endDateObj);
                endExclusive.setDate(endExclusive.getDate() + 1);
                endValue = endExclusive.toISOString().split('T')[0];
            } else {
                endValue = endIso + 'T' + (heureFin || baseConfig.heure || '23:59') + ':00';
            }

            instances.push(this._createBaseInstance(title, parsedNotes, type, theme, row, {
                ...baseConfig,
                start: startIso + 'T' + (baseConfig.heure || '12:00') + ':00',
                end: endValue,
                isMultiDay,
                // Un bandeau étalé sur plusieurs jours (IRL) se lit mieux en tout-la-journée ;
                // un événement d'une seule journée reste ponctuel s'il a une heure connue.
                allDay: isMultiDay || !baseConfig.heure
            }));
        }
        // Cas standard unitaire
        else {
            const startIso = start.toISOString().split('T')[0];
            let endValue = null;
            let isMultiDayStandard = false;

            if (end && end.toISOString().split('T')[0] !== startIso) {
                // "Date de fin" pointe explicitement vers un autre jour : chevauchement de
                // minuit noté factuellement (ex: soirée de 23h30 à 01h10 le lendemain) —
                // signal explicite, prioritaire sur tout calcul.
                isMultiDayStandard = true;
                endValue = end.toISOString().split('T')[0] + 'T' + (heureFinGlobale || '23:59') + ':00';
            } else {
                // Pas de "Date de fin" utile (absente, ou juste une convention de saisie
                // "même jour" qui ne reflète pas la durée réelle) : on calcule automatiquement
                // la fin depuis "Durée Réelle", ce qui détecte aussi un chevauchement de
                // minuit (ex: début 23h30 + 2h de durée réelle).
                const durationEnd = this.computeDurationEnd(startIso, baseConfig.heure, totalDuration);
                if (durationEnd) {
                    endValue = durationEnd.endValue;
                    isMultiDayStandard = durationEnd.isMultiDay;
                }
            }

            instances.push(this._createBaseInstance(title, parsedNotes, type, theme, row, {
                ...baseConfig,
                start: startIso + 'T' + (baseConfig.heure || '12:00') + ':00',
                end: endValue,
                isMultiDay: isMultiDayStandard,
                // Ce cas reste un événement ponctuel avec heure précise (même s'il chevauche
                // minuit) : contrairement au bandeau Meet Up, il ne doit pas passer en tout-la-journée.
                allDay: !baseConfig.heure
            }));
        }

        return instances;
    }

    /**
     * Calcule automatiquement l'heure de fin d'une occurrence à partir d'une durée en
     * minutes (durée réelle notée, durée moyenne calculée pour une série/hebdo, ou durée
     * moyenne globale de repli — voir appelants dans ce fichier et dans main.js),
     * appliquée depuis son heure de début réelle. Détecte au passage un chevauchement de
     * minuit (ex: début 23h30 + 1h30 de durée -> fin 01h00 le lendemain), sans dépendre
     * d'une "Date de fin" explicite par occurrence (qui n'a de sens qu'au niveau de la
     * ligne entière pour une série hebdomadaire). Public (pas de préfixe `_`) : réutilisé
     * par main.js pour estimer la fin des épisodes dont la ligne n'a aucune durée notée.
     * @param {string} startIso - "YYYY-MM-DD" de l'occurrence
     * @param {string|null} heure - Heure de début "HH:MM" (minuit si absente)
     * @param {number} durationMinutes
     * @returns {{ endValue: string, isMultiDay: boolean } | null} null si durée inconnue/nulle
     */
    static computeDurationEnd(startIso, heure, durationMinutes) {
        if (!durationMinutes || durationMinutes <= 0) return null;
        const startDate = new Date(`${startIso}T${heure || '00:00'}:00`);
        const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
        const endValue = DateUtils.toLocalIso(endDate);
        return { endValue, isMultiDay: endValue.split('T')[0] !== startIso };
    }

    static _isPaused(dateIso, pause, reprise) {
        const pauseIso = pause ? pause.toISOString().split('T')[0] : null;
        const repriseIso = reprise ? reprise.toISOString().split('T')[0] : null;
        return pauseIso && dateIso >= pauseIso && (!repriseIso || dateIso < repriseIso);
    }

    /**
     * Devine le nombre d'épisodes couverts par une annotation libre ("Episode 1 et 2",
     * "Episodes 4 à 6", "Episode 8") pour faire avancer correctement la numérotation
     * automatique des semaines suivantes.
     * @param {string} text
     * @returns {number}
     */
    static _countEpisodesInText(text) {
        if (!text) return 1;
        const rangeMatch = text.match(/(\d+)\s*(?:à|-)\s*(\d+)/i);
        if (rangeMatch) {
            const from = parseInt(rangeMatch[1], 10);
            const to = parseInt(rangeMatch[2], 10);
            if (!isNaN(from) && !isNaN(to) && to >= from) return to - from + 1;
        }
        const numbers = text.match(/\d+/g);
        return numbers ? numbers.length : 1;
    }

    static _createBaseInstance(title, parsedNotes, type, theme, row, overrides) {
        // Force l'existence d'un tableau propre pour les tags
        const cleanTags = Array.isArray(parsedNotes.tags) ? parsedNotes.tags : [];
        // isContre ne sert qu'à décider le titre ci-dessous : on l'extrait pour ne pas
        // le laisser trainer, inutilisé, sur l'instance finale.
        const { isContre, ...restOverrides } = overrides;

        const instance = {
            title: isContre ? "Contre Soirée" : title,
            notes: parsedNotes.content || "",
            tags: cleanTags, // On s'assure que c'est bien transmis ici !
            meta: parsedNotes.meta || {},
            type,
            img: theme.img,
            col: theme.col,
            category: theme.cat,
            dur: DateUtils.parseDuration(row["Durée Réelle"]),
            sub: null,
            isCanceled: false,
            isPlanned: false,
            end: null,
            isMultiDay: false,
            allDay: false,
            progressStatus: "En Cours",
            // Lieu par défaut si ni "Loc :", ni @loc/@location n'est renseigné dans les Notes.
            location: parsedNotes.meta.loc || parsedNotes.meta.location || CONFIG.DEFAULT_LOCATION,
            // @image/@url (ou @lien/@link) de l'événement priment sur l'affiche/lien par
            // défaut du type (voir config.js) ; null si ni l'un ni l'autre n'est défini.
            image: parsedNotes.meta.image || theme.image || null,
            url: parsedNotes.meta.url || parsedNotes.meta.lien || parsedNotes.meta.link || theme.url || null,
            ...restOverrides
        };

        // Identifiant stable (pour la durée d'un chargement) utilisé par le lien
        // partageable (?event=...) et le suivi des "nouveaux" événements : la combinaison
        // titre + date de début est unique en pratique (deux occurrences distinctes ne
        // démarrent jamais à la même seconde avec le même titre). Pas d'encodage manuel ici :
        // URLSearchParams s'en charge déjà à la volée côté ModalView (encoder deux fois
        // produirait une URL doublement échappée, moche mais toujours fonctionnelle).
        instance.id = `${instance.start}__${instance.title}`;

        // Compilation de l'index de recherche
        instance.searchIndex = SearchEngine.createIndex(instance);

        return instance;
    }
}