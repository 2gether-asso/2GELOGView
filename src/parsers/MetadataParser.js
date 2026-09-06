// Retire les diacritiques (accents) d'une chaine : "episode" et "épisode" deviennent identiques.
// Regex sur la plage Unicode des marques diacritiques combinantes (U+0300-U+036F).
function stripAccents(str) {
    return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Clés `@` qui peuvent apparaître plusieurs fois sur des lignes distinctes pour accumuler
// plusieurs valeurs (ex: plusieurs clips YouTube ou captures d'écran pour un même événement,
// voir @clip/@screen dans GUIDE_METADONNEES.md) - au lieu du comportement par défaut où la
// dernière occurrence écrase silencieusement les précédentes.
const REPEATABLE_META_KEYS = new Set(["clip", "screen"]);

export class MetadataParser {
    /**
     * Analyse une chaîne de caractères pour en extraire les tags, les métadonnées et le texte libre.
     * @param {string} text
     * @returns {Object} { tags: Array, meta: Object, content: string }
     */
    static parse(text) {
        // Set (pas juste un tableau) : dédoublonne les tags répétés — notamment pendant la
        // migration Notes -> Tags (voir EventGenerator.generate()), où une même ligne peut
        // temporairement porter le même #tag dans les deux colonnes fusionnées ici.
        const tagSet = new Set();
        const meta = {};
        const linesContent = [];

        if (!text) return { tags: [], meta, content: "" };

        text.split("\n").forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return;

            // 1. Détection des Tags (#tag)
            if (trimmedLine.startsWith("#")) {
                tagSet.add(trimmedLine.slice(1).trim().toLowerCase());
                return;
            }

            // 2. Détection des Métadonnées Modernes (@cle:valeur)
            if (trimmedLine.startsWith("@")) {
                const parts = trimmedLine.slice(1).split(":");
                if (parts.length >= 2) {
                    // Les accents sont retirés de la clé ("@Épisode" -> "episode") pour que
                    // @episode et @épisode pointent tous les deux vers la même métadonnée.
                    const key = stripAccents(parts[0].trim().toLowerCase());
                    const value = parts.slice(1).join(":").trim();
                    if (REPEATABLE_META_KEYS.has(key)) {
                        if (!Array.isArray(meta[key])) meta[key] = [];
                        meta[key].push(value);
                    } else {
                        meta[key] = value;
                    }
                    return;
                }
            }

            // 3. Rétro-compatibilité : Détection de l'ancien format "Loc : ..."
            if (/^loc\s*:/i.test(trimmedLine)) {
                const parts = trimmedLine.split(":");
                meta["loc"] = parts.slice(1).join(":").trim();
                return;
            }
            if (/partenaire/i.test(trimmedLine)) meta["partenaire"] = "true";
            if (/sanctuaire/i.test(trimmedLine)) meta["sanctuaire"] = "true";

            // Si ce n'est ni un tag, ni une méta, c'est du texte libre
            linesContent.push(line);
        });

        return {
            tags: [...tagSet],
            meta,
            content: linesContent.join("\n").trim()
        };
    }
}
