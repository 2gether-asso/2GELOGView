export const CONFIG = {
    CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSVu8Z5ZxyDpRVG3eFFLuWH_iWKZyKuLWKvW617wBfAMT6no6UVah6HSqlhM8LDKjheEc4EBfSXgooM/pub?gid=0&single=true&output=csv",

    // Lieu affiché quand aucun @location/@loc n'est renseigné dans les Notes (voir
    // EventGenerator). Centralisé ici pour n'avoir qu'un seul endroit à changer.
    DEFAULT_LOCATION: "Discord 2GETHER",

    // Organisateur affiché quand aucun @host/@orga n'est renseigné : la grande majorité
    // des sessions sans mention explicite sont animées par Helldwin.
    DEFAULT_HOST: "Helldwin",

    // Un événement "En Cours" dont la fin n'est qu'une estimation (endIsEstimate, voir
    // EventGenerator) ou totalement inconnue ne doit être présenté comme "en direct
    // maintenant" (bandeau, pastille animée) que peu de temps après son début : sans
    // cette limite, une série dont la durée réelle n'est toujours pas renseignée dans le
    // tableur (ex: un seul épisode regardé, jamais refermé) resterait "en direct" des
    // semaines durant. Un événement à fin confirmée (réelle ou explicite) reste lui
    // toujours fiable, quel que soit son âge : cette limite ne s'applique qu'à l'incertain.
    LIVE_GRACE_HOURS: 6,

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

    // `image` et `url` sont les valeurs par défaut utilisées pour un événement de ce
    // type quand ses Notes ne précisent pas leur propre @image / @url (ou @lien/@link
    // pour l'url) — voir GUIDE_METADONNEES.md. Un événement qui renseigne sa propre
    // métadonnée prime toujours sur la valeur par défaut ci-dessous. Laissez à "" pour
    // ne rien afficher par défaut sur ce type ; complétez avec vos propres URLs
    // (affiche/bannière de type, lien vers votre chaîne, catégorie Twitch, etc.).
    // `img` pointe dans assets/img/badges/ (icône de type sur les tuiles/modale) ;
    // `image` par défaut pointe dans assets/img/default/ (bannière locale, plus fiable
    // qu'un lien CDN Discord qui finit toujours par expirer).
    THEMES: {
        "Soirée Jeux":      { img: "soiree-jeux.png", col: "#4fc4e8", cat: "jeux", image: "./assets/img/default/Gaming Banner.png", url: "" },
        "Bravery":          { img: "bravery.png", col: "#e8c44f", cat: "jeux", image: "./assets/img/default/Bravery Banner.png", url: "" },
        "Soirée Film":      { img: "soiree-film.png", col: "#e84f4f", cat: "visionnage", image: "./assets/img/default/Movie Banner.png", url: "" },
        "Soirée Série":     { img: "soiree-serie.png", col: "#e84f4f", cat: "visionnage", image: "./assets/img/default/Movie Banner.png", url: "" },
        "Soirée Spéciale":  { img: "soiree-speciale.png", col: "#704fe8", cat: "special", image: "./assets/img/default/Spécial Banner.png", url: "" },
        "Hors Prog":        { img: "hors-prog.png", col: "#914fe8", cat: "hors prog", image: "./assets/img/default/Mystery Banner.png", url: "" },
        "Gazette 2025":     { img: "gazette-2025.png", col: "#bd8f5e", cat: "gazette", image: "", url: "" },
        "Gazette 2026":     { img: "gazette-2026.png", col: "#5ebd8f", cat: "gazette", image: "./assets/img/default/Gazette Banner2026.png", url: "" },
        "Event St Valentin":{ img: "st-valentin.png", col: "#bd5ea4", cat: "special", image: "./assets/img/default/Valentine Banner.png", url: "" },
        "Meet Up":          { img: "meet-up.png", col: "#3b82f6", cat: "irl", image: "", url: "" },
        "Partenaire":       { img: "meet-up.png", col: "#ef4444", cat: "externe", image: "", url: "" },
        "Sanctuaire":       { img: "meet-up.png", col: "#a855f7", cat: "irl", image: "", url: "" },
        "Event Halloween":  { img: "halloween.png", col: "#e6b33e", cat: "special", image: "", url: "" },
        "Event Nowel":      { img: "nowel.png", col: "#79bd57", cat: "special", image: "", url: "" },
        "JDR":              { img: "jdr.png", col: "#e342de", cat: "jdr", image: "", url: "" },
        "Soirée Minecraft": { img: "minecraft.png", col: "#42e342", cat: "jeux", image: "", url: "" },
        "Annulé / Reporté": { img: "hors-prog.png", col: "#ef4444", cat: "annulé", image: "", url: "" },
        "default":          { img: "hors-prog.png", col: "#914fe8", cat: "hors prog", image: "", url: "" }
    }
};
