// Correspondance ville -> [latitude, longitude] pour la carte des lieux IRL (voir
// MeetupMapView.js). Liste volontairement restreinte aux villes de meetups déjà connues (v1) :
// facilement extensible en ajoutant une entrée ici, clé en minuscules sans accents superflus.
// Une ville non listée n'obtient simplement pas de marqueur (non bloquant).
export const CITY_COORDINATES = {
    montpellier: [43.6108, 3.8767],
    paris: [48.8566, 2.3522],
    grenoble: [45.1885, 5.7245]
};
