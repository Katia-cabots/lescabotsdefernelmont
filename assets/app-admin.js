// © 2026 LES BEAUX CABOTS SRL. Tous droits réservés.
// Ce code ne peut être utilisé, copié ou modifié sans autorisation
// écrite — voir LICENSE.txt à la racine du dépôt.
// Contenu du site sous la responsabilité de Katia Renard (LES BEAUX CABOTS SRL).

import {
  auth, db, onAuthStateChanged, signOut,
  doc, getDoc, getDocAvecReessai, setDoc, updateDoc, deleteDoc, increment,
  collection, collectionGroup, addDoc, getDocs, query, where,
  serverTimestamp, identifiantVersEmail
} from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { VERSION_SITE } from "./version.js";
import { getAuth as getAuthSecondary, createUserWithEmailAndPassword, signOut as signOutSecondary,
  signInWithEmailAndPassword as signInSecondary, updatePassword as updatePasswordSecondary,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider, setPersistence, inMemoryPersistence }
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { meteoActuelle, meteoPour, alerteMeteo, iconeCode } from "./meteo.js";

const JOURS = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];

// Identifiants et mots de passe : caractères spéciaux interdits (lettres,
// chiffres, point/tiret/underscore pour l'identifiant uniquement). Empêche
// notamment une apostrophe de casser les boutons générés dynamiquement
// dans l'interface (leur code intègre l'identifiant/mot de passe tel quel).
const REGEX_IDENTIFIANT = /^[a-zA-Z0-9._-]+$/;
const REGEX_MOT_DE_PASSE = /^[a-zA-Z0-9]+$/;
function identifiantValide(valeur) { return REGEX_IDENTIFIANT.test(valeur || ''); }
function motDePasseValide(valeur) { return REGEX_MOT_DE_PASSE.test(valeur || ''); }
const MESSAGE_IDENTIFIANT_INVALIDE = "L'identifiant ne peut contenir que des lettres, chiffres, points, tirets ou underscores (pas d'espace, d'accent, ni d'autre caractère spécial).";
const MESSAGE_MDP_INVALIDE = "Le mot de passe ne peut contenir que des lettres et des chiffres (pas de caractère spécial, espace ou accent).";

// IMPORTANT : ne jamais utiliser Date.toISOString() pour obtenir la date du
// jour — ça convertit en UTC et décale d'un jour selon l'heure (surtout le
// soir en Belgique, UTC+2 l'été). Cette fonction reste sur l'heure locale.
function dateISOLocale(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}
const JOURS_MAJ = { lundi:"Lundi", mardi:"Mardi", mercredi:"Mercredi", jeudi:"Jeudi", vendredi:"Vendredi", samedi:"Samedi", dimanche:"Dimanche" };

let currentGroupes = [];
let currentMembres = [];

// ---------- Garde d'accès ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'connexion.html'; return; }
  const mDoc = await getDocAvecReessai(doc(db, 'membres', user.uid));
  if (!mDoc.exists() || mDoc.data().role !== 'admin') {
    window.location.href = 'connexion.html';
    return;
  }
  document.getElementById('adminNom').textContent = mDoc.data().nomMaitre || 'Katia';

  // Changement de mot de passe trimestriel obligatoire (1er janvier, avril,
  // juillet, octobre) — pour Katia ET le Super Admin, sans exception.
  const derniereMajMdp = mDoc.data().dateDernierChangementMdp ? new Date(mDoc.data().dateDernierChangementMdp) : null;
  if (!derniereMajMdp || derniereMajMdp < dateLimiteMdpActuelle()) {
    ouvrirModalMonCompte(true);
  }

  // Dernière activité : mise à jour à chaque ouverture de page admin,
  // même quand la session était déjà ouverte depuis avant.
  updateDoc(doc(db, 'membres', user.uid), { derniereActivite: new Date().toISOString() }).catch(() => {});

  // Numéro de version : visible pour tous les comptes admin (Katia ET
  // Super Admin). L'onglet "Mots de passe" reste réservé exclusivement au
  // Super Admin. La fraise 🍓 reste réservée à Katia (Admin) uniquement — donc
  // masquée pour le Super Admin. Aucun autre changement pour le compte Admin.
  document.getElementById('versionTagCoin').textContent = VERSION_SITE;
  if (user.email === identifiantVersEmail('HeleneL')) {
    document.getElementById('tabMotsDePasseBtn').classList.remove('hidden');
    document.getElementById('fraiseDiscrete')?.remove();
    chargerListeAdminsPourMdp();
  }

  // 🍓💕 Surprise d'anniversaire — visible UNIQUEMENT sur le compte de
  // Katia (Admin), du 15 novembre au 21 novembre inclus.
  if (user.email === identifiantVersEmail('Admin')) {
    const aujourdhui = new Date();
    const mois = aujourdhui.getMonth(); // 10 = novembre (0-indexé)
    const jour = aujourdhui.getDate();
    if (mois === 10 && jour >= 15 && jour <= 21) {
      document.getElementById('banniereAnniversaireKatia')?.classList.remove('hidden');
    }
  }

  await chargerGroupes();
  await chargerMembres();
  await chargerServices();
  activerBlocsRepliables(document);
  chargerConversations();
  chargerAnniversaires();
  chargerCotisationsARenouveler();
  chargerAbonnementsARenouveler(); chargerVaccinsARappeler();
  chargerCeSoir();
  chargerDemandesAnnulation();
  chargerDemandesInfo();
  chargerLivreOrAdmin();
  afficherMeteoDuJour();
  chargerRdv();
  chargerArticles();
  chargerVideosAdmin();

  // Rattrapage des absences non répondues + décompte : potentiellement long
  // (beaucoup d'écritures la première fois), donc en arrière-plan, sans
  // bloquer l'affichage du reste de la page. Protégé par try/catch pour
  // qu'une erreur ici ne casse jamais le reste de l'admin.
  (async () => {
    try {
      await corrigerAbsencesAvantInscription();
      await detecterAbsencesNonRepondues();
      await traiterAbsencesAutomatiques();
      chargerCeSoir();
    } catch (err) {
      console.error('Erreur rattrapage absences :', err);
    }
  })();
  chargerBoutiqueAdmin();
  chargerDogSittingAdmin();
  chargerCampagnesAdmin();
  chargerComptaAdmin();
  chargerNumerotationCompta();
  chargerContenuAdmin();
  chargerRoiAdmin();
  chargerEnquetesAnonymesAdmin();
  console.log('%c🍓 Un petit jardin secret pour toi, Katia...', 'color:#C0392B; font-size:13px;');
});

document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth).then(() => window.location.href = 'connexion.html'));

// ---------- Onglets ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'dogsitting' && window.marquerDogSittingVuAdmin) {
      window.marquerDogSittingVuAdmin();
    }
  });
});

// ==========================================================================
// MÉTÉO DU JOUR (bandeau)
// ==========================================================================
async function afficherMeteoDuJour() {
  const zone = document.getElementById('meteoDuJour');
  const m = await meteoActuelle();
  if (!m) { zone.innerHTML = ''; return; }
  const dateLabel = new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  zone.innerHTML = `
    <div class="banner-alert" style="background:#EFF3F6; border-color:#D4DAE0; color:var(--navy-dark); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
      <span>${iconeCode(m.code)} Andenne — ${m.description}, ${m.temperature}°C</span>
      <span style="text-transform:capitalize;">${dateLabel}</span>
    </div>`;
}

// ==========================================================================
// GROUPES
// ==========================================================================
async function chargerGroupes() {
  const snap = await getDocs(collection(db, 'groupes'));
  currentGroupes = [];
  snap.forEach(d => currentGroupes.push({ id: d.id, ...d.data() }));
  renderGroupes();
  remplirSelectGroupes();
}

function renderGroupes() {
  const wrap = document.getElementById('listeGroupes');
  if (currentGroupes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun groupe créé pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = currentGroupes.map(g => {
    const nbMembres = currentMembres.filter(m => m.groupeId === g.id).length;
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(g.nom)}</div>
        <div class="data-sub">${JOURS_MAJ[g.jour] || g.jour} · ${g.heureDebut}–${g.heureFin} · ${nbMembres}/${g.participantsMax} chiens</div>
      </div>
      <div class="data-actions">
        <button class="btn-sm" onclick="window.voirMembresGroupe('${g.id}')">Membres (${nbMembres})</button>
        <button class="btn-sm" onclick="window.editerGroupe('${g.id}')">Modifier</button>
        <button class="btn-sm danger" onclick="window.supprimerGroupe('${g.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('btnAjouterGroupe').addEventListener('click', () => ouvrirModalGroupe());

window.voirMembresGroupe = (groupeId) => {
  const groupe = currentGroupes.find(g => g.id === groupeId);
  const membresDuGroupe = currentMembres.filter(m => m.groupeId === groupeId);

  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>${escapeHtml(groupe?.nom || '')} — ${membresDuGroupe.length} membre(s)</h3>
        <div class="data-list">
          ${membresDuGroupe.length === 0
            ? '<div class="empty-state">Aucun membre dans ce groupe pour l\'instant.</div>'
            : membresDuGroupe.map(m => `
              <div class="data-row">
                <div class="data-main">
                  <div class="data-title">${escapeHtml(m.nomMaitre)}${nomsChiensActifs(m) ? ' — ' + escapeHtml(nomsChiensActifs(m)) : ''}</div>
                  <div class="data-sub">${m.gsm ? `<a href="tel:${escapeAttr(m.gsm)}">${escapeHtml(m.gsm)}</a>` : ''}</div>
                </div>
                <div class="data-actions">
                  <button class="btn-sm" onclick="window.fermerModal(); window.editerMembre('${m.id}')">Fiche</button>
                </div>
              </div>`).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Fermer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
};

document.getElementById('btnImportGroupes').addEventListener('click', () => ouvrirModalImportGroupes());

function ouvrirModalImportGroupes() {
  const exemplePreRempli =
    'Groupe 01;lundi;18:30;19:30;8\n' +
    'Groupe 02;lundi;19:45;20:45;8\n' +
    'Groupe 03;mardi;18:45;19:45;8\n' +
    'Groupe 04;mercredi;18:30;19:30;8';

  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" style="max-width:560px;">
        <h3>Import groupé de groupes</h3>
        <p style="color:var(--slate); font-size:0.85rem; margin-bottom:12px;">
          Une ligne par groupe, format : <strong>Nom;jour;heureDébut;heureFin;maxChiens</strong><br>
          Jours en minuscules : lundi, mardi, mercredi, jeudi, vendredi, samedi.
        </p>
        <div class="field">
          <textarea id="ig-texte" rows="8" style="resize:vertical; font-family:monospace; font-size:0.85rem;">${exemplePreRempli}</textarea>
        </div>
        <div id="ig-resultat" style="font-size:0.85rem; color:var(--slate);"></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="ig-save">Importer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;

  document.getElementById('ig-save').addEventListener('click', async () => {
    const lignes = document.getElementById('ig-texte').value.split('\n').map(l => l.trim()).filter(l => l);
    const joursValides = ['lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    let succes = 0, erreurs = [];

    for (const ligne of lignes) {
      const parts = ligne.split(';').map(p => p.trim());
      if (parts.length < 4) { erreurs.push(`Ligne ignorée (format incomplet) : "${ligne}"`); continue; }
      const [nom, jour, heureDebut, heureFin, max] = parts;
      if (!nom || !joursValides.includes(jour.toLowerCase()) || !heureDebut || !heureFin) {
        erreurs.push(`Ligne ignorée (jour ou champ invalide) : "${ligne}"`);
        continue;
      }
      try {
        await addDoc(collection(db, 'groupes'), {
          nom,
          jour: jour.toLowerCase(),
          heureDebut,
          heureFin,
          participantsMax: parseInt(max, 10) || 8
        });
        succes++;
      } catch (e) {
        erreurs.push(`Erreur pour "${nom}" : ${e.message}`);
      }
    }

    document.getElementById('ig-resultat').innerHTML =
      `<strong>${succes} groupe(s) importé(s).</strong>` +
      (erreurs.length ? '<br>' + erreurs.map(e => escapeHtml(e)).join('<br>') : '');

    chargerGroupes();
  });
}

window.editerGroupe = (id) => {
  const g = currentGroupes.find(x => x.id === id);
  ouvrirModalGroupe(g);
};

window.supprimerGroupe = async (id) => {
  if (!confirm('Supprimer ce groupe ?')) return;
  await deleteDoc(doc(db, 'groupes', id));
  chargerGroupes();
};

function ouvrirModalGroupe(groupe) {
  const isEdit = !!groupe;
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>${isEdit ? 'Modifier le groupe' : 'Ajouter un groupe'}</h3>
        <div class="field"><label>Nom du groupe</label><input id="mg-nom" value="${isEdit ? escapeAttr(groupe.nom) : ''}"></div>
        <div class="form-grid">
          <div class="field"><label>Jour</label>
            <select id="mg-jour">
              ${JOURS.filter(j=>j!=='dimanche').map(j => `<option value="${j}" ${isEdit && groupe.jour===j ? 'selected':''}>${JOURS_MAJ[j]}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Nombre de chiens max</label><input type="number" id="mg-max" min="1" value="${isEdit ? groupe.participantsMax : 8}"></div>
          <div class="field"><label>Heure de début</label><input type="time" id="mg-debut" value="${isEdit ? groupe.heureDebut : '18:00'}"></div>
          <div class="field"><label>Heure de fin</label><input type="time" id="mg-fin" value="${isEdit ? groupe.heureFin : '19:00'}"></div>
        </div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="mg-save">Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('mg-save').addEventListener('click', async () => {
    const data = {
      nom: document.getElementById('mg-nom').value.trim(),
      jour: document.getElementById('mg-jour').value,
      heureDebut: document.getElementById('mg-debut').value,
      heureFin: document.getElementById('mg-fin').value,
      participantsMax: parseInt(document.getElementById('mg-max').value, 10) || 8
    };
    if (!data.nom) { alert('Merci d\'indiquer un nom de groupe.'); return; }
    if (isEdit) {
      await updateDoc(doc(db, 'groupes', groupe.id), data);
    } else {
      await addDoc(collection(db, 'groupes'), data);
    }
    window.fermerModal();
    chargerGroupes();
  });
}

window.fermerModal = () => { document.getElementById('modalZone').innerHTML = ''; };

function remplirSelectGroupes() {
  const sel = document.getElementById('mm-groupe');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Aucun groupe par défaut —</option>' +
    currentGroupes.map(g => `<option value="${g.id}">${escapeHtml(g.nom)} (${JOURS_MAJ[g.jour]} ${g.heureDebut})</option>`).join('');
}

// ==========================================================================
// MEMBRES
// ==========================================================================
let currentMembresArchives = [];

async function chargerMembres() {
  const snap = await getDocs(query(collection(db, 'membres'), where('role', '==', 'membre')));
  currentMembres = [];
  currentMembresArchives = [];
  snap.forEach(d => {
    const m = { id: d.id, ...d.data() };
    if (m.archive) currentMembresArchives.push(m); else currentMembres.push(m);
  });
  // Classement alphabétique (nom du maître) — se répercute automatiquement
  // sur toutes les listes qui filtrent/affichent currentMembres ensuite
  // (membres, archives, membres par groupe, destinataires RDV/messages,
  // mots de passe...).
  const parNom = (a, b) => (a.nomMaitre || '').localeCompare(b.nomMaitre || '', 'fr', { sensitivity: 'base' });
  currentMembres.sort(parNom);
  currentMembresArchives.sort(parNom);
  renderMembres();
  renderGroupes();
  chargerMotsDePasseAdmin();
}

function nomsChiensActifs(membre) {
  const actifs = (membre.chiens || []).filter(c => !c.archive);
  return actifs.map(c => c.nom).filter(Boolean).join(', ');
}

function renderMembres() {
  const wrap = document.getElementById('listeMembres');
  if (currentMembres.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun membre pour l\'instant.</div>';
    return;
  }
  const terme = (document.getElementById('rechercheMembre')?.value || '').trim().toLowerCase();
  const membresAffiches = !terme ? currentMembres : currentMembres.filter(m =>
    (m.nomMaitre || '').toLowerCase().includes(terme) ||
    nomsChiensActifs(m).toLowerCase().includes(terme)
  );
  if (membresAffiches.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun membre ne correspond à cette recherche.</div>';
    return;
  }
  wrap.innerHTML = membresAffiches.map(m => {
    const groupe = currentGroupes.find(g => g.id === m.groupeId);
    // Migration en douceur : tant que le bouton de migration n'a pas été
    // cliqué, un membre existant sans champ accesCours/accesBoutique est
    // considéré comme y ayant accès (comportement historique).
    const aAccesCours = m.accesCours !== undefined ? !!m.accesCours : true;
    const aAccesBoutique = m.accesBoutique !== undefined ? !!m.accesBoutique : true;
    const chips = [
      aAccesCours ? '<span class="badge" style="background:#EAF2EC; color:#2F6B4F;">Cours</span>' : '',
      m.accesDogSitting ? '<span class="badge" style="background:#EFF3F6; color:var(--navy-dark);">Dog Sitting</span>' : '',
      aAccesBoutique ? '<span class="badge" style="background:#FBEFDA; color:#8A5A17;">Boutique</span>' : ''
    ].filter(Boolean).join(' ');
    const badgeAbo = !aAccesCours ? '' : (m.abonnementPaye
      ? `<span class="badge badge-ok">${m.coursRestants ?? 0} cours restants</span>`
      : `<span class="badge badge-danger">Abonnement non payé</span>`);
    const badgeCotis = !aAccesCours ? '' : (m.cotisationPayee
      ? `<span class="badge badge-ok">Cotisation à jour</span>`
      : `<span class="badge badge-warn">Cotisation à régler</span>`);
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(m.nomMaitre)}${nomsChiensActifs(m) ? ' — ' + escapeHtml(nomsChiensActifs(m)) : ''}</div>
        <div class="data-sub">${chips}</div>
        <div class="data-sub">${aAccesCours ? (groupe ? escapeHtml(groupe.nom) : 'Sans groupe') + ' · ' : ''}${badgeAbo} ${badgeCotis}</div>
        <div class="data-sub">${m.gsm ? `<a href="tel:${escapeAttr(m.gsm)}">${escapeHtml(m.gsm)}</a>` : ''} ${m.email ? `· <a href="mailto:${escapeAttr(m.email)}">${escapeHtml(m.email)}</a>` : ''}</div>
        <div class="data-sub">Identifiant : <strong>${escapeHtml(m.identifiant || '—')}</strong>${m.motDePasseInitial ? ` · Mot de passe : <strong>${escapeHtml(m.motDePasseInitial)}</strong>` : ''}</div>
      </div>
      <div class="data-actions">
        <button class="btn-sm" onclick="window.editerMembre('${m.id}')">Fiche</button>
        <button class="btn-sm danger" onclick="window.archiverMembre('${m.id}')">Archiver</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('btnAjouterMembre').addEventListener('click', () => ouvrirModalMembre());
document.getElementById('rechercheMembre').addEventListener('input', () => renderMembres());

document.getElementById('btnImportMembres').addEventListener('click', () => ouvrirModalImportMembres());

function ouvrirModalImportMembres() {
  const exemplePreRempli =
    'Prénom Nom;identifiant;motdepasse;Nom du groupe\n' +
    'Prénom Nom;identifiant;motdepasse;Nom du groupe';

  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" style="max-width:560px;">
        <h3>Import groupé de membres</h3>
        <p style="color:var(--slate); font-size:0.85rem; margin-bottom:12px;">
          Une ligne par membre, format : <strong>NomMaître;identifiant;motDePasse;NomDuGroupe</strong><br>
          Le nom du groupe doit correspondre exactement à un groupe déjà créé (sinon le membre est créé sans groupe).
          Le reste de la fiche (chien, abonnement...) pourra être complété ensuite via "Fiche".
        </p>
        <div class="field">
          <textarea id="im-texte" rows="9" style="resize:vertical; font-family:monospace; font-size:0.85rem;">${exemplePreRempli}</textarea>
        </div>
        <div id="im-resultat" style="font-size:0.85rem; color:var(--slate); white-space:pre-line;"></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="im-save">Importer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;

  document.getElementById('im-save').addEventListener('click', async () => {
    const btn = document.getElementById('im-save');
    btn.disabled = true;
    const resultZone = document.getElementById('im-resultat');
    const lignes = document.getElementById('im-texte').value.split('\n').map(l => l.trim()).filter(l => l);
    let succes = 0, erreurs = [];

    for (const ligne of lignes) {
      const parts = ligne.split(';').map(p => p.trim());
      if (parts.length < 3) { erreurs.push(`Ligne ignorée (format incomplet) : "${ligne}"`); continue; }
      const [nomMaitre, identifiantBrut, mdp, nomGroupe] = parts;
      if (!nomMaitre || !identifiantBrut || !mdp || mdp.length < 6) {
        erreurs.push(`Ligne ignorée (identifiant/mot de passe invalide, 6 caractères min.) : "${ligne}"`);
        continue;
      }
      if (!identifiantValide(identifiantBrut)) {
        erreurs.push(`Ligne ignorée (identifiant avec caractère(s) spécial(aux) non autorisé(s)) : "${ligne}"`);
        continue;
      }
      if (!motDePasseValide(mdp)) {
        erreurs.push(`Ligne ignorée (mot de passe avec caractère(s) spécial(aux) non autorisé(s)) : "${ligne}"`);
        continue;
      }
      const identifiant = identifiantBrut.charAt(0).toUpperCase() + identifiantBrut.slice(1);
      const groupe = nomGroupe ? currentGroupes.find(g => g.nom.toLowerCase() === nomGroupe.toLowerCase()) : null;

      resultZone.textContent = `Import en cours... (${succes + erreurs.length + 1}/${lignes.length})`;

      const email = identifiantVersEmail(identifiant);
      const secondaryApp = initializeApp(auth.app.options, 'import-' + Date.now() + '-' + Math.random());
      const secondaryAuth = getAuthSecondary(secondaryApp);
      try {
        await setPersistence(secondaryAuth, inMemoryPersistence);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, mdp);
        await setDoc(doc(db, 'membres', cred.user.uid), {
          nomMaitre, identifiant, motDePasseInitial: mdp, role: 'membre', archive: false,
          gsm: '', dateAnniversaire: '',
          chiens: [],
          accesCours: true, accesDogSitting: false, accesBoutique: false,
          groupeId: groupe ? groupe.id : null,
          coursRestants: 11, abonnementPaye: false, cotisationPayee: false,
          dateInscription: serverTimestamp()
        });
        await signOutSecondary(secondaryAuth);
        await deleteApp(secondaryApp);
        succes++;
      } catch (e) {
        try { await deleteApp(secondaryApp); } catch (e2) { /* déjà supprimée ou jamais créée */ }
        erreurs.push(`"${nomMaitre}" (${identifiant}) : ${e.code === 'auth/email-already-in-use' ? 'identifiant déjà utilisé' : e.message}`);
      }
    }

    resultZone.textContent = `${succes} membre(s) importé(s) avec succès.` + (erreurs.length ? '\n' + erreurs.join('\n') : '');
    btn.disabled = false;
    chargerMembres().then(() => { chargerConversations(); chargerAnniversaires(); chargerCotisationsARenouveler(); chargerAbonnementsARenouveler(); chargerVaccinsARappeler(); });
  });
}

window.editerMembre = (id) => {
  const m = currentMembres.find(x => x.id === id);
  ouvrirModalMembre(m);
};

window.archiverMembre = async (id) => {
  if (!confirm('Archiver ce membre ? Il ne pourra plus se connecter mais ses données seront conservées.')) return;
  await updateDoc(doc(db, 'membres', id), { archive: true });
  chargerMembres().then(() => { chargerConversations(); chargerAnniversaires(); chargerCotisationsARenouveler(); chargerAbonnementsARenouveler(); chargerVaccinsARappeler(); });
};

window.reactiverMembre = async (id) => {
  await updateDoc(doc(db, 'membres', id), { archive: false });
  chargerMembres().then(() => { chargerConversations(); chargerAnniversaires(); chargerCotisationsARenouveler(); chargerAbonnementsARenouveler(); chargerVaccinsARappeler(); renderMembresArchives(); });
};

function renderMembresArchives() {
  const wrap = document.getElementById('listeMembresArchives');
  if (currentMembresArchives.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun membre archivé.</div>';
    return;
  }
  wrap.innerHTML = currentMembresArchives.map(m => `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(m.nomMaitre)}${nomsChiensActifs(m) ? ' — ' + escapeHtml(nomsChiensActifs(m)) : ''}</div>
        <div class="data-sub">Identifiant : <strong>${escapeHtml(m.identifiant || '—')}</strong></div>
      </div>
      <div class="data-actions">
        <button class="btn-sm primary" onclick="window.reactiverMembre('${m.id}')">Remettre actif</button>
      </div>
    </div>`).join('');
}

document.getElementById('btnVoirArchives').addEventListener('click', () => {
  const wrap = document.getElementById('listeMembresArchives');
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : 'block';
  if (!visible) renderMembresArchives();
});

function optionsMarqueVaccin(valeurActuelle) {
  return ['', 'Eurican', 'Versican', 'Nobivac', 'Autres'].map(m =>
    `<option value="${m}" ${valeurActuelle === m ? 'selected' : ''}>${m || '—'}</option>`
  ).join('');
}

function ouvrirModalMembre(membre, prefill) {
  const isEdit = !!membre;
  const rc = membre?.assuranceRC || {};
  const chiens = (membre?.chiens || []).filter(c => !c.archive);
  // Accès : nouveaux champs (accesCours/accesBoutique). Pour un membre déjà
  // existant qui n'a pas encore reçu la migration (undefined), on part du
  // principe qu'il a accès (comportement historique) — jamais l'inverse,
  // pour ne perdre aucun accès par accident tant que le bouton de migration
  // n'a pas été cliqué. Pour un nouveau membre : décoché par défaut.
  const accesCoursDefaut = isEdit ? (membre.accesCours !== undefined ? !!membre.accesCours : true) : false;
  const accesDogSittingDefaut = isEdit ? !!membre.accesDogSitting : false;
  const accesBoutiqueDefaut = isEdit ? (membre.accesBoutique !== undefined ? !!membre.accesBoutique : true) : false;
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" style="max-width:560px;">
        <h3>${isEdit ? 'Fiche membre' : 'Ajouter un membre'}</h3>
        ${!isEdit ? `
        <div class="form-grid">
          <div class="field"><label>Identifiant</label><input id="mm-identifiant" placeholder="ex: Sarah.m"></div>
          <div class="field"><label>Mot de passe initial</label><input id="mm-mdp" placeholder="min. 6 caractères"></div>
        </div>` : `
        <div class="form-grid">
          <div class="field"><label>Identifiant</label><input value="${escapeAttr(membre.identifiant||'')}" disabled style="background:var(--paper-warm);"></div>
          <div class="field"><label>Mot de passe (pour référence)</label><input id="mm-mdpRef" value="${escapeAttr(membre.motDePasseInitial||'')}" placeholder="renseigne-le si tu le connais"></div>
        </div>
        <button class="btn-sm" type="button" id="mm-btnChangerMdp" style="margin-bottom:10px;">🔑 Changer réellement le mot de passe de connexion</button>`}

        <h3 style="margin-top:18px;">Accès</h3>
        <p style="font-size:0.85rem; color:var(--slate); margin-bottom:6px;">Détermine les champs ci-dessous et les onglets visibles côté espace membre.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
          <label class="membre-check-row" style="flex:1; min-width:120px; border:1px solid #E3E7EB;"><input type="checkbox" id="mm-accesCours" ${accesCoursDefaut ? 'checked' : ''}><span>Cours</span></label>
          <label class="membre-check-row" style="flex:1; min-width:120px; border:1px solid #E3E7EB;"><input type="checkbox" id="mm-accesDogSitting" ${accesDogSittingDefaut ? 'checked' : ''}><span>Dog Sitting</span></label>
          <label class="membre-check-row" style="flex:1; min-width:120px; border:1px solid #E3E7EB;"><input type="checkbox" id="mm-accesBoutique" ${accesBoutiqueDefaut ? 'checked' : ''}><span>Boutique</span></label>
        </div>

        <h3 class="bloc-titre" style="margin-top:18px;">Coordonnées <span class="bloc-fleche">▾</span></h3>
        <div class="bloc-contenu">
        ${prefill ? `<div class="banner-alert" style="margin-bottom:10px;">Fiche pré-remplie depuis une demande d'information reçue via le site. Pense à ajouter le chien une fois le membre enregistré :<br>Race : ${escapeHtml(prefill.raceChien || '—')} · Âge : ${escapeHtml(prefill.ageChien || '—')} · Stérilisé/castré : ${prefill.sterilise === 'oui' ? 'Oui' : prefill.sterilise === 'non' ? 'Non' : '—'}${prefill.demande ? `<br>Message du visiteur : « ${escapeHtml(prefill.demande)} »` : ''}</div>` : ''}
        <div class="field"><label>Nom du maître</label><input id="mm-nomMaitre" value="${isEdit ? escapeAttr(membre.nomMaitre) : (prefill ? escapeAttr(`${prefill.prenom||''} ${prefill.nom||''}`.trim()) : '')}"></div>
        <div class="form-grid">
          <div class="field"><label>GSM</label><input id="mm-gsm" value="${isEdit ? escapeAttr(membre.gsm||'') : (prefill ? escapeAttr(prefill.gsm||'') : '')}" placeholder="ex: 0032 4XX XX XX XX"></div>
          <div class="field"><label>E-mail</label><input type="email" id="mm-email" value="${isEdit ? escapeAttr(membre.email||'') : (prefill ? escapeAttr(prefill.email||'') : '')}" placeholder="ex: nom@exemple.be"></div>
        </div>
        <div class="field"><label>Adresse postale</label><input id="mm-adresse" value="${isEdit ? escapeAttr(membre.adressePostale||'') : (prefill ? escapeAttr(prefill.ville||'') : '')}" placeholder="rue, numéro, code postal, ville"></div>
        <div class="field"><label>Date d'anniversaire</label><input type="date" id="mm-anniversaire" value="${isEdit ? (membre.dateAnniversaire||'') : ''}"></div>

        <div class="form-grid">
          <div class="field"><label>Vous nous avez trouvé via</label>
            <select id="mm-trouveVia">
              <option value="" ${!membre?.trouveVia ? 'selected':''}>—</option>
              <option value="Vétérinaire" ${membre?.trouveVia==='Vétérinaire' ? 'selected':''}>Vétérinaire</option>
              <option value="Internet" ${membre?.trouveVia==='Internet' ? 'selected':''}>Internet</option>
              <option value="Facebook" ${membre?.trouveVia==='Facebook' ? 'selected':''}>Facebook</option>
              <option value="Amis" ${membre?.trouveVia==='Amis' ? 'selected':''}>Amis</option>
              <option value="Autre" ${membre?.trouveVia==='Autre' ? 'selected':''}>Autre</option>
            </select>
          </div>
          <div class="field"><label>Précision</label><input id="mm-trouveViaDetail" value="${isEdit ? escapeAttr(membre.trouveViaDetail||'') : ''}"></div>
        </div>
        </div>

        <div class="mm-groupeCours">
        <h3 class="bloc-titre replie" style="margin-top:18px;">Conducteur du chien (si différent du propriétaire) <span class="bloc-fleche">▾</span></h3>
        <div class="bloc-contenu replie">
        <div class="form-grid">
          <div class="field"><label>Nom Prénom</label><input id="mm-conducteurNom" value="${isEdit ? escapeAttr(membre.conducteurNom||'') : ''}"></div>
          <div class="field"><label>GSM</label><input id="mm-conducteurGsm" value="${isEdit ? escapeAttr(membre.conducteurGsm||'') : ''}"></div>
        </div>
        <div class="field"><label>E-mail</label><input type="email" id="mm-conducteurEmail" value="${isEdit ? escapeAttr(membre.conducteurEmail||'') : ''}"></div>
        </div>
        </div>

        <div class="mm-groupeCours">
        <h3 class="bloc-titre replie" style="margin-top:18px;">Assurance RC familiale <span class="bloc-fleche">▾</span></h3>
        <div class="bloc-contenu replie">
        <div class="form-grid">
          <div class="field"><label>Compagnie</label><input id="mm-rcCompagnie" value="${escapeAttr(rc.compagnie||'')}"></div>
          <div class="field"><label>N° de police</label><input id="mm-rcNumero" value="${escapeAttr(rc.numeroPolice||'')}"></div>
          <div class="field"><label>Échéance (mois/année)</label><input type="month" id="mm-rcEcheance" value="${rc.dateEcheance||''}"></div>
        </div>
        </div>
        </div>

        <h3 class="bloc-titre" style="margin-top:18px;">Chien(s) <span class="bloc-fleche">▾</span></h3>
        <div class="bloc-contenu">
        <div id="mm-listeChiens">
          ${isEdit ? renderListeChiensAdmin(membre) : '<p style="color:var(--slate); font-size:0.85rem;">Enregistre d\'abord le membre, tu pourras ajouter son/ses chien(s) juste après.</p>'}
        </div>
        ${isEdit ? `<button class="btn-sm" type="button" onclick="window.ouvrirModalChien('${membre.id}', null)">+ Ajouter un chien</button>` : ''}
        </div>

        <div class="mm-groupeCours">
        <h3 class="bloc-titre" style="margin-top:18px;">Groupe &amp; abonnement <span class="bloc-fleche">▾</span></h3>
        <div class="bloc-contenu">
        <div class="field"><label>Groupe par défaut</label><select id="mm-groupe"></select></div>
        <div class="form-grid">
          <div class="field"><label>Cours restants (abonnement)</label><input type="number" id="mm-coursRestants" value="${isEdit ? (membre.coursRestants ?? 11) : 11}"></div>
          <div class="field"><label>Abonnement payé</label>
            <select id="mm-aboPaye">
              <option value="oui" ${isEdit && membre.abonnementPaye ? 'selected':''}>Oui</option>
              <option value="non" ${isEdit && !membre.abonnementPaye ? 'selected':''}>Non</option>
            </select>
          </div>
        </div>
        </div>
        </div>

        <div class="mm-groupeCours">
          <h3 class="bloc-titre" style="margin-top:18px;">Cotisation annuelle du club <span class="bloc-fleche">▾</span></h3>
          <div class="bloc-contenu">
          ${isEdit ? `<button class="btn-sm primary" type="button" id="mm-btnRenouvelerCotisation" style="margin-bottom:10px;">🔄 Renouveler maintenant (+1 an, marque payée)</button>` : ''}
          <div class="form-grid">
            <div class="field"><label>Date d'échéance</label><input type="date" id="mm-cotisEcheance" value="${membre?.cotisationDateEcheance||''}"></div>
            <div class="field"><label>Payée</label>
              <select id="mm-cotisPaye">
                <option value="oui" ${isEdit && membre.cotisationPayee ? 'selected':''}>Oui</option>
                <option value="non" ${isEdit && !membre.cotisationPayee ? 'selected':''}>Non</option>
              </select>
            </div>
          </div>
          ${isEdit && membre.cotisationRenouvellement ? `<p style="font-size:0.85rem; color:var(--slate);">Réponse du membre au renouvellement : <strong>${membre.cotisationRenouvellement === 'oui' ? 'Oui, elle/il souhaite renouveler' : 'Non, elle/il ne souhaite pas renouveler'}</strong></p>` : ''}
          </div>
        </div>
        <p id="mm-noteRenouvellement" class="hidden" style="font-size:0.85rem; color:var(--slate); font-style:italic;">Date et statut mis à jour ci-dessus — pense à cliquer "Enregistrer" pour valider.</p>

        ${isEdit ? `
        <h3 class="bloc-titre replie" style="margin-top:18px;">Paiements <span class="bloc-fleche">▾</span></h3>
        <div class="bloc-contenu replie">
        <button class="btn-sm" type="button" onclick="window.ouvrirModalPaiement('${membre.id}')">+ Enregistrer un paiement</button>
        <div id="mm-historiquePaiements" style="margin-top:10px;"><div class="empty-state">...</div></div>
        </div>

        <div class="mm-groupeCours">
        <h3 class="bloc-titre replie" style="margin-top:18px;">Historique de présence <span class="bloc-fleche">▾</span></h3>
        <div class="bloc-contenu replie">
        <div id="mm-historiquePresences" style="margin-top:10px; max-height:220px; overflow-y:auto;"><div class="empty-state">...</div></div>
        </div>
        </div>
        ` : ''}

        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="mm-save">Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  activerBlocsRepliables(document.getElementById('modalZone'));
  remplirSelectGroupes();
  if (isEdit && membre.groupeId) document.getElementById('mm-groupe').value = membre.groupeId;
  if (isEdit) { chargerHistoriquePaiements(membre.id); chargerHistoriquePresencesAdmin(membre.id); }
  if (isEdit) {
    document.getElementById('mm-btnChangerMdp')?.addEventListener('click', () => window.changerMotDePasseMembre(membre.id, membre.identifiant, membre.motDePasseInitial));

    document.getElementById('mm-btnRenouvelerCotisation')?.addEventListener('click', () => {
      const aujourdhui = new Date();
      const echeanceActuelle = membre.cotisationDateEcheance ? new Date(membre.cotisationDateEcheance + 'T00:00:00') : null;
      // Repart de l'échéance actuelle si elle est encore dans le futur (renouvellement anticipé),
      // sinon repart d'aujourd'hui (renouvellement en retard) — jamais de date passée en résultat.
      const base = (echeanceActuelle && echeanceActuelle > aujourdhui) ? echeanceActuelle : aujourdhui;
      const nouvelleEcheance = new Date(base);
      nouvelleEcheance.setFullYear(nouvelleEcheance.getFullYear() + 1);
      document.getElementById('mm-cotisEcheance').value = dateISOLocale(nouvelleEcheance);
      document.getElementById('mm-cotisPaye').value = 'oui';
      document.getElementById('mm-noteRenouvellement').classList.remove('hidden');
    });
  }

  function actualiserVisibiliteParAcces() {
    const aAccesCours = document.getElementById('mm-accesCours').checked;
    document.getElementById('modalZone').querySelectorAll('.mm-groupeCours').forEach(bloc => {
      bloc.classList.toggle('hidden', !aAccesCours);
    });
  }
  actualiserVisibiliteParAcces();
  document.getElementById('mm-accesCours').addEventListener('change', actualiserVisibiliteParAcces);

  document.getElementById('mm-save').addEventListener('click', async () => {
    const btnSave = document.getElementById('mm-save');
    btnSave.disabled = true;
    btnSave.textContent = 'Enregistrement...';

    const data = {
      nomMaitre: document.getElementById('mm-nomMaitre').value.trim(),
      gsm: document.getElementById('mm-gsm').value.trim(),
      email: document.getElementById('mm-email').value.trim(),
      adressePostale: document.getElementById('mm-adresse').value.trim(),
      dateAnniversaire: document.getElementById('mm-anniversaire').value,
      trouveVia: document.getElementById('mm-trouveVia').value,
      trouveViaDetail: document.getElementById('mm-trouveViaDetail').value.trim(),
      conducteurNom: document.getElementById('mm-conducteurNom').value.trim(),
      conducteurGsm: document.getElementById('mm-conducteurGsm').value.trim(),
      conducteurEmail: document.getElementById('mm-conducteurEmail').value.trim(),
      assuranceRC: {
        compagnie: document.getElementById('mm-rcCompagnie').value.trim(),
        numeroPolice: document.getElementById('mm-rcNumero').value.trim(),
        dateEcheance: document.getElementById('mm-rcEcheance').value
      },
      accesCours: document.getElementById('mm-accesCours').checked,
      accesDogSitting: document.getElementById('mm-accesDogSitting').checked,
      accesBoutique: document.getElementById('mm-accesBoutique').checked,
      groupeId: document.getElementById('mm-accesCours').checked ? (document.getElementById('mm-groupe').value || null) : null,
      coursRestants: document.getElementById('mm-accesCours').checked ? (parseInt(document.getElementById('mm-coursRestants').value, 10) || 0) : 0,
      abonnementPaye: document.getElementById('mm-accesCours').checked ? document.getElementById('mm-aboPaye').value === 'oui' : false,
      cotisationPayee: document.getElementById('mm-accesCours').checked ? document.getElementById('mm-cotisPaye').value === 'oui' : false,
      cotisationDateEcheance: document.getElementById('mm-accesCours').checked ? document.getElementById('mm-cotisEcheance').value : ''
    };
    // Une fois vraiment renouvelée (payée + échéance repoussée d'au moins un
    // mois), on efface l'ancienne réponse du membre pour ne pas ré-afficher
    // une alerte périmée de son côté.
    if (data.cotisationPayee && data.cotisationDateEcheance) {
      const dansUnMois = new Date(); dansUnMois.setMonth(dansUnMois.getMonth() + 1);
      if (new Date(data.cotisationDateEcheance + 'T00:00:00') > dansUnMois) {
        data.cotisationRenouvellement = null;
      }
    }
    if (isEdit) {
      data.motDePasseInitial = document.getElementById('mm-mdpRef').value.trim();
    }
    if (!data.nomMaitre) { alert('Merci d\'indiquer le nom du maître.'); btnSave.disabled = false; btnSave.textContent = 'Enregistrer'; return; }

    if (isEdit) {
      await updateDoc(doc(db, 'membres', membre.id), data);
      window.fermerModal();
      chargerMembres().then(() => { chargerConversations(); chargerAnniversaires(); chargerCotisationsARenouveler(); chargerAbonnementsARenouveler(); chargerVaccinsARappeler(); });
    } else {
      let identifiant = document.getElementById('mm-identifiant').value.trim();
      const mdp = document.getElementById('mm-mdp').value;
      if (!identifiant || !mdp || mdp.length < 6) {
        alert('Identifiant et mot de passe (6 caractères min.) obligatoires.');
        return;
      }
      if (!identifiantValide(identifiant)) { alert(MESSAGE_IDENTIFIANT_INVALIDE); return; }
      if (!motDePasseValide(mdp)) { alert(MESSAGE_MDP_INVALIDE); return; }
      identifiant = identifiant.charAt(0).toUpperCase() + identifiant.slice(1);
      const email = identifiantVersEmail(identifiant);

      // Création via une instance Firebase secondaire pour ne pas
      // déconnecter la session admin en cours.
      const secondaryApp = initializeApp(auth.app.options, 'secondaire-' + Date.now());
      const secondaryAuth = getAuthSecondary(secondaryApp);
      try {
        await setPersistence(secondaryAuth, inMemoryPersistence);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, mdp);
        await setDoc(doc(db, 'membres', cred.user.uid), {
          ...data,
          chiens: [],
          identifiant,
          motDePasseInitial: mdp,
          role: 'membre',
          archive: false,
          dateInscription: serverTimestamp()
        });
        await signOutSecondary(secondaryAuth);
        await deleteApp(secondaryApp);
        window.fermerModal();
        chargerMembres().then(() => { chargerConversations(); chargerAnniversaires(); chargerCotisationsARenouveler(); chargerAbonnementsARenouveler(); chargerVaccinsARappeler(); });
      } catch (err) {
        try { await deleteApp(secondaryApp); } catch (e2) { /* déjà supprimée ou jamais créée */ }
        alert("Impossible de créer ce membre : " + (err.code === 'auth/email-already-in-use' ? 'cet identifiant existe déjà.' : err.message));
        btnSave.disabled = false;
        btnSave.textContent = 'Enregistrer';
      }
    }
  });
}

// ==========================================================================
// CHIENS (tableau chiens[] sur le membre — plusieurs chiens possibles,
// avec archivage individuel, ex: décès puis nouveau chien)
// ==========================================================================
function renderListeChiensAdmin(membre) {
  const chiens = (membre.chiens || []).filter(c => !c.archive);
  if (chiens.length === 0) return '<p style="color:var(--slate); font-size:0.85rem;">Aucun chien enregistré pour l\'instant.</p>';
  return chiens.map(c => `
    <div class="dog-card">
      <div class="dog-card-head">
        <div>
          <div class="dog-title">${escapeHtml(c.nom || 'Sans nom')} ${c.race ? '— ' + escapeHtml(c.race) : ''}</div>
          <div class="dog-sub">${c.pedigree ? 'Pedigree · ' : ''}${c.puce ? 'Puce ' + escapeHtml(c.puce) : 'Puce non renseignée'}</div>
        </div>
        <div class="data-actions">
          <button class="btn-sm" type="button" onclick="window.ouvrirModalChien('${membre.id}', '${c.id}')">Modifier</button>
          <button class="btn-sm danger" type="button" onclick="window.archiverChien('${membre.id}', '${c.id}')">Archiver</button>
        </div>
      </div>
    </div>`).join('');
}

window.ouvrirModalChien = (membreId, chienId) => {
  const membre = currentMembres.find(m => m.id === membreId);
  const chien = chienId ? (membre.chiens || []).find(c => c.id === chienId) : null;
  const v = chien?.vaccins || {};

  const html = `
    <div class="modal-overlay" id="modalOverlayChien">
      <div class="modal-box" style="max-width:520px;">
        <h3>${chien ? 'Modifier le chien' : 'Ajouter un chien'}</h3>
        <div class="form-grid">
          <div class="field"><label>Nom du chien</label><input id="mc-nom" value="${chien ? escapeAttr(chien.nom||'') : ''}"></div>
          <div class="field"><label>Race</label><input id="mc-race" value="${chien ? escapeAttr(chien.race||'') : ''}"></div>
          <div class="field"><label>Date de naissance</label><input type="date" id="mc-naissance" value="${chien ? (chien.naissance||'') : ''}"></div>
          <div class="field"><label>Sexe</label>
            <select id="mc-sexe">
              <option value="male" ${chien?.sexe==='male' ? 'selected':''}>Mâle</option>
              <option value="femelle" ${chien?.sexe==='femelle' ? 'selected':''}>Femelle</option>
            </select>
          </div>
          <div class="field"><label>Castré / Stérilisée</label>
            <select id="mc-sterilise">
              <option value="non" ${!chien?.sterilise ? 'selected':''}>Non</option>
              <option value="oui" ${chien?.sterilise ? 'selected':''}>Oui</option>
            </select>
          </div>
          <div class="field"><label>Date (si oui)</label><input type="date" id="mc-dateSterilisation" value="${chien ? (chien.dateSterilisation||'') : ''}"></div>
          <div class="field"><label>N° de puce</label><input id="mc-puce" value="${chien ? escapeAttr(chien.puce||'') : ''}"></div>
          <div class="field"><label>N° de passeport</label><input id="mc-passeport" value="${chien ? escapeAttr(chien.passeport||'') : ''}"></div>
          <div class="field"><label>Pedigree</label>
            <select id="mc-pedigree">
              <option value="non" ${!chien?.pedigree ? 'selected':''}>Non</option>
              <option value="oui" ${chien?.pedigree ? 'selected':''}>Oui</option>
            </select>
          </div>
        </div>

        <div class="form-grid">
          <div class="field"><label>Origine</label>
            <select id="mc-origine">
              <option value="" ${!chien?.origine ? 'selected':''}>—</option>
              <option value="Elevage familial" ${chien?.origine==='Elevage familial' ? 'selected':''}>Élevage familial</option>
              <option value="Petshop" ${chien?.origine==='Petshop' ? 'selected':''}>Petshop</option>
              <option value="Refuge" ${chien?.origine==='Refuge' ? 'selected':''}>Refuge</option>
              <option value="Autre" ${chien?.origine==='Autre' ? 'selected':''}>Autre</option>
            </select>
          </div>
          <div class="field"><label>Nom et lieu de l'origine</label><input id="mc-origineDetail" value="${chien ? escapeAttr(chien.origineDetail||'') : ''}" placeholder="ex: Élevage du Bois Joli, Andenne"></div>
        </div>

        <h3 style="margin-top:16px;">Vaccins</h3>
        <div class="form-grid">
          <div class="field"><label>Leptospirose — marque</label><select id="mc-vaxLepto-marque">${optionsMarqueVaccin(v.leptospirose?.marque)}</select></div>
          <div class="field"><label>Leptospirose — date</label><input type="date" id="mc-vaxLepto-date" value="${v.leptospirose?.date||''}"></div>
          <div class="field"><label>Parvovirose — marque</label><select id="mc-vaxParvo-marque">${optionsMarqueVaccin(v.parvovirose?.marque)}</select></div>
          <div class="field"><label>Parvovirose — date</label><input type="date" id="mc-vaxParvo-date" value="${v.parvovirose?.date||''}"></div>
          <div class="field"><label>Toux du chenil — marque</label><select id="mc-vaxToux-marque">${optionsMarqueVaccin(v.touxChenils?.marque)}</select></div>
          <div class="field"><label>Toux du chenil — date</label><input type="date" id="mc-vaxToux-date" value="${v.touxChenils?.date||''}"></div>
          <div class="field"><label>Rage — date</label><input type="date" id="mc-vaxRage-date" value="${v.rage?.date||''}"></div>
        </div>

        <div class="modal-actions">
          <button class="btn-sm" type="button" onclick="document.getElementById('modalOverlayChien').remove()">Annuler</button>
          <button class="btn-sm primary" type="button" id="mc-save">Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('mc-save').addEventListener('click', async () => {
    const nouveauChien = {
      id: chien ? chien.id : 'chien-' + Date.now(),
      nom: document.getElementById('mc-nom').value.trim(),
      race: document.getElementById('mc-race').value.trim(),
      naissance: document.getElementById('mc-naissance').value,
      sexe: document.getElementById('mc-sexe').value,
      sterilise: document.getElementById('mc-sterilise').value === 'oui',
      dateSterilisation: document.getElementById('mc-dateSterilisation').value,
      puce: document.getElementById('mc-puce').value.trim(),
      passeport: document.getElementById('mc-passeport').value.trim(),
      pedigree: document.getElementById('mc-pedigree').value === 'oui',
      origine: document.getElementById('mc-origine').value,
      origineDetail: document.getElementById('mc-origineDetail').value.trim(),
      archive: false,
      vaccins: {
        leptospirose: { marque: document.getElementById('mc-vaxLepto-marque').value, date: document.getElementById('mc-vaxLepto-date').value },
        parvovirose: { marque: document.getElementById('mc-vaxParvo-marque').value, date: document.getElementById('mc-vaxParvo-date').value },
        touxChenils: { marque: document.getElementById('mc-vaxToux-marque').value, date: document.getElementById('mc-vaxToux-date').value },
        rage: { date: document.getElementById('mc-vaxRage-date').value }
      }
    };
    if (!nouveauChien.nom) { alert('Merci d\'indiquer le nom du chien.'); return; }

    const chiensActuels = membre.chiens || [];
    const nouveauxChiens = chien
      ? chiensActuels.map(c => c.id === chien.id ? nouveauChien : c)
      : [...chiensActuels, nouveauChien];

    await updateDoc(doc(db, 'membres', membreId), { chiens: nouveauxChiens });
    membre.chiens = nouveauxChiens;
    document.getElementById('modalOverlayChien').remove();
    ouvrirModalMembre(membre);
  });
};

window.archiverChien = async (membreId, chienId) => {
  if (!confirm('Archiver ce chien ? (par ex. en cas de décès) Ses données seront conservées mais il n\'apparaîtra plus comme actif.')) return;
  const membre = currentMembres.find(m => m.id === membreId);
  const nouveauxChiens = (membre.chiens || []).map(c => c.id === chienId ? { ...c, archive: true } : c);
  await updateDoc(doc(db, 'membres', membreId), { chiens: nouveauxChiens });
  membre.chiens = nouveauxChiens;
  ouvrirModalMembre(membre);
};

// ==========================================================================
// PAIEMENTS — historique par membre, enregistrement manuel par l'admin
// ==========================================================================
async function chargerHistoriquePaiements(membreId) {
  const zone = document.getElementById('mm-historiquePaiements');
  if (!zone) return;
  const snap = await getDocs(query(collection(db, 'paiements'), where('membreId', '==', membreId)));
  const paiements = [];
  snap.forEach(d => paiements.push({ id: d.id, ...d.data() }));
  paiements.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (paiements.length === 0) {
    zone.innerHTML = '<div class="empty-state">Aucun paiement enregistré.</div>';
    return;
  }
  zone.innerHTML = paiements.map(p => `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(p.type)} — ${Number(p.montant).toFixed(2)} € TTC</div>
        <div class="data-sub">${p.date || ''}${p.note ? ' · ' + escapeHtml(p.note) : ''}</div>
        ${p.numeroFacture ? `<div class="data-sub">Facture n° <strong>${escapeHtml(p.numeroFacture)}</strong></div>` : ''}
      </div>
      <div class="data-actions">
        ${!p.numeroFacture ? `<button class="btn-sm primary" onclick="window.facturerPaiement('${p.id}')">Générer la facture</button>` : `<button class="btn-sm" onclick="window.retelechargerFacture('${p.numeroFacture}')">Retélécharger PDF+XML</button> <button class="btn-sm" onclick="window.envoyerFactureParMail('${membreId}','${p.numeroFacture}')">Envoyer par mail</button>`}
        <button class="btn-sm danger" onclick="window.supprimerPaiement('${p.id}', '${membreId}')">Supprimer</button>
      </div>
    </div>`).join('');
}

async function chargerHistoriquePresencesAdmin(membreId) {
  const zone = document.getElementById('mm-historiquePresences');
  if (!zone) return;
  const snap = await getDocs(query(collection(db, 'presences'), where('uid', '==', membreId)));
  const presences = [];
  snap.forEach(d => presences.push({ id: d.id, ...d.data() }));
  presences.sort((a, b) => (b.dateISO || '').localeCompare(a.dateISO || ''));

  if (presences.length === 0) {
    zone.innerHTML = '<div class="empty-state">Aucun historique pour l\'instant.</div>';
    return;
  }
  zone.innerHTML = presences.map(p => {
    const g = currentGroupes.find(gr => gr.id === p.groupeId);
    let badge;
    if (p.statut === 'present') badge = '<span class="badge badge-ok">Présent(e)</span>';
    else if (p.statut === 'absent-auto') badge = '<span class="badge badge-warn">Non répondu — décompté</span>';
    else if (p.statut === 'absent-justifie') badge = '<span class="badge badge-neutral">Absent(e) justifié(e) — non décompté</span>';
    else badge = '<span class="badge badge-neutral">Absent(e) (signalé)</span>';
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${p.dateISO || ''} — ${g ? escapeHtml(g.nom) : '?'}</div>
        <div class="data-sub">${badge}</div>
      </div>
      <div class="data-actions">
        <button class="btn-sm" onclick="window.editerPresenceAdmin('${p.id}','${membreId}','${p.statut}')">Modifier</button>
        <button class="btn-sm danger" onclick="window.supprimerPresenceAdmin('${p.id}','${membreId}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

// Une présence "décompte" un cours de l'abonnement si son statut est
// 'present' (le membre est venu) ou 'absent-auto' (absent sans avoir
// répondu à temps, pénalité). 'absent' (signalé à temps) et
// 'absent-justifie' (annulation validée) ne décomptent jamais.
function presenceEstDecomptee(statut) {
  return statut === 'present' || statut === 'absent-auto';
}

window.editerPresenceAdmin = (presenceId, membreId, statutActuel) => {
  const html = `
    <div class="modal-overlay" id="modalOverlayPresence">
      <div class="modal-box">
        <h3>Modifier cette présence</h3>
        <div class="field"><label>Statut</label>
          <select id="pr-statut">
            <option value="present" ${statutActuel === 'present' ? 'selected' : ''}>Présent (décompté)</option>
            <option value="absent-auto" ${statutActuel === 'absent-auto' ? 'selected' : ''}>Absent — non répondu (décompté)</option>
            <option value="absent-justifie" ${statutActuel === 'absent-justifie' ? 'selected' : ''}>Absent justifié (non décompté)</option>
            <option value="absent" ${statutActuel === 'absent' ? 'selected' : ''}>Absent — signalé (non décompté)</option>
          </select>
        </div>
        <p style="font-size:0.8rem; color:var(--slate);">Le nombre de cours restants de l'abonnement du membre est ajusté automatiquement si le changement de statut le nécessite.</p>
        <div class="modal-actions">
          <button class="btn-sm" type="button" onclick="document.getElementById('modalOverlayPresence').remove()">Annuler</button>
          <button class="btn-sm primary" type="button" id="pr-save">Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('pr-save').addEventListener('click', async () => {
    const nouveauStatut = document.getElementById('pr-statut').value;
    const presSnap = await getDoc(doc(db, 'presences', presenceId));
    if (!presSnap.exists()) { document.getElementById('modalOverlayPresence').remove(); return; }
    const presence = presSnap.data();
    const decompteAvant = presence.compteAbonnement === true; // était réellement décompté
    const decompteApres = presenceEstDecomptee(nouveauStatut);

    if (decompteAvant !== decompteApres) {
      // Repasse en "décompté" → -1 cours. Repasse en "non décompté" → +1 cours
      // (remboursé). Incrément atomique Firestore : jamais de risque de valeur
      // périmée, même si un autre traitement (ex: décompte automatique) touche
      // ce même membre au même moment.
      await updateDoc(doc(db, 'membres', membreId), { coursRestants: increment(decompteApres ? -1 : 1) });
    }

    await updateDoc(doc(db, 'presences', presenceId), {
      statut: nouveauStatut,
      compteAbonnement: decompteApres,
      modifieParAdmin: true
    });

    document.getElementById('modalOverlayPresence').remove();
    chargerHistoriquePresencesAdmin(membreId);
    renderMembres();
  });
};

window.supprimerPresenceAdmin = async (presenceId, membreId) => {
  if (!confirm('Supprimer cette entrée de l\'historique de présence ? Si elle était décomptée, le cours sera recrédité à l\'abonnement.')) return;
  const presSnap = await getDoc(doc(db, 'presences', presenceId));
  if (presSnap.exists() && presSnap.data().compteAbonnement === true) {
    await updateDoc(doc(db, 'membres', membreId), { coursRestants: increment(1) });
  }
  await deleteDoc(doc(db, 'presences', presenceId));
  chargerHistoriquePresencesAdmin(membreId);
  renderMembres();
};

window.ouvrirModalPaiement = (membreId) => {
  const html = `
    <div class="modal-overlay" id="modalOverlayPaiement">
      <div class="modal-box">
        <h3>Enregistrer un paiement</h3>
        <div class="field"><label>Type</label>
          <select id="pay-type">
            <option value="Cotisation">Cotisation</option>
            <option value="Abonnement">Abonnement</option>
            <option value="Cours individuel">Cours individuel</option>
            <option value="Séance de comportement">Séance de comportement</option>
            <option value="Dog Sitting">Dog Sitting</option>
            <option value="Toilettage">Toilettage</option>
            <option value="Vente diverse">Vente diverse</option>
            <option value="Autre">Autre</option>
          </select>
        </div>
        <div class="form-grid">
          <div class="field"><label>Montant (€ TTC)</label><input type="number" step="0.01" id="pay-montant"></div>
          <div class="field"><label>Date</label><input type="date" id="pay-date" value="${dateISOLocale(new Date())}"></div>
        </div>
        <div class="field"><label>Note (optionnel)</label><input id="pay-note" placeholder="ex: viré le 12/03"></div>
        <div class="modal-actions">
          <button class="btn-sm" type="button" onclick="document.getElementById('modalOverlayPaiement').remove()">Annuler</button>
          <button class="btn-sm primary" type="button" id="pay-save">Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('pay-save').addEventListener('click', async () => {
    const montant = parseFloat(document.getElementById('pay-montant').value);
    if (isNaN(montant)) { alert('Merci d\'indiquer un montant.'); return; }
    await addDoc(collection(db, 'paiements'), {
      membreId,
      type: document.getElementById('pay-type').value,
      montant,
      date: document.getElementById('pay-date').value,
      note: document.getElementById('pay-note').value.trim(),
      createdAt: serverTimestamp()
    });
    document.getElementById('modalOverlayPaiement').remove();
    chargerHistoriquePaiements(membreId);
  });
};

window.supprimerPaiement = async (paiementId, membreId) => {
  if (!confirm('Supprimer ce paiement de l\'historique ?')) return;
  await deleteDoc(doc(db, 'paiements', paiementId));
  chargerHistoriquePaiements(membreId);
};

// ==========================================================================
// CE SOIR — cours du jour, météo, maintien / annulation
// ==========================================================================
async function chargerCeSoir() {
  const wrap = document.getElementById('listeCeSoir');
  try {

  // Construit la liste des occurrences de cours sur les 7 prochains jours
  // (aujourd'hui inclus), en fonction du jour récurrent de chaque groupe.
  const occurrences = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
    const jour = JOURS[d.getDay()];
    const dateISO = dateISOLocale(d);
    currentGroupes.filter(g => g.jour === jour).forEach(g => occurrences.push({ date: d, dateISO, groupe: g }));
  }

  if (occurrences.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun cours prévu cette semaine.</div>';
    return;
  }

  const annulSnap = await getDocs(collection(db, 'annulations'));
  const annulations = {};
  annulSnap.forEach(d => { annulations[d.id] = d.data(); });

  const confirmSnap = await getDocs(collection(db, 'confirmations'));
  const confirmations = {};
  confirmSnap.forEach(d => { confirmations[d.id] = d.data(); });

  const presSnap = await getDocs(collection(db, 'presences'));
  const presencesParCle = {};
  presSnap.forEach(d => {
    const p = d.data();
    const cle = `${p.groupeId}_${p.dateISO}`;
    if (!presencesParCle[cle]) presencesParCle[cle] = { present: 0, absent: 0 };
    presencesParCle[cle][p.statut === 'present' ? 'present' : 'absent']++;
  });

  const MIN_PARTICIPANTS = 4;
  const aujourdhuiISO = dateISOLocale(new Date());

  const lignes = await Promise.all(occurrences.map(async ({ date, dateISO, groupe: g }) => {
    const cle = `${g.id}_${dateISO}`;
    const annule = annulations[cle];
    const confirme = confirmations[cle];
    const nbMembres = currentMembres.filter(m => m.groupeId === g.id).length;
    const presencesJour = presencesParCle[cle] || { present: 0, absent: 0 };
    const pasAssez = !annule && presencesJour.present < MIN_PARTICIPANTS;
    let m = null;
    try { m = await meteoPour(dateISO, g.heureDebut); } catch (e) { m = null; }
    const alerte = alerteMeteo(m);
    const dateLabel = date.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    const estAujourdhui = dateISO === aujourdhuiISO;

    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${estAujourdhui ? "Ce soir — " : ""}${capitalize(dateLabel)} — ${escapeHtml(g.nom)} (${g.heureDebut}–${g.heureFin})</div>
        <div class="data-sub">
          ${nbMembres} chiens inscrits · <strong>${presencesJour.present}</strong> confirmé(s) présent(s)${presencesJour.absent ? `, ${presencesJour.absent} absent(s)` : ''}
          ${annule ? `<span class="badge badge-danger">Annulé — ${escapeHtml(annule.motif)}</span>` : `<span class="badge badge-ok">Maintenu</span>`}
          ${confirme && !annule ? `<span class="badge badge-ok">✅ Confirmé par Katia</span>` : ''}
          ${m ? `<span class="badge badge-neutral">${iconeCode(m.code)} ${m.temperature}°C · pluie ${m.pluie}%</span>` : '<span class="badge badge-neutral">Météo indisponible</span>'}
        </div>
        ${alerte && !annule ? `<div class="banner-alert" style="margin-top:8px; padding:8px 12px; ${alerte.niveau==='danger' ? 'background:#FBEAEA;border-color:#E3B4B4;color:#8A2E2E;' : ''}">⚠️ ${alerte.texte} — pense à vérifier si le cours doit être maintenu.</div>` : ''}
        ${pasAssez ? `<div class="banner-alert" style="margin-top:8px; padding:8px 12px; background:#FBEAEA;border-color:#E3B4B4;color:#8A2E2E;">⚠️ Seulement ${presencesJour.present} confirmation(s) sur les ${MIN_PARTICIPANTS} minimum requises — le cours devra être annulé faute de participants si ça n'évolue pas.</div>` : ''}
      </div>
      <div class="data-actions">
        <button class="btn-sm" onclick="window.voirMembresCours('${g.id}','${dateISO}')">Membres</button>
        ${annule
          ? `<button class="btn-sm" onclick="window.reactiverCours('${g.id}','${dateISO}')">Réactiver</button>`
          : `
            ${!confirme ? `<button class="btn-sm primary" onclick="window.validerCoursSemaine('${g.id}','${dateISO}')">✅ Valider ce cours</button>` : `<button class="btn-sm" onclick="window.retirerValidationCours('${g.id}','${dateISO}')">Retirer la validation</button>`}
            <button class="btn-sm danger" onclick="window.annulerCours('${g.id}','${dateISO}')">Annuler ce cours</button>
          `}
      </div>
    </div>`;
  }));

  wrap.innerHTML = lignes.join('');

  } catch (err) {
    wrap.innerHTML = `<div class="banner-alert" style="background:#FBEAEA; border-color:#E3B4B4; color:#8A2E2E;">Erreur : ${escapeHtml(err.code || '')} — ${escapeHtml(err.message || String(err))}</div>`;
  }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

window.marquerPresenceManuelle = async (groupeId, dateISO, uid, statut) => {
  await setDoc(doc(db, 'presences', `${groupeId}_${dateISO}_${uid}`), {
    groupeId, uid, dateISO, statut,
    repondu: new Date().toISOString(),
    compteAbonnement: false,
    marqueParAdmin: true
  });
  await traiterAbsencesAutomatiques(); // décompte l'abonnement immédiatement, comme pour une réponse normale
  window.voirMembresCours(groupeId, dateISO); // rafraîchit la fenêtre avec le nouveau statut
};

window.voirMembresCours = async (groupeId, dateISO) => {
  const groupe = currentGroupes.find(g => g.id === groupeId);
  const membresDuGroupe = currentMembres.filter(m => m.groupeId === groupeId);

  const presSnap = await getDocs(query(collection(db, 'presences'), where('groupeId', '==', groupeId), where('dateISO', '==', dateISO)));
  const reponses = {};
  presSnap.forEach(d => { reponses[d.data().uid] = d.data(); });

  const dateLabel = new Date(dateISO + 'T00:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });

  const lignes = membresDuGroupe.map(m => {
    const r = reponses[m.id];
    let badge;
    if (!r) badge = '<span class="badge badge-neutral">N\'a pas encore répondu</span>';
    else if (r.statut === 'present') badge = '<span class="badge badge-ok">Présent</span>';
    else if (r.statut === 'absent-auto') badge = '<span class="badge badge-warn">Absent — non répondu (décompté)</span>';
    else if (r.statut === 'absent-justifie') badge = '<span class="badge badge-neutral">Absent justifié (non décompté)</span>';
    else badge = '<span class="badge badge-neutral">Absent (signalé)</span>';
    return `
      <div class="data-row">
        <div class="data-main">
          <div class="data-title">${escapeHtml(m.nomMaitre)}${nomsChiensActifs(m) ? ' — ' + escapeHtml(nomsChiensActifs(m)) : ''}</div>
          <div class="data-sub">${badge}</div>
        </div>
        <div class="data-actions">
          <button class="btn-sm primary" onclick="window.marquerPresenceManuelle('${groupeId}','${dateISO}','${m.id}','present')">✅ Présent</button>
          <button class="btn-sm danger" onclick="window.marquerPresenceManuelle('${groupeId}','${dateISO}','${m.id}','absent-auto')">Absent (décompté)</button>
          <button class="btn-sm" onclick="window.marquerPresenceManuelle('${groupeId}','${dateISO}','${m.id}','absent-justifie')">Absent justifié (non décompté)</button>
        </div>
      </div>`;
  }).join('');

  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" style="max-width:640px;">
        <h3>${escapeHtml(groupe?.nom || '')} — ${capitalize(dateLabel)}</h3>
        <p style="color:var(--slate); font-size:0.85rem;">En temps normal, chaque membre valide lui-même sa présence depuis son espace. Utilise ces boutons pour aider un membre qui n'y arrive pas seul (pas d'accès, difficulté avec le site...).</p>
        <div class="data-list ce-soir-membres">
          ${lignes || '<div class="empty-state">Aucun membre dans ce groupe.</div>'}
        </div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Fermer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
};

window.validerCoursSemaine = async (groupeId, dateISO) => {
  await setDoc(doc(db, 'confirmations', `${groupeId}_${dateISO}`), {
    validePar: 'admin', dateValidation: serverTimestamp()
  });
  chargerCeSoir();
};

window.retirerValidationCours = async (groupeId, dateISO) => {
  await deleteDoc(doc(db, 'confirmations', `${groupeId}_${dateISO}`));
  chargerCeSoir();
};

window.annulerCours = (groupeId, dateISO) => {
  const html = `
    <div class="modal-overlay" id="modalOverlayMotif">
      <div class="modal-box">
        <h3>Motif de l'annulation</h3>
        <div class="field">
          <select id="motif-select">
            <option value="Pluie">Pluie</option>
            <option value="Chaleur / canicule">Chaleur / canicule</option>
            <option value="Pas assez de participants">Pas assez de participants</option>
            <option value="Autre">Autre (préciser ci-dessous)</option>
          </select>
        </div>
        <div class="field"><label>Précision (optionnel)</label><input id="motif-texte" placeholder="ex: orage annoncé en soirée"></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="document.getElementById('modalOverlayMotif').remove()">Annuler</button>
          <button class="btn-sm primary" id="motif-save">Confirmer l'annulation</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('motif-save').addEventListener('click', async () => {
    const choix = document.getElementById('motif-select').value;
    const precision = document.getElementById('motif-texte').value.trim();
    const motif = precision ? `${choix} — ${precision}` : choix;
    await setDoc(doc(db, 'annulations', `${groupeId}_${dateISO}`), {
      motif, annulePar: 'admin', dateAnnulation: serverTimestamp()
    });
    await deleteDoc(doc(db, 'confirmations', `${groupeId}_${dateISO}`)).catch(() => {});
    document.getElementById('modalOverlayMotif').remove();
    chargerCeSoir();
  });
};

window.reactiverCours = async (groupeId, dateISO) => {
  await deleteDoc(doc(db, 'annulations', `${groupeId}_${dateISO}`));
  chargerCeSoir();
};

// ---------- Utils ----------
function formaterPoids(poids, unite) {
  return unite === 'kg' ? Number(poids).toFixed(2) : poids;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// Blocs de fiche repliables : tout <h3 class="bloc-titre"> ouvre/ferme le
// <div class="bloc-contenu"> qui le suit directement (arrow ▾ / ▸). Fonction
// générique appelée après le rendu HTML concerné (ex: à l'ouverture de la
// fiche membre) — sans effet si aucun bloc-titre n'est présent dans conteneur.
function activerBlocsRepliables(conteneur) {
  (conteneur || document).querySelectorAll('.bloc-titre').forEach(titre => {
    if (titre.dataset.repliableInit) return;
    titre.dataset.repliableInit = '1';
    const contenu = titre.nextElementSibling;
    if (!contenu || !contenu.classList.contains('bloc-contenu')) return;
    titre.addEventListener('click', () => {
      const seFerme = !contenu.classList.contains('replie');
      contenu.classList.toggle('replie', seFerme);
      titre.classList.toggle('replie', seFerme);
    });
  });
}

// Échappe le texte puis transforme les liens http(s)://... tapés dedans en
// vrais liens cliquables (ouverture dans un nouvel onglet).
function texteAvecLiens(str) {
  const echappe = escapeHtml(str);
  return echappe.replace(/(https?:\/\/[^\s<]+)/g, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

// ==========================================================================
// SERVICES (remplace l'ancien "Tarifs" — catégories libres, prix ou texte)
// ==========================================================================
const SERVICES_PAR_DEFAUT = [
  { categorie: 'Éducation canine', nom: 'Cours collectif', prix: 70, prixTexte: '', unite: 'les 11 cours (10 + 1 gratuit)', conditions: '', prixFutur: null, dateFutur: '' },
  { categorie: 'Éducation canine', nom: 'Cours individuel', prix: 8, prixTexte: '', unite: 'par cours', conditions: '', prixFutur: null, dateFutur: '' },
  { categorie: 'Éducation canine', nom: 'Cotisation annuelle', prix: 70, prixTexte: '', unite: 'par an', conditions: '', prixFutur: 75, dateFutur: '2027-01-01' },
  { categorie: 'Éducation canine', nom: 'Séance de comportement individuelle', prix: 60, prixTexte: '', unite: 'par heure', conditions: '', prixFutur: null, dateFutur: '' },
  { categorie: 'Dog Sitting', nom: 'Dog Sitting', prix: 22, prixTexte: '', unite: 'par jour', conditions: "Sous réserve d'acceptation par Katia. Le chien doit obligatoirement être castré ou stérilisé. Arrivée à partir de 14h, départ avant 12h.", prixFutur: null, dateFutur: '' },
  { categorie: 'Toilettage', nom: 'Toilettage pendant la pension', prix: null, prixTexte: 'Sur devis', unite: '', conditions: '', prixFutur: null, dateFutur: '' },
  { categorie: 'Toilettage', nom: 'Toilettage à la demande', prix: null, prixTexte: '40 à 60 €', unite: 'tarif sur devis', conditions: '', prixFutur: null, dateFutur: '' }
];

let currentServices = [];

async function chargerServices() {
  const snap = await getDocs(collection(db, 'services'));
  currentServices = [];
  snap.forEach(d => currentServices.push({ id: d.id, ...d.data() }));
  renderServicesAdmin();
}

function libellePrix(s) {
  if (s.prixTexte) return s.prixTexte;
  if (typeof s.prix === 'number') return `${s.prix.toFixed(2)} €${s.unite ? ' — ' + s.unite : ''}`;
  return '—';
}

function renderServicesAdmin() {
  const wrap = document.getElementById('listeServices');
  if (currentServices.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun service pour l\'instant. Clique sur "Initialiser les services par défaut" ou ajoute-les un par un.</div>';
    return;
  }
  const categories = [...new Set(currentServices.map(s => s.categorie || 'Autres'))];
  wrap.innerHTML = categories.map(cat => `
    <h3 style="margin-top:18px;">${escapeHtml(cat)}</h3>
    <div class="data-list">
      ${currentServices.filter(s => (s.categorie || 'Autres') === cat).map(s => `
        <div class="data-row">
          <div class="data-main">
            <div class="data-title">${escapeHtml(s.nom)}</div>
            <div class="data-sub">${libellePrix(s)}${s.prixFutur ? ` <span class="badge badge-warn">${Number(s.prixFutur).toFixed(2)} € à partir du ${s.dateFutur}</span>` : ''}</div>
            ${s.conditions ? `<div class="data-sub">${escapeHtml(s.conditions)}</div>` : ''}
          </div>
          <div class="data-actions">
            <button class="btn-sm" onclick="window.editerService('${s.id}')">Modifier</button>
            <button class="btn-sm danger" onclick="window.supprimerService('${s.id}')">Supprimer</button>
          </div>
        </div>`).join('')}
    </div>`).join('');
}

document.getElementById('btnAjouterService').addEventListener('click', () => ouvrirModalService());

window.editerService = (id) => {
  const s = currentServices.find(x => x.id === id);
  ouvrirModalService(s);
};

window.supprimerService = async (id) => {
  if (!confirm('Supprimer ce service ?')) return;
  await deleteDoc(doc(db, 'services', id));
  chargerServices();
};

function ouvrirModalService(service) {
  const isEdit = !!service;
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>${isEdit ? 'Modifier le service' : 'Ajouter un service'}</h3>
        <div class="form-grid">
          <div class="field"><label>Catégorie</label><input id="sv-categorie" value="${isEdit ? escapeAttr(service.categorie||'') : ''}" placeholder="ex: Éducation canine, Dog Sitting, Toilettage" list="sv-categories-list"></div>
          <datalist id="sv-categories-list">
            ${[...new Set(currentServices.map(s => s.categorie))].map(c => `<option value="${escapeAttr(c)}">`).join('')}
          </datalist>
          <div class="field"><label>Nom du service</label><input id="sv-nom" value="${isEdit ? escapeAttr(service.nom||'') : ''}"></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Prix TTC (€, laisser vide si "sur devis")</label><input type="number" step="0.01" id="sv-prix" value="${isEdit && service.prix != null ? service.prix : ''}"></div>
          <div class="field"><label>Ou texte libre (ex: "40 à 60 €")</label><input id="sv-prixTexte" value="${isEdit ? escapeAttr(service.prixTexte||'') : ''}"></div>
        </div>
        <div class="field"><label>Unité / précision (ex: "par jour", "par heure")</label><input id="sv-unite" value="${isEdit ? escapeAttr(service.unite||'') : ''}"></div>
        <div class="field"><label>Conditions particulières (optionnel)</label><textarea id="sv-conditions" rows="2" style="resize:vertical;">${isEdit ? escapeHtml(service.conditions||'') : ''}</textarea></div>
        <div class="form-grid">
          <div class="field"><label>Prix futur (optionnel)</label><input type="number" step="0.01" id="sv-prixFutur" value="${isEdit && service.prixFutur != null ? service.prixFutur : ''}"></div>
          <div class="field"><label>À partir du</label><input type="date" id="sv-dateFutur" value="${isEdit ? (service.dateFutur||'') : ''}"></div>
        </div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="sv-save">Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('sv-save').addEventListener('click', async () => {
    const nom = document.getElementById('sv-nom').value.trim();
    const categorie = document.getElementById('sv-categorie').value.trim();
    if (!nom || !categorie) { alert('Merci d\'indiquer une catégorie et un nom.'); return; }
    const prixVal = document.getElementById('sv-prix').value;
    const prixFuturVal = document.getElementById('sv-prixFutur').value;
    const data = {
      categorie, nom,
      prix: prixVal === '' ? null : parseFloat(prixVal),
      prixTexte: document.getElementById('sv-prixTexte').value.trim(),
      unite: document.getElementById('sv-unite').value.trim(),
      conditions: document.getElementById('sv-conditions').value.trim(),
      prixFutur: prixFuturVal === '' ? null : parseFloat(prixFuturVal),
      dateFutur: document.getElementById('sv-dateFutur').value
    };
    if (isEdit) {
      await updateDoc(doc(db, 'services', service.id), data);
    } else {
      await addDoc(collection(db, 'services'), data);
    }
    window.fermerModal();
    chargerServices();
  });
}

document.getElementById('btnInitServices').addEventListener('click', async () => {
  if (currentServices.length > 0 && !confirm('Des services existent déjà. Ajouter quand même les services par défaut (sans toucher aux existants) ?')) return;
  try {
    for (const s of SERVICES_PAR_DEFAUT) {
      await addDoc(collection(db, 'services'), s);
    }
    chargerServices();
  } catch (err) {
    alert('Erreur lors de la création des services : ' + (err.code || '') + ' — ' + (err.message || err));
  }
});

// ==========================================================================
// RDV — destinataires ciblés, prix par personne, suivi de paiement
// ==========================================================================

async function chargerIban() {
  const paramDoc = await getDoc(doc(db, 'parametres', 'bancaire'));
  document.getElementById('rdv-iban').value = paramDoc.exists() ? (paramDoc.data().iban || '') : '';
}

document.getElementById('btnSauverIban').addEventListener('click', async () => {
  await setDoc(doc(db, 'parametres', 'bancaire'), { iban: document.getElementById('rdv-iban').value.trim() });
  alert('IBAN enregistré.');
});

function libelleDestinataires(rdv, membreIdsParRdv) {
  if (!rdv.destinataires || rdv.destinataires.type === 'tous') return 'Tous les membres';
  if (rdv.destinataires.type === 'groupe') {
    const g = currentGroupes.find(g => g.id === rdv.destinataires.groupeId);
    return 'Groupe : ' + (g ? g.nom : '—');
  }
  const membreIds = membreIdsParRdv?.[rdv.id] || [];
  const noms = membreIds.map(id => currentMembres.find(m => m.id === id)?.nomMaitre).filter(Boolean);
  return 'Membres : ' + (noms.join(', ') || '—');
}

async function chargerRdv() {
  await chargerIban();
  const snap = await getDocs(collection(db, 'rdv'));
  const rdvs = [];
  snap.forEach(d => rdvs.push({ id: d.id, ...d.data() }));
  rdvs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const wrap = document.getElementById('listeRdv');
  if (rdvs.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun RDV créé pour l\'instant.</div>';
    return;
  }

  // Destinataires nominatifs : stockés à part (rdv_admin, réservé à
  // l'admin) pour que la liste des membres ciblés par un RDV "individuel"
  // ne soit jamais lisible par les membres eux-mêmes.
  const adminSnap = await getDocs(collection(db, 'rdv_admin'));
  const membreIdsParRdv = {};
  adminSnap.forEach(d => { membreIdsParRdv[d.id] = d.data().membreIds || []; });

  const reponsesSnap = await getDocs(collection(db, 'rdv_reponses'));
  const reponsesParRdv = {};
  reponsesSnap.forEach(d => {
    const r = d.data();
    if (!reponsesParRdv[r.rdvId]) reponsesParRdv[r.rdvId] = [];
    reponsesParRdv[r.rdvId].push({ id: d.id, ...r });
  });

  wrap.innerHTML = rdvs.map(rdv => {
    const reponses = reponsesParRdv[rdv.id] || [];
    const presents = reponses.filter(r => r.statut === 'present');
    const totalPersonnes = presents.reduce((s, r) => s + (r.nombrePersonnes || 1), 0);
    const totalDu = presents.reduce((s, r) => s + (r.montant || 0), 0);
    const payes = presents.filter(r => r.paye).length;
    const valides = presents.filter(r => r.paiementValide).length;
    const dateLabel = rdv.date ? new Date(rdv.date + 'T00:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    const detailPresents = [...presents].sort((a, b) => {
      const nomA = currentMembres.find(mm => mm.id === a.uid)?.nomMaitre || '';
      const nomB = currentMembres.find(mm => mm.id === b.uid)?.nomMaitre || '';
      return nomA.localeCompare(nomB, 'fr', { sensitivity: 'base' });
    }).map(r => {
      const m = currentMembres.find(mm => mm.id === r.uid);
      return `
      <div class="data-row">
        <div class="data-main">
          <div class="data-title">${escapeHtml(m?.nomMaitre || '?')}${m && nomsChiensActifs(m) ? ' — ' + escapeHtml(nomsChiensActifs(m)) : ''} ${r.nombrePersonnes > 1 ? `(${r.nombrePersonnes} pers.)` : ''}</div>
          <div class="data-sub">
            ${rdv.prixParPersonne ? `${Number(r.montant||0).toFixed(2)} € dû` : ''}
            ${r.paye ? '<span class="badge badge-ok">A indiqué avoir payé</span>' : '<span class="badge badge-neutral">Pas encore payé</span>'}
            ${r.paiementValide ? '<span class="badge badge-ok">Paiement validé</span>' : ''}
          </div>
        </div>
        <div class="data-actions">
          ${!r.paiementValide ? `<button class="btn-sm primary" onclick="window.validerPaiementRdv('${r.id}', '${rdv.id}')">Valider le paiement</button>` : ''}
        </div>
      </div>`;
    }).join('');

    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(rdv.titre)}</div>
        <div class="data-sub">${dateLabel} ${rdv.heure || ''} · ${escapeHtml(rdv.lieu || '')} · ${escapeHtml(rdv.modalite || '')}</div>
        <div class="data-sub">${escapeHtml(libelleDestinataires(rdv, membreIdsParRdv))}${rdv.prixParPersonne ? ` · ${Number(rdv.prixParPersonne).toFixed(2)} €/pers.` : ''}</div>
        <div class="data-sub">
          <span class="badge badge-ok">${presents.length} réponse(s) présent · ${totalPersonnes} pers.</span>
          ${rdv.prixParPersonne ? `<span class="badge badge-neutral">${totalDu.toFixed(2)} € attendus</span> <span class="badge badge-neutral">${valides}/${presents.length} paiements validés</span>` : ''}
        </div>
        ${presents.length ? `<div style="margin-top:10px;">${detailPresents}</div>` : ''}
      </div>
      <div class="data-actions">
        <button class="btn-sm danger" onclick="window.supprimerRdv('${rdv.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('btnAjouterRdv').addEventListener('click', () => {
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>Créer un RDV</h3>
        <div class="field"><label>Titre</label><input id="rd-titre" placeholder="ex: Repas du club"></div>
        <div class="form-grid">
          <div class="field"><label>Date</label><input type="date" id="rd-date"></div>
          <div class="field"><label>Heure</label><input type="time" id="rd-heure"></div>
        </div>
        <div class="field"><label>Lieu</label><input id="rd-lieu"></div>
        <div class="field"><label>Modalité (info libre, optionnel)</label><input id="rd-modalite" placeholder="ex: Chacun ramène un plat"></div>
        <div class="field"><label>Prix par personne (€ TTC, laisser vide si gratuit)</label><input type="number" step="0.01" id="rd-prix"></div>

        <div class="field"><label>Destinataires</label>
          <select id="rd-destinatairesType">
            <option value="tous">Tous les membres</option>
            <option value="groupe">Un groupe</option>
            <option value="individuel">Membres spécifiques</option>
          </select>
        </div>
        <div class="field hidden" id="rd-groupeWrap">
          <label>Groupe</label>
          <select id="rd-groupe">${currentGroupes.map(g => `<option value="${g.id}">${escapeHtml(g.nom)}</option>`).join('')}</select>
        </div>
        <div class="field hidden" id="rd-membresWrap">
          <label>Membres invités</label>
          <div class="membre-check-list">
            ${currentMembres.map(m => `
              <label class="membre-check-row">
                <input type="checkbox" class="rd-membre-check" value="${m.id}">
                <span>${escapeHtml(m.nomMaitre)}</span>
              </label>`).join('')}
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="rd-save">Créer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;

  document.getElementById('rd-destinatairesType').addEventListener('change', (e) => {
    document.getElementById('rd-groupeWrap').classList.toggle('hidden', e.target.value !== 'groupe');
    document.getElementById('rd-membresWrap').classList.toggle('hidden', e.target.value !== 'individuel');
  });

  document.getElementById('rd-save').addEventListener('click', async () => {
    const titre = document.getElementById('rd-titre').value.trim();
    const date = document.getElementById('rd-date').value;
    if (!titre || !date) { alert('Merci de renseigner au moins un titre et une date.'); return; }

    const typeDest = document.getElementById('rd-destinatairesType').value;
    let membreIdsCibles = [];
    const destinataires = { type: typeDest, groupeId: null };
    if (typeDest === 'groupe') destinataires.groupeId = document.getElementById('rd-groupe').value;
    if (typeDest === 'individuel') {
      membreIdsCibles = [...document.querySelectorAll('.rd-membre-check:checked')].map(c => c.value);
    }

    const prixVal = document.getElementById('rd-prix').value;

    // Le RDV lui-même (lisible par tous les membres) ne contient JAMAIS la
    // liste nominative des membres ciblés — seulement le type et, pour un
    // ciblage par groupe, le groupeId (non personnel). La liste nominative
    // va dans rdv_admin (réservé à l'admin), et un petit marqueur par
    // membre ciblé va dans rdv_cibles, pour que chacun ne puisse vérifier
    // QUE sa propre invitation, jamais celle des autres.
    const refRdv = await addDoc(collection(db, 'rdv'), {
      titre, date,
      heure: document.getElementById('rd-heure').value,
      lieu: document.getElementById('rd-lieu').value.trim(),
      modalite: document.getElementById('rd-modalite').value.trim(),
      prixParPersonne: prixVal === '' ? null : parseFloat(prixVal),
      destinataires,
      dateCreation: serverTimestamp()
    });

    if (typeDest === 'individuel') {
      await setDoc(doc(db, 'rdv_admin', refRdv.id), { membreIds: membreIdsCibles });
      await Promise.all(membreIdsCibles.map(uid =>
        setDoc(doc(db, 'rdv_cibles', `${refRdv.id}_${uid}`), { rdvId: refRdv.id, uid })
      ));
    }

    window.fermerModal();
    chargerRdv();
  });
});

window.supprimerRdv = async (id) => {
  if (!confirm('Supprimer ce RDV ? Les réponses des membres seront aussi supprimées.')) return;
  await deleteDoc(doc(db, 'rdv', id));
  await deleteDoc(doc(db, 'rdv_admin', id)).catch(() => {});
  const ciblesSnap = await getDocs(query(collection(db, 'rdv_cibles'), where('rdvId', '==', id)));
  await Promise.all(ciblesSnap.docs.map(d => deleteDoc(d.ref)));
  const reponsesSnap = await getDocs(query(collection(db, 'rdv_reponses'), where('rdvId', '==', id)));
  await Promise.all(reponsesSnap.docs.map(d => deleteDoc(d.ref)));
  chargerRdv();
};

window.validerPaiementRdv = async (reponseId, rdvId) => {
  await updateDoc(doc(db, 'rdv_reponses', reponseId), { paiementValide: true });
  chargerRdv();
};

// ==========================================================================
// MESSAGES (chat admin <-> membre)
// ==========================================================================
let conversationOuverte = null;

async function chargerConversations() {
  const snap = await getDocs(collection(db, 'conversations'));
  const convs = {};
  snap.forEach(d => { convs[d.id] = d.data(); });

  const wrap = document.getElementById('listeConversations');
  const membresAvecConv = currentMembres.filter(m => convs[m.id]);
  const autresMembres = currentMembres.filter(m => !convs[m.id]);
  const ordonne = [...membresAvecConv.sort((a, b) => (convs[b.id]?.dateDernierMessage || '').localeCompare(convs[a.id]?.dateDernierMessage || '')), ...autresMembres];

  let unReadTotal = 0;
  ordonne.forEach(m => { if (convs[m.id]?.nonLuAdmin) unReadTotal++; });
  const tabBtn = document.getElementById('tabMessagesBtn');
  tabBtn.classList.toggle('has-unread', unReadTotal > 0);

  const terme = (document.getElementById('rechercheMessage')?.value || '').trim().toLowerCase();
  const ordonneAffiches = !terme ? ordonne : ordonne.filter(m =>
    (m.nomMaitre || '').toLowerCase().includes(terme) || nomsChiensActifs(m).toLowerCase().includes(terme)
  );

  if (ordonneAffiches.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun membre ne correspond à cette recherche.</div>';
  } else {
    wrap.innerHTML = ordonneAffiches.map(m => {
      const c = convs[m.id];
      const nonLu = c?.nonLuAdmin;
      return `
      <div class="data-row" style="cursor:pointer;" onclick="window.ouvrirConversation('${m.id}')">
        <div class="data-main">
          <div class="data-title">${escapeHtml(m.nomMaitre)}${nomsChiensActifs(m) ? ' — ' + escapeHtml(nomsChiensActifs(m)) : ''} ${nonLu ? '<span class="badge badge-danger">Nouveau</span>' : ''}</div>
          <div class="data-sub">${c?.dernierMessage ? escapeHtml(c.dernierMessage).slice(0, 60) : 'Aucun message pour l\'instant'}</div>
        </div>
        <div class="data-actions"><button class="btn-sm">Ouvrir</button></div>
      </div>`;
    }).join('');
  }
}

window.ouvrirConversation = async (uid) => {
  conversationOuverte = uid;
  const membre = currentMembres.find(m => m.id === uid);
  const msgsSnap = await getDocs(collection(db, 'conversations', uid, 'messages'));
  const msgs = [];
  msgsSnap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
  msgs.sort((a, b) => (a.dateEnvoi || '').localeCompare(b.dateEnvoi || ''));

  // Marquer comme lus les messages envoyés par le membre
  await Promise.all(msgs.filter(m => m.expediteur === 'membre' && !m.lu).map(m =>
    updateDoc(doc(db, 'conversations', uid, 'messages', m.id), { lu: true })
  ));
  await setDoc(doc(db, 'conversations', uid), { nonLuAdmin: false }, { merge: true });

  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" style="max-width:520px;">
        <h3>${escapeHtml(membre?.nomMaitre || '')}${membre && nomsChiensActifs(membre) ? ' — ' + escapeHtml(nomsChiensActifs(membre)) : ''}</h3>
        <div class="chat-thread" id="chatThread">
          ${msgs.map(m => bulleMessage(m, 'admin', uid)).join('') || '<div class="empty-state">Aucun message.</div>'}
        </div>
        <div class="chat-input-row">
          <input type="text" id="chatInputAdmin" placeholder="Écrire un message...">
          <button class="btn-sm primary" id="chatSendAdmin">Envoyer</button>
        </div>
        <div class="modal-actions"><button class="btn-sm" onclick="window.fermerModal()">Fermer</button></div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('chatThread').scrollTop = 999999;

  document.getElementById('chatSendAdmin').addEventListener('click', () => envoyerMessageAdmin(uid));
  document.getElementById('chatInputAdmin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') envoyerMessageAdmin(uid);
  });

  chargerConversations();
};

async function envoyerMessageAdmin(uid) {
  const input = document.getElementById('chatInputAdmin');
  const texte = input.value.trim();
  if (!texte) return;
  input.value = '';
  const maintenant = new Date().toISOString();
  await addDoc(collection(db, 'conversations', uid, 'messages'), {
    texte, expediteur: 'admin', dateEnvoi: maintenant, lu: false
  });
  await setDoc(doc(db, 'conversations', uid), {
    dernierMessage: texte, dateDernierMessage: maintenant, nonLuMembre: true
  }, { merge: true });
  window.ouvrirConversation(uid);
}

document.getElementById('rechercheMessage').addEventListener('input', () => chargerConversations());
async function envoyerMessageATousMembres(texte, cible = 'tous') {
  const destinataires = cible === 'tous' ? currentMembres : currentMembres.filter(m => m.groupeId === cible);
  const maintenant = new Date().toISOString();
  await Promise.all(destinataires.map(async (m) => {
    await addDoc(collection(db, 'conversations', m.id, 'messages'), {
      texte, expediteur: 'admin', dateEnvoi: maintenant, lu: false
    });
    await setDoc(doc(db, 'conversations', m.id), {
      dernierMessage: texte, dateDernierMessage: maintenant, nonLuMembre: true
    }, { merge: true });
  }));
  chargerConversations();
  return destinataires.length;
}

document.getElementById('btnMessageGroupe').addEventListener('click', () => {
  ouvrirModalMessageGroupe();
});

document.getElementById('btnSupprimerMessagePartout').addEventListener('click', () => {
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>🗑️ Supprimer un message envoyé à tout le monde</h3>
        <p style="font-size:0.85rem; color:var(--slate);">Colle ici exactement le texte du message à retirer (copie-le depuis une conversation). Il sera recherché puis supprimé dans TOUTES les conversations où il apparaît — pratique pour un message groupé envoyé par erreur.</p>
        <div class="field"><label>Texte exact du message</label><textarea id="smp-texte" rows="3" style="resize:vertical;"></textarea></div>
        <button class="btn-sm" id="smp-chercher">Chercher les messages correspondants</button>
        <div id="smp-resultat" style="margin-top:12px;"></div>
        <div class="modal-actions"><button class="btn-sm" onclick="window.fermerModal()">Fermer</button></div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;

  document.getElementById('smp-chercher').addEventListener('click', async () => {
    const texte = document.getElementById('smp-texte').value.trim();
    const resultatEl = document.getElementById('smp-resultat');
    if (!texte) { resultatEl.innerHTML = '<p style="color:var(--slate); font-size:0.85rem;">Colle d\'abord le texte du message.</p>'; return; }
    resultatEl.innerHTML = '<p style="color:var(--slate); font-size:0.85rem;">Recherche en cours...</p>';

    const snap = await getDocs(query(collectionGroup(db, 'messages'), where('texte', '==', texte)));
    if (snap.empty) {
      resultatEl.innerHTML = '<p style="color:var(--slate); font-size:0.85rem;">Aucun message correspondant trouvé.</p>';
      return;
    }
    resultatEl.innerHTML = `
      <p style="font-size:0.9rem; color:var(--ink);"><strong>${snap.size}</strong> message(s) trouvé(s) avec ce texte exact.</p>
      <button class="btn-sm danger" id="smp-supprimer">Supprimer ces ${snap.size} message(s) partout</button>`;
    document.getElementById('smp-supprimer').addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement ces ${snap.size} message(s), chez tous les membres concernés ?`)) return;
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      resultatEl.innerHTML = `<p style="color:#2F6B4F; font-size:0.9rem;">✓ ${snap.size} message(s) supprimé(s).</p>`;
      chargerConversations();
    });
  });
});

function ouvrirModalMessageGroupe(texteInitial = '') {
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>Écrire à un groupe ou à tous les membres</h3>
        <div class="field"><label>Destinataires</label>
          <select id="bc-cible">
            <option value="tous">Tous les membres</option>
            ${currentGroupes.map(g => `<option value="${g.id}">${escapeHtml(g.nom)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Message</label><textarea id="bc-texte" rows="6" style="resize:vertical;">${escapeHtml(texteInitial)}</textarea></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="bc-save">Envoyer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('bc-save').addEventListener('click', async () => {
    const cible = document.getElementById('bc-cible').value;
    const texte = document.getElementById('bc-texte').value.trim();
    if (!texte) { alert('Merci d\'écrire un message.'); return; }
    const nb = await envoyerMessageATousMembres(texte, cible);
    window.fermerModal();
    alert(`Message envoyé à ${nb} membre(s).`);
  });
}

function bulleMessage(m, pointDeVue, uid) {
  const estMoi = m.expediteur === pointDeVue;
  const heure = m.dateEnvoi ? new Date(m.dateEnvoi).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
  const coche = estMoi ? `<span class="chat-check ${m.lu ? 'lu' : ''}">${m.lu ? '✓✓' : '✓'}</span>` : '';
  const btnSupprimer = (pointDeVue === 'admin' && uid && m.id)
    ? `<button class="chat-delete" title="Supprimer ce message" onclick="window.supprimerMessageConversation('${uid}','${m.id}')">✕</button>`
    : '';
  return `
    <div class="chat-bubble ${estMoi ? 'moi' : 'autre'}">
      ${btnSupprimer}
      ${escapeHtml(m.texte)}
      <div class="chat-meta">${heure} ${coche}</div>
    </div>`;
}

window.supprimerMessageConversation = async (uid, msgId) => {
  if (!confirm('Supprimer ce message ? Cette action est irréversible.')) return;
  await deleteDoc(doc(db, 'conversations', uid, 'messages', msgId));
  window.ouvrirConversation(uid);
};

// ==========================================================================
// BLOG (articles publics)
// ==========================================================================
let currentArticlesArchives = [];

async function chargerArticles() {
  const snap = await getDocs(collection(db, 'articles'));
  const tous = [];
  snap.forEach(d => tous.push({ id: d.id, ...d.data() }));
  tous.sort((a, b) => (b.datePublication || '').localeCompare(a.datePublication || ''));

  const articles = tous.filter(a => !a.archive);
  currentArticlesArchives = tous.filter(a => a.archive);

  const wrap = document.getElementById('listeArticles');
  if (articles.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun article pour l\'instant.</div>';
  } else {
    wrap.innerHTML = articles.map(a => `
      <div class="data-row">
        <div class="data-main">
          <div class="data-title">${escapeHtml(a.titre)}</div>
          <div class="data-sub">${a.datePublication || ''} · ${escapeHtml((a.contenu || '').slice(0, 80))}${(a.contenu||'').length > 80 ? '…' : ''}</div>
        </div>
        <div class="data-actions">
          <button class="btn-sm" onclick="window.editerArticle('${a.id}')">Modifier</button>
          <button class="btn-sm danger" onclick="window.archiverArticle('${a.id}')">Archiver</button>
        </div>
      </div>`).join('');
  }
  renderArticlesArchives();
}

function renderArticlesArchives() {
  const wrap = document.getElementById('listeArticlesArchives');
  if (!wrap) return;
  if (currentArticlesArchives.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun article archivé.</div>';
    return;
  }
  wrap.innerHTML = currentArticlesArchives.map(a => `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(a.titre)}</div>
        <div class="data-sub">${a.datePublication || ''}</div>
      </div>
      <div class="data-actions">
        <button class="btn-sm primary" onclick="window.reactiverArticle('${a.id}')">Remettre en ligne</button>
      </div>
    </div>`).join('');
}

document.getElementById('btnAjouterArticle').addEventListener('click', () => ouvrirModalArticle());

document.getElementById('btnVoirArticlesArchives')?.addEventListener('click', () => {
  const wrap = document.getElementById('listeArticlesArchives');
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : 'block';
});

window.editerArticle = async (id) => {
  const d = await getDoc(doc(db, 'articles', id));
  ouvrirModalArticle({ id, ...d.data() });
};

window.archiverArticle = async (id) => {
  if (!confirm('Archiver cet article ? Il ne sera plus visible des membres mais restera récupérable.')) return;
  await updateDoc(doc(db, 'articles', id), { archive: true });
  chargerArticles();
};

window.reactiverArticle = async (id) => {
  await updateDoc(doc(db, 'articles', id), { archive: false });
  chargerArticles();
};

function ouvrirModalArticle(article) {
  const isEdit = !!article;
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" style="max-width:520px;">
        <h3>${isEdit ? 'Modifier l\'article' : 'Nouvel article'}</h3>
        <div class="field"><label>Titre</label><input id="ar-titre" value="${isEdit ? escapeAttr(article.titre) : ''}"></div>
        <div class="field"><label>Image (URL d'un fichier .jpg/.png, optionnel)</label><input id="ar-image" value="${isEdit ? escapeAttr(article.image||'') : ''}" placeholder="https://exemple.be/photo.jpg"></div>
        <div class="field"><label>Lien externe (optionnel — vers un article, une actualité...)</label><input id="ar-lien" value="${isEdit ? escapeAttr(article.lien||'') : ''}" placeholder="https://..."></div>
        <div class="field"><label>Contenu</label><textarea id="ar-contenu" rows="7" style="resize:vertical;">${isEdit ? escapeHtml(article.contenu) : ''}</textarea></div>
        <p style="font-size:0.78rem; color:var(--slate);">Astuce : tout lien tapé directement dans le texte du contenu devient automatiquement cliquable.</p>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="ar-save">${isEdit ? 'Enregistrer' : 'Publier'}</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('ar-save').addEventListener('click', async () => {
    const titre = document.getElementById('ar-titre').value.trim();
    const contenu = document.getElementById('ar-contenu').value.trim();
    if (!titre || !contenu) { alert('Merci de remplir le titre et le contenu.'); return; }
    const data = {
      titre, contenu,
      image: document.getElementById('ar-image').value.trim(),
      lien: document.getElementById('ar-lien').value.trim(),
      datePublication: isEdit ? article.datePublication : dateISOLocale(new Date())
    };
    if (isEdit) {
      await updateDoc(doc(db, 'articles', article.id), data);
    } else {
      await addDoc(collection(db, 'articles'), data);
    }
    window.fermerModal();
    chargerArticles();
  });
}

// ==========================================================================
// VIDÉOS D'APPRENTISSAGE
// ==========================================================================
async function chargerVideosAdmin() {
  const snap = await getDocs(collection(db, 'videos'));
  const videos = [];
  snap.forEach(d => videos.push({ id: d.id, ...d.data() }));

  const wrap = document.getElementById('listeVideos');
  if (videos.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune vidéo pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = videos.map(v => `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(v.titre)}</div>
        <div class="data-sub">${escapeHtml((v.texte || '').slice(0, 80))}</div>
      </div>
      <div class="data-actions">
        <button class="btn-sm" onclick="window.editerVideo('${v.id}')">Modifier</button>
        <button class="btn-sm danger" onclick="window.supprimerVideo('${v.id}')">Supprimer</button>
      </div>
    </div>`).join('');
}

document.getElementById('btnAjouterVideo').addEventListener('click', () => ouvrirModalVideo());

window.editerVideo = async (id) => {
  const d = await getDoc(doc(db, 'videos', id));
  ouvrirModalVideo({ id, ...d.data() });
};

window.supprimerVideo = async (id) => {
  if (!confirm('Supprimer cette vidéo ?')) return;
  await deleteDoc(doc(db, 'videos', id));
  chargerVideosAdmin();
};

function ouvrirModalVideo(video) {
  const isEdit = !!video;
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" style="max-width:520px;">
        <h3>${isEdit ? 'Modifier la vidéo' : 'Ajouter une vidéo'}</h3>
        <div class="field"><label>Titre (ex: Apprendre "assis")</label><input id="vd-titre" value="${isEdit ? escapeAttr(video.titre) : ''}"></div>
        <div class="field"><label>Lien vidéo (YouTube)</label><input id="vd-url" value="${isEdit ? escapeAttr(video.url||'') : ''}" placeholder="https://www.youtube.com/watch?v=..."></div>
        <div class="field"><label>Texte explicatif</label><textarea id="vd-texte" rows="5" style="resize:vertical;">${isEdit ? escapeHtml(video.texte||'') : ''}</textarea></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="vd-save">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('vd-save').addEventListener('click', async () => {
    const titre = document.getElementById('vd-titre').value.trim();
    const url = document.getElementById('vd-url').value.trim();
    if (!titre || !url) { alert('Merci de remplir le titre et le lien vidéo.'); return; }
    const data = { titre, url, texte: document.getElementById('vd-texte').value.trim() };
    if (isEdit) {
      await updateDoc(doc(db, 'videos', video.id), data);
    } else {
      await addDoc(collection(db, 'videos'), data);
    }
    window.fermerModal();
    chargerVideosAdmin();
  });
}

// ==========================================================================
// ANNIVERSAIRES — rappel des anniversaires proches (7 jours)
// ==========================================================================
async function chargerAnniversaires() {
  const zone = document.getElementById('anniversairesDuJour');
  if (!zone) return;
  const aujourdhui = new Date();
  const debutJourAuj = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
  const demain = new Date(debutJourAuj); demain.setDate(demain.getDate() + 1);

  // Fenêtre stricte : la veille + le jour même (pas une semaine entière).
  function estVeilleOuJourJ(mois, jour) {
    let candidate = new Date(aujourdhui.getFullYear(), mois - 1, jour);
    if (candidate < debutJourAuj) candidate = new Date(aujourdhui.getFullYear() + 1, mois - 1, jour);
    return candidate.getTime() === debutJourAuj.getTime() || candidate.getTime() === demain.getTime();
  }

  const lignes = [];
  currentMembres.forEach(m => {
    if (m.dateAnniversaire) {
      const parts = m.dateAnniversaire.split('-').map(Number);
      if (estVeilleOuJourJ(parts[1], parts[2])) {
        const estAuj = new Date(aujourdhui.getFullYear(), parts[1]-1, parts[2]).getTime() === debutJourAuj.getTime();
        lignes.push(`🎂 ${escapeHtml(m.nomMaitre)} — ${parts[2]}/${parts[1]} ${estAuj ? '<strong>(aujourd\'hui !)</strong>' : '(demain)'}`);
      }
    }
    (m.chiens || []).filter(c => !c.archive).forEach(c => {
      if (!c.naissance) return;
      const parts = c.naissance.split('-').map(Number);
      if (estVeilleOuJourJ(parts[1], parts[2])) {
        const estAuj = new Date(aujourdhui.getFullYear(), parts[1]-1, parts[2]).getTime() === debutJourAuj.getTime();
        lignes.push(`🐾 ${escapeHtml(c.nom)} (${escapeHtml(m.nomMaitre)}) — ${parts[2]}/${parts[1]} ${estAuj ? '<strong>(aujourd\'hui !)</strong>' : '(demain)'}`);
      }
    });
  });

  if (lignes.length === 0) { zone.innerHTML = ''; return; }

  zone.innerHTML = `
    <div class="banner-alert">
      🎉 Anniversaire${lignes.length > 1 ? 's' : ''} :<br>
      ${lignes.join('<br>')}
    </div>`;
}

// ==========================================================================
// COTISATIONS — rappel des échéances proches (30 jours) ou dépassées
// ==========================================================================
async function chargerCotisationsARenouveler() {
  const zone = document.getElementById('cotisationsARenouveler');
  if (!zone) return;
  const aujourdhui = new Date(); aujourdhui.setHours(0,0,0,0);
  const dans30Jours = new Date(aujourdhui); dans30Jours.setDate(aujourdhui.getDate() + 30);

  // Cas 1 : une date d'échéance est renseignée et elle approche (ou est déjà dépassée) —
  // peu importe le statut payé/non payé.
  const concernesEcheance = currentMembres.filter(m => {
    if (!m.cotisationDateEcheance) return false;
    const echeance = new Date(m.cotisationDateEcheance + 'T00:00:00');
    return echeance <= dans30Jours;
  });

  // Cas 2 : la fiche affiche "Cotisation à jour" (cotisationPayee = true) mais sans
  // date d'échéance renseignée — dans ce cas le cas 1 ne peut jamais se déclencher,
  // donc on prévient qu'il manque la date pour pouvoir un jour relancer ce membre.
  // (accès Cours requis, indépendamment d'un groupe hebdo précis déjà choisi ou non)
  const concernesSansDate = currentMembres.filter(m =>
    (m.accesCours !== undefined ? m.accesCours : true) && m.cotisationPayee && !m.cotisationDateEcheance
  );

  if (concernesEcheance.length === 0 && concernesSansDate.length === 0) { zone.innerHTML = ''; return; }

  let html = '';
  if (concernesEcheance.length > 0) {
    html += `
    <div class="banner-alert">
      💳 Cotisation${concernesEcheance.length > 1 ? 's' : ''} à renouveler bientôt :<br>
      ${concernesEcheance.map(m => {
        const echeance = new Date(m.cotisationDateEcheance + 'T00:00:00');
        const enRetard = echeance < aujourdhui;
        const reponse = m.cotisationRenouvellement === 'oui' ? ' (a dit oui — facture 70€ TTC possible)'
          : m.cotisationRenouvellement === 'non' ? ' (a dit non)' : ' (pas encore répondu)';
        return `${escapeHtml(m.nomMaitre)}${enRetard ? ' — échue' : ''}${reponse}`;
      }).join('<br>')}
    </div>`;
  }
  if (concernesSansDate.length > 0) {
    html += `
    <div class="banner-alert" style="background:#FFF7E6; border-color:#F0D9A0;">
      ⚠️ Cotisation marquée "à jour" mais sans date d'échéance renseignée (impossible de la relancer plus tard tant que la date n'est pas complétée) :<br>
      ${concernesSansDate.map(m => escapeHtml(m.nomMaitre)).join('<br>')}
    </div>`;
  }
  zone.innerHTML = html;
}

// ==========================================================================
// ABONNEMENTS — rappel quand il reste peu de cours
// ==========================================================================
async function chargerAbonnementsARenouveler() {
  const zone = document.getElementById('abonnementsARenouveler');
  if (!zone) return;

  // Accès Cours requis, indépendamment d'un groupe hebdo précis déjà choisi ou non.
  const concernes = currentMembres.filter(m => (m.accesCours !== undefined ? m.accesCours : true) && (m.coursRestants ?? 0) <= 2);
  if (concernes.length === 0) { zone.innerHTML = ''; return; }

  const serviceAbonnement = currentServices.find(s => s.nom === 'Cours collectif') || {};
  const prixAbonnement = typeof serviceAbonnement.prix === 'number' ? serviceAbonnement.prix : 70;

  zone.innerHTML = `
    <div class="banner-alert">
      📚 Abonnement${concernes.length > 1 ? 's' : ''} bientôt épuisé${concernes.length > 1 ? 's' : ''} :<br>
      ${concernes.map(m => {
        const epuise = (m.coursRestants ?? 0) <= 0;
        const reponse = m.abonnementRenouvellement === 'oui' ? ` (a dit oui — facture ${prixAbonnement.toFixed(2)}€ TTC pour 11 cours possible)`
          : m.abonnementRenouvellement === 'non' ? ' (a dit non)' : ' (pas encore répondu)';
        return `${escapeHtml(m.nomMaitre)} — ${m.coursRestants ?? 0} cours restant(s)${epuise ? ', épuisé' : ''}${reponse}`;
      }).join('<br>')}
    </div>`;
}


// ==========================================================================
// DÉTECTION DES NON-RÉPONSES — jusqu'ici, l'enregistrement "absent — non
// répondu" n'était créé QUE quand le membre lui-même ouvrait sa page (dans
// son propre navigateur). Un membre qui ne se connecte jamais n'avait donc
// aucun enregistrement créé, et rien à décompter. Cette fonction fait la
// même détection côté admin (qui se connecte régulièrement, elle) pour les
// 60 derniers jours, sans dépendre de la visite du membre.
// ==========================================================================
// ==========================================================================
// RÉPARATION — corrige les décomptes déjà faits à tort sur des cours
// antérieurs à la date d'inscription du membre (bug du rattrapage 60 jours
// avant qu'il ne tienne compte de la date d'inscription). Rembourse le
// cours au membre puis supprime l'enregistrement erroné.
// ==========================================================================
async function corrigerAbsencesAvantInscription() {
  const presSnap = await getDocs(query(collection(db, 'presences'), where('statut', '==', 'absent-auto')));
  const aCorriger = [];
  presSnap.forEach(d => {
    const p = d.data();
    const membre = currentMembres.find(m => m.id === p.uid);
    if (!membre?.dateInscription?.toDate) return;
    const inscriptionISO = dateISOLocale(membre.dateInscription.toDate());
    if (p.dateISO < inscriptionISO) aCorriger.push({ id: d.id, ...p });
  });
  if (aCorriger.length === 0) return;

  for (const p of aCorriger) {
    if (p.compteAbonnement) {
      await updateDoc(doc(db, 'membres', p.uid), { coursRestants: increment(1) });
    }
    await deleteDoc(doc(db, 'presences', p.id));
  }
  renderMembres();
}

// Date de lancement réel du site — jamais de décompte automatique
// rétroactif avant cette date, même si un membre a une dateInscription
// antérieure (import fait avant l'ouverture réelle aux membres). Sans ce
// garde-fou, la génération rétroactive (60 jours en arrière) recréait sans
// fin de fausses absences pour des cours d'avant le lancement, y compris
// après leur suppression manuelle.
const DATE_LANCEMENT_SITE = '2026-09-04';

async function detecterAbsencesNonRepondues() {
  const presSnap = await getDocs(collection(db, 'presences'));
  const dejaReponduCles = new Set();
  presSnap.forEach(d => {
    const p = d.data();
    dejaReponduCles.add(`${p.groupeId}_${p.dateISO}_${p.uid}`);
  });

  const annulSnap = await getDocs(collection(db, 'annulations'));
  const annulesCles = new Set();
  annulSnap.forEach(d => annulesCles.add(d.id));

  const maintenant = new Date();
  const aCreer = [];

  for (let i = 0; i <= 60; i++) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const jour = JOURS[d.getDay()];
    const dateISO = dateISOLocale(d);
    if (dateISO < DATE_LANCEMENT_SITE) continue; // jamais avant le vrai lancement du site

    currentGroupes.filter(g => g.jour === jour).forEach(g => {
      if (annulesCles.has(`${g.id}_${dateISO}`)) return; // cours annulé, pas de décompte
      const heureCours = new Date(`${dateISO}T${g.heureDebut || '00:00'}:00`);
      const delaiDepasse = maintenant >= new Date(heureCours.getTime() - 24 * 60 * 60 * 1000);
      if (!delaiDepasse) return;

      currentMembres.filter(m => m.groupeId === g.id).forEach(m => {
        // On ne pénalise jamais un membre pour un cours qui a eu lieu
        // avant sa date d'inscription au club.
        if (m.dateInscription?.toDate && dateISO < dateISOLocale(m.dateInscription.toDate())) return;
        const cle = `${g.id}_${dateISO}_${m.id}`;
        if (!dejaReponduCles.has(cle)) {
          aCreer.push({ groupeId: g.id, uid: m.id, dateISO });
          dejaReponduCles.add(cle); // éviter les doublons si le même cours revient
        }
      });
    });
  }

  if (aCreer.length === 0) return;

  await Promise.all(aCreer.map(p =>
    setDoc(doc(db, 'presences', `${p.groupeId}_${p.dateISO}_${p.uid}`), {
      groupeId: p.groupeId, uid: p.uid, dateISO: p.dateISO, statut: 'absent-auto',
      repondu: new Date().toISOString(), compteAbonnement: false
    })
  ));
}

// ==========================================================================
// DÉCOMPTE DES COURS — traite les réponses "présent" et les absences
// automatiques (pas de réponse dans les 24h) : décompte le cours de
// l'abonnement, une seule fois par cours (via le champ compteAbonnement),
// jamais sous 0 (seul l'admin a le droit d'écriture sur coursRestants).
// L'ordre de traitement n'a pas d'importance : chaque présence n'est
// décomptée qu'une seule fois, indépendamment des autres.
// ==========================================================================
async function traiterAbsencesAutomatiques() {
  const presSnap = await getDocs(query(collection(db, 'presences'), where('statut', 'in', ['present', 'absent-auto'])));
  const aTraiter = [];
  presSnap.forEach(d => {
    const p = d.data();
    if (!p.compteAbonnement) aTraiter.push({ id: d.id, ...p });
  });
  if (aTraiter.length === 0) return;

  for (const p of aTraiter) {
    await updateDoc(doc(db, 'membres', p.uid), { coursRestants: increment(-1) }).catch(() => {});
    await updateDoc(doc(db, 'presences', p.id), { compteAbonnement: true });
  }
  renderMembres();
}

// ==========================================================================
// VACCINS — rappel des échéances (30 jours) ou retards, calculées à 1 an
// après la date de dernière vaccination indiquée.
// ==========================================================================
const LABELS_VACCINS = { leptospirose: 'Leptospirose', parvovirose: 'Parvovirose', touxChenils: 'Toux du chenil', rage: 'Rage' };

function calculerEcheancesVaccins(chien) {
  const v = chien.vaccins || {};
  const resultats = [];
  Object.keys(LABELS_VACCINS).forEach(cle => {
    const date = v[cle]?.date;
    if (!date) return;
    const echeance = new Date(date + 'T00:00:00');
    echeance.setFullYear(echeance.getFullYear() + 1);
    resultats.push({ vaccin: LABELS_VACCINS[cle], echeance });
  });
  return resultats;
}

async function chargerVaccinsARappeler() {
  const zone = document.getElementById('vaccinsARappeler');
  if (!zone) return;
  const aujourdhui = new Date(); aujourdhui.setHours(0,0,0,0);
  const dans30Jours = new Date(aujourdhui); dans30Jours.setDate(aujourdhui.getDate() + 30);

  const lignes = [];
  currentMembres.forEach(m => {
    (m.chiens || []).filter(c => !c.archive).forEach(c => {
      calculerEcheancesVaccins(c).forEach(({ vaccin, echeance }) => {
        if (echeance <= dans30Jours) {
          const enRetard = echeance < aujourdhui;
          lignes.push(`${escapeHtml(c.nom)} (${escapeHtml(m.nomMaitre)}) — ${vaccin}${enRetard ? ' en retard' : ' à renouveler bientôt'}`);
        }
      });
    });
  });

  if (lignes.length === 0) { zone.innerHTML = ''; return; }
  zone.innerHTML = `<div class="banner-alert">💉 Vaccins à surveiller :<br>${lignes.join('<br>')}</div>`;
}

// ==========================================================================
// BOUTIQUE — articles, stock, commandes (validation = décompte du stock)
// ==========================================================================
const ARTICLES_DE_BASE = [
  { nom: 'Laisse en cuir', prix: 0, stock: 0, actif: true },
  { nom: 'Collier en cuir', prix: 0, stock: 0, actif: true },
  { nom: 'Collier Torquatus', prix: 0, stock: 0, actif: true },
  { nom: 'Bonbon dressage BBQ', prix: 0, stock: 0, actif: true },
  { nom: 'Grosse boîte de bonbons os', prix: 0, stock: 0, actif: true }
];

let currentArticlesBoutique = [];

async function chargerBoutiqueAdmin() {
  const snap = await getDocs(collection(db, 'articles_boutique'));
  currentArticlesBoutique = [];
  snap.forEach(d => currentArticlesBoutique.push({ id: d.id, ...d.data() }));
  currentArticlesBoutique.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  renderArticlesBoutiqueAdmin();
  await chargerCommandesAdmin();
}

function renderArticlesBoutiqueAdmin() {
  const wrap = document.getElementById('listeArticlesBoutique');
  if (currentArticlesBoutique.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun article pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = currentArticlesBoutique.map(a => `
    <div class="data-row">
      <div class="data-row-left">
        ${a.photoURL ? `<img class="data-thumb" src="${escapeAttr(a.photoURL)}">` : ''}
        <div class="data-main">
          <div class="data-title">${escapeHtml(a.nom)} ${!a.actif ? '<span class="badge badge-neutral">Masqué</span>' : ''}</div>
          <div class="data-sub">${Number(a.prix).toFixed(2)} € TTC · <span class="${a.stock <= 0 ? 'badge badge-danger' : 'badge badge-ok'}">${a.stock} en stock</span></div>
          <div class="data-sub">${a.reference ? `Réf. ${escapeHtml(a.reference)}` : ''}${a.poids ? ` · ${formaterPoids(a.poids, a.poidsUnite)} ${a.poidsUnite || 'g'}` : ''}</div>
          ${a.infoDescription ? `<div class="data-sub" style="font-style:italic;">${texteAvecLiens(a.infoDescription.length > 100 ? a.infoDescription.slice(0, 100) + '…' : a.infoDescription)}</div>` : ''}
        </div>
      </div>
      <div class="data-actions">
        <button class="btn-sm" onclick="window.editerArticleBoutique('${a.id}')">Modifier</button>
        <button class="btn-sm danger" onclick="window.supprimerArticleBoutique('${a.id}')">Supprimer</button>
      </div>
    </div>`).join('');
}

document.getElementById('btnAjouterArticleBoutique').addEventListener('click', () => ouvrirModalArticleBoutique());
document.getElementById('rechercheCommande').addEventListener('input', () => chargerCommandesAdmin());

window.editerArticleBoutique = (id) => {
  const a = currentArticlesBoutique.find(x => x.id === id);
  ouvrirModalArticleBoutique(a);
};

window.supprimerArticleBoutique = async (id) => {
  if (!confirm('Supprimer cet article ?')) return;
  await deleteDoc(doc(db, 'articles_boutique', id));
  chargerBoutiqueAdmin();
};

function ouvrirModalArticleBoutique(article) {
  const isEdit = !!article;
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>${isEdit ? 'Modifier l\'article' : 'Ajouter un article'}</h3>
        <div class="field"><label>Nom</label><input id="ab-nom" value="${isEdit ? escapeAttr(article.nom) : ''}"></div>
        <div class="field"><label>Photo (URL d'un fichier .jpg/.png, optionnel)</label><input id="ab-photoURL" value="${isEdit ? escapeAttr(article.photoURL||'') : ''}" placeholder="https://exemple.be/photo.jpg"></div>
        <div class="form-grid">
          <div class="field"><label>Référence article</label><input id="ab-reference" value="${isEdit ? escapeAttr(article.reference||'') : ''}" placeholder="ex: LAI-CUIR-01"></div>
          <div class="field"><label>Poids</label>
            <div style="display:flex; gap:6px;">
              <input type="number" step="0.01" id="ab-poids" value="${isEdit ? (article.poids ?? '') : ''}" placeholder="ex: 250" style="flex:1;">
              <select id="ab-poidsUnite" style="flex:none; width:75px;">
                <option value="g" ${!isEdit || article.poidsUnite !== 'kg' ? 'selected' : ''}>g</option>
                <option value="kg" ${isEdit && article.poidsUnite === 'kg' ? 'selected' : ''}>kg</option>
              </select>
            </div>
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Prix TTC (€)</label><input type="number" step="0.01" id="ab-prix" value="${isEdit ? article.prix : ''}"></div>
          <div class="field"><label>Stock</label><input type="number" id="ab-stock" value="${isEdit ? article.stock : 0}"></div>
        </div>
        <div class="field"><label>Info / description (visible par les membres dans la boutique)</label><textarea id="ab-info" rows="3" spellcheck="true" lang="fr" style="resize:vertical;" placeholder="ex: composition, taille, conseils d'utilisation...">${isEdit ? escapeHtml(article.infoDescription||'') : ''}</textarea></div>
        <div class="field"><label>Visible dans la boutique</label>
          <select id="ab-actif">
            <option value="oui" ${!isEdit || article.actif ? 'selected' : ''}>Oui</option>
            <option value="non" ${isEdit && !article.actif ? 'selected' : ''}>Non</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="ab-save">Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('ab-save').addEventListener('click', async () => {
    const btnSave = document.getElementById('ab-save');
    btnSave.disabled = true;
    const nom = document.getElementById('ab-nom').value.trim();
    const prix = parseFloat(document.getElementById('ab-prix').value);
    const stock = parseInt(document.getElementById('ab-stock').value, 10);
    if (!nom || isNaN(prix) || isNaN(stock)) { alert('Merci de remplir nom, prix et stock.'); btnSave.disabled = false; return; }
    const data = {
      nom, prix, stock,
      photoURL: document.getElementById('ab-photoURL').value.trim(),
      reference: document.getElementById('ab-reference').value.trim(),
      infoDescription: document.getElementById('ab-info').value.trim(),
      poids: document.getElementById('ab-poids').value ? parseFloat(document.getElementById('ab-poids').value) : null,
      poidsUnite: document.getElementById('ab-poidsUnite').value,
      actif: document.getElementById('ab-actif').value === 'oui'
    };
    if (isEdit) {
      await updateDoc(doc(db, 'articles_boutique', article.id), data);
    } else {
      await addDoc(collection(db, 'articles_boutique'), data);
    }
    window.fermerModal();
    chargerBoutiqueAdmin();
  });
}

document.getElementById('btnInitArticles').addEventListener('click', async () => {
  if (currentArticlesBoutique.length > 0 && !confirm('Ajouter les articles de base en plus des existants (prix et stock à 0, à compléter) ?')) return;
  try {
    for (const a of ARTICLES_DE_BASE) {
      await addDoc(collection(db, 'articles_boutique'), a);
    }
    chargerBoutiqueAdmin();
  } catch (err) {
    alert('Erreur lors de la création des articles : ' + (err.code || '') + ' — ' + (err.message || err));
  }
});

async function chargerCommandesAdmin() {
  const snap = await getDocs(collection(db, 'commandes'));
  const commandes = [];
  snap.forEach(d => commandes.push({ id: d.id, ...d.data() }));
  commandes.sort((a, b) => (b.dateCreation?.toMillis?.() || 0) - (a.dateCreation?.toMillis?.() || 0));

  const enAttente = commandes.filter(c => c.statut === 'en_attente').length;
  const precSnap = await getDocs(collection(db, 'precommandes'));
  let precommandesNonVues = 0;
  precSnap.forEach(d => { if (d.data().vu === false) precommandesNonVues++; });
  const tabBtn = document.getElementById('tabBoutiqueBtn');
  if (tabBtn) tabBtn.classList.toggle('has-unread', enAttente > 0 || precommandesNonVues > 0);

  const wrap = document.getElementById('listeCommandes');
  if (commandes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune commande pour l\'instant.</div>';
    return;
  }

  const terme = (document.getElementById('rechercheCommande')?.value || '').trim().toLowerCase();
  const commandesAffichees = !terme ? commandes : commandes.filter(c => {
    const membre = currentMembres.find(m => m.id === c.membreId);
    return membre && ((membre.nomMaitre || '').toLowerCase().includes(terme) || nomsChiensActifs(membre).toLowerCase().includes(terme));
  });
  if (commandesAffichees.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune commande ne correspond à cette recherche.</div>';
    return;
  }

  wrap.innerHTML = commandesAffichees.map(c => {
    const membre = currentMembres.find(m => m.id === c.membreId);
    const detailLignes = (c.lignes || []).map(l => `${l.quantite} × ${escapeHtml(l.nom)}`).join(', ');
    const badgeStatut = c.statut === 'validee' ? '<span class="badge badge-ok">Validée</span>'
      : c.statut === 'annulee' ? '<span class="badge badge-danger">Annulée</span>'
      : '<span class="badge badge-warn">En attente</span>';
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(membre?.nomMaitre || '?')}${membre && nomsChiensActifs(membre) ? ' — ' + escapeHtml(nomsChiensActifs(membre)) : ''} — ${Number(c.total).toFixed(2)} € TTC ${badgeStatut}</div>
        <div class="data-sub">${detailLignes}</div>
        ${c.numeroFacture ? `<div class="data-sub">Facture n° <strong>${escapeHtml(c.numeroFacture)}</strong></div>` : ''}
      </div>
      <div class="data-actions">
        ${c.statut === 'en_attente' ? `
          <button class="btn-sm primary" onclick="window.validerCommande('${c.id}')">Valider (décompte le stock)</button>
          <button class="btn-sm danger" onclick="window.annulerCommande('${c.id}')">Annuler</button>
        ` : ''}
        ${c.statut === 'validee' && !c.numeroFacture ? `<button class="btn-sm primary" onclick="window.facturerCommande('${c.id}')">Générer la facture</button>` : ''}
        ${c.numeroFacture ? `<button class="btn-sm" onclick="window.retelechargerFacture('${c.numeroFacture}')">Retélécharger PDF+XML</button> <button class="btn-sm" onclick="window.envoyerFactureParMail('${c.membreId}','${c.numeroFacture}')">Envoyer par mail</button>` : ''}
        <button class="btn-sm danger" onclick="window.supprimerCommande('${c.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

window.supprimerCommande = async (commandeId) => {
  if (!confirm('Supprimer définitivement cette commande ? Cette action ne peut pas être annulée (le stock ne sera pas modifié).')) return;
  await deleteDoc(doc(db, 'commandes', commandeId));
  chargerCommandesAdmin();
};

window.validerCommande = async (commandeId) => {
  const commande = (await getDoc(doc(db, 'commandes', commandeId))).data();
  for (const ligne of commande.lignes || []) {
    const article = currentArticlesBoutique.find(a => a.id === ligne.articleId);
    if (article) {
      const nouveauStock = Math.max(0, article.stock - ligne.quantite);
      await updateDoc(doc(db, 'articles_boutique', ligne.articleId), { stock: nouveauStock });
    }
  }
  await updateDoc(doc(db, 'commandes', commandeId), { statut: 'validee', dateValidation: serverTimestamp() });
  chargerBoutiqueAdmin();
};

window.annulerCommande = async (commandeId) => {
  if (!confirm('Annuler cette commande ? Le stock ne sera pas touché.')) return;
  await updateDoc(doc(db, 'commandes', commandeId), { statut: 'annulee' });
  chargerCommandesAdmin();
};

// ==========================================================================
// Filet de sécurité : si une zone reste bloquée sur "..." après un moment,
// c'est qu'un chargement a échoué silencieusement — on le dit clairement
// plutôt que de laisser croire que quelque chose va encore arriver.
// ==========================================================================
setTimeout(() => {
  document.querySelectorAll('.empty-state').forEach(el => {
    if (el.textContent.trim() === '...') {
      el.textContent = 'Page vide — une erreur a peut-être empêché le chargement. Recharge la page (Ctrl+F5).';
    }
  });
}, 7000);

// ==========================================================================
// FACTURATION — numérotation séquentielle, PDF légal, export UBL/XML
// (compatible import "factures électroniques" d'Octopus), historique.
//
// ⚠️ Ceci génère un document structuré correctement, mais je ne suis pas
// comptable ni juriste : avant le premier envoi réel à un client, fais
// vérifier un exemplaire par ta fiduciaire (numérotation, mentions TVA,
// et compatibilité de l'import UBL avec ton dossier Octopus).
// ==========================================================================

const ENTREPRISE = {
  nom: 'LES BEAUX CABOTS SRL',
  enseigne: 'Les Cabots de Fernelmont',
  adresse: 'Rue Grande 26',
  codePostal: '4219',
  ville: 'Wasseiges (Meeffe)',
  pays: 'Belgique',
  tva: 'BE0729593814',
  email: 'cabotsdefernelmont@gmail.com',
  tel: '0032 494 05 17 96',
  iban: 'BE58 7320 5129 6479',
  bic: 'CREGBEBB'
};
const TAUX_TVA = 21;
const TAUX_ACOMPTE_DOGSITTING = 0.30; // 30% d'acompte exigé pour le Dog Sitting

async function prochainNumeroFacture() {
  const refDoc = doc(db, 'parametres', 'facturation');
  const snap = await getDoc(refDoc);
  const annee = new Date().getFullYear();
  let compteur = 1;
  if (snap.exists() && snap.data().annee === annee) {
    compteur = (snap.data().dernierNumero || 0) + 1;
  }
  await setDoc(refDoc, { annee, dernierNumero: compteur });
  return `${annee}-${String(compteur).padStart(3, '0')}`;
}

async function prochainNumeroNC() {
  const refDoc = doc(db, 'parametres', 'notesCredit');
  const snap = await getDoc(refDoc);
  const annee = new Date().getFullYear();
  let compteur = 1;
  if (snap.exists() && snap.data().annee === annee) {
    compteur = (snap.data().dernierNumero || 0) + 1;
  }
  await setDoc(refDoc, { annee, dernierNumero: compteur });
  const anneeCourte = String(annee).slice(-2);
  return `NC${anneeCourte}-${String(compteur).padStart(3, '0')}`;
}

// lignes : [{ description, quantite, prixUnitaireTTC }]
async function genererFacture({ membre, lignes, type, refId }) {
  if (!membre) { alert('Membre introuvable.'); return; }
  const numero = await prochainNumeroFacture();
  const dateEmission = dateISOLocale(new Date());

  const lignesCalc = lignes.map(l => {
    const totalTTC = l.quantite * l.prixUnitaireTTC;
    const totalHT = totalTTC / (1 + TAUX_TVA / 100);
    return { ...l, totalTTC, totalHT };
  });
  const totalTTC = lignesCalc.reduce((s, l) => s + l.totalTTC, 0);
  const totalHT = lignesCalc.reduce((s, l) => s + l.totalHT, 0);
  const totalTVA = totalTTC - totalHT;

  await addDoc(collection(db, 'factures'), {
    numero, membreId: membre.id, type, refId,
    dateEmission, lignes: lignesCalc, totalHT, totalTVA, totalTTC,
    creeLe: serverTimestamp()
  });

  telechargerFacturePDF({ numero, dateEmission, membre, lignesCalc, totalHT, totalTVA, totalTTC });
  telechargerFactureUBL({ numero, dateEmission, membre, lignesCalc, totalHT, totalTVA, totalTTC });

  return numero;
}

// Retélécharge le PDF + XML d'une facture déjà émise (même numéro, aucune
// nouvelle écriture) — utile si le fichier a été perdu ou mal enregistré.
window.retelechargerFacture = async (numeroFacture) => {
  const snap = await getDocs(query(collection(db, 'factures'), where('numero', '==', numeroFacture)));
  if (snap.empty) { alert('Facture introuvable.'); return; }
  const facture = snap.docs[0].data();
  const membre = currentMembres.find(m => m.id === facture.membreId) || currentMembresArchives.find(m => m.id === facture.membreId);
  if (!membre) { alert('Membre introuvable (peut-être archivé sans fiche retrouvée).'); return; }
  telechargerFacturePDF({ numero: facture.numero, dateEmission: facture.dateEmission, membre, lignesCalc: facture.lignes, totalHT: facture.totalHT, totalTVA: facture.totalTVA, totalTTC: facture.totalTTC });
  telechargerFactureUBL({ numero: facture.numero, dateEmission: facture.dateEmission, membre, lignesCalc: facture.lignes, totalHT: facture.totalHT, totalTVA: facture.totalTVA, totalTTC: facture.totalTTC });
};

function telechargerFacturePDF({ numero, dateEmission, membre, lignesCalc, totalHT, totalTVA, totalTTC }) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let y = 20;

  pdf.setFontSize(16); pdf.setFont(undefined, 'bold');
  pdf.text(ENTREPRISE.nom, 15, y);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  y += 6; pdf.text(ENTREPRISE.enseigne, 15, y);
  y += 5; pdf.text(`${ENTREPRISE.adresse}, ${ENTREPRISE.codePostal} ${ENTREPRISE.ville}`, 15, y);
  y += 5; pdf.text(`TVA ${ENTREPRISE.tva}`, 15, y);
  y += 5; pdf.text(`${ENTREPRISE.email} — ${ENTREPRISE.tel}`, 15, y);

  pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
  pdf.text('FACTURE', 150, 20);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  pdf.text(`N° ${numero}`, 150, 27);
  pdf.text(`Date : ${new Date(dateEmission + 'T00:00:00').toLocaleDateString('fr-BE')}`, 150, 32);

  y = 55;
  pdf.setFont(undefined, 'bold'); pdf.text('Client', 15, y); pdf.setFont(undefined, 'normal');
  y += 6; pdf.text(membre.nomMaitre || '', 15, y);
  if (membre.adressePostale) { y += 5; pdf.text(membre.adressePostale, 15, y); }
  if (membre.email) { y += 5; pdf.text(membre.email, 15, y); }

  y += 12;
  pdf.setFillColor(27, 58, 92);
  pdf.rect(15, y, 180, 8, 'F');
  pdf.setTextColor(255, 255, 255); pdf.setFont(undefined, 'bold'); pdf.setFontSize(9);
  pdf.text('Description', 18, y + 5.5);
  pdf.text('Qté', 120, y + 5.5);
  pdf.text('PU TTC', 140, y + 5.5);
  pdf.text('Total TTC', 168, y + 5.5);
  pdf.setTextColor(0, 0, 0); pdf.setFont(undefined, 'normal');
  y += 8;

  lignesCalc.forEach(l => {
    y += 8;
    pdf.text(String(l.description).slice(0, 55), 18, y);
    pdf.text(String(l.quantite), 120, y);
    pdf.text(l.prixUnitaireTTC.toFixed(2) + ' €', 140, y);
    pdf.text(l.totalTTC.toFixed(2) + ' €', 168, y);
  });

  y += 14;
  pdf.line(120, y, 195, y);
  y += 6;
  pdf.text('Total HT :', 140, y); pdf.text(totalHT.toFixed(2) + ' €', 168, y);
  y += 6;
  pdf.text(`TVA ${TAUX_TVA}% :`, 140, y); pdf.text(totalTVA.toFixed(2) + ' €', 168, y);
  y += 6;
  pdf.setFont(undefined, 'bold');
  pdf.text('Total TTC :', 140, y); pdf.text(totalTTC.toFixed(2) + ' €', 168, y);
  pdf.setFont(undefined, 'normal');

  y += 14;
  pdf.setFontSize(9);
  pdf.text(`À payer sur le compte ${ENTREPRISE.iban} (BIC ${ENTREPRISE.bic}) — communication : ${numero}`, 15, y);

  y += 14;
  pdf.setFontSize(8); pdf.setTextColor(90, 100, 110);
  pdf.text('Facture soumise aux Conditions Générales de Vente disponibles sur le site du club.', 15, y);
  y += 5;
  pdf.text('En cas de retard de paiement, des intérêts de retard légaux sont applicables de plein droit.', 15, y);
  y += 10;
  pdf.text(`${ENTREPRISE.nom} — TVA ${ENTREPRISE.tva} — ${ENTREPRISE.adresse}, ${ENTREPRISE.codePostal} ${ENTREPRISE.ville}`, 15, y);

  pdf.save(`Facture_${numero}.pdf`);
}

function telechargerFactureUBL({ numero, dateEmission, membre, lignesCalc, totalHT, totalTVA, totalTTC }) {
  const ligneXml = lignesCalc.map((l, i) => `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${l.quantite}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${l.totalHT.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escaperXml(l.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${TAUX_TVA}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">${(l.prixUnitaireTTC / (1 + TAUX_TVA / 100)).toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${numero}</cbc:ID>
  <cbc:IssueDate>${dateEmission}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0208">${ENTREPRISE.tva}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${escaperXml(ENTREPRISE.nom)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escaperXml(ENTREPRISE.adresse)}</cbc:StreetName>
        <cbc:CityName>${escaperXml(ENTREPRISE.ville)}</cbc:CityName>
        <cbc:PostalZone>${ENTREPRISE.codePostal}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${ENTREPRISE.tva}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${escaperXml(membre.nomMaitre || '')}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escaperXml(membre.adressePostale || '')}</cbc:StreetName>
        <cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${membre.email ? `<cac:Contact><cbc:ElectronicMail>${escaperXml(membre.email)}</cbc:ElectronicMail></cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${totalTVA.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${totalHT.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${totalTVA.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${TAUX_TVA}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${totalHT.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${totalHT.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${totalTTC.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${totalTTC.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${ligneXml}
</Invoice>`;

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `Facture_${numero}_UBL.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

function escaperXml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}

function telechargerNoteCreditPDF({ numero, dateEmission, membre, factureOrigineNumero, lignesCalc, totalHT, totalTVA, totalTTC }) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let y = 20;

  pdf.setFontSize(16); pdf.setFont(undefined, 'bold');
  pdf.text(ENTREPRISE.nom, 15, y);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  y += 6; pdf.text(ENTREPRISE.enseigne, 15, y);
  y += 5; pdf.text(`${ENTREPRISE.adresse}, ${ENTREPRISE.codePostal} ${ENTREPRISE.ville}`, 15, y);
  y += 5; pdf.text(`TVA ${ENTREPRISE.tva}`, 15, y);
  y += 5; pdf.text(`${ENTREPRISE.email} — ${ENTREPRISE.tel}`, 15, y);

  pdf.setFontSize(14); pdf.setFont(undefined, 'bold'); pdf.setTextColor(140, 30, 30);
  pdf.text('NOTE DE CRÉDIT', 138, 20);
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  pdf.text(`N° ${numero}`, 150, 27);
  pdf.text(`Date : ${new Date(dateEmission + 'T00:00:00').toLocaleDateString('fr-BE')}`, 150, 32);
  pdf.text(`Annule la facture n° ${factureOrigineNumero}`, 150, 37);

  y = 58;
  pdf.setFont(undefined, 'bold'); pdf.text('Client', 15, y); pdf.setFont(undefined, 'normal');
  y += 6; pdf.text(membre?.nomMaitre || '', 15, y);
  if (membre?.adressePostale) { y += 5; pdf.text(membre.adressePostale, 15, y); }
  if (membre?.email) { y += 5; pdf.text(membre.email, 15, y); }

  y += 12;
  pdf.setFillColor(140, 30, 30);
  pdf.rect(15, y, 180, 8, 'F');
  pdf.setTextColor(255, 255, 255); pdf.setFont(undefined, 'bold'); pdf.setFontSize(9);
  pdf.text('Description', 18, y + 5.5);
  pdf.text('Qté', 120, y + 5.5);
  pdf.text('PU TTC', 140, y + 5.5);
  pdf.text('Total TTC', 168, y + 5.5);
  pdf.setTextColor(0, 0, 0); pdf.setFont(undefined, 'normal');
  y += 8;

  lignesCalc.forEach(l => {
    y += 8;
    pdf.text(String(l.description).slice(0, 55), 18, y);
    pdf.text(String(l.quantite), 120, y);
    pdf.text('-' + l.prixUnitaireTTC.toFixed(2) + ' €', 140, y);
    pdf.text('-' + l.totalTTC.toFixed(2) + ' €', 168, y);
  });

  y += 14;
  pdf.line(120, y, 195, y);
  y += 6;
  pdf.text('Total HT :', 140, y); pdf.text('-' + totalHT.toFixed(2) + ' €', 168, y);
  y += 6;
  pdf.text(`TVA ${TAUX_TVA}% :`, 140, y); pdf.text('-' + totalTVA.toFixed(2) + ' €', 168, y);
  y += 6;
  pdf.setFont(undefined, 'bold');
  pdf.text('Total TTC :', 140, y); pdf.text('-' + totalTTC.toFixed(2) + ' €', 168, y);
  pdf.setFont(undefined, 'normal');

  y += 20;
  pdf.setFontSize(8); pdf.setTextColor(90, 100, 110);
  pdf.text(`Cette note de crédit annule et remplace la facture n° ${factureOrigineNumero}.`, 15, y);
  y += 10;
  pdf.text(`${ENTREPRISE.nom} — TVA ${ENTREPRISE.tva} — ${ENTREPRISE.adresse}, ${ENTREPRISE.codePostal} ${ENTREPRISE.ville}`, 15, y);

  pdf.save(`NoteCredit_${numero}.pdf`);
}

window.annulerFactureAvecNoteCredit = async (numeroFacture) => {
  if (!confirm(`Annuler la facture ${numeroFacture} via une note de crédit ? Cette action génère un document officiel et ne peut pas être défaite.`)) return;
  try {
    const snap = await getDocs(query(collection(db, 'factures'), where('numero', '==', numeroFacture)));
    if (snap.empty) { alert('Facture introuvable.'); return; }
    const factureDoc = snap.docs[0];
    const facture = factureDoc.data();
    const membre = currentMembres.find(m => m.id === facture.membreId) || currentMembresArchives.find(m => m.id === facture.membreId);

    const numeroNC = await prochainNumeroNC();
    const dateEmission = dateISOLocale(new Date());

    await addDoc(collection(db, 'notes_credit'), {
      numero: numeroNC, factureOrigineNumero: numeroFacture, membreId: facture.membreId,
      dateEmission, lignes: facture.lignes, totalHT: facture.totalHT, totalTVA: facture.totalTVA, totalTTC: facture.totalTTC,
      creeLe: serverTimestamp()
    });
    await updateDoc(doc(db, 'factures', factureDoc.id), { statut: 'annulee', noteCreditNumero: numeroNC });

    telechargerNoteCreditPDF({ numero: numeroNC, dateEmission, membre, factureOrigineNumero: numeroFacture, lignesCalc: facture.lignes, totalHT: facture.totalHT, totalTVA: facture.totalTVA, totalTTC: facture.totalTTC });

    chargerComptaAdmin();
  } catch (err) {
    alert('Erreur : ' + (err.code || '') + ' — ' + (err.message || err));
  }
};

window.retelechargerNoteCredit = async (numeroNC) => {
  const snap = await getDocs(query(collection(db, 'notes_credit'), where('numero', '==', numeroNC)));
  if (snap.empty) { alert('Note de crédit introuvable.'); return; }
  const nc = snap.docs[0].data();
  const membre = currentMembres.find(m => m.id === nc.membreId) || currentMembresArchives.find(m => m.id === nc.membreId);
  telechargerNoteCreditPDF({ numero: nc.numero, dateEmission: nc.dateEmission, membre, factureOrigineNumero: nc.factureOrigineNumero, lignesCalc: nc.lignes, totalHT: nc.totalHT, totalTVA: nc.totalTVA, totalTTC: nc.totalTTC });
};

// ==========================================================================
// COMPTA — historique factures + notes de crédit, réglage numérotation
// ==========================================================================
async function chargerComptaAdmin() {
  const facturesSnap = await getDocs(collection(db, 'factures'));
  const factures = [];
  // IMPORTANT : le document facture a lui-même un champ "type" (ex: 'commande',
  // 'paiement' — la nature de l'achat facturé). On utilise donc "_docCompta"
  // pour ce marqueur interne (facture / note de crédit) afin de ne jamais
  // l'écraser avec ...d.data() — c'était le bug qui affichait certaines
  // factures comme "Note de crédit".
  facturesSnap.forEach(d => factures.push({ id: d.id, ...d.data(), _docCompta: 'facture' }));

  const ncSnap = await getDocs(collection(db, 'notes_credit'));
  const notesCredit = [];
  ncSnap.forEach(d => notesCredit.push({ id: d.id, ...d.data(), _docCompta: 'nc' }));

  let tous = [...factures, ...notesCredit];
  tous.sort((a, b) => (b.dateEmission || '').localeCompare(a.dateEmission || ''));

  const terme = (document.getElementById('rechercheCompta')?.value || '').trim().toLowerCase();
  if (terme) {
    tous = tous.filter(doc => {
      const membre = currentMembres.find(m => m.id === doc.membreId) || currentMembresArchives.find(m => m.id === doc.membreId);
      return (membre?.nomMaitre || '').toLowerCase().includes(terme) || doc.numero.toLowerCase().includes(terme);
    });
  }

  const wrap = document.getElementById('listeCompta');
  if (tous.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun document pour l\'instant.</div>';
    return;
  }

  wrap.innerHTML = tous.map(doc => {
    const membre = currentMembres.find(m => m.id === doc.membreId) || currentMembresArchives.find(m => m.id === doc.membreId);
    if (doc._docCompta === 'facture') {
      const badge = doc.statut === 'annulee' ? '<span class="badge badge-danger">Annulée</span>' : '<span class="badge badge-ok">Facture</span>';
      return `
      <div class="data-row">
        <div class="data-main">
          <div class="data-title">${escapeHtml(doc.numero)} — ${escapeHtml(membre?.nomMaitre || '?')} ${badge}</div>
          <div class="data-sub">${doc.dateEmission} · ${Number(doc.totalTTC).toFixed(2)} € TTC${doc.noteCreditNumero ? ` · annulée par ${escapeHtml(doc.noteCreditNumero)}` : ''}</div>
        </div>
        <div class="data-actions">
          <button class="btn-sm" onclick="window.retelechargerFacture('${doc.numero}')">PDF</button>
          ${doc.statut !== 'annulee' ? `<button class="btn-sm danger" onclick="window.annulerFactureAvecNoteCredit('${doc.numero}')">Annuler (note de crédit)</button>` : ''}
        </div>
      </div>`;
    } else {
      return `
      <div class="data-row">
        <div class="data-main">
          <div class="data-title">${escapeHtml(doc.numero)} — ${escapeHtml(membre?.nomMaitre || '?')} <span class="badge badge-danger">Note de crédit</span></div>
          <div class="data-sub">${doc.dateEmission} · -${Number(doc.totalTTC).toFixed(2)} € TTC · annule ${escapeHtml(doc.factureOrigineNumero)}</div>
        </div>
        <div class="data-actions">
          <button class="btn-sm" onclick="window.retelechargerNoteCredit('${doc.numero}')">PDF</button>
        </div>
      </div>`;
    }
  }).join('');
}

document.getElementById('rechercheCompta').addEventListener('input', () => chargerComptaAdmin());

async function chargerNumerotationCompta() {
  const anneeActuelle = new Date().getFullYear();
  const facDoc = await getDoc(doc(db, 'parametres', 'facturation'));
  document.getElementById('cpt-facture-annee').value = facDoc.exists() ? facDoc.data().annee : anneeActuelle;
  document.getElementById('cpt-facture-dernier').value = facDoc.exists() ? facDoc.data().dernierNumero : 0;

  const ncDoc = await getDoc(doc(db, 'parametres', 'notesCredit'));
  document.getElementById('cpt-nc-annee').value = ncDoc.exists() ? ncDoc.data().annee : anneeActuelle;
  document.getElementById('cpt-nc-dernier').value = ncDoc.exists() ? ncDoc.data().dernierNumero : 0;
}

document.getElementById('btnSauverNumFacture').addEventListener('click', async () => {
  const annee = parseInt(document.getElementById('cpt-facture-annee').value, 10);
  const dernierNumero = parseInt(document.getElementById('cpt-facture-dernier').value, 10) || 0;
  await setDoc(doc(db, 'parametres', 'facturation'), { annee, dernierNumero });
  alert(`Enregistré. La prochaine facture générée pour ${annee} sera numérotée ${annee}-${String(dernierNumero + 1).padStart(3, '0')}.`);
});

document.getElementById('btnSauverNumNC').addEventListener('click', async () => {
  const annee = parseInt(document.getElementById('cpt-nc-annee').value, 10);
  const dernierNumero = parseInt(document.getElementById('cpt-nc-dernier').value, 10) || 0;
  await setDoc(doc(db, 'parametres', 'notesCredit'), { annee, dernierNumero });
  const anneeCourte = String(annee).slice(-2);
  alert(`Enregistré. La prochaine note de crédit générée pour ${annee} sera numérotée NC${anneeCourte}-${String(dernierNumero + 1).padStart(3, '0')}.`);
});

window.envoyerFactureParMail = (membreId, numero) => {
  const membre = currentMembres.find(m => m.id === membreId);
  if (!membre?.email) { alert('Ce membre n\'a pas d\'adresse e-mail renseignée dans sa fiche.'); return; }
  const sujet = encodeURIComponent(`Facture ${numero} — Les Beaux Cabots`);
  const corps = encodeURIComponent(`Bonjour ${membre.nomMaitre},\n\nVeuillez trouver ci-joint votre facture n° ${numero}.\n\nMerci de joindre le PDF téléchargé juste avant à cet e-mail (le navigateur ne permet pas de le faire automatiquement).\n\nBien à vous,\nKatia — Les Beaux Cabots`);
  window.location.href = `mailto:${membre.email}?subject=${sujet}&body=${corps}`;
};

window.facturerCommande = async (commandeId) => {
  try {
    const commande = (await getDoc(doc(db, 'commandes', commandeId))).data();
    const membre = currentMembres.find(m => m.id === commande.membreId);
    const lignes = (commande.lignes || []).map(l => ({ description: l.nom, quantite: l.quantite, prixUnitaireTTC: l.prixUnitaire }));
    const numero = await genererFacture({ membre, lignes, type: 'commande', refId: commandeId });
    if (numero) {
      await updateDoc(doc(db, 'commandes', commandeId), { numeroFacture: numero });
      chargerCommandesAdmin();
      chargerComptaAdmin();
      chargerNumerotationCompta();
    }
  } catch (err) {
    alert('Erreur lors de la génération de la facture : ' + (err.message || err) + '\n\nVérifie que ton navigateur n\'a pas bloqué le téléchargement (souvent affiché en haut de la fenêtre).');
  }
};

window.facturerPaiement = async (paiementId) => {
  try {
    const paiement = (await getDoc(doc(db, 'paiements', paiementId))).data();
    const membre = currentMembres.find(m => m.id === paiement.membreId);
    const lignes = [{ description: `${paiement.type}${paiement.note ? ' — ' + paiement.note : ''}`, quantite: 1, prixUnitaireTTC: paiement.montant }];
    const numero = await genererFacture({ membre, lignes, type: 'paiement', refId: paiementId });
    if (numero) {
      await updateDoc(doc(db, 'paiements', paiementId), { numeroFacture: numero });
      chargerHistoriquePaiements(paiement.membreId);
      chargerComptaAdmin();
      chargerNumerotationCompta();
    }
  } catch (err) {
    alert('Erreur lors de la génération de la facture : ' + (err.message || err) + '\n\nVérifie que ton navigateur n\'a pas bloqué le téléchargement (souvent affiché en haut de la fenêtre).');
  }
};

// ==========================================================================
// DOG SITTING — calendrier + validation des demandes
// Règle : un seul chien en Dog Sitting à la fois. Si la période demandée
// chevauche une période déjà validée, la nouvelle demande reste "en attente"
// et Katia doit la valider explicitement (2e chien accepté volontairement).
// ==========================================================================
let currentDogSitting = [];

// Miroir minimal (dates + statut uniquement — jamais de nom de membre, de
// chien, de notes ou de motif) de chaque entrée Dog Sitting, dans une
// collection à part et largement lisible par les membres, pour que la
// vérification de chevauchement de dates reste possible côté membre SANS
// jamais exposer les données personnelles des autres membres (ni le motif
// des périodes bloquées par Katia elle-même).
async function syncDogSittingDates(id, dateDebut, dateFin, statut) {
  await setDoc(doc(db, 'dogsitting_dates', id), { dateDebut, dateFin, statut });
}
let dsMoisAffiche = new Date(); dsMoisAffiche.setDate(1);

async function chargerDogSittingAdmin() {
  const snap = await getDocs(collection(db, 'dogsitting'));
  currentDogSitting = [];
  snap.forEach(d => currentDogSitting.push({ id: d.id, ...d.data() }));
  currentDogSitting.sort((a, b) => (a.dateDebut || '').localeCompare(b.dateDebut || ''));

  const nonVues = currentDogSitting.filter(r => r.vuParAdmin === false).length;
  document.getElementById('tabDogSittingBtn')?.classList.toggle('has-unread', nonVues > 0);

  renderCalendrierDogSitting();
  renderListeDogSittingAdmin();
}

function joursOccupesDansLeMois(annee, mois) {
  // Renvoie une map jour(1-31) -> 'indispo' (blocage admin) | 'bloque' (acompte validé) |
  // 'validee' (approuvé, acompte pas encore validé) | 'attente'
  // Priorité d'affichage : attente > indispo > validee > bloque (pour ne jamais masquer un conflit).
  const map = {};
  currentDogSitting.forEach(r => {
    if (r.statut === 'refusee' || r.statut === 'annulee') return;
    const statutCase = r.isBlocage ? 'indispo' : r.statut === 'attente' ? 'attente' : (r.acompteValide ? 'bloque' : 'validee');
    const debut = new Date(r.dateDebut + 'T00:00:00');
    const fin = new Date(r.dateFin + 'T00:00:00');
    for (let d = new Date(debut); d <= fin; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === annee && d.getMonth() === mois) {
        const j = d.getDate();
        const ordre = { attente: 3, indispo: 2, validee: 1, bloque: 0 };
        if (!map[j] || ordre[statutCase] > ordre[map[j]]) map[j] = statutCase;
      }
    }
  });
  return map;
}

function renderCalendrierDogSitting() {
  const wrap = document.getElementById('dsCalendrier');
  const annee = dsMoisAffiche.getFullYear();
  const mois = dsMoisAffiche.getMonth();
  const occupes = joursOccupesDansLeMois(annee, mois);

  const premierJourSemaine = (new Date(annee, mois, 1).getDay() + 6) % 7; // lundi = 0
  const nbJours = new Date(annee, mois + 1, 0).getDate();
  const labelMois = dsMoisAffiche.toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });

  let cases = '';
  for (let i = 0; i < premierJourSemaine; i++) cases += '<div class="ds-case ds-vide"></div>';
  for (let j = 1; j <= nbJours; j++) {
    const statut = occupes[j];
    const classe = statut === 'attente' ? 'ds-attente' : statut === 'indispo' ? 'ds-indispo' : statut === 'bloque' ? 'ds-bloque' : statut === 'validee' ? 'ds-occupe' : '';
    const dateISO = `${annee}-${String(mois+1).padStart(2,'0')}-${String(j).padStart(2,'0')}`;
    cases += `<div class="ds-case ${classe}" ${classe ? `onclick="window.voirDogSittingJour('${dateISO}')"` : ''}>${j}</div>`;
  }

  wrap.innerHTML = `
    <div class="ds-calendrier-header">
      <button class="btn-sm" onclick="window.dsMoisPrecedent()">◀</button>
      <h3>${capitalize(labelMois)}</h3>
      <button class="btn-sm" onclick="window.dsMoisSuivant()">▶</button>
    </div>
    <div class="ds-grille">
      <div class="ds-jour-label">L</div><div class="ds-jour-label">M</div><div class="ds-jour-label">M</div>
      <div class="ds-jour-label">J</div><div class="ds-jour-label">V</div><div class="ds-jour-label">S</div><div class="ds-jour-label">D</div>
      ${cases}
    </div>
    <p style="font-size:0.78rem; color:var(--slate); margin-top:10px;">
      <span style="background:#DCEEE0; padding:2px 8px; border-radius:4px;">Bloqué (acompte validé)</span>
      &nbsp; <span style="background:#FFE58A; padding:2px 8px; border-radius:4px;">Validé, acompte en attente</span>
      &nbsp; <span style="background:#DADFE3; padding:2px 8px; border-radius:4px;">Indisponible (club)</span>
      &nbsp; <span style="background:#FBEAEA; padding:2px 8px; border-radius:4px;">En attente / conflit</span>
    </p>`;
}

window.dsMoisPrecedent = () => { dsMoisAffiche.setMonth(dsMoisAffiche.getMonth() - 1); renderCalendrierDogSitting(); };
window.dsMoisSuivant = () => { dsMoisAffiche.setMonth(dsMoisAffiche.getMonth() + 1); renderCalendrierDogSitting(); };

document.getElementById('btnBloquerPeriode').addEventListener('click', () => {
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>🚫 Bloquer une période</h3>
        <p style="color:var(--slate); font-size:0.85rem;">Ex : vacances de Katia, indisponibilité du club. Aucun membre ne pourra réserver le Dog Sitting sur cette période.</p>
        <div class="form-grid">
          <div class="field"><label>Du</label><input type="date" id="bl-dateDebut"></div>
          <div class="field"><label>Au</label><input type="date" id="bl-dateFin"></div>
        </div>
        <div class="field"><label>Motif (visible uniquement par toi)</label><input id="bl-motif" placeholder="ex: Vacances de Katia"></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="bl-save">Bloquer cette période</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('bl-save').addEventListener('click', async () => {
    const dateDebut = document.getElementById('bl-dateDebut').value;
    const dateFin = document.getElementById('bl-dateFin').value;
    const motif = document.getElementById('bl-motif').value.trim() || 'Indisponible';
    if (!dateDebut || !dateFin) { alert('Merci de renseigner les deux dates.'); return; }
    if (dateFin < dateDebut) { alert('La date de fin doit être après la date de début.'); return; }
    const refBlocage = await addDoc(collection(db, 'dogsitting'), {
      membreId: null, chienNom: null, isBlocage: true, motifBlocage: motif,
      dateDebut, dateFin, heureArrivee: '', heureDepart: '',
      statut: 'validee', acompte: null, acompteValide: true,
      vuParAdmin: true, vuParMembre: true,
      dateCreation: serverTimestamp()
    });
    await syncDogSittingDates(refBlocage.id, dateDebut, dateFin, 'validee');
    window.fermerModal();
    chargerDogSittingAdmin();
  });
});

window.supprimerBlocage = async (id) => {
  if (!confirm('Supprimer ce blocage ? Les membres pourront à nouveau réserver sur cette période.')) return;
  await deleteDoc(doc(db, 'dogsitting', id));
  await deleteDoc(doc(db, 'dogsitting_dates', id)).catch(() => {});
  chargerDogSittingAdmin();
};

window.voirDogSittingJour = (dateISO) => {
  const concernes = currentDogSitting.filter(r => r.statut !== 'refusee' && r.statut !== 'annulee' && r.dateDebut <= dateISO && dateISO <= r.dateFin);
  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>${new Date(dateISO + 'T00:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
        <div class="data-list">
          ${concernes.map(r => {
            if (r.isBlocage) {
              return `<div class="data-row"><div class="data-main">
                <div class="data-title">🚫 ${escapeHtml(r.motifBlocage || 'Indisponible')}</div>
                <div class="data-sub">${r.dateDebut} → ${r.dateFin} — <span class="badge badge-neutral">Blocage club</span></div>
              </div></div>`;
            }
            const m = currentMembres.find(mm => mm.id === r.membreId);
            return `<div class="data-row"><div class="data-main">
              <div class="data-title">${escapeHtml(r.chienNom)} (${escapeHtml(m?.nomMaitre || '?')})</div>
              <div class="data-sub">${r.dateDebut} ${r.heureArrivee || ''} → ${r.dateFin} ${r.heureDepart || ''} — ${r.statut === 'attente' ? '<span class="badge badge-warn">En attente</span>' : '<span class="badge badge-ok">Validé</span>'}</div>
            </div></div>`;
          }).join('')}
        </div>
        <div class="modal-actions"><button class="btn-sm" onclick="window.fermerModal()">Fermer</button></div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
};

function renderListeDogSittingAdmin() {
  const wrap = document.getElementById('listeDogSitting');
  if (currentDogSitting.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune demande pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = currentDogSitting.map(r => {
    if (r.isBlocage) {
      return `
      <div class="data-row">
        <div class="data-main">
          <div class="data-title">🚫 ${escapeHtml(r.motifBlocage || 'Indisponible')} <span class="badge badge-neutral">Blocage club</span></div>
          <div class="data-sub">Du ${r.dateDebut} au ${r.dateFin}</div>
        </div>
        <div class="data-actions">
          <button class="btn-sm danger" onclick="window.supprimerBlocage('${r.id}')">Supprimer le blocage</button>
        </div>
      </div>`;
    }

    const m = currentMembres.find(mm => mm.id === r.membreId);
    const badge = r.statut === 'validee' ? '<span class="badge badge-ok">Validé</span>'
      : r.statut === 'refusee' ? '<span class="badge badge-danger">Refusé</span>'
      : r.statut === 'annulee' ? '<span class="badge badge-danger">Annulé</span>'
      : '<span class="badge badge-warn">En attente de validation</span>';

    let infoAcompte = '';
    if (r.statut === 'validee' && r.acompte) {
      if (r.acompteValide) {
        infoAcompte = `<div class="data-sub"><span class="badge badge-ok">✅ Acompte validé — date bloquée</span></div>`;
      } else {
        infoAcompte = `<div class="data-sub">Acompte attendu : <strong>${r.acompte.toFixed(2)} €</strong> (30% de ${r.total.toFixed(2)} €) ${r.acomptePaye ? '<span class="badge badge-warn">Membre indique avoir payé</span>' : '<span class="badge badge-neutral">Le membre n\'a pas encore signalé avoir payé l\'acompte</span>'}</div>`;
      }
    }
    if (r.statut === 'annulee' && r.motifAnnulation) {
      infoAcompte += `<div class="data-sub">Motif d'annulation : <em>${escapeHtml(r.motifAnnulation)}</em></div>`;
    }

    const apporteLabels = { carnet: 'carnet de santé', couche: 'couche/panier', gamelle: 'gamelle', nourriture: 'nourriture' };
    const apporteListe = r.apporte ? Object.keys(apporteLabels).filter(k => r.apporte[k]).map(k => apporteLabels[k]).join(', ') : '';
    const servicesListe = r.servicesDemandes ? [
      r.servicesDemandes.domicile ? 'prise/remise à domicile' : null,
      r.servicesDemandes.balades ? 'balades' : null,
      r.servicesDemandes.reeducation ? 'rééducation' : null,
      r.servicesDemandes.toilettage || null
    ].filter(Boolean).join(', ') : '';

    let detailFiche = '';
    if (apporteListe || servicesListe || r.habitudesDeVie) {
      detailFiche = `<div class="data-sub">
        ${apporteListe ? `Apporte : ${escapeHtml(apporteListe)}<br>` : ''}
        ${servicesListe ? `Services en plus : ${escapeHtml(servicesListe)}<br>` : ''}
        ${r.habitudesDeVie ? `Habitudes de vie : <em>${escapeHtml(r.habitudesDeVie)}</em>` : ''}
      </div>`;
    }

    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(m?.nomMaitre || '?')} — ${escapeHtml(r.chienNom)} ${badge}</div>
        <div class="data-sub">Du ${r.dateDebut} ${r.heureArrivee || ''} au ${r.dateFin} ${r.heureDepart || ''}</div>
        ${infoAcompte}
        ${detailFiche}
      </div>
      <div class="data-actions">
        ${r.statut === 'attente' ? `
          <button class="btn-sm primary" onclick="window.validerDogSitting('${r.id}')">Valider</button>
          <button class="btn-sm danger" onclick="window.refuserDogSitting('${r.id}')">Refuser</button>
        ` : ''}
        ${r.statut === 'validee' && r.acompte && !r.acompteValide ? `<button class="btn-sm primary" onclick="window.validerAcompteDogSitting('${r.id}')">Valider l'acompte (bloque la date)</button>` : ''}
        ${r.statut === 'validee' ? `<button class="btn-sm danger" onclick="window.annulerReservationDogSitting('${r.id}')">Annuler cette réservation</button>` : ''}
        <button class="btn-sm danger" onclick="window.supprimerDogSitting('${r.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

window.validerDogSitting = async (id) => {
  await updateDoc(doc(db, 'dogsitting', id), { statut: 'validee', vuParMembre: false });
  const r = currentDogSitting.find(x => x.id === id);
  if (r) await syncDogSittingDates(id, r.dateDebut, r.dateFin, 'validee');
  chargerDogSittingAdmin();
};
window.validerAcompteDogSitting = async (id) => {
  await updateDoc(doc(db, 'dogsitting', id), { acompteValide: true, vuParMembre: false });
  chargerDogSittingAdmin();
};
window.refuserDogSitting = async (id) => {
  await updateDoc(doc(db, 'dogsitting', id), { statut: 'refusee', vuParMembre: false });
  const r = currentDogSitting.find(x => x.id === id);
  if (r) await syncDogSittingDates(id, r.dateDebut, r.dateFin, 'refusee');
  chargerDogSittingAdmin();
};
window.annulerReservationDogSitting = (id) => {
  const html = `
    <div class="modal-overlay" id="modalOverlayAnnulDS">
      <div class="modal-box">
        <h3>Annuler cette réservation</h3>
        <p style="color:var(--slate); font-size:0.85rem;">La date sera libérée sur le calendrier et le membre en sera informé.</p>
        <div class="field"><label>Motif de l'annulation</label><textarea id="ds-motif-annul" rows="3" style="width:100%; box-sizing:border-box; resize:vertical;" placeholder="ex: Katia indisponible finalement sur cette période"></textarea></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="document.getElementById('modalOverlayAnnulDS').remove()">Retour</button>
          <button class="btn-sm danger" id="ds-motif-annul-save">Confirmer l'annulation</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('ds-motif-annul-save').addEventListener('click', async () => {
    const motif = document.getElementById('ds-motif-annul').value.trim();
    if (!motif) { alert('Merci d\'indiquer un motif.'); return; }
    await updateDoc(doc(db, 'dogsitting', id), { statut: 'annulee', motifAnnulation: motif, vuParMembre: false });
    const r = currentDogSitting.find(x => x.id === id);
    if (r) await syncDogSittingDates(id, r.dateDebut, r.dateFin, 'annulee');
    document.getElementById('modalOverlayAnnulDS').remove();
    chargerDogSittingAdmin();
  });
};

window.supprimerDogSitting = async (id) => {
  if (!confirm('Supprimer cette demande de Dog Sitting ?')) return;
  await deleteDoc(doc(db, 'dogsitting', id));
  await deleteDoc(doc(db, 'dogsitting_dates', id)).catch(() => {});
  chargerDogSittingAdmin();
};

window.marquerDogSittingVuAdmin = async () => {
  const nonVues = currentDogSitting.filter(r => r.vuParAdmin === false);
  if (nonVues.length === 0) return;
  await Promise.all(nonVues.map(r => updateDoc(doc(db, 'dogsitting', r.id), { vuParAdmin: true })));
  nonVues.forEach(r => r.vuParAdmin = true);
  document.getElementById('tabDogSittingBtn')?.classList.remove('has-unread');
};

// ==========================================================================
// COMMANDES GROUPÉES (précommandes) — ex: commande groupée de croquettes.
// Le membre précommande avant une date limite ; l'admin récupère le total
// par article pour passer une seule commande au fournisseur, plus le détail
// par membre pour facturer/répartir ensuite.
// ==========================================================================
let currentCampagnes = [];
let campagnesAvecNouvellesPrecommandes = new Set();

async function chargerCampagnesAdmin() {
  const snap = await getDocs(collection(db, 'campagnes'));
  currentCampagnes = [];
  snap.forEach(d => currentCampagnes.push({ id: d.id, ...d.data() }));
  currentCampagnes.sort((a, b) => (b.dateLimite || '').localeCompare(a.dateLimite || ''));

  const precSnap = await getDocs(collection(db, 'precommandes'));
  campagnesAvecNouvellesPrecommandes = new Set();
  precSnap.forEach(d => { if (d.data().vu === false) campagnesAvecNouvellesPrecommandes.add(d.data().campagneId); });

  renderCampagnesAdmin();
}

function renderCampagnesAdmin() {
  const wrap = document.getElementById('listeCampagnes');
  if (currentCampagnes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune commande groupée pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = currentCampagnes.map(c => {
    const dateLimiteLabel = c.dateLimite ? new Date(c.dateLimite + 'T00:00:00').toLocaleDateString('fr-BE') : '';
    const badge = c.statut === 'cloturee' ? '<span class="badge badge-neutral">Clôturée</span>' : '<span class="badge badge-ok">Ouverte</span>';
    const badgeNouveau = campagnesAvecNouvellesPrecommandes.has(c.id) ? ' <span class="badge badge-danger">Nouvelle(s) précommande(s)</span>' : '';
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(c.titre)} ${badge}${badgeNouveau}</div>
        <div class="data-sub">Date limite : ${dateLimiteLabel} · ${(c.articles||[]).length} article(s)</div>
      </div>
      <div class="data-actions">
        <button class="btn-sm" onclick="window.voirPrecommandes('${c.id}')">Voir les précommandes</button>
        <button class="btn-sm" onclick="window.ouvrirModalCampagne('${c.id}')">Modifier</button>
        ${c.statut !== 'cloturee'
          ? `<button class="btn-sm danger" onclick="window.cloturerCampagne('${c.id}')">Clôturer</button>`
          : `<button class="btn-sm" onclick="window.rouvrirCampagne('${c.id}')">Rouvrir</button>`}
        <button class="btn-sm danger" onclick="window.supprimerCampagne('${c.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('btnCreerCampagne').addEventListener('click', () => window.ouvrirModalCampagne(null));

window.ouvrirModalCampagne = (campagneId) => {
  const c = campagneId ? currentCampagnes.find(cc => cc.id === campagneId) : null;
  const isEdit = !!c;
  const articlesChoisisIds = new Set((c?.articles || []).map(a => a.articleId));

  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <h3>${isEdit ? 'Modifier la commande groupée' : 'Créer une commande groupée'}</h3>
        <div class="field"><label>Titre</label><input id="cp-titre" spellcheck="true" lang="fr" placeholder="ex: Commande croquettes chien" value="${isEdit ? escapeAttr(c.titre) : ''}"></div>
        <p style="font-size:0.8rem; color:var(--slate); margin:-8px 0 10px;">La correction orthographique du navigateur est activée sur ce champ — un mot souligné en rouge propose un clic droit pour le corriger.</p>
        <div class="field"><label>Description (optionnel)</label><textarea id="cp-description" rows="2" spellcheck="true" lang="fr" style="resize:vertical;" placeholder="ex: Précisez la quantité souhaitée par sac.">${isEdit ? escapeHtml(c.description || '') : ''}</textarea></div>
        <div class="field"><label>Date limite pour commander</label><input type="date" id="cp-dateLimite" value="${isEdit ? (c.dateLimite || '') : ''}"></div>
        <div class="field"><label>Articles proposés</label>
          <div class="membre-check-list">
            ${currentArticlesBoutique.map(a => `
              <label class="membre-check-row">
                <input type="checkbox" class="cp-article-check" value="${a.id}" data-nom="${escapeAttr(a.nom)}" data-prix="${a.prix}" ${articlesChoisisIds.has(a.id) ? 'checked' : ''}>
                <span>${escapeHtml(a.nom)} — ${Number(a.prix).toFixed(2)} € TTC</span>
              </label>`).join('') || '<p style="padding:8px; color:var(--slate); font-size:0.85rem;">Crée d\'abord tes articles (ex: les sacs de nourriture) dans "Articles" ci-dessus.</p>'}
          </div>
        </div>
        ${isEdit ? '<p style="font-size:0.8rem; color:var(--slate);">Modifier la liste d\'articles ne touche pas aux précommandes déjà passées par les membres.</p>' : ''}
        <div class="modal-actions">
          <button class="btn-sm" onclick="window.fermerModal()">Annuler</button>
          <button class="btn-sm primary" id="cp-save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;

  document.getElementById('cp-save').addEventListener('click', async () => {
    const titre = document.getElementById('cp-titre').value.trim();
    const dateLimite = document.getElementById('cp-dateLimite').value;
    const description = document.getElementById('cp-description').value.trim();
    const articlesChoisis = [...document.querySelectorAll('.cp-article-check:checked')].map(ch => ({
      articleId: ch.value, nom: ch.dataset.nom, prix: parseFloat(ch.dataset.prix)
    }));
    if (!titre || !dateLimite || articlesChoisis.length === 0) {
      alert('Merci de remplir le titre, la date limite, et de choisir au moins un article.');
      return;
    }

    if (isEdit) {
      await updateDoc(doc(db, 'campagnes', c.id), { titre, description, dateLimite, articles: articlesChoisis });
      window.fermerModal();
      chargerCampagnesAdmin();
      return;
    }

    await addDoc(collection(db, 'campagnes'), {
      titre, description, dateLimite, articles: articlesChoisis, statut: 'ouverte',
      dateCreation: serverTimestamp()
    });
    window.fermerModal();
    chargerCampagnesAdmin();

    // Prépare un message prêt à envoyer à tous, que l'admin peut relire avant d'envoyer.
    const dateLimiteLabel = new Date(dateLimite + 'T00:00:00').toLocaleDateString('fr-BE');
    const listeArticles = articlesChoisis.map(a => `- ${a.nom} : ${a.prix.toFixed(2)} € TTC`).join('\n');
    const messageAuto = `📦 ${titre}\n\n${description ? description + '\n\n' : ''}Voici les articles disponibles :\n${listeArticles}\n\nVous pouvez précommander directement depuis votre espace membre, onglet "Boutique", jusqu'au ${dateLimiteLabel}.`;
    ouvrirModalMessageGroupe(messageAuto);
  });
};

window.cloturerCampagne = async (id) => {
  await updateDoc(doc(db, 'campagnes', id), { statut: 'cloturee' });
  chargerCampagnesAdmin();
};
window.rouvrirCampagne = async (id) => {
  await updateDoc(doc(db, 'campagnes', id), { statut: 'ouverte' });
  chargerCampagnesAdmin();
};
window.supprimerCampagne = async (id) => {
  if (!confirm('Supprimer cette commande groupée ? Les précommandes des membres seront aussi supprimées.')) return;
  const precSnap = await getDocs(query(collection(db, 'precommandes'), where('campagneId', '==', id)));
  await Promise.all(precSnap.docs.map(d => deleteDoc(d.ref)));
  await deleteDoc(doc(db, 'campagnes', id));
  chargerCampagnesAdmin();
};

window.voirPrecommandes = async (campagneId) => {
  const campagne = currentCampagnes.find(c => c.id === campagneId);
  const snap = await getDocs(query(collection(db, 'precommandes'), where('campagneId', '==', campagneId)));
  const precommandes = [];
  snap.forEach(d => precommandes.push({ id: d.id, ...d.data() }));

  // Marque les précommandes de cette campagne comme vues (fait disparaître
  // le point rouge sur l'onglet Boutique une fois consultées).
  const aMarquer = precommandes.filter(p => p.vu === false);
  if (aMarquer.length > 0) {
    await Promise.all(aMarquer.map(p => updateDoc(doc(db, 'precommandes', p.id), { vu: true })));
    chargerCampagnesAdmin();
    chargerCommandesAdmin();
  }

  // Total par article, pour la commande fournisseur
  const totauxParArticle = {};
  precommandes.forEach(p => {
    (p.lignes || []).forEach(l => {
      if (!totauxParArticle[l.nom]) totauxParArticle[l.nom] = 0;
      totauxParArticle[l.nom] += l.quantite;
    });
  });

  const detailMembres = [...precommandes].sort((a, b) => {
    const nomA = currentMembres.find(mm => mm.id === a.membreId)?.nomMaitre || '';
    const nomB = currentMembres.find(mm => mm.id === b.membreId)?.nomMaitre || '';
    return nomA.localeCompare(nomB, 'fr', { sensitivity: 'base' });
  }).map(p => {
    const m = currentMembres.find(mm => mm.id === p.membreId);
    const detail = (p.lignes || []).map(l => `${l.quantite} × ${l.nom}`).join(', ');
    return `<div class="data-row"><div class="data-main">
      <div class="data-title">${escapeHtml(m?.nomMaitre || '?')}</div>
      <div class="data-sub">${detail}</div>
    </div></div>`;
  }).join('') || '<div class="empty-state">Aucune précommande pour l\'instant.</div>';

  const totauxHtml = Object.keys(totauxParArticle).length
    ? Object.entries(totauxParArticle).map(([nom, qte]) => `<div class="data-row"><div class="data-main"><div class="data-title">${escapeHtml(nom)}</div></div><div class="data-actions"><span class="badge badge-ok">${qte} unité(s) au total</span></div></div>`).join('')
    : '<div class="empty-state">Rien à commander pour l\'instant.</div>';

  const html = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" style="max-width:560px;">
        <h3>${escapeHtml(campagne?.titre || '')}</h3>
        <h3 style="margin-top:14px;">Total à commander au fournisseur</h3>
        <div class="data-list">${totauxHtml}</div>
        ${Object.keys(totauxParArticle).length ? `<button class="btn-sm" id="btnPdfFournisseur" style="margin-top:10px;">📄 PDF pour le fournisseur (quantités uniquement)</button>` : ''}
        <h3 style="margin-top:18px;">Détail par membre</h3>
        <div class="data-list">${detailMembres}</div>
        <div class="modal-actions"><button class="btn-sm" onclick="window.fermerModal()">Fermer</button></div>
      </div>
    </div>`;
  document.getElementById('modalZone').innerHTML = html;
  document.getElementById('btnPdfFournisseur')?.addEventListener('click', () => {
    window.telechargerPdfFournisseur(campagne?.titre || '', totauxParArticle);
  });
};

// Récap fournisseur : quantité totale par article, regroupée (jamais une
// ligne par membre) — SANS prix, puisque le prix affiché aux membres est le
// prix de vente et non le prix d'achat chez le fournisseur (Arion).
window.telechargerPdfFournisseur = (titreCampagne, totauxParArticle) => {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let y = 20;

  pdf.setFontSize(16); pdf.setFont(undefined, 'bold');
  pdf.text(ENTREPRISE.nom, 15, y);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  y += 6; pdf.text(ENTREPRISE.enseigne, 15, y);
  y += 5; pdf.text(`${ENTREPRISE.email} — ${ENTREPRISE.tel}`, 15, y);

  y += 14;
  pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
  pdf.text('Commande fournisseur', 15, y);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  y += 7; pdf.text(titreCampagne || '', 15, y);
  y += 5; pdf.text(`Générée le ${new Date().toLocaleDateString('fr-BE')}`, 15, y);

  y += 12;
  pdf.setFillColor(27, 58, 92);
  pdf.rect(15, y, 180, 8, 'F');
  pdf.setTextColor(255, 255, 255); pdf.setFont(undefined, 'bold');
  pdf.text('Article', 18, y + 5.5);
  pdf.text('Quantité totale', 150, y + 5.5);
  pdf.setTextColor(0, 0, 0); pdf.setFont(undefined, 'normal');
  y += 8;

  Object.entries(totauxParArticle).forEach(([nom, qte], i) => {
    if (i % 2 === 1) { pdf.setFillColor(240, 240, 240); pdf.rect(15, y, 180, 8, 'F'); }
    pdf.text(String(nom), 18, y + 5.5);
    pdf.text(String(qte), 150, y + 5.5);
    y += 8;
  });

  pdf.save(`Commande-fournisseur-${(titreCampagne || 'campagne').replace(/[^a-z0-9]+/gi, '-')}.pdf`);
};

// ==========================================================================
// CONTENU DU SITE — permet à Katia de modifier les textes des pages
// publiques (Accueil, Le Club, Activités, Katia) sans toucher au code.
// Chaque champ a un identifiant unique (data-contenu-id dans le HTML) et un
// texte par défaut (celui d'origine) affiché tant qu'aucune modification
// n'a été enregistrée.
// ==========================================================================
const CHAMPS_CONTENU = [
  { page: 'Accueil', champs: [
    { id: 'accueil_eyebrow', label: 'Petit texte au-dessus du titre', defaut: "Centre d'éducation canine — Région d'Andenne" },
    { id: 'accueil_titre', label: 'Titre principal', defaut: 'Une relation de confiance entre vous et votre chien, construite pas à pas.' },
    { id: 'accueil_lead', label: 'Sous-titre', defaut: "Les Cabots de Fernelmont accompagnent maîtres et chiens avec des méthodes douces et respectueuses, autour de Katia, éducatrice canine depuis plus de 10 ans." },
    { id: 'accueil_section2_titre', label: 'Titre section "Le club en un coup d\'œil"', defaut: 'Un club à taille humaine, pensé pour progresser ensemble' },
    { id: 'accueil_section2_texte', label: 'Texte de cette section', defaut: "Chaque cours est pensé pour créer un vrai lien entre vous et votre chien — dans le respect de son rythme et du vôtre." },
    { id: 'accueil_cta_titre', label: 'Titre bandeau final', defaut: 'Envie de rejoindre le club ?' },
    { id: 'accueil_cta_texte', label: 'Texte bandeau final', defaut: 'Contactez-nous par téléphone ou par mail — nous répondons volontiers à toutes vos questions sur les cours et les inscriptions.' },
  ]},
  { page: 'Le Club', champs: [
    { id: 'club_lead', label: 'Sous-titre', defaut: 'Un club canin familial, où chaque duo maître-chien avance à son rythme.' },
    { id: 'club_philo_p1', label: 'Philosophie — 1er paragraphe', defaut: "Les Cabots de Fernelmont, c'est avant tout une approche douce et respectueuse du chien. Nous croyons qu'une bonne éducation canine se construit sur la confiance, la patience et la compréhension mutuelle — jamais sur la contrainte." },
    { id: 'club_philo_p2', label: 'Philosophie — 2e paragraphe', defaut: 'Nos cours se donnent à Andenne, en petits groupes, pour permettre à Katia de suivre chaque chien et chaque maître de façon personnalisée.' },
    { id: 'club_propose_texte', label: '"Ce que propose le club" — texte', defaut: "Au-delà des cours collectifs, le club propose également la vente d'accessoires, du toilettage et la garde de chiens à domicile pendant les vacances des maîtres." },
    { id: 'club_citation', label: 'Citation mise en avant', defaut: "Chaque chien avance à son rythme — notre rôle est de l'accompagner, pas de le forcer." },
  ]},
  { page: 'Activités', champs: [
    { id: 'activites_lead', label: 'Sous-titre', defaut: 'Cinq axes de travail pour progresser avec votre chien, à chaque étape de son développement.' },
    { id: 'activite1_titre', label: 'Activité 1 — titre', defaut: 'Obéissance' },
    { id: 'activite1_texte', label: 'Activité 1 — texte', defaut: 'Les bases essentielles pour un chien équilibré au quotidien : rappel, marche en laisse, positions et self-control, enseignés avec des méthodes douces.' },
    { id: 'activite2_titre', label: 'Activité 2 — titre', defaut: 'Socialisation' },
    { id: 'activite2_texte', label: 'Activité 2 — texte', defaut: "Des rencontres encadrées avec d'autres chiens et d'autres maîtres pour apprendre à votre compagnon à évoluer sereinement dans son environnement." },
    { id: 'activite3_titre', label: 'Activité 3 — titre', defaut: 'Agility' },
    { id: 'activite3_texte', label: 'Activité 3 — texte', defaut: 'Un parcours d\'obstacles ludique qui renforce la complicité entre le chien et son maître, tout en développant agilité et concentration.' },
    { id: 'activite4_titre', label: 'Activité 4 — titre', defaut: 'Confiance au chien' },
    { id: 'activite4_texte', label: 'Activité 4 — texte', defaut: "Un travail spécifique pour aider les chiens craintifs ou peu sûrs d'eux à gagner en assurance, à leur rythme et en douceur." },
    { id: 'activite5_titre', label: 'Activité 5 — titre', defaut: 'Rapport chien-maître' },
    { id: 'activite5_texte', label: 'Activité 5 — texte', defaut: 'Renforcer la communication et la complicité entre vous et votre chien, pour une relation basée sur la confiance mutuelle.' },
  ]},
  { page: 'Katia', champs: [
    { id: 'katia_lead', label: 'Sous-titre', defaut: 'Fondatrice et éducatrice canine du club Les Cabots de Fernelmont.' },
    { id: 'katia_bio_p1', label: 'Biographie — 1er paragraphe', defaut: "Depuis plus de 10 ans, Katia se consacre à l'éducation canine avec une conviction simple : chaque chien mérite d'être compris avant d'être corrigé. Fondatrice des Cabots de Fernelmont, elle a bâti le club autour de méthodes douces, respectueuses du rythme et de la sensibilité de chaque animal." },
    { id: 'katia_bio_p2', label: 'Biographie — 2e paragraphe', defaut: 'Elle accompagne aujourd\'hui de nombreux duos maîtres-chiens à Andenne, en cours collectifs comme en séances individuelles, et propose également toilettage, conseils sur les accessoires et garde de chiens à domicile.' },
    { id: 'katia_citation', label: 'Citation mise en avant', defaut: "Un chien qui comprend ce qu'on attend de lui est un chien qui a confiance." },
    { id: 'katia_complices_texte', label: '"Ses trois complices" — texte', defaut: "Katia partage aussi son quotidien avec ses propres chiens — Olga, Pistache et Cookie — qui l'accompagnent parfois lors des cours." },
  ]},
];

// Activités pouvant être masquées individuellement de la page publique
// (checkbox "visible/invisible", indépendante du texte). Doc Firestore
// contenu_site/activiteN_visible = { visible: bool } — absent = visible.
const ACTIVITES_VISIBILITE = [
  { n: 1, nom: 'Obéissance' },
  { n: 2, nom: 'Socialisation' },
  { n: 3, nom: 'Agility' },
  { n: 4, nom: 'Confiance au chien' },
  { n: 5, nom: 'Rapport chien-maître' },
];

async function chargerContenuAdmin() {
  const wrap = document.getElementById('zoneContenu');
  if (!wrap) return;
  const snap = await getDocs(collection(db, 'contenu_site'));
  const valeurs = {};
  const visibilites = {};
  snap.forEach(d => {
    valeurs[d.id] = d.data().texte;
    if (d.id.endsWith('_visible')) visibilites[d.id] = d.data().visible;
  });

  wrap.innerHTML = CHAMPS_CONTENU.map(section => `
    <h3 style="margin-top:20px;">${escapeHtml(section.page)}</h3>
    <button class="btn-sm" style="margin-bottom:10px;" onclick="window.reinitialiserContenu('${escapeAttr(section.page)}')">↺ Réinitialiser cette page aux textes par défaut</button>
    ${section.page === 'Activités' ? `
    <div style="background:var(--paper-warm); border-radius:6px; padding:10px 14px; margin-bottom:14px;">
      <p style="font-size:0.85rem; color:var(--slate); margin-bottom:8px;">Décoche une activité pour la masquer entièrement de la page publique "Activités" (le texte reste enregistré, juste caché) :</p>
      ${ACTIVITES_VISIBILITE.map(a => {
        const docId = `activite${a.n}_visible`;
        const visible = visibilites[docId] !== false;
        return `<label class="membre-check-row" style="display:inline-flex; width:auto; margin:0 10px 6px 0;"><input type="checkbox" ${visible ? 'checked' : ''} onchange="window.sauverVisibiliteActivite(${a.n}, this.checked)"><span>Activité ${a.n} — ${escapeHtml(a.nom)}</span></label>`;
      }).join('')}
    </div>` : ''}
    ${section.champs.map(c => `
      <div class="field" style="margin-bottom:14px;">
        <label>${escapeHtml(c.label)}</label>
        <textarea id="ct-${c.id}" rows="2" style="width:100%; box-sizing:border-box; resize:vertical;">${escapeHtml(valeurs[c.id] ?? c.defaut)}</textarea>
        <button class="btn-sm" style="margin-top:4px;" onclick="window.sauverContenu('${c.id}')">Enregistrer</button>
        <span id="ct-statut-${c.id}" style="font-size:0.8rem; color:var(--slate); margin-left:8px;"></span>
      </div>`).join('')}
  `).join('');
}

window.sauverVisibiliteActivite = async (n, visible) => {
  await setDoc(doc(db, 'contenu_site', `activite${n}_visible`), { visible });
};

window.reinitialiserContenu = async (page) => {
  if (!confirm(`Remettre tous les textes de la page "${page}" à leur version par défaut ?`)) return;
  const section = CHAMPS_CONTENU.find(s => s.page === page);
  if (!section) return;
  for (const c of section.champs) {
    await setDoc(doc(db, 'contenu_site', c.id), { texte: c.defaut });
  }
  if (page === 'Activités') {
    for (const a of ACTIVITES_VISIBILITE) {
      await setDoc(doc(db, 'contenu_site', `activite${a.n}_visible`), { visible: true });
    }
  }
  chargerContenuAdmin();
};

window.sauverContenu = async (champId) => {
  const texte = document.getElementById(`ct-${champId}`).value;
  const statutEl = document.getElementById(`ct-statut-${champId}`);
  statutEl.textContent = 'Enregistrement...';
  await setDoc(doc(db, 'contenu_site', champId), { texte });
  statutEl.textContent = 'Enregistré ✓';
  setTimeout(() => { statutEl.textContent = ''; }, 2500);
};

// ==========================================================================
// RÈGLEMENT D'ORDRE INTÉRIEUR (ROI) — texte modifiable par l'admin, à lire
// et approuver par chaque membre. Un vrai changement de version force tous
// les membres à réapprouver.
// ==========================================================================
const ROI_TEXTE_PAR_DEFAUT = `ARTICLE 1 – Cotisation annuelle
Toute personne désirant devenir membre devra s'acquitter de sa cotisation annuelle dès la fin de son cours d'accueil (gratuit). Cette cotisation annuelle est de 70€ (TVAC) et non remboursable.

ARTICLE 2 – Cours et/ou cartes d'abonnements
En plus de la cotisation, chaque maître/maîtresse devra s'acquitter du montant de son cours collectif selon le tarif en vigueur. Il y a la possibilité de prendre un abonnement (fortement recommandé) donnant droit à 10 séances de cours collectifs + 1 gratuite pour la somme de 70€ (TVAC).

Pour l'inscription d'un nouveau membre, lors du premier cours d'accueil, il vous sera demandé de venir avec les documents suivants :
- La « Fiche Signalétique » et la « Fiche de Renseignements » dûment complétées.
- Le présent règlement d'ordre intérieur signé et accepté.
- La présentation du carnet de santé du chien et/ou une copie pour le dossier d'adhésion.
- Une copie de votre échéance de police d'assurance Responsabilité Civile.

Le chien devra être muni d'un collier souple et d'une laisse de dressage assez longue et adaptée (de préférence en cuir).

ARTICLE 3 – Les cours
En cours individuel : au prix en vigueur, payable à la fin de la séance.
En cours collectif d'obéissance : chiots ou adultes selon un horaire à définir. Le membre qui arrive en retard pourrait se voir refuser l'accès au cours, dans un souci d'organisation.

ARTICLE 4 – Canal pour nous suivre
Le club communique via les canaux qu'il détermine (Facebook, e-mail, ou cet espace membre) pour toute notification concernant les cours (inscription, sondage, modification, annulation, déplacement...).

ARTICLE 5 – Suspension des cours
Les cours peuvent être suspendus : les jours fériés, en cas d'intempéries, durant les mois les plus rudes de l'hiver, lors des vacances annuelles ou de fin d'année, lors des activités annuelles du club, ou pour tout autre cas non prévu dans cette liste. Toute modification vous sera communiquée à l'avance.

ARTICLE 6 – Santé
Tous les chiens devront être en ordre de vaccins sous peine d'être refusés au travail. Tout chien ayant un problème de santé contagieux sera refusé au travail tant qu'il n'est pas guéri. Toute chienne en chaleur n'est pas autorisée à travailler. Tout chien pouvant être considéré comme dangereux doit être muselé et fera l'objet d'un travail individuel jusqu'à l'accord de l'éducatrice pour passer en cours collectif.

ARTICLE 7 – Responsabilité civile / Assurances
Chaque membre doit disposer d'une assurance responsabilité civile (familiale) couvrant les dégâts corporels ou matériels que pourrait causer son chien. Le club décline toute responsabilité en cas d'accident survenu par le fait du chien ou de son maître. Les chiens restent sous l'entière responsabilité de leur maître, qu'ils soient en laisse ou en liberté.

ARTICLE 8 – Interdictions
Il est strictement interdit de brutaliser un chien, sous peine d'exclusion sans remboursement. Il est également interdit de venir au cours muni d'un collier étrangleur, semi-étrangleur ou à pics, sauf accord explicite de l'éducatrice. Les GSM doivent rester en silencieux pendant toute la durée du cours.

ARTICLE 9 – Convivialité
Tout membre nuisant à la bonne entente du club par son comportement, son agressivité ou le non-respect des méthodes mises en place pourra être exclu du club sans remboursement de sa cotisation.

ARTICLE 9 BIS
En cas de changement d'avis en cours d'année, ou de non-acceptation d'une modification du présent règlement, aucun remboursement de la cotisation ne sera effectué.

ARTICLE 10 – Amendes
Les GSM doivent être éteints ou en silencieux pendant les cours. Le non-respect de cette règle peut entraîner le renvoi du cours.

ARTICLE 11 – Abonnement de cours
Le club propose un abonnement de 10 leçons + 1 gratuite pour 70€.

ARTICLE 12 – Modification du présent règlement
Ce règlement peut être modifié à tout moment pour l'adapter aux besoins du club et aux normes en vigueur. Toute modification substantielle vous sera à nouveau soumise pour accord.

Pour accord :
En cochant la case et en validant depuis mon espace membre, je déclare avoir lu et approuvé le présent règlement d'ordre intérieur.`;

async function chargerRoiAdmin() {
  const doc_ = await getDoc(doc(db, 'reglement', 'roi'));
  const version = doc_.exists() ? doc_.data().version : 1;
  const texte = doc_.exists() ? doc_.data().texte : ROI_TEXTE_PAR_DEFAUT;
  document.getElementById('roi-texte').value = texte;
  document.getElementById('roi-versionActuelle').textContent = version;

  const nonApprouves = currentMembres.filter(m => (m.reglementVersionApprouvee || 0) < version);
  const wrap = document.getElementById('listeRoiNonApprouve');
  if (nonApprouves.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Tous les membres ont approuvé la version actuelle. 🎉</div>';
  } else {
    wrap.innerHTML = nonApprouves.map(m => `
      <div class="data-row"><div class="data-main"><div class="data-title">${escapeHtml(m.nomMaitre)}</div></div></div>`).join('');
  }
}

document.getElementById('btnSauverRoiSansVersion').addEventListener('click', async () => {
  const statutEl = document.getElementById('roi-statut');
  statutEl.textContent = 'Enregistrement...';
  const doc_ = await getDoc(doc(db, 'reglement', 'roi'));
  const version = doc_.exists() ? doc_.data().version : 1;
  await setDoc(doc(db, 'reglement', 'roi'), {
    texte: document.getElementById('roi-texte').value, version, dateModification: serverTimestamp()
  });
  statutEl.textContent = 'Enregistré (version inchangée) ✓';
  chargerRoiAdmin();
});

document.getElementById('btnPublierNouvelleVersionRoi').addEventListener('click', async () => {
  if (!confirm('Publier une nouvelle version ? Tous les membres devront relire et réapprouver le règlement.')) return;
  const statutEl = document.getElementById('roi-statut');
  statutEl.textContent = 'Publication...';
  const doc_ = await getDoc(doc(db, 'reglement', 'roi'));
  const nouvelleVersion = (doc_.exists() ? doc_.data().version : 1) + 1;
  await setDoc(doc(db, 'reglement', 'roi'), {
    texte: document.getElementById('roi-texte').value, version: nouvelleVersion, dateModification: serverTimestamp()
  });
  statutEl.textContent = `Nouvelle version (${nouvelleVersion}) publiée — les membres devront réapprouver ✓`;
  chargerRoiAdmin();
});

// ==========================================================================
// FICHE DE RENSEIGNEMENTS — réponses anonymes agrégées (lecture seule,
// aucun lien possible avec un membre précis).
// ==========================================================================
async function chargerEnquetesAnonymesAdmin() {
  const wrap = document.getElementById('listeEnquetesAnonymes');
  if (!wrap) return;
  const snap = await getDocs(collection(db, 'enquetes_renseignements'));
  const reponses = [];
  snap.forEach(d => reponses.push(d.data()));

  if (reponses.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune réponse pour l\'instant.</div>';
    return;
  }

  wrap.innerHTML = reponses.map((r, i) => `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${r.identifiant ? `${escapeHtml(r.identifiant)}${r.chienNom ? ' — ' + escapeHtml(r.chienNom) : ''}` : `Réponse anonyme n°${i + 1}`}</div>
        <div class="data-sub">
          Âge : ${escapeHtml(r.age || '—')} · Race : ${escapeHtml(r.race || '—')} (${escapeHtml(r.sexe || '—')})<br>
          Élevage : ${escapeHtml(r.elevage || '—')} · Retrait à ${escapeHtml(String(r.ageRetrait || '—'))} semaines<br>
          Vu régulièrement chez l'éleveur : ${escapeHtml(r.vuRegulierement || '—')} · Choisi soi-même : ${escapeHtml(r.choisiSoiMeme || '—')}<br>
          ${r.criteres ? `Critères de choix : ${escapeHtml(r.criteres)}<br>` : ''}
          Premier chien : ${escapeHtml(r.premierChien || '—')}
          ${r.recherche ? `<br>Recherche longue : ${escapeHtml(r.recherche)}` : ''}
          ${r.pourquoiSexe ? `<br>Pourquoi ce sexe : ${escapeHtml(r.pourquoiSexe)}` : ''}
          ${r.enfants ? `<br>Enfants : ${escapeHtml(r.enfants)}` : ''}
          ${r.connaissanceRace ? `<br>Connaissance de la race : ${escapeHtml(r.connaissanceRace)}` : ''}
          ${r.raisonsChoix ? `<br>Raisons du choix : <em>${escapeHtml(r.raisonsChoix)}</em>` : ''}
          ${r.premieresSemaines ? `<br>Premières semaines : <em>${escapeHtml(r.premieresSemaines)}</em>` : ''}
        </div>
      </div>
    </div>`).join('');
}

// ==========================================================================
// GESTION DES MOTS DE PASSE
// ==========================================================================

// Admin change SON PROPRE mot de passe (nécessite de retaper l'actuel).
function ouvrirModalMonCompte(oblige) {
  const html = `
    <div class="modal-overlay" id="modalOverlay${oblige ? 'MdpOblige' : ''}">
      <div class="modal-box">
        <h3>🔒 ${oblige ? 'Changement de mot de passe requis' : 'Mon compte — changer mon mot de passe'}</h3>
        ${oblige ? `<p style="color:var(--ink);">Pour la sécurité de tous, le club impose de changer son mot de passe chaque trimestre (1er janvier, 1er avril, 1er juillet, 1er octobre). Merci de définir un nouveau mot de passe pour continuer.</p>
        <ol style="font-size:0.88rem; color:var(--slate); padding-left:20px; margin-bottom:14px;">
          <li>Entrez votre mot de passe actuel</li>
          <li>Choisissez un nouveau mot de passe (lettres/chiffres, min. 6 caractères)</li>
          <li>Confirmez-le puis cliquez sur "Changer mon mot de passe"</li>
        </ol>` : ''}
        <div class="field"><label>Mot de passe actuel</label><input type="password" id="cpt-mdpActuel"></div>
        <div class="field"><label>Nouveau mot de passe (min. 6 caractères)</label><input type="password" id="cpt-mdpNouveau"></div>
        <div class="field"><label>Confirmer le nouveau mot de passe</label><input type="password" id="cpt-mdpConfirme"></div>
        <div class="modal-actions">
          ${oblige ? '' : '<button class="btn-sm" onclick="window.fermerModal()">Annuler</button>'}
          <button class="btn-sm primary" id="cpt-mdp-save">Changer mon mot de passe</button>
        </div>
        <p id="cpt-mdp-statut" style="font-size:0.85rem; color:var(--slate); margin-top:8px;"></p>
      </div>
    </div>`;
  if (oblige) {
    document.body.insertAdjacentHTML('beforeend', html);
  } else {
    document.getElementById('modalZone').innerHTML = html;
  }

  document.getElementById('cpt-mdp-save').addEventListener('click', async () => {
    const statutEl = document.getElementById('cpt-mdp-statut');
    const actuel = document.getElementById('cpt-mdpActuel').value;
    const nouveau = document.getElementById('cpt-mdpNouveau').value;
    const confirme = document.getElementById('cpt-mdpConfirme').value;

    if (!actuel || !nouveau) { statutEl.textContent = 'Merci de remplir tous les champs.'; return; }
    if (nouveau.length < 6) { statutEl.textContent = 'Le nouveau mot de passe doit faire au moins 6 caractères.'; return; }
    if (!motDePasseValide(nouveau)) { statutEl.textContent = MESSAGE_MDP_INVALIDE; return; }
    if (nouveau !== confirme) { statutEl.textContent = 'La confirmation ne correspond pas.'; return; }

    statutEl.textContent = 'Changement en cours...';
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, actuel);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, nouveau);
      await updateDoc(doc(db, 'membres', auth.currentUser.uid), {
        motDePasseInitial: nouveau, dateDernierChangementMdp: new Date().toISOString()
      });
      statutEl.textContent = 'Mot de passe changé avec succès ✓';
      setTimeout(() => {
        if (oblige) { document.getElementById('modalOverlayMdpOblige').remove(); }
        else { window.fermerModal(); }
        chargerMotsDePasseAdmin();
      }, 1200);
    } catch (err) {
      statutEl.textContent = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential'
        ? 'Mot de passe actuel incorrect.'
        : 'Erreur : ' + err.message;
    }
  });
}

document.getElementById('btnMonCompte').addEventListener('click', () => ouvrirModalMonCompte(false));

// Trimestre en cours : le 1er janvier, avril, juillet et octobre. Si le
// mot de passe n'a jamais été changé depuis la dernière de ces dates,
// un changement est imposé à la connexion (voir plus bas dans
// onAuthStateChanged).
function dateLimiteMdpActuelle() {
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const bornes = [new Date(annee, 0, 1), new Date(annee, 3, 1), new Date(annee, 6, 1), new Date(annee, 9, 1)];
  let derniere = new Date(annee - 1, 9, 1);
  for (const b of bornes) { if (b <= maintenant) derniere = b; }
  return derniere;
}

// Admin change le mot de passe RÉEL d'un membre (pas juste le champ
// "référence") — utilise une session Firebase secondaire pour se connecter
// au compte du membre (avec son mot de passe actuel connu) sans déconnecter
// la session admin en cours.
window.changerMotDePasseMembre = (membreId, identifiant, motDePasseActuel) => {
  const html = `
    <div class="modal-overlay" id="modalOverlayMdpMembre">
      <div class="modal-box">
        <h3>Changer le mot de passe de ${escapeHtml(identifiant || 'ce membre')}</h3>
        ${!motDePasseActuel ? '<p style="color:#8A2E2E; font-size:0.85rem;">⚠️ Le mot de passe actuel de ce membre n\'est pas connu du système (champ vide) — le changement ne pourra pas fonctionner tant qu\'il n\'est pas renseigné dans le champ "Mot de passe (pour référence)" juste au-dessus, avec la vraie valeur actuelle.</p>' : ''}
        <div class="field"><label>Nouveau mot de passe (min. 6 caractères)</label><input type="password" id="mdpm-nouveau"></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="document.getElementById('modalOverlayMdpMembre').remove()">Annuler</button>
          <button class="btn-sm primary" id="mdpm-save" ${!motDePasseActuel ? 'disabled' : ''}>Changer le mot de passe</button>
        </div>
        <p id="mdpm-statut" style="font-size:0.85rem; color:var(--slate); margin-top:8px;"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('mdpm-save').addEventListener('click', async () => {
    const statutEl = document.getElementById('mdpm-statut');
    const nouveau = document.getElementById('mdpm-nouveau').value;
    if (!nouveau || nouveau.length < 6) { statutEl.textContent = 'Le nouveau mot de passe doit faire au moins 6 caractères.'; return; }
    if (!motDePasseValide(nouveau)) { statutEl.textContent = MESSAGE_MDP_INVALIDE; return; }

    statutEl.textContent = 'Changement en cours...';
    const email = identifiantVersEmail(identifiant);
    const secondaryApp = initializeApp(auth.app.options, 'mdp-membre-' + Date.now());
    const secondaryAuth = getAuthSecondary(secondaryApp);
    try {
      // Persistance en mémoire uniquement : cette session temporaire ne
      // touche jamais le stockage du navigateur, donc ne peut jamais
      // interférer avec ta propre session admin en cours.
      await setPersistence(secondaryAuth, inMemoryPersistence);
      await signInSecondary(secondaryAuth, email, motDePasseActuel);
      await updatePasswordSecondary(secondaryAuth.currentUser, nouveau);
      await updateDoc(doc(db, 'membres', membreId), { motDePasseInitial: nouveau, dateDernierChangementMdp: new Date().toISOString() });
      await signOutSecondary(secondaryAuth);
      await deleteApp(secondaryApp);
      statutEl.textContent = 'Mot de passe changé avec succès ✓';
      setTimeout(() => {
        document.getElementById('modalOverlayMdpMembre')?.remove();
        window.fermerModal();
        chargerMembres();
        chargerListeAdminsPourMdp();
      }, 1200);
    } catch (err) {
      console.error('Erreur changement mot de passe :', err);
      try { await deleteApp(secondaryApp); } catch (e2) { /* déjà supprimée ou jamais créée */ }
      statutEl.textContent = `Erreur (${err.code || 'inconnue'}) : ${err.message || err}. ` +
        (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
          ? 'Le mot de passe actuel enregistré ne correspond plus au vrai mot de passe du compte — recontacte la personne, mets à jour le champ "référence" avec la vraie valeur actuelle, puis réessaie.'
          : 'Regarde la console du navigateur (F12) pour le détail technique complet si besoin.');
    }
  });
};

// ==========================================================================
// MOTS DE PASSE — onglet exclusif au Super Admin (voir la détection à la
// connexion). Vue consolidée de tous les membres avec leur identifiant et
// leur vrai mot de passe de connexion actuel (toujours synchronisé, aucun
// self-service de mot de passe n'existe côté membre — la seule façon dont
// il change est via ce même panneau ou la création du compte).
// ==========================================================================
// ==========================================================================
// MAINTENANCE — migration ponctuelle : activer les 3 accès (Cours/Dog
// Sitting/Boutique) pour tous les membres déjà existants (chantier refonte
// membres). Écrase la valeur actuelle de accesCours/accesDogSitting/
// accesBoutique pour CHAQUE membre (role: 'membre'), y compris archivés —
// action volontaire à la demande du Super Admin, pas une simple réparation de
// champ manquant. Sans effet sur les nouveaux membres créés après coup
// (ceux-ci démarrent avec les 3 accès décochés par défaut).
// ==========================================================================
document.getElementById('btnMigrationAcces')?.addEventListener('click', async () => {
  if (!confirm("Donner l'accès Cours + Dog Sitting + Boutique à TOUS les membres existants (y compris archivés) ? Cette action écrase leurs accès actuels.")) return;
  const btn = document.getElementById('btnMigrationAcces');
  const zone = document.getElementById('migrationAccesResultat');
  btn.disabled = true;
  zone.textContent = 'Migration en cours...';
  try {
    const snap = await getDocs(query(collection(db, 'membres'), where('role', '==', 'membre')));
    let compte = 0;
    for (const d of snap.docs) {
      await updateDoc(doc(db, 'membres', d.id), { accesCours: true, accesDogSitting: true, accesBoutique: true });
      compte++;
    }
    zone.textContent = `Terminé : ${compte} membre(s) mis à jour avec les 3 accès activés.`;
    chargerMembres();
  } catch (err) {
    zone.textContent = 'Erreur pendant la migration : ' + err.message;
  }
  btn.disabled = false;
});

document.getElementById('btnNettoyerPresences')?.addEventListener('click', async () => {
  const dateLimite = document.getElementById('nettoyagePresencesDate').value;
  const zone = document.getElementById('nettoyagePresencesResultat');
  if (!dateLimite) { zone.textContent = 'Choisis une date.'; return; }
  if (!confirm(`Supprimer toutes les présences/absences enregistrées avant le ${new Date(dateLimite + 'T00:00:00').toLocaleDateString('fr-BE')} ? Les cours déjà décomptés seront recrédités automatiquement.`)) return;

  const btn = document.getElementById('btnNettoyerPresences');
  btn.disabled = true;
  zone.textContent = 'Synchronisation des décomptes en cours...';
  try {
    // Traite d'abord tout décompte automatique en attente, pour que
    // "compteAbonnement" reflète bien la réalité de CHAQUE présence avant
    // qu'on décide s'il faut la recréditer ou non (évite un recrédit
    // manqué si un décompte se produisait juste au même moment).
    await traiterAbsencesAutomatiques();

    zone.textContent = 'Nettoyage en cours...';
    const snap = await getDocs(query(collection(db, 'presences'), where('dateISO', '<', dateLimite)));
    let supprimees = 0;
    const aRecrediter = {};
    for (const d of snap.docs) {
      const p = d.data();
      if (p.compteAbonnement === true && p.uid) {
        aRecrediter[p.uid] = (aRecrediter[p.uid] || 0) + 1;
      }
      await deleteDoc(doc(db, 'presences', d.id));
      supprimees++;
    }
    // Incrément atomique Firestore par membre : jamais de valeur périmée,
    // même si plusieurs présences du même membre sont recréditées d'un coup.
    for (const uid of Object.keys(aRecrediter)) {
      await updateDoc(doc(db, 'membres', uid), { coursRestants: increment(aRecrediter[uid]) });
    }
    zone.textContent = `Terminé : ${supprimees} présence(s) supprimée(s), ${Object.keys(aRecrediter).length} membre(s) recrédité(s) d'un ou plusieurs cours.`;
    chargerMembres();
  } catch (err) {
    zone.textContent = 'Erreur pendant le nettoyage : ' + err.message;
  }
  btn.disabled = false;
});

let currentAdminsPourMdp = [];

async function chargerListeAdminsPourMdp() {
  const snap = await getDocs(query(collection(db, 'membres'), where('role', '==', 'admin')));
  currentAdminsPourMdp = [];
  snap.forEach(d => currentAdminsPourMdp.push({ id: d.id, ...d.data() }));
  chargerMotsDePasseAdmin();
}

function chargerMotsDePasseAdmin() {
  const wrap = document.getElementById('listeMotsDePasse');
  if (!wrap) return;

  const terme = (document.getElementById('rechercheMdp')?.value || '').trim().toLowerCase();
  let tous = [
    ...currentAdminsPourMdp.map(m => ({ ...m, estAdminCompte: true })),
    ...currentMembres.map(m => ({ ...m, estAdminCompte: false }))
  ].sort((a, b) => (a.nomMaitre || '').localeCompare(b.nomMaitre || '', 'fr'));

  if (terme) {
    tous = tous.filter(m =>
      (m.nomMaitre || '').toLowerCase().includes(terme) ||
      (m.identifiant || '').toLowerCase().includes(terme)
    );
  }

  if (tous.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun compte trouvé.</div>';
    return;
  }

  wrap.innerHTML = tous.map(m => {
    const derniereConnexionLabel = m.derniereConnexion
      ? new Date(m.derniereConnexion).toLocaleString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'jamais connecté(e)';
    const derniereActiviteLabel = m.derniereActivite
      ? new Date(m.derniereActivite).toLocaleString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'aucune activité connue';
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(m.nomMaitre || '?')} ${m.estAdminCompte ? '<span class="badge badge-ok">Admin</span>' : ''}</div>
        <div class="data-sub">Identifiant : <strong>${escapeHtml(m.identifiant || '—')}</strong>${m.motDePasseInitial ? ` · Mot de passe : <strong>${escapeHtml(m.motDePasseInitial)}</strong>` : ' · <span class="badge badge-neutral">mot de passe inconnu</span>'}</div>
        <div class="data-sub">Dernière connexion (avec mot de passe tapé) : ${derniereConnexionLabel}</div>
        <div class="data-sub">Dernière activité sur le site (session déjà ouverte incluse) : ${derniereActiviteLabel}</div>
      </div>
      <div class="data-actions">
        <button class="btn-sm" onclick="window.changerMotDePasseMembre('${m.id}', '${escapeAttr(m.identifiant)}', '${escapeAttr(m.motDePasseInitial||'')}')" ${!m.motDePasseInitial ? 'disabled title="Mot de passe actuel inconnu — impossible de le changer depuis ici tant qu\'il n\'est pas connu (voir Firebase Console pour un compte totalement perdu)."' : ''}>Changer</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('rechercheMdp')?.addEventListener('input', () => chargerMotsDePasseAdmin());

document.getElementById('btnExporterMdpExcel')?.addEventListener('click', () => {
  const terme = (document.getElementById('rechercheMdp')?.value || '').trim().toLowerCase();
  let tous = [
    ...currentAdminsPourMdp.map(m => ({ ...m, estAdminCompte: true })),
    ...currentMembres.map(m => ({ ...m, estAdminCompte: false }))
  ].sort((a, b) => (a.nomMaitre || '').localeCompare(b.nomMaitre || '', 'fr'));

  if (terme) {
    tous = tous.filter(m =>
      (m.nomMaitre || '').toLowerCase().includes(terme) ||
      (m.identifiant || '').toLowerCase().includes(terme)
    );
  }

  const lignes = tous.map(m => ({
    'Nom': m.nomMaitre || '',
    'Compte': m.estAdminCompte ? 'Admin' : 'Membre',
    'Identifiant': m.identifiant || '',
    'Mot de passe': m.motDePasseInitial || '(inconnu)',
    'E-mail': m.email || '',
    'GSM': m.gsm || '',
    'Dernière connexion': m.derniereConnexion ? new Date(m.derniereConnexion).toLocaleString('fr-BE') : 'jamais connecté(e)'
  }));

  const feuille = XLSX.utils.json_to_sheet(lignes);
  feuille['!cols'] = [{ wch: 24 }, { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 20 }];
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Identifiants');
  XLSX.writeFile(classeur, `Liste-distribution-membres-${dateISOLocale(new Date())}.xlsx`);
});

// ==========================================================================
// EXPORT ODOO — génère un CSV prêt à importer dans Odoo (Comptabilité →
// Clients → Factures → Importer des enregistrements). Une ligne par ligne
// de facture ; les lignes d'une même facture partagent le même "id" externe
// (convention standard d'import Odoo pour les champs one2many).
// Les prix stockés côté club sont TTC : on recalcule le prix unitaire HT
// pour laisser Odoo appliquer lui-même la TVA via le code de taxe standard,
// évitant toute double comptabilisation.
// ==========================================================================
function echapperCsv(valeur) {
  const s = String(valeur ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function genererLignesCsvOdoo(documents, typeMouvement) {
  const entetes = ['id', 'move_type', 'partner_id/name', 'partner_id/street', 'partner_id/email', 'partner_id/phone',
    'invoice_date', 'invoice_date_due', 'ref', 'invoice_line_ids/name', 'invoice_line_ids/quantity',
    'invoice_line_ids/price_unit', 'invoice_line_ids/tax_ids',
    'Prix HTVA (référence)', 'TVA 21% (référence)', 'Contrôle HTVA+TVA=TTC'];

  const lignesCsv = [entetes.join(';')];

  documents.forEach(docu => {
    const membre = currentMembres.find(m => m.id === docu.membreId) || currentMembresArchives.find(m => m.id === docu.membreId);
    const idExterne = 'CABOTS_' + docu.numero.replace(/[^a-zA-Z0-9]/g, '_');

    (docu.lignes || []).forEach((ligne, i) => {
      const prixTTC = ligne.prixUnitaireTTC;
      // HTVA = TTC / 1.21, arrondi à 2 décimales.
      const prixUnitaireHT = Math.round((prixTTC / 1.21) * 100) / 100;
      // TVA dérivée par soustraction (jamais recalculée indépendamment) :
      // garantit HTVA + TVA = TTC à l'euro-cent près, sans écart d'arrondi.
      const tva = Math.round((prixTTC - prixUnitaireHT) * 100) / 100;
      const controle = Math.round((prixUnitaireHT + tva) * 100) / 100 === Math.round(prixTTC * 100) / 100 ? 'OK' : '⚠️ ÉCART';

      const premiereLigne = i === 0;
      lignesCsv.push([
        idExterne,
        typeMouvement,
        premiereLigne ? echapperCsv(membre?.nomMaitre || 'Client inconnu') : '',
        premiereLigne ? echapperCsv(membre?.adressePostale || '') : '',
        premiereLigne ? echapperCsv(membre?.email || '') : '',
        premiereLigne ? echapperCsv(membre?.gsm || '') : '',
        premiereLigne ? docu.dateEmission : '',
        premiereLigne ? docu.dateEmission : '',
        premiereLigne ? echapperCsv(docu.numero + (docu.factureOrigineNumero ? ' (annule ' + docu.factureOrigineNumero + ')' : '')) : '',
        echapperCsv(ligne.description),
        ligne.quantite,
        prixUnitaireHT.toFixed(2),
        'TVA 21%',
        prixUnitaireHT.toFixed(2),
        tva.toFixed(2),
        controle
      ].join(';'));
    });
  });

  return lignesCsv.join('\n');
}

function telechargerCsv(contenu, nomFichier) {
  const blob = new Blob(['\uFEFF' + contenu], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomFichier;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('btnExporterOdoo').addEventListener('click', async () => {
  const statutEl = document.getElementById('odoo-statut');
  const dateDebut = document.getElementById('odoo-dateDebut').value;
  const dateFin = document.getElementById('odoo-dateFin').value;

  statutEl.textContent = 'Préparation de l\'export...';
  const snap = await getDocs(collection(db, 'factures'));
  let factures = [];
  snap.forEach(d => factures.push({ id: d.id, ...d.data() }));
  if (dateDebut) factures = factures.filter(f => f.dateEmission >= dateDebut);
  if (dateFin) factures = factures.filter(f => f.dateEmission <= dateFin);
  factures.sort((a, b) => (a.dateEmission || '').localeCompare(b.dateEmission || ''));

  if (factures.length === 0) {
    statutEl.textContent = 'Aucune facture trouvée sur cette période.';
    return;
  }

  const csv = genererLignesCsvOdoo(factures, 'out_invoice');
  telechargerCsv(csv, `Export_Odoo_Factures_${dateDebut || 'debut'}_${dateFin || 'fin'}.csv`);
  statutEl.textContent = `${factures.length} facture(s) exportée(s) ✓ — teste d'abord l'import avec 1 ou 2 factures avant de tout importer d'un coup.`;
});

document.getElementById('btnExporterOdooNC').addEventListener('click', async () => {
  const statutEl = document.getElementById('odoo-statut');
  const dateDebut = document.getElementById('odoo-dateDebut').value;
  const dateFin = document.getElementById('odoo-dateFin').value;

  statutEl.textContent = 'Préparation de l\'export...';
  const snap = await getDocs(collection(db, 'notes_credit'));
  let nc = [];
  snap.forEach(d => nc.push({ id: d.id, ...d.data() }));
  if (dateDebut) nc = nc.filter(n => n.dateEmission >= dateDebut);
  if (dateFin) nc = nc.filter(n => n.dateEmission <= dateFin);
  nc.sort((a, b) => (a.dateEmission || '').localeCompare(b.dateEmission || ''));

  if (nc.length === 0) {
    statutEl.textContent = 'Aucune note de crédit trouvée sur cette période.';
    return;
  }

  const csv = genererLignesCsvOdoo(nc, 'out_refund');
  telechargerCsv(csv, `Export_Odoo_NotesCredit_${dateDebut || 'debut'}_${dateFin || 'fin'}.csv`);
  statutEl.textContent = `${nc.length} note(s) de crédit exportée(s) ✓`;
});

// ==========================================================================
// DEMANDES D'ANNULATION TARDIVE — un membre a déjà validé sa présence mais
// demande à annuler avec justificatif. Si l'admin valide, le cours est
// remboursé (s'il avait déjà été décompté) et ne compte plus. Si refusée,
// le cours reste décompté normalement, comme si la demande n'avait jamais
// été faite.
// ==========================================================================
let currentDemandesInfo = [];

// Point rouge sur l'onglet "Membres" : combine plusieurs sources
// indépendantes (demandes d'info + livre d'or) sans que l'une n'efface
// le signal de l'autre, même si leurs chargements se terminent dans un
// ordre imprévisible.
let etatsPointRougeMembres = { demandesInfo: false, livreOr: false };
function majPointRougeMembres() {
  const actif = etatsPointRougeMembres.demandesInfo || etatsPointRougeMembres.livreOr;
  document.getElementById('tabMembresBtn')?.classList.toggle('has-unread', actif);
}

async function chargerDemandesInfo() {
  const wrap = document.getElementById('listeDemandesInfo');
  if (!wrap) return;
  const snap = await getDocs(collection(db, 'demandes_info'));
  const demandes = [];
  snap.forEach(d => demandes.push({ id: d.id, ...d.data() }));
  currentDemandesInfo = demandes;
  demandes.sort((a, b) => (b.dateEnvoi?.seconds || 0) - (a.dateEnvoi?.seconds || 0));

  const nbNonLues = demandes.filter(d => !d.lu).length;
  etatsPointRougeMembres.demandesInfo = nbNonLues > 0;
  majPointRougeMembres();
  document.getElementById('titreDemandesInfo')?.classList.toggle('has-unread', nbNonLues > 0);

  if (demandes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune demande reçue pour l\'instant.</div>';
    return;
  }

  wrap.innerHTML = demandes.map(d => {
    const dateLabel = d.dateEnvoi?.seconds
      ? new Date(d.dateEnvoi.seconds * 1000).toLocaleString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    return `
    <div class="data-row" style="${!d.lu ? 'background:#FBEFDA;' : ''}">
      <div class="data-main">
        <div class="data-title">${!d.lu ? '<span class="badge badge-danger">Nouveau</span> ' : ''}${escapeHtml(d.prenom || '')} ${escapeHtml(d.nom || '')}</div>
        <div class="data-sub">${d.gsm ? `<a href="tel:${escapeAttr(d.gsm)}">${escapeHtml(d.gsm)}</a>` : ''}${d.email ? ` · <a href="mailto:${escapeAttr(d.email)}">${escapeHtml(d.email)}</a>` : ''}</div>
        <div class="data-sub">${escapeHtml(d.ville || '')}${d.raceChien ? ' · ' + escapeHtml(d.raceChien) : ''}${d.ageChien ? ' · ' + escapeHtml(d.ageChien) : ''}${d.sterilise ? ' · Stérilisé/castré : ' + (d.sterilise === 'oui' ? 'Oui' : 'Non') : ''}</div>
        <div class="data-sub" style="white-space:pre-wrap;">${escapeHtml(d.demande || '')}</div>
        <div class="data-sub" style="font-style:italic;">${dateLabel}</div>
      </div>
      <div class="data-actions">
        ${!d.lu ? `<button class="btn-sm" onclick="window.marquerDemandeInfoLue('${d.id}')">Marquer comme lue</button>` : ''}
        <button class="btn-sm primary" onclick="window.convertirDemandeEnMembre('${d.id}')">Convertir en fiche membre</button>
        <button class="btn-sm danger" onclick="window.supprimerDemandeInfo('${d.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

window.marquerDemandeInfoLue = async (id) => {
  await updateDoc(doc(db, 'demandes_info', id), { lu: true });
  chargerDemandesInfo();
};

window.supprimerDemandeInfo = async (id) => {
  if (!confirm('Supprimer cette demande ?')) return;
  await deleteDoc(doc(db, 'demandes_info', id));
  chargerDemandesInfo();
};

window.convertirDemandeEnMembre = (id) => {
  const demande = currentDemandesInfo.find(d => d.id === id);
  if (!demande) return;
  ouvrirModalMembre(null, demande);
};

async function chargerLivreOrAdmin() {
  const wrap = document.getElementById('listeLivreOr');
  if (!wrap) return;
  const snap = await getDocs(collection(db, 'livre_or'));
  const messages = [];
  snap.forEach(d => messages.push({ id: d.id, ...d.data() }));
  messages.sort((a, b) => (b.dateEnvoi?.seconds || 0) - (a.dateEnvoi?.seconds || 0));

  const nbEnAttente = messages.filter(m => !m.approuve).length;
  etatsPointRougeMembres.livreOr = nbEnAttente > 0;
  majPointRougeMembres();
  document.getElementById('titreLivreOr')?.classList.toggle('has-unread', nbEnAttente > 0);

  if (messages.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun message pour l\'instant.</div>';
    return;
  }

  wrap.innerHTML = messages.map(m => {
    const dateLabel = m.dateEnvoi?.seconds
      ? new Date(m.dateEnvoi.seconds * 1000).toLocaleString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    return `
    <div class="data-row" style="${!m.approuve ? 'background:#FBEFDA;' : ''}">
      <div class="data-main">
        <div class="data-title">${!m.approuve ? '<span class="badge badge-danger">En attente</span> ' : '<span class="badge badge-ok">Publié</span> '}${escapeHtml(m.prenom || '')} ${escapeHtml(m.nom || '')}</div>
        ${m.message ? `<div class="data-sub" style="white-space:pre-wrap;">${escapeHtml(m.message)}</div>` : ''}
        <div class="data-sub" style="font-style:italic;">${dateLabel}</div>
      </div>
      <div class="data-actions">
        ${!m.approuve ? `<button class="btn-sm primary" onclick="window.approuverMessageLivreOr('${m.id}')">Publier</button>` : `<button class="btn-sm" onclick="window.retirerMessageLivreOr('${m.id}')">Retirer</button>`}
        <button class="btn-sm danger" onclick="window.supprimerMessageLivreOr('${m.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

window.approuverMessageLivreOr = async (id) => {
  await updateDoc(doc(db, 'livre_or', id), { approuve: true });
  chargerLivreOrAdmin();
};

window.retirerMessageLivreOr = async (id) => {
  await updateDoc(doc(db, 'livre_or', id), { approuve: false });
  chargerLivreOrAdmin();
};

window.supprimerMessageLivreOr = async (id) => {
  if (!confirm('Supprimer ce message définitivement ?')) return;
  await deleteDoc(doc(db, 'livre_or', id));
  chargerLivreOrAdmin();
};

async function chargerDemandesAnnulation() {
  const bloc = document.getElementById('blocDemandesAnnulation');
  const wrap = document.getElementById('listeDemandesAnnulation');
  if (!wrap) return;

  const snap = await getDocs(query(collection(db, 'presences'), where('demandeAnnulationStatut', '==', 'attente')));
  const demandes = [];
  snap.forEach(d => demandes.push({ id: d.id, ...d.data() }));

  if (demandes.length === 0) {
    bloc.style.display = 'none';
    return;
  }
  bloc.style.display = '';

  demandes.sort((a, b) => (a.dateISO || '').localeCompare(b.dateISO || ''));

  wrap.innerHTML = demandes.map(d => {
    const m = currentMembres.find(mm => mm.id === d.uid);
    const groupe = currentGroupes.find(g => g.id === d.groupeId);
    const dateLabel = new Date(d.dateISO + 'T00:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(m?.nomMaitre || '?')} — ${escapeHtml(groupe?.nom || '')}</div>
        <div class="data-sub">${capitalize(dateLabel)}</div>
        <div class="data-sub">Motif : <em>${escapeHtml(d.demandeAnnulationMotif || '')}</em></div>
      </div>
      <div class="data-actions">
        <button class="btn-sm primary" onclick="window.validerAnnulationTardive('${d.id}')">Valider (ne compte pas)</button>
        <button class="btn-sm danger" onclick="window.refuserAnnulationTardive('${d.id}')">Refuser (reste décompté)</button>
      </div>
    </div>`;
  }).join('');
}

window.validerAnnulationTardive = async (presenceId) => {
  const presDoc = await getDoc(doc(db, 'presences', presenceId));
  const p = presDoc.data();

  // Si le cours avait déjà été décompté de l'abonnement, on rembourse.
  if (p.compteAbonnement) {
    const membre = currentMembres.find(m => m.id === p.uid);
    if (membre) {
      await updateDoc(doc(db, 'membres', p.uid), { coursRestants: (membre.coursRestants ?? 0) + 1 });
    }
  }

  await updateDoc(doc(db, 'presences', presenceId), {
    statut: 'absent',
    compteAbonnement: false,
    demandeAnnulationStatut: 'validee'
  });

  chargerMembres();
  chargerDemandesAnnulation();
};

window.refuserAnnulationTardive = async (presenceId) => {
  await updateDoc(doc(db, 'presences', presenceId), { demandeAnnulationStatut: 'refusee' });
  chargerDemandesAnnulation();
};
