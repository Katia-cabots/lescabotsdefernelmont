// © 2026 Hélène Laruelle. Tous droits réservés.
// Ce code ne peut être utilisé, copié ou modifié sans autorisation
// écrite d'Hélène Laruelle — voir LICENSE.txt à la racine du dépôt.
// Contenu du site sous la responsabilité de Katia Renard (LES BEAUX CABOTS SRL).

// ==========================================================================
// CONTENU DYNAMIQUE — remplace les textes des pages publiques par la
// version modifiée par l'admin si elle existe (collection Firestore
// 'contenu_site'), sinon garde le texte par défaut déjà présent dans le
// HTML. Lecture seule, publique, aucune connexion requise.
// ==========================================================================
import { db, collection, getDocs } from "./firebase-config.js";

(async () => {
  try {
    const snap = await getDocs(collection(db, 'contenu_site'));
    snap.forEach(d => {
      const el = document.querySelector(`[data-contenu-id="${d.id}"]`);
      if (el && d.data().texte) {
        el.textContent = d.data().texte;
      }
      // Visibilité d'une carte (ex: activite1_visible -> #activite1-carte).
      // Absent = visible par défaut ; seul un doc explicite {visible:false}
      // masque la carte.
      const matchVisible = d.id.match(/^(.+)_visible$/);
      if (matchVisible && d.data().visible === false) {
        document.getElementById(`${matchVisible[1]}-carte`)?.style.setProperty('display', 'none');
      }
    });
  } catch (e) {
    // En cas d'erreur (hors ligne, etc.), on garde simplement le texte par défaut du HTML.
  }

  // Renumérote les cartes d'activités encore visibles (01, 02, 03...) dans
  // leur ordre d'affichage, pour ne jamais avoir de trou (ex: 01 puis 03) si
  // une activité a été masquée depuis l'admin.
  const cartesVisibles = Array.from(document.querySelectorAll('.activity-card'))
    .filter(carte => carte.style.display !== 'none');
  cartesVisibles.forEach((carte, i) => {
    const indexEl = carte.querySelector('.num-index');
    if (indexEl) indexEl.textContent = String(i + 1).padStart(2, '0');
  });
})();
