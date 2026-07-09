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

    // `image` et `url` sont les valeurs par défaut utilisées pour un événement de ce
    // type quand ses Notes ne précisent pas leur propre @image / @url (ou @lien/@link
    // pour l'url) — voir GUIDE_METADONNEES.md. Un événement qui renseigne sa propre
    // métadonnée prime toujours sur la valeur par défaut ci-dessous. Laissez à "" pour
    // ne rien afficher par défaut sur ce type ; complétez avec vos propres URLs
    // (affiche/bannière de type, lien vers votre chaîne, catégorie Twitch, etc.).
    THEMES: {
        "Soirée Jeux":      { img: "soiree-jeux.png", col: "#4fc4e8", cat: "jeux", image: "https://cdn.discordapp.com/attachments/795250300386017281/1523406563518451762/Gaming_Banner.png?ex=6a4bfe6c&is=6a4aacec&hm=eec879e2a214bfedb0876f7cf46ba271b7e624d16bfdc16a24d31a156fbe9014&", url: "" },
        "Bravery":          { img: "bravery.png", col: "#e8c44f", cat: "jeux", image: "https://cdn.discordapp.com/attachments/795250300386017281/1523406531029368862/Bravery_Banner.png?ex=6a4bfe64&is=6a4aace4&hm=752354b9f38828fe65e64bdfd2037e49f201c2b15cb8c08d289daa765b8b53cc&", url: "" },
        "Soirée Film":      { img: "soiree-film.png", col: "#e84f4f", cat: "visionnage", image: "https://cdn.discordapp.com/attachments/795250300386017281/1523406653112975372/Movie_Banner.png?ex=6a4bfe81&is=6a4aad01&hm=5299285dd9cfc14198956b58cbbfa0bec43514ae0d4ae85e81d2b9d80bc2869e&", url: "" },
        "Soirée Série":     { img: "soiree-serie.png", col: "#e84f4f", cat: "visionnage", image: "https://cdn.discordapp.com/attachments/795250300386017281/1523406653112975372/Movie_Banner.png?ex=6a4bfe81&is=6a4aad01&hm=5299285dd9cfc14198956b58cbbfa0bec43514ae0d4ae85e81d2b9d80bc2869e&", url: "" },
        "Soirée Spéciale":  { img: "soiree-speciale.png", col: "#704fe8", cat: "special", image: "https://cdn.discordapp.com/attachments/795250300386017281/1523406710935650414/Special_Banner.png?ex=6a4bfe8f&is=6a4aad0f&hm=5643480b4e772aa6c530c2576418dcbc44ccc7af850769c44bb6a826802b17fd&", url: "" },
        "Hors Prog":        { img: "hors-prog.png", col: "#914fe8", cat: "hors prog", image: "https://cdn.discordapp.com/attachments/795250300386017281/1523406672041611386/Mystery_Banner.png?ex=6a4bfe86&is=6a4aad06&hm=8e5ae8748b708aeab6797a12184b24e43fa95c80838ee64ece8aac0c3b7faa48&", url: "" },
        "Gazette 2025":     { img: "gazette-2025.png", col: "#bd8f5e", cat: "gazette", image: "", url: "" },
        "Gazette 2026":     { img: "gazette-2026.png", col: "#5ebd8f", cat: "gazette", image: "https://cdn.discordapp.com/attachments/795250300386017281/1523406589908750396/Gazette_Banner.png?ex=6a4bfe72&is=6a4aacf2&hm=438d041a9965a25b7aa89582a667cb7db6682c8f5de5656ab6bdb94579ec241c&", url: "" },
        "Event St Valentin":{ img: "st-valentin.png", col: "#bd5ea4", cat: "special", image: "https://cdn.discordapp.com/attachments/795250300386017281/1523406734314438789/Valentine_Banner.png?ex=6a4bfe94&is=6a4aad14&hm=9e573312284adfcda34c7125eb4b8eb5f33b0a7378eee9061678239b0284742c&", url: "" },
        "Meet Up":          { img: "meet-up.png", col: "#3b82f6", cat: "irl", image: "", url: "" },
        "Partenaire":       { img: "meet-up.png", col: "#ef4444", cat: "externe", image: "", url: "" },
        "Sanctuaire":       { img: "meet-up.png", col: "#a855f7", cat: "irl", image: "", url: "" },
        "Event Halloween":  { img: "halloween.png", col: "#e6b33e", cat: "special", image: "", url: "" },
        "Event Nowel":      { img: "nowel.png", col: "#79bd57", cat: "special", image: "", url: "" },
        "JDR":              { img: "jdr.png", col: "#e342de", cat: "jdr", image: "", url: "" },
        "Soirée Minecraft": { img: "minecraft.png", col: "#42e342", cat: "game", image: "", url: "" },
        "Annulé / Reporté": { img: "hors-prog.png", col: "#ef4444", cat: "annulé", image: "", url: "" },
        "default":          { img: "hors-prog.png", col: "#914fe8", cat: "hors prog", image: "", url: "" }
    }
};
