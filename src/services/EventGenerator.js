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

        // Colonne "Tags" (migration en cours dans le tableur, cf. GUIDE_METADONNEES.md) :
        // à terme, tous les #tag/@clé:valeur/mots-clés spéciaux y vivront, et "Notes" ne
        // servira plus qu'au commentaire libre. En attendant, les deux colonnes sont fusionnées
        // ici et lues indifféremment, pour que la migration puisse se faire ligne par ligne
        // sans rien casser (une ligne peut avoir ses tags dans l'une, l'autre, ou les deux).
        const rawNotes = [row["Tags"], row["Notes"]].filter(Boolean).join("\n");
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

        const endRawGlobal = row["Date de fin"];
        const heureFinGlobale = endRawGlobal?.includes(' ') ? DateUtils.formatHeure(endRawGlobal.split(' ')[1]) : null;

        // Objet de base commun à toutes les déclinaisons de cette ligne. `progressStatus`
        // n'y figure plus : une série hebdo/à épisodes génère plusieurs dates distinctes à
        // partir d'une seule ligne, et chacune doit avoir SON PROPRE statut (Prévu/En Cours/
        // Terminé) selon SES propres début/fin — pas celui, unique, calculé une fois pour
        // toute la ligne (qui faisait qu'un épisode diffusé la semaine dernière restait "En
        // Cours" indéfiniment dès lors que la ligne elle-même n'avait pas de "Date de fin").
        // Voir _computeProgressStatus(), appelé par occurrence dans _createBaseInstance().
        const baseConfig = {
            heure: heureGlobale,
            isContre,
            isCanceled: isCanceledBase
        };

        // La cellule "Durée Réelle" a-t-elle été renseignée, même à 0 (ex: une Gazette, qui
        // n'a pas de session à proprement parler) ? Distinct de `totalDuration > 0` plus bas,
        // qui vaut 0 aussi bien pour "case vide" que pour "0:00" explicite. Sert uniquement au
        // cas standard (Priorité 4) pour décider si une durée à 0 est un signal réel
        // ("événement instantané", ex: publication d'une Gazette -> Terminé juste après le
        // début) ou une absence de donnée (Durée Réelle pas encore chronométrée -> pas de fin
        // fiable, voir `endIsEstimate` sur les instances).
        const hasDurationData = Boolean(row["Durée Réelle"] && String(row["Durée Réelle"]).trim());

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
            // Durée de chaque occurrence : réelle (explicite par épisode) quand annotée,
            // moyenne du reliquat de "Durée Réelle" sinon — voir _computeEpisodeDurations().
            const entries = validEntries.map(({ explicit }) => ({
                explicit,
                count: explicit ? this._countEpisodesInText(explicit.text) : 1
            }));
            const durations = this._computeEpisodeDurations(entries, totalDuration);

            validEntries.forEach(({ iso, explicit }, i) => {
                const { count } = entries[i];
                const { duration: effectiveDuration, isEstimate } = durations[i];
                const startNum = episodeCounter + 1;
                episodeCounter += count;
                const label = count > 1 ? `Épisodes ${startNum}-${episodeCounter}` : `Épisode ${episodeCounter}`;
                const heureInst = explicit?.heure || heureGlobale;
                // Pas de "Date de fin" par occurrence pour une série hebdo (celle du tableur
                // ne concerne que la fin de la série entière) : la fin se calcule toujours
                // depuis la durée effective de cette occurrence précise.
                const durationEnd = this.computeDurationEnd(iso, heureInst, effectiveDuration);

                instances.push(this._createBaseInstance(title, parsedNotes, type, theme, row, {
                    ...baseConfig,
                    start: iso + 'T' + (heureInst || '12:00') + ':00',
                    heure: heureInst,
                    allDay: !heureInst,
                    end: durationEnd?.endValue || null,
                    isMultiDay: durationEnd?.isMultiDay || false,
                    // Fin estimée (pas de durée réelle connue pour cette occurrence précise) :
                    // ne doit pas suffire à conclure "Terminé" (voir _computeProgressStatus).
                    endIsEstimate: isEstimate,
                    sub: explicit ? explicit.text : null,
                    episode: isSeries ? label : null,
                    dur: effectiveDuration
                }));
            });
        }
        // Priorité 2 : Épisodes explicites seuls (pas de mot-clé "hebdo" ni de série
        // continue : uniquement les dates listées, sans reconduction automatique).
        else if (episodes.length > 0) {
            const validEpisodes = episodes.filter(ep => !this._isPaused(ep.date, pauseDate, repriseDate));
            const entries = validEpisodes.map(ep => ({ explicit: ep, count: this._countEpisodesInText(ep.text) }));
            const durations = this._computeEpisodeDurations(entries, totalDuration);

            validEpisodes.forEach((ep, i) => {
                episodeCounter++;
                const heureInst = ep.heure || heureGlobale;
                const { duration: effectiveDuration, isEstimate } = durations[i];
                const durationEnd = this.computeDurationEnd(ep.date, heureInst, effectiveDuration);
                instances.push(this._createBaseInstance(title, parsedNotes, type, theme, row, {
                    ...baseConfig,
                    start: ep.date + 'T' + (heureInst || '12:00') + ':00',
                    heure: heureInst,
                    allDay: !heureInst,
                    end: durationEnd?.endValue || null,
                    isMultiDay: durationEnd?.isMultiDay || false,
                    endIsEstimate: isEstimate,
                    sub: ep.text,
                    episode: isSeries ? `Épisode ${episodeCounter}` : null,
                    dur: effectiveDuration
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
            } else if (totalDuration > 0) {
                // Pas de "Date de fin" utile (absente, ou juste une convention de saisie
                // "même jour" qui ne reflète pas la durée réelle) : on calcule automatiquement
                // la fin depuis "Durée Réelle", ce qui détecte aussi un chevauchement de
                // minuit (ex: début 23h30 + 2h de durée réelle).
                const durationEnd = this.computeDurationEnd(startIso, baseConfig.heure, totalDuration);
                if (durationEnd) {
                    endValue = durationEnd.endValue;
                    isMultiDayStandard = durationEnd.isMultiDay;
                }
            } else if (hasDurationData) {
                // "Durée Réelle" explicitement à 0 (ex: une Gazette : publiée, pas de session
                // à proprement parler) : signal réel d'événement instantané, fin = début, donc
                // "Terminé" juste après l'heure de publication plutôt que "En Cours" indéfiniment.
                endValue = startIso + 'T' + (baseConfig.heure || '12:00') + ':00';
            }
            // Sinon (aucune donnée de durée du tout) : `endValue` reste `null`, l'événement
            // reste "En Cours" indéfiniment une fois démarré en attendant la vraie donnée
            // (voir _computeProgressStatus) — plutôt que de deviner "Terminé" à tort.

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

    /**
     * Calcule "Prévu / En Cours / Terminé" à partir du début/fin RÉELS de CETTE occurrence
     * (pas de la ligne entière du tableur) : voir le commentaire sur `baseConfig` dans
     * generate() pour pourquoi ça doit être calculé par occurrence.
     * @param {Object} instance - Doit déjà avoir `start`/`end`/`endIsEstimate` finalisés.
     * @returns {"Prévu"|"En Cours"|"Terminé"}
     */
    static _computeProgressStatus(instance) {
        const now = new Date();
        const startWithTime = new Date(instance.start);
        if (startWithTime > now) return "Prévu";
        // Pas de fin connue, ou fin estimée (repli DEFAULT_EPISODE_DURATION_MINUTES faute de
        // vraie "Durée Réelle") : pas assez fiable pour conclure "Terminé", on reste "En Cours"
        // une fois démarré, en attendant la vraie donnée dans le tableur.
        if (!instance.end || instance.endIsEstimate) return "En Cours";

        // Une fin "date seule" (YYYY-MM-DD, borne exclusive d'un bandeau allDay) désigne le
        // début du jour suivant la dernière journée réelle ; une fin complète (avec l'heure)
        // se compare telle quelle.
        const endWithTime = instance.end.includes('T')
            ? new Date(instance.end)
            : new Date(`${instance.end}T00:00:00`);
        return endWithTime <= now ? "Terminé" : "En Cours";
    }

    static _isPaused(dateIso, pause, reprise) {
        const pauseIso = pause ? pause.toISOString().split('T')[0] : null;
        const repriseIso = reprise ? reprise.toISOString().split('T')[0] : null;
        return pauseIso && dateIso >= pauseIso && (!repriseIso || dateIso < repriseIso);
    }

    /**
     * Calcule la durée effective de chaque occurrence d'une ligne hebdo/épisodique.
     * Une occurrence annotée avec des durées explicites par épisode (ex: "Episodes 3 à 6
     * (1h,23min,45min,1h)", voir DateUtils.extractEpisodes) utilise leur somme : réelle et
     * fiable, indépendamment de "Durée Réelle". Les occurrences restantes (sans annotation)
     * se partagent le RELIQUAT de "Durée Réelle" — le total de la ligne moins ce qui est déjà
     * expliqué par les durées explicites — réparti sur le nombre d'épisodes qu'il leur reste
     * à couvrir, plutôt qu'une simple division uniforme qui gonflerait injustement leur part
     * (et fausserait les statistiques cumulées) avec du temps déjà compté ailleurs.
     * @param {Array<{explicit: Object|null, count: number}>} entries
     * @param {number} totalDuration - "Durée Réelle" cumulée de toute la ligne (minutes)
     * @returns {Array<{duration: number, isEstimate: boolean}>}
     */
    static _computeEpisodeDurations(entries, totalDuration) {
        let explicitTotal = 0;
        const explicitDurations = entries.map(({ explicit }) => {
            const durations = explicit?.durations;
            if (!durations || durations.length === 0) return null;
            const sum = durations.reduce((a, b) => a + b, 0);
            explicitTotal += sum;
            return sum;
        });

        // Le reliquat se répartit au PRORATA du nombre d'épisodes de chaque occurrence
        // restante (une entrée "Episodes 3 à 6" en couvre 4, une "Episode 9" n'en couvre
        // qu'1) — diviser par le nombre d'OCCURRENCES plutôt que d'ÉPISODES sous-évaluerait
        // les occurrences à plusieurs épisodes et sur-évaluerait celles à un seul.
        const remainingEpisodeCount = entries.reduce(
            (sum, { count }, i) => explicitDurations[i] === null ? sum + count : sum, 0
        );
        const remainingTotal = Math.max(0, totalDuration - explicitTotal);
        // Sans "Durée Réelle" du tout pour ce qui reste, on part d'un repère par défaut par
        // épisode (voir DEFAULT_EPISODE_DURATION_MINUTES) en attendant la vraie donnée.
        const perEpisodeAvg = remainingEpisodeCount > 0 ? remainingTotal / remainingEpisodeCount : 0;

        return entries.map(({ count }, i) => {
            if (explicitDurations[i] !== null) return { duration: explicitDurations[i], isEstimate: false };
            if (perEpisodeAvg > 0) return { duration: Math.round(perEpisodeAvg * count), isEstimate: false };
            return { duration: count * DEFAULT_EPISODE_DURATION_MINUTES, isEstimate: true };
        });
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
            endIsEstimate: false,
            isMultiDay: false,
            allDay: false,
            // Lieu par défaut si ni "Loc :", ni @loc/@location n'est renseigné dans les Notes.
            location: parsedNotes.meta.loc || parsedNotes.meta.location || CONFIG.DEFAULT_LOCATION,
            // @image/@url (ou @lien/@link) de l'événement priment sur l'affiche/lien par
            // défaut du type (voir config.js) ; null si ni l'un ni l'autre n'est défini.
            image: parsedNotes.meta.image || theme.image || null,
            url: parsedNotes.meta.url || parsedNotes.meta.lien || parsedNotes.meta.link || theme.url || null,
            ...restOverrides
        };

        // Calculé après coup (dépend de `start`/`end` déjà finalisés ci-dessus), sauf pour un
        // événement "Prévu" (date connue approximativement dans les Notes, pas d'heure réelle
        // à comparer) dont le statut est déjà fixé explicitement dans restOverrides.
        if (!instance.isPlanned) {
            instance.progressStatus = this._computeProgressStatus(instance);
        }

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