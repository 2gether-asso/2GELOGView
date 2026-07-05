export const CONFIG = {
    CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSVu8Z5ZxyDpRVG3eFFLuWH_iWKZyKuLWKvW617wBfAMT6no6UVah6HSqlhM8LDKjheEc4EBfSXgooM/pub?gid=0&single=true&output=csv",

    // Lieu affiché quand aucun @location/@loc n'est renseigné dans les Notes (voir
    // EventGenerator). Centralisé ici pour n'avoir qu'un seul endroit à changer.
    DEFAULT_LOCATION: "Discord 2GETHER",

    // Verrou du mode ?admin. ⚠️ Ce site est 100% statique (GitHub Pages) : ceci n'est
    // PAS une vraie sécurité (le hash et la logique de vérification sont visibles dans
    // le code source, contournables par quiconque sait lire du JS). Ça bloque juste les
    // visiteurs occasionnels qui tomberaient sur ?admin par curiosité.
    // Pour changer le mot de passe : calculez le SHA-256 hexadécimal du nouveau mot de
    // passe (ex. dans la console du navigateur :
    //   crypto.subtle.digest('SHA-256', new TextEncoder().encode('votre-mot-de-passe'))
    //     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
    // ) puis collez le résultat ci-dessous.
    ADMIN_PASSPHRASE_SHA256: "f36d4064fdd194db7ee4b51379b4fbec2cb988f5d70ab7161584c4f04a790823",

    THEMES: {
        "Soirée Jeux":      { img: "soiree-jeux.png", col: "#4fc4e8", cat: "game" },
        "Bravery":          { img: "bravery.png", col: "#e8c44f", cat: "game" },
        "Soirée Film":      { img: "soiree-film.png", col: "#e84f4f", cat: "watch" },
        "Soirée Série":     { img: "soiree-serie.png", col: "#e84f4f", cat: "watch" },
        "Soirée Spéciale":  { img: "soiree-speciale.png", col: "#704fe8", cat: "watch" },
        "Hors Prog":        { img: "hors-prog.png", col: "#914fe8", cat: "watch" },
        "Gazette 2025":     { img: "gazette-2025.png", col: "#bd8f5e", cat: "watch" },
        "Gazette 2026":     { img: "gazette-2026.png", col: "#5ebd8f", cat: "watch" },
        "Event St Valentin":{ img: "st-valentin.png", col: "#bd5ea4", cat: "watch" },
        "Meet Up":          { img: "meet-up.png", col: "#3b82f6", cat: "watch" },
        "Partenaire":       { img: "meet-up.png", col: "#ef4444", cat: "watch" },
        "Sanctuaire":       { img: "meet-up.png", col: "#a855f7", cat: "watch" },
        "Event Halloween":  { img: "halloween.png", col: "#e6b33e", cat: "watch" },
        "Event Nowel":      { img: "nowel.png", col: "#79bd57", cat: "watch" },
        "JDR":              { img: "jdr.png", col: "#e342de", cat: "game" },
        "Soirée Minecraft": { img: "minecraft.png", col: "#42e342", cat: "game" },
        "Annulé / Reporté": { img: "hors-prog.png", col: "#ef4444", cat: "watch" },
        "default":          { img: "hors-prog.png", col: "#914fe8", cat: "watch" }
    }
};