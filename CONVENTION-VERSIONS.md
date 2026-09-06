# Convention de versionnage des livraisons — Projet "Les Cabots de Fernelmont"

Chaque zip livré est nommé selon le format :

    VJJ-NNN

- **JJ** = numéro du **jour de travail** sur ce site (pas la date calendaire).
  Le tout premier jour où on travaille sur le site = 01. Le jour de travail
  *suivant* (peu importe le nombre de jours calendaires passés entre les
  deux) = 02, etc.
- **NNN** = numéro de **livraison dans cette journée de travail**. Commence
  à 001 et s'incrémente à chaque nouveau zip livré ce jour-là. Repart à 001
  au jour de travail suivant.

**Exemple :** 3 livraisons le premier jour de travail sur le site →
`V01-001`, `V01-002`, `V01-003`. Le jour de travail suivant → `V02-001`,
`V02-002`, etc.

Le numéro de version actuel est aussi reflété :
- dans `const VERSION_SITE = '...'` en haut de `assets/app-admin.js` et
  `assets/app-membre.js` (affiché dans le coin de l'écran admin, visible
  par Katia et le Super Admin) ;
- en commentaire d'en-tête de `firestore.rules`, avec le nom du projet
  Firebase.

---

## Prompt à réutiliser tel quel dans d'autres projets

    Convention de versionnage des livraisons (zip) : chaque zip est nommé
    V{JJ}-{NNN} où JJ = numéro du jour de travail sur ce projet (pas la
    date calendaire — un compteur qui commence à 01 et s'incrémente à
    chaque nouveau jour de travail sur ce projet), et NNN = numéro de
    livraison dans cette journée de travail (commence à 001, s'incrémente
    à chaque nouveau zip livré ce jour-là, revient à 001 au jour de
    travail suivant). Exemple : 3 livraisons le premier jour de travail →
    V01-001, V01-002, V01-003 ; le jour de travail suivant → V02-001,
    V02-002, etc. Le nom du zip et le VERSION_SITE (ou équivalent) du code
    doivent toujours être mis à jour ensemble avant chaque livraison.
