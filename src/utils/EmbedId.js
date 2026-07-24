// Nom de fichier stable pour la page d'aperçu statique d'un événement (voir
// scripts/generate-embeds.js et ModalView). Un id d'événement (`start__title`) contient
// des espaces/accents/slashes impropres à un nom de fichier : on le réduit ici en un
// hash hexadécimal court (FNV-1a 32 bits), calculé À L'IDENTIQUE côté génération (Node)
// et côté app (navigateur) pour que le lien copié pointe toujours vers le bon fichier
// sans avoir besoin d'un index de correspondance.
export function embedFileName(eventId) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < eventId.length; i++) {
        hash ^= eventId.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
