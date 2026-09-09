// © 2026 LES BEAUX CABOTS SRL. Tous droits réservés.
// Ce code ne peut être utilisé, copié ou modifié sans autorisation
// écrite — voir LICENSE.txt à la racine du dépôt.
// Contenu du site sous la responsabilité de Katia Renard (LES BEAUX CABOTS SRL).

import {
  auth, db, onAuthStateChanged, signOut,
  doc, getDoc, getDocAvecReessai, setDoc, getDocs, collection, addDoc, updateDoc, query, orderBy, where, serverTimestamp, onSnapshot,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider, identifiantVersEmail
} from "./firebase-config.js";
import { meteoPour, alerteMeteo, iconeCode } from "./meteo.js";

const JOURS = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];

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

const ENTREPRISE_IBAN = 'BE58 7320 5129 6479';
const ENTREPRISE_BIC = 'CREGBEBB';
const TAUX_ACOMPTE_DOGSITTING_MEMBRE = 0.30;

let membreData = null;
let membreUid = null;
let groupeData = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'connexion.html'; return; }
  const mDoc = await getDocAvecReessai(doc(db, 'membres', user.uid));
  if (!mDoc.exists() || mDoc.data().role !== 'membre') {
    window.location.href = 'connexion.html';
    return;
  }
  membreUid = user.uid;
  membreData = mDoc.data();
  activerBlocsRepliables();

  // Message de sécurité affiché une seule fois, juste après la toute
  // première connexion du membre (voir connexion.html qui pose ce
  // marqueur). sessionStorage s'efface tout seul à la fermeture de l'onglet
  // — largement suffisant pour ne le montrer qu'à ce moment précis.
  if (sessionStorage.getItem('cabots_premiere_connexion') === '1') {
    sessionStorage.removeItem('cabots_premiere_connexion');
    document.getElementById('blocPremiereConnexion')?.classList.remove('hidden');
  }
  document.getElementById('btnFermerPremiereConnexion')?.addEventListener('click', () => {
    document.getElementById('blocPremiereConnexion').classList.add('hidden');
  });

  // Changement de mot de passe trimestriel obligatoire (1er janvier, avril,
  // juillet, octobre) — pour tous les membres, sans exception.
  const derniereMajMdp = membreData.dateDernierChangementMdp ? new Date(membreData.dateDernierChangementMdp) : null;
  if (!derniereMajMdp || derniereMajMdp < dateLimiteMdpActuelle()) {
    ouvrirModalMdpObligatoireMembre();
  }

  // Dernière activité : mise à jour à chaque ouverture de page (pas
  // seulement à la connexion), y compris quand la session était déjà
  // ouverte depuis avant. Silencieux, sans impact sur rien d'autre.
  updateDoc(doc(db, 'membres', membreUid), { derniereActivite: new Date().toISOString() }).catch(() => {});

  // Chantier refonte membres : accès Cours / Dog Sitting / Boutique
  // indépendants. Un membre déjà existant sans champ accesCours/accesBoutique
  // (pas encore touché par la migration) est considéré y avoir accès par
  // défaut — même logique de sécurité que côté admin.
  const aAccesCours = membreData.accesCours !== undefined ? !!membreData.accesCours : true;
  const aAccesBoutique = membreData.accesBoutique !== undefined ? !!membreData.accesBoutique : true;

  if (membreData.archive) {
    // Ancien membre (compte archivé) : accès restreint à la Boutique et,
    // si autorisé, au Dog Sitting uniquement (et seulement si le membre y a
    // encore droit) — tout le reste (cours, profil, blog, messages,
    // règlement...) reste masqué.
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const garder = (btn.dataset.tab === 'boutique' && aAccesBoutique) || (btn.dataset.tab === 'dogsitting' && membreData.accesDogSitting);
      btn.classList.toggle('hidden', !garder);
      btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    const premierOnglet = aAccesBoutique ? 'boutique' : (membreData.accesDogSitting ? 'dogsitting' : null);
    if (premierOnglet) {
      document.querySelector(`.tab-btn[data-tab="${premierOnglet}"]`)?.classList.add('active');
      document.getElementById('panel-' + premierOnglet)?.classList.remove('hidden');
    }
    if (aAccesBoutique) chargerBoutiqueMembre();
    if (membreData.accesDogSitting) {
      document.getElementById('tabDogSittingBtn')?.classList.remove('hidden');
      chargerDogSittingMembre();
    }
    return;
  }

  // Onglets/panneaux dont la visibilité dépend du profil d'accès.
  document.getElementById('tabReglementBtn')?.classList.toggle('hidden', !aAccesCours);
  document.getElementById('tabBlogBtn')?.classList.toggle('hidden', !aAccesCours);
  document.getElementById('tabBoutiqueBtn')?.classList.toggle('hidden', !aAccesBoutique);
  document.getElementById('panelHistoriquePresencesWrap')?.classList.toggle('hidden', !aAccesCours);

  afficherAccueil();

  if (membreData.groupeId) {
    const gDoc = await getDoc(doc(db, 'groupes', membreData.groupeId));
    if (gDoc.exists()) {
      groupeData = { id: gDoc.id, ...gDoc.data() };
      afficherGroupe();
      await afficherProchainsCours();
    }
  } else {
    // Pas (encore) de groupe hebdo précis assigné : les panneaux "Mon
    // groupe" et "Mes prochains cours" n'ont pas de sens tant qu'aucun
    // créneau n'est choisi (indépendant de l'accès Cours lui-même, qui peut
    // déjà être activé — voir "Mon abonnement" juste en dessous).
    document.getElementById('panelGroupeWrap').classList.add('hidden');
    document.getElementById('panelCoursWrap').classList.add('hidden');
  }

  document.getElementById('panelAbonnementWrap').classList.toggle('hidden', !aAccesCours);
  if (aAccesBoutique && !aAccesCours) {
    document.getElementById('blocBoutiqueEnAvant').classList.remove('hidden');
    afficherApercuBoutique();
  } else {
    document.getElementById('blocBoutiqueEnAvant').classList.add('hidden');
  }

  chargerServicesMembre();
  chargerRdv();
  chargerChat();
  afficherAlerteMessage();
  afficherSurpriseAnniversaireKatia();
  chargerVideosMembre();
  chargerBlogMembre();
  chargerHistoriquePresencesMembre();
  chargerRoiMembre();
  chargerEnqueteAnonyme();
  initNotifications();
});

document.getElementById('chatSendMembre').addEventListener('click', envoyerMessageMembre);
document.getElementById('chatInputMembre').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') envoyerMessageMembre();
});

document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth).then(() => window.location.href = 'connexion.html'));

const REGEX_MOT_DE_PASSE = /^[A-Za-z0-9]+$/;
function motDePasseValide(valeur) { return REGEX_MOT_DE_PASSE.test(valeur || ''); }
const MESSAGE_MDP_INVALIDE = "Le mot de passe ne peut contenir que des lettres et des chiffres (pas de caractère spécial, espace ou accent).";

// Trimestre en cours : le 1er janvier, avril, juillet et octobre. Si le mot
// de passe n'a jamais été changé depuis la dernière de ces dates, un
// changement est imposé à la connexion (voir onAuthStateChanged plus haut).
function dateLimiteMdpActuelle() {
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const bornes = [new Date(annee, 0, 1), new Date(annee, 3, 1), new Date(annee, 6, 1), new Date(annee, 9, 1)];
  let derniere = new Date(annee - 1, 9, 1);
  for (const b of bornes) { if (b <= maintenant) derniere = b; }
  return derniere;
}

async function executerChangementMdpMembre(mdpActuel, mdpNouveau, mdpConfirmer, statutEl) {
  statutEl.style.color = 'var(--slate)';

  if (!mdpActuel || !mdpNouveau || !mdpConfirmer) {
    statutEl.style.color = '#B3432B';
    statutEl.textContent = 'Merci de remplir les 3 champs.';
    return false;
  }
  if (mdpNouveau.length < 6) {
    statutEl.style.color = '#B3432B';
    statutEl.textContent = 'Le nouveau mot de passe doit faire au moins 6 caractères.';
    return false;
  }
  if (!motDePasseValide(mdpNouveau)) {
    statutEl.style.color = '#B3432B';
    statutEl.textContent = MESSAGE_MDP_INVALIDE;
    return false;
  }
  if (mdpNouveau !== mdpConfirmer) {
    statutEl.style.color = '#B3432B';
    statutEl.textContent = 'Les deux nouveaux mots de passe ne correspondent pas.';
    return false;
  }

  statutEl.style.color = 'var(--slate)';
  statutEl.textContent = 'Modification en cours...';
  try {
    // Firebase exige une ré-authentification récente pour un changement de
    // mot de passe — on revalide donc l'ancien mot de passe juste avant.
    const credential = EmailAuthProvider.credential(identifiantVersEmail(membreData.identifiant), mdpActuel);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, mdpNouveau);
    // Garde le mot de passe visible par l'admin ("Mots de passe") à jour,
    // pour qu'elle puisse continuer à dépanner en cas d'oubli, et note la
    // date pour le changement trimestriel obligatoire.
    await updateDoc(doc(db, 'membres', membreUid), {
      motDePasseInitial: mdpNouveau, dateDernierChangementMdp: new Date().toISOString()
    });
    membreData.dateDernierChangementMdp = new Date().toISOString();
    statutEl.style.color = '#2F6B4F';
    statutEl.textContent = 'Mot de passe changé avec succès ✓ Utilisez-le à votre prochaine connexion.';
    return true;
  } catch (err) {
    statutEl.style.color = '#B3432B';
    statutEl.textContent = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
      ? 'Le mot de passe actuel saisi est incorrect.'
      : 'Erreur : ' + (err.code || err.message || err);
    return false;
  }
}

function ouvrirModalMdpObligatoireMembre() {
  const html = `
    <div class="modal-overlay" id="modalOverlayMdpOblige">
      <div class="modal-box">
        <h3>🔒 Changement de mot de passe requis</h3>
        <p style="color:var(--ink);">Pour la sécurité de tous, le club impose de changer son mot de passe chaque trimestre (1er janvier, 1er avril, 1er juillet, 1er octobre). Merci de définir un nouveau mot de passe pour continuer.</p>
        <ol style="font-size:0.88rem; color:var(--slate); padding-left:20px; margin-bottom:14px;">
          <li>Entrez votre mot de passe actuel</li>
          <li>Choisissez un nouveau mot de passe (lettres/chiffres, min. 6 caractères)</li>
          <li>Confirmez-le puis cliquez sur "Changer mon mot de passe"</li>
        </ol>
        <div class="field"><label>Mot de passe actuel</label><input type="password" id="mdpo-actuel" autocomplete="current-password"></div>
        <div class="form-grid">
          <div class="field"><label>Nouveau mot de passe</label><input type="password" id="mdpo-nouveau" autocomplete="new-password"></div>
          <div class="field"><label>Confirmer</label><input type="password" id="mdpo-confirmer" autocomplete="new-password"></div>
        </div>
        <button class="btn-sm primary" id="mdpo-save">Changer mon mot de passe</button>
        <p id="mdpo-statut" style="font-size:0.85rem; margin-top:8px;"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('mdpo-save').addEventListener('click', async () => {
    const statutEl = document.getElementById('mdpo-statut');
    const ok = await executerChangementMdpMembre(
      document.getElementById('mdpo-actuel').value,
      document.getElementById('mdpo-nouveau').value,
      document.getElementById('mdpo-confirmer').value,
      statutEl
    );
    if (ok) setTimeout(() => document.getElementById('modalOverlayMdpOblige')?.remove(), 1200);
  });
}

document.getElementById('btnChangerMdpMembre').addEventListener('click', async () => {
  const statutEl = document.getElementById('mp-mdpStatut');
  const ok = await executerChangementMdpMembre(
    document.getElementById('mp-mdpActuel').value,
    document.getElementById('mp-mdpNouveau').value,
    document.getElementById('mp-mdpConfirmer').value,
    statutEl
  );
  if (ok) {
    document.getElementById('mp-mdpActuel').value = '';
    document.getElementById('mp-mdpNouveau').value = '';
    document.getElementById('mp-mdpConfirmer').value = '';
  }
});

function nomsChiensActifs() {
  return (membreData.chiens || []).filter(c => !c.archive).map(c => c.nom).filter(Boolean).join(', ');
}

function afficherAccueil() {
  document.getElementById('membreNom').textContent = membreData.nomMaitre || '';
  document.getElementById('chienNom').textContent = nomsChiensActifs();
  const badgeAbo = membreData.abonnementPaye
    ? `<span class="badge badge-ok">${membreData.coursRestants ?? 0} cours restants</span>`
    : `<span class="badge badge-danger">Abonnement non payé</span>`;
  const badgeCotis = membreData.cotisationPayee
    ? `<span class="badge badge-ok">Cotisation à jour</span>`
    : `<span class="badge badge-warn">Cotisation à régler</span>`;
  document.getElementById('badgesAbo').innerHTML = badgeAbo + ' ' + badgeCotis;
  afficherRappelAbonnement();
  afficherRappelCotisation();
  preremplirMonProfil();
  afficherMesChiens();
  chargerHistoriquePaiementsMembre();
  chargerBoutiqueMembre();
  chargerCampagnesMembre();
  document.getElementById('tabDogSittingBtn')?.classList.toggle('hidden', !membreData.accesDogSitting);
  if (membreData.accesDogSitting) chargerDogSittingMembre();
}

function afficherRappelAbonnement() {
  const zone = document.getElementById('zoneAbonnementRappel');
  const reste = membreData.coursRestants ?? 0;

  if (reste > 2) { zone.innerHTML = ''; return; }

  if (reste <= 0) {
    zone.innerHTML = `<div class="banner-alert" style="background:#FBEAEA; border-color:#E3B4B4; color:#8A2E2E;">Votre abonnement est épuisé, vous ne pouvez plus vous inscrire à un cours. Contactez Katia pour renouveler.</div>`;
    return;
  }

  if (membreData.abonnementRenouvellement) {
    zone.innerHTML = `<div class="banner-alert">Il vous reste ${reste} cours — vous avez indiqué : <strong>${membreData.abonnementRenouvellement === 'oui' ? 'je souhaite renouveler' : 'je ne souhaite pas renouveler'}</strong>. Katia s'en occupe.</div>`;
    return;
  }

  // La demande interactive (boutons Oui/Non) reste affichée tant que le
  // membre n'a pas répondu, à 2 comme à 1 cours restant — pas de nouvelle
  // demande séparée, juste la même qui continue jusqu'à réponse ou jusqu'à
  // l'abonnement épuisé (0 cours, où on bloque les réservations à la place).
  zone.innerHTML = `
    <div class="banner-alert">
      Il vous reste ${reste} cours sur votre abonnement. Souhaitez-vous le renouveler (11 cours) ?
      <div class="presence-btns">
        <button class="btn-sm primary" onclick="window.repondreAbonnement('oui')">Oui, je renouvelle</button>
        <button class="btn-sm" onclick="window.repondreAbonnement('non')">Non, pas pour l'instant</button>
      </div>
    </div>`;
}

window.repondreAbonnement = async (reponse) => {
  await updateDoc(doc(db, 'membres', membreUid), { abonnementRenouvellement: reponse });
  membreData.abonnementRenouvellement = reponse;
  afficherRappelAbonnement();

  // Prévient Katia par message (comme un message de chat normal, donc
  // visible avec le point rouge habituel sur l'onglet Messages) pour
  // qu'elle sache si elle peut préparer la facture d'abonnement (11 cours)
  // ou non.
  const reste = membreData.coursRestants ?? 0;
  const texteAuto = reponse === 'oui'
    ? `🔔 Renouvellement d'abonnement : je souhaite renouveler pour 11 cours (il me reste ${reste} cours actuellement).`
    : `🔔 Renouvellement d'abonnement : je ne souhaite pas renouveler pour l'instant (il me reste ${reste} cours actuellement).`;
  await addDoc(collection(db, 'conversations', membreUid, 'messages'), {
    texte: texteAuto, expediteur: 'membre', dateEnvoi: new Date().toISOString(), lu: false
  });
  await setDoc(doc(db, 'conversations', membreUid), {
    dernierMessage: texteAuto, dateDernierMessage: new Date().toISOString(), nonLuAdmin: true
  }, { merge: true });
  chargerChat();
};

function afficherRappelCotisation() {
  const zone = document.getElementById('zoneCotisation');
  if (!membreData.cotisationDateEcheance) { zone.innerHTML = ''; return; }
  const aujourdhui = new Date(); aujourdhui.setHours(0,0,0,0);
  const dansUnMois = new Date(aujourdhui); dansUnMois.setMonth(aujourdhui.getMonth() + 1);
  const echeance = new Date(membreData.cotisationDateEcheance + 'T00:00:00');
  const dateLabel = echeance.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });

  const infoDate = `<p style="font-size:0.85rem; color:var(--slate); margin:0 0 8px;">Vous êtes en ordre de cotisation jusqu'au <strong>${dateLabel}</strong>.</p>`;

  if (echeance > dansUnMois) { zone.innerHTML = infoDate; return; }

  if (membreData.cotisationRenouvellement) {
    zone.innerHTML = infoDate + `<div class="banner-alert">Cotisation jusqu'au ${dateLabel} — vous avez indiqué : <strong>${membreData.cotisationRenouvellement === 'oui' ? 'je souhaite renouveler' : 'je ne souhaite pas renouveler'}</strong>. Katia s'en occupe.</div>`;
    return;
  }

  zone.innerHTML = infoDate + `
    <div class="banner-alert">
      Votre cotisation arrive à échéance le ${dateLabel}. Souhaitez-vous la renouveler ?
      <div class="presence-btns">
        <button class="btn-sm primary" onclick="window.repondreCotisation('oui')">Oui, je renouvelle</button>
        <button class="btn-sm" onclick="window.repondreCotisation('non')">Non, pas cette année</button>
      </div>
    </div>`;
}

window.repondreCotisation = async (reponse) => {
  await updateDoc(doc(db, 'membres', membreUid), { cotisationRenouvellement: reponse });
  membreData.cotisationRenouvellement = reponse;
  afficherRappelCotisation();
};

function afficherGroupe() {
  document.getElementById('zoneGroupe').innerHTML = `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(groupeData.nom)}</div>
        <div class="data-sub">Jour et horaire : ${JOURS_MAJ[groupeData.jour]}, ${groupeData.heureDebut}–${groupeData.heureFin}</div>
      </div>
    </div>`;
}

function prochainesOccurrences(jourGroupe, nombre) {
  const indexJour = JOURS.indexOf(jourGroupe);
  const dates = [];
  let d = new Date();
  d.setHours(0,0,0,0);
  while (dates.length < nombre) {
    if (d.getDay() === indexJour) dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function afficherProchainsCours() {
  const dates = prochainesOccurrences(groupeData.jour, 2);
  const annulSnap = await getDocs(collection(db, 'annulations'));
  const annulations = {};
  annulSnap.forEach(d => { annulations[d.id] = d.data(); });

  const confirmSnap = await getDocs(collection(db, 'confirmations'));
  const confirmations = {};
  confirmSnap.forEach(d => { confirmations[d.id] = d.data(); });

  const presSnap = await getDocs(query(collection(db, 'presences'), where('uid', '==', membreUid)));
  const presences = {};
  presSnap.forEach(d => { presences[d.id] = d.data(); });

  const wrap = document.getElementById('zoneCours');

  const lignes = await Promise.all(dates.map(async (d) => {
    const dateISO = dateISOLocale(d);
    const dateLabel = d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    const cleAnnul = `${groupeData.id}_${dateISO}`;
    const clePres = `${groupeData.id}_${dateISO}_${membreUid}`;
    const annule = annulations[cleAnnul];
    const confirme = confirmations[cleAnnul];
    const presence = presences[clePres];
    const m = await meteoPour(dateISO, groupeData.heureDebut);
    const alerte = alerteMeteo(m);
    const meteoBadge = m ? `<span class="badge badge-neutral">${iconeCode(m.code)} ${m.temperature}°C · pluie ${m.pluie}%</span>` : '<span class="badge badge-neutral">Météo indisponible</span>';
    const confirmeBadge = confirme && !annule ? '<span class="badge badge-ok">✅ Confirmé par Katia</span>' : '';

    if (annule) {
      return `
      <div class="data-row">
        <div class="data-main">
          <div class="data-title">${capitalize(dateLabel)} — ${groupeData.heureDebut}</div>
          <div class="data-sub"><span class="badge badge-danger">Cours annulé — ${escapeHtml(annule.motif)}</span> ${meteoBadge}</div>
        </div>
      </div>`;
    }

    let statutHtml;
    const heureCours = new Date(`${dateISO}T${groupeData.heureDebut}:00`);
    const delaiDepasse = new Date() >= new Date(heureCours.getTime() - 24 * 60 * 60 * 1000);

    if (presence) {
      if (presence.statut === 'present') {
        const heureLimiteAnnul = new Date(heureCours.getTime() - 60 * 60 * 1000); // 1h avant le cours
        const encoreTemps = new Date() < heureLimiteAnnul;

        if (!delaiDepasse) {
          // Plus de 24h avant le cours : changement d'avis totalement libre,
          // sans justificatif ni validation admin.
          statutHtml = `<span class="badge badge-ok">Présence confirmée</span>
            <button class="btn-sm" style="margin-top:6px; display:block;" onclick="window.repondrePresence('${dateISO}','absent')">Changer pour absent</button>
            <p style="font-size:0.76rem; color:var(--slate-light); margin-top:4px;">Vous pouvez encore changer d'avis librement jusqu'à 24h avant le cours.</p>`;
        } else if (presence.demandeAnnulationStatut === 'attente') {
          statutHtml = `<span class="badge badge-warn">Présence confirmée</span><br>
            <span class="badge badge-neutral" style="margin-top:4px;">Demande d'annulation envoyée — en attente de validation par Katia</span>`;
        } else if (presence.demandeAnnulationStatut === 'refusee') {
          statutHtml = `<span class="badge badge-ok">Présence confirmée</span><br>
            <span style="font-size:0.78rem; color:var(--slate); display:block; margin-top:4px;">Votre demande d'annulation a été refusée par Katia — ce cours compte dans votre abonnement.</span>`;
        } else if (encoreTemps) {
          statutHtml = `<span class="badge badge-ok">Présence confirmée</span>
            <button class="btn-sm" style="margin-top:6px; display:block;" onclick="window.ouvrirDemandeAnnulation('${dateISO}')">Annuler ma présence (avec justificatif)</button>
            <p style="font-size:0.76rem; color:var(--slate-light); margin-top:4px;">Possible jusqu'à 1h avant le cours. Katia doit valider pour que le cours ne compte pas dans votre abonnement.</p>`;
        } else {
          statutHtml = '<span class="badge badge-ok">Présence confirmée</span>';
        }
      } else if (presence.statut === 'absent-auto') {
        statutHtml = '<span class="badge badge-warn">Pas de réponse dans les délais — comptabilisé(e) absent(e), ce cours compte dans votre abonnement.</span>';
      } else if (!delaiDepasse) {
        // Absence signalée volontairement, mais on est encore à plus de 24h
        // du cours : le membre peut librement revenir sur sa décision.
        statutHtml = `<span class="badge badge-neutral">Absence signalée</span>
          <button class="btn-sm primary" style="margin-top:6px; display:block;" onclick="window.repondrePresence('${dateISO}','present')">Changer pour présent</button>
          <p style="font-size:0.76rem; color:var(--slate-light); margin-top:4px;">Vous pouvez encore changer d'avis librement jusqu'à 24h avant le cours.</p>`;
      } else {
        statutHtml = '<span class="badge badge-neutral">Absence signalée</span>';
      }
    } else if (delaiDepasse) {
      // Le délai de 24h avant le cours est dépassé sans réponse : absence automatique.
      await setDoc(doc(db, 'presences', clePres), {
        groupeId: groupeData.id, uid: membreUid, dateISO, statut: 'absent-auto',
        repondu: new Date().toISOString(), compteAbonnement: false
      });
      statutHtml = '<span class="badge badge-warn">Pas de réponse dans les délais — comptabilisé(e) absent(e), ce cours compte dans votre abonnement.</span>';
    } else if ((membreData.coursRestants ?? 0) <= 0) {
      statutHtml = '<span class="badge badge-danger">Abonnement épuisé — contactez Katia</span>';
    } else {
      statutHtml = `
        <div class="presence-btns">
          <button class="btn-sm primary" onclick="window.repondrePresence('${dateISO}','present')">Je serai présent</button>
          <button class="btn-sm" onclick="window.repondrePresence('${dateISO}','absent')">Je serai absent</button>
        </div>
        <p style="font-size:0.76rem; color:var(--slate-light); margin-top:4px;">À confirmer au plus tard 24h avant le cours.</p>`;
    }

    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${capitalize(dateLabel)} — ${groupeData.heureDebut}</div>
        <div class="data-sub">${meteoBadge} ${confirmeBadge}</div>
        ${alerte ? `<div class="banner-alert" style="margin-top:8px; padding:8px 12px;">⚠️ ${alerte.texte}, une annulation est possible.</div>` : ''}
        ${statutHtml}
      </div>
    </div>`;
  }));

  wrap.innerHTML = lignes.join('');
}

window.repondrePresence = async (dateISO, statut) => {
  if (statut === 'present' && (membreData.coursRestants ?? 0) <= 0) {
    alert('Votre abonnement est épuisé. Contactez Katia pour le renouveler avant de vous inscrire à un cours.');
    return;
  }
  const cle = `${groupeData.id}_${dateISO}_${membreUid}`;
  await setDoc(doc(db, 'presences', cle), {
    groupeId: groupeData.id, uid: membreUid, dateISO, statut,
    repondu: new Date().toISOString()
  });
  afficherProchainsCours();
};

function formaterPoids(poids, unite) {
  return unite === 'kg' ? Number(poids).toFixed(2) : poids;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Blocs de fiche repliables : tout <h3 class="bloc-titre"> ouvre/ferme le
// <div class="bloc-contenu"> qui le suit directement (arrow ▾ / ▸).
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

function texteAvecLiens(str) {
  const echappe = escapeHtml(str);
  return echappe.replace(/(https?:\/\/[^\s<]+)/g, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ==========================================================================
// TARIFS (lecture seule)
// ==========================================================================
function libellePrixMembre(s) {
  if (s.prixTexte) return s.prixTexte;
  if (typeof s.prix === 'number') return `${s.prix.toFixed(2)} €${s.unite ? ' — ' + s.unite : ''}`;
  return '—';
}

async function chargerServicesMembre() {
  const wrap = document.getElementById('zoneServices');
  const snap = await getDocs(collection(db, 'services'));
  const services = [];
  snap.forEach(d => services.push(d.data()));

  if (services.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun service publié pour l\'instant.</div>';
    return;
  }

  const categories = [...new Set(services.map(s => s.categorie || 'Autres'))];
  wrap.innerHTML = categories.map(cat => `
    <h3 style="margin-top:14px;">${escapeHtml(cat)}</h3>
    <div class="data-list">
      ${services.filter(s => (s.categorie || 'Autres') === cat).map(s => `
        <div class="data-row">
          <div class="data-main">
            <div class="data-title">${escapeHtml(s.nom)}</div>
            ${s.conditions ? `<div class="data-sub">${escapeHtml(s.conditions)}</div>` : ''}
          </div>
          <div class="data-actions">
            <span class="badge badge-neutral">${libellePrixMembre(s)}</span>
            ${s.prixFutur ? `<span class="badge badge-warn">${Number(s.prixFutur).toFixed(2)} € dès le ${s.dateFutur}</span>` : ''}
          </div>
        </div>`).join('')}
    </div>`).join('') + '<p style="color:var(--slate); font-size:0.8rem; margin-top:10px;">Prix TTC, TVA 21% incluse.</p>';
}

// ==========================================================================
// RDV — filtré par destinataires, prix par personne, paiement par virement
// ==========================================================================
async function estInviteAuRdv(rdv) {
  if (!rdv.destinataires || rdv.destinataires.type === 'tous') return true;
  if (rdv.destinataires.type === 'groupe') return rdv.destinataires.groupeId === membreData.groupeId;
  if (rdv.destinataires.type === 'individuel') {
    // Vérifie SA PROPRE invitation via un marqueur dédié (rdv_cibles) —
    // jamais une liste partagée des autres membres invités.
    const cibleDoc = await getDoc(doc(db, 'rdv_cibles', `${rdv.id}_${membreUid}`));
    return cibleDoc.exists();
  }
  return false;
}

async function chargerRdv() {
  const snap = await getDocs(collection(db, 'rdv'));
  let rdvs = [];
  snap.forEach(d => rdvs.push({ id: d.id, ...d.data() }));
  const invitations = await Promise.all(rdvs.map(estInviteAuRdv));
  rdvs = rdvs.filter((r, i) => invitations[i]);
  rdvs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const wrap = document.getElementById('zoneRdv');
  if (rdvs.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun RDV prévu pour l\'instant.</div>';
    return;
  }

  const paramDoc = await getDoc(doc(db, 'parametres', 'bancaire'));
  const iban = paramDoc.exists() ? (paramDoc.data().iban || '') : '';

  const reponseSnap = await getDocs(query(collection(db, 'rdv_reponses'), where('uid', '==', membreUid)));
  const mesReponses = {};
  reponseSnap.forEach(d => {
    const r = d.data();
    if (r.uid === membreUid) mesReponses[r.rdvId] = { id: d.id, ...r };
  });

  const nomChien = (membreData.chiens || []).find(c => !c.archive)?.nom || '';

  wrap.innerHTML = rdvs.map(rdv => {
    const dateLabel = rdv.date ? new Date(rdv.date + 'T00:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    const maReponse = mesReponses[rdv.id];
    let statutHtml;

    if (maReponse) {
      if (maReponse.statut === 'present') {
        const communication = `${rdv.titre} ${nomChien} ${rdv.date}`;
        statutHtml = `<span class="badge badge-ok">Vous serez présent(e)${maReponse.nombrePersonnes > 1 ? ` (${maReponse.nombrePersonnes} pers.)` : ''}</span>`;
        if (rdv.prixParPersonne) {
          statutHtml += `
            <div class="banner-alert" style="margin-top:8px;">
              Montant à payer : <strong>${Number(maReponse.montant || 0).toFixed(2)} €</strong><br>
              ${iban ? `Virement sur : <strong>${escapeHtml(iban)}</strong><br>` : ''}
              Communication : <strong>${escapeHtml(communication)}</strong>
              <div class="presence-btns" style="margin-top:8px;">
                ${maReponse.paye
                  ? '<span class="badge badge-ok">Vous avez indiqué avoir payé</span>' + (maReponse.paiementValide ? ' <span class="badge badge-ok">Validé par Katia</span>' : ' <span class="badge badge-warn">En attente de validation</span>')
                  : `<button class="btn-sm primary" onclick="window.signalerPaiementRdv('${maReponse.id}')">J'ai payé</button>`}
              </div>
            </div>`;
        }
      } else {
        statutHtml = '<span class="badge badge-neutral">Absence signalée</span>';
      }
    } else {
      statutHtml = `
        <div class="field" style="max-width:160px;">
          <label>Nombre de personnes</label>
          <input type="number" min="1" value="1" id="rd-nb-${rdv.id}" style="width:100%;">
        </div>
        <div class="presence-btns">
          <button class="btn-sm primary" onclick="window.repondreRdv('${rdv.id}','present')">Je serai présent(e)</button>
          <button class="btn-sm" onclick="window.repondreRdv('${rdv.id}','absent')">Je ne pourrai pas venir</button>
        </div>`;
    }
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(rdv.titre)}</div>
        <div class="data-sub">${capitalize(dateLabel)} ${rdv.heure || ''} · ${escapeHtml(rdv.lieu || '')}</div>
        ${rdv.modalite ? `<div class="data-sub">${escapeHtml(rdv.modalite)}</div>` : ''}
        ${rdv.prixParPersonne ? `<div class="data-sub">${Number(rdv.prixParPersonne).toFixed(2)} € / personne</div>` : ''}
        <div style="margin-top:8px;">${statutHtml}</div>
      </div>
    </div>`;
  }).join('');
}

window.repondreRdv = async (rdvId, statut) => {
  const rdv = (await getDoc(doc(db, 'rdv', rdvId))).data();
  const nombrePersonnes = statut === 'present' ? (parseInt(document.getElementById('rd-nb-' + rdvId)?.value, 10) || 1) : 1;
  const montant = rdv.prixParPersonne ? rdv.prixParPersonne * nombrePersonnes : 0;
  const cle = `${rdvId}_${membreUid}`;
  await setDoc(doc(db, 'rdv_reponses', cle), {
    rdvId, uid: membreUid, statut, nombrePersonnes, montant, paye: false, paiementValide: false,
    dateReponse: new Date().toISOString()
  });
  chargerRdv();
};

window.signalerPaiementRdv = async (reponseId) => {
  await updateDoc(doc(db, 'rdv_reponses', reponseId), { paye: true });
  chargerRdv();
};

// ==========================================================================
// CHAT avec Katia
// ==========================================================================
async function chargerChat() {
  const msgsSnap = await getDocs(collection(db, 'conversations', membreUid, 'messages'));
  const msgs = [];
  msgsSnap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
  msgs.sort((a, b) => (a.dateEnvoi || '').localeCompare(b.dateEnvoi || ''));

  const wrap = document.getElementById('chatThreadMembre');
  wrap.innerHTML = msgs.map(m => bulleMessage(m)).join('') || '<div class="empty-state">Aucun message pour l\'instant. Dites bonjour à Katia !</div>';
  wrap.scrollTop = 999999;
}

async function marquerChatLu() {
  const msgsSnap = await getDocs(collection(db, 'conversations', membreUid, 'messages'));
  const nonLus = [];
  msgsSnap.forEach(d => {
    const m = d.data();
    if (m.expediteur === 'admin' && !m.lu) nonLus.push(d.id);
  });
  if (nonLus.length > 0) {
    await Promise.all(nonLus.map(id => updateDoc(doc(db, 'conversations', membreUid, 'messages', id), { lu: true })));
    await setDoc(doc(db, 'conversations', membreUid), { nonLuMembre: false }, { merge: true });
  }
  document.getElementById('zoneAlerteMessage').innerHTML = '';
  document.getElementById('tabMessagesBtn')?.classList.remove('has-unread');
  chargerChat();
}

async function afficherAlerteMessage() {
  const convDoc = await getDoc(doc(db, 'conversations', membreUid));
  const zone = document.getElementById('zoneAlerteMessage');
  const nonLu = convDoc.exists() && convDoc.data().nonLuMembre;
  document.getElementById('tabMessagesBtn')?.classList.toggle('has-unread', !!nonLu);
  if (nonLu) {
    zone.innerHTML = `
      <div class="alerte-message" onclick="window.ouvrirMessagesEtLire()">
        💬 Vous avez un nouveau message de Katia — cliquez pour le lire
      </div>`;
  } else {
    zone.innerHTML = '';
  }
}

window.ouvrirMessagesEtLire = () => {
  document.querySelector('.tab-btn[data-tab="messages"]').click();
  marquerChatLu();
};

window.marquerMessagesLusDepuisAccordeon = () => marquerChatLu();

async function envoyerMessageMembre() {
  const input = document.getElementById('chatInputMembre');
  const texte = input.value.trim();
  if (!texte) return;
  input.value = '';
  const maintenant = new Date().toISOString();
  await addDoc(collection(db, 'conversations', membreUid, 'messages'), {
    texte, expediteur: 'membre', dateEnvoi: maintenant, lu: false
  });
  await setDoc(doc(db, 'conversations', membreUid), {
    dernierMessage: texte, dateDernierMessage: maintenant, nonLuAdmin: true
  }, { merge: true });
  chargerChat();
}

function bulleMessage(m) {
  const estMoi = m.expediteur === 'membre';
  const heure = m.dateEnvoi ? new Date(m.dateEnvoi).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
  const coche = estMoi ? `<span class="chat-check ${m.lu ? 'lu' : ''}">${m.lu ? '✓✓' : '✓'}</span>` : '';
  return `
    <div class="chat-bubble ${estMoi ? 'moi' : 'autre'}">
      ${escapeHtml(m.texte)}
      <div class="chat-meta">${heure} ${coche}</div>
    </div>`;
}

// ==========================================================================
// VIDÉOS D'APPRENTISSAGE + COMMENTAIRES
// ==========================================================================
function idYoutube(url) {
  const m = url.match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function chargerVideosMembre() {
  const snap = await getDocs(collection(db, 'videos'));
  const videos = [];
  snap.forEach(d => videos.push({ id: d.id, ...d.data() }));

  const wrap = document.getElementById('zoneVideos');
  if (videos.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune vidéo pour l\'instant.</div>';
    return;
  }

  const blocs = await Promise.all(videos.map(async (v) => {
    const yid = idYoutube(v.url || '');
    const commentsSnap = await getDocs(collection(db, 'videos', v.id, 'commentaires'));
    const comments = [];
    commentsSnap.forEach(d => comments.push(d.data()));
    comments.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    return `
    <div class="app-panel" style="margin-bottom:0;">
      <h3>${escapeHtml(v.titre)}</h3>
      ${yid ? `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${yid}" title="${escapeHtml(v.titre)}" allowfullscreen></iframe></div>` : `<p><a href="${escapeHtml(v.url)}" target="_blank" rel="noopener">Voir la vidéo</a></p>`}
      ${v.texte ? `<p style="white-space:pre-wrap;">${escapeHtml(v.texte)}</p>` : ''}
      <div style="margin-top:14px;">
        <div id="comments-${v.id}">
          ${comments.map(c => `<div class="comment-item"><span class="comment-auteur">${escapeHtml(c.auteur)}</span>${escapeHtml(c.texte)}</div>`).join('') || '<p style="color:var(--slate); font-size:0.85rem;">Aucun commentaire pour l\'instant.</p>'}
        </div>
        <div class="comment-input-row">
          <input type="text" id="comment-input-${v.id}" placeholder="Ajouter un commentaire...">
          <button class="btn-sm primary" onclick="window.ajouterCommentaire('${v.id}')">Envoyer</button>
        </div>
      </div>
    </div>`;
  }));

  wrap.innerHTML = blocs.join('<div style="height:16px;"></div>');
}

window.ajouterCommentaire = async (videoId) => {
  const input = document.getElementById('comment-input-' + videoId);
  const texte = input.value.trim();
  if (!texte) return;
  input.value = '';
  await addDoc(collection(db, 'videos', videoId, 'commentaires'), {
    texte, auteur: membreData.nomMaitre || 'Membre', uid: membreUid,
    date: new Date().toISOString()
  });
  chargerVideosMembre();
};

// ==========================================================================
// MON PROFIL — le membre encode/modifie ses propres infos
// ==========================================================================
function preremplirMonProfil() {
  const rc = membreData.assuranceRC || {};

  document.getElementById('mp-gsm').value = membreData.gsm || '';
  document.getElementById('mp-email').value = membreData.email || '';
  document.getElementById('mp-adresse').value = membreData.adressePostale || '';
  document.getElementById('mp-anniversaire').value = membreData.dateAnniversaire || '';
  document.getElementById('mp-trouveVia').value = membreData.trouveVia || '';
  document.getElementById('mp-trouveViaDetail').value = membreData.trouveViaDetail || '';
  document.getElementById('mp-conducteurNom').value = membreData.conducteurNom || '';
  document.getElementById('mp-conducteurGsm').value = membreData.conducteurGsm || '';
  document.getElementById('mp-conducteurEmail').value = membreData.conducteurEmail || '';

  document.getElementById('mp-rcCompagnie').value = rc.compagnie || '';
  document.getElementById('mp-rcNumero').value = rc.numeroPolice || '';
  document.getElementById('mp-rcEcheance').value = rc.dateEcheance || '';

  // Champs liés aux cours (conducteur du chien, assurance RC) : masqués si
  // le membre n'a pas l'accès Cours. Comme côté admin, un membre déjà
  // existant sans champ accesCours (pas encore migré) est considéré comme y
  // ayant accès par défaut.
  const aAccesCours = membreData.accesCours !== undefined ? !!membreData.accesCours : true;
  document.querySelectorAll('.mp-groupeCours').forEach(bloc => bloc.classList.toggle('hidden', !aAccesCours));
}

document.getElementById('mp-enregistrer').addEventListener('click', async () => {
  const btn = document.getElementById('mp-enregistrer');
  const statut = document.getElementById('mp-statut');
  btn.disabled = true;
  statut.textContent = 'Enregistrement...';

  const data = {
    gsm: document.getElementById('mp-gsm').value.trim(),
    email: document.getElementById('mp-email').value.trim(),
    adressePostale: document.getElementById('mp-adresse').value.trim(),
    dateAnniversaire: document.getElementById('mp-anniversaire').value,
    trouveVia: document.getElementById('mp-trouveVia').value,
    trouveViaDetail: document.getElementById('mp-trouveViaDetail').value.trim(),
    conducteurNom: document.getElementById('mp-conducteurNom').value.trim(),
    conducteurGsm: document.getElementById('mp-conducteurGsm').value.trim(),
    conducteurEmail: document.getElementById('mp-conducteurEmail').value.trim(),
    assuranceRC: {
      compagnie: document.getElementById('mp-rcCompagnie').value.trim(),
      numeroPolice: document.getElementById('mp-rcNumero').value.trim(),
      dateEcheance: document.getElementById('mp-rcEcheance').value
    }
  };

  try {
    await updateDoc(doc(db, 'membres', membreUid), data);
    membreData = { ...membreData, ...data };
    document.getElementById('membreNom').textContent = membreData.nomMaitre || '';
    statut.textContent = 'Profil enregistré ✓';
  } catch (e) {
    statut.textContent = 'Erreur : ' + e.message;
  }
  btn.disabled = false;
});

// ==========================================================================
// MES CHIENS — plusieurs chiens possibles, archivage individuel (ex: décès)
// ==========================================================================
function optionsMarqueVaccinMembre(valeurActuelle) {
  return ['', 'Eurican', 'Versican', 'Nobivac', 'Autres'].map(m =>
    `<option value="${m}" ${valeurActuelle === m ? 'selected' : ''}>${m || '—'}</option>`
  ).join('');
}

function afficherMesChiens() {
  const chiens = (membreData.chiens || []).filter(c => !c.archive);
  const wrap = document.getElementById('mc-liste');
  if (chiens.length === 0) {
    wrap.innerHTML = '<p style="color:var(--slate); font-size:0.85rem;">Aucun chien enregistré pour l\'instant.</p>';
    return;
  }
  wrap.innerHTML = chiens.map(c => {
    const alertesVaccins = alerteVaccinsChien(c);
    return `
    <div class="dog-card">
      <div class="dog-card-head">
        <div>
          <div class="dog-title">${escapeHtml(c.nom || 'Sans nom')} ${c.race ? '— ' + escapeHtml(c.race) : ''}</div>
          <div class="dog-sub">${c.pedigree ? 'Pedigree · ' : ''}${c.puce ? 'Puce ' + escapeHtml(c.puce) : 'Puce non renseignée'}</div>
        </div>
        <div class="data-actions">
          <button class="btn-sm" type="button" onclick="window.ouvrirFormChien('${c.id}')">Modifier</button>
          <button class="btn-sm danger" type="button" onclick="window.archiverMonChien('${c.id}')">Archiver</button>
        </div>
      </div>
      ${alertesVaccins.length ? `<div class="banner-alert" style="margin-top:10px; padding:8px 12px;">💉 ${alertesVaccins.join(', ')}</div>` : ''}
    </div>`;
  }).join('');
}

document.getElementById('mc-ajouter').addEventListener('click', () => window.ouvrirFormChien(null));

window.ouvrirFormChien = (chienId) => {
  const chien = chienId ? (membreData.chiens || []).find(c => c.id === chienId) : null;
  const v = chien?.vaccins || {};

  const html = `
    <div class="modal-overlay" id="modalOverlayChien">
      <div class="modal-box" style="max-width:520px;">
        <h3>${chien ? 'Modifier le chien' : 'Ajouter un chien'}</h3>
        <div class="form-grid">
          <div class="field"><label>Nom du chien</label><input id="fc-nom" value="${chien ? escapeHtml(chien.nom||'') : ''}"></div>
          <div class="field"><label>Race</label><input id="fc-race" value="${chien ? escapeHtml(chien.race||'') : ''}"></div>
          <div class="field"><label>Date de naissance</label><input type="date" id="fc-naissance" value="${chien ? (chien.naissance||'') : ''}"></div>
          <div class="field"><label>Sexe</label>
            <select id="fc-sexe">
              <option value="male" ${chien?.sexe==='male' ? 'selected':''}>Mâle</option>
              <option value="femelle" ${chien?.sexe==='femelle' ? 'selected':''}>Femelle</option>
            </select>
          </div>
          <div class="field"><label>Castré / Stérilisée</label>
            <select id="fc-sterilise">
              <option value="non" ${!chien?.sterilise ? 'selected':''}>Non</option>
              <option value="oui" ${chien?.sterilise ? 'selected':''}>Oui</option>
            </select>
          </div>
          <div class="field"><label>Date (si oui)</label><input type="date" id="fc-dateSterilisation" value="${chien ? (chien.dateSterilisation||'') : ''}"></div>
          <div class="field"><label>N° de puce</label><input id="fc-puce" value="${chien ? escapeHtml(chien.puce||'') : ''}"></div>
          <div class="field"><label>N° de passeport</label><input id="fc-passeport" value="${chien ? escapeHtml(chien.passeport||'') : ''}"></div>
          <div class="field"><label>Pedigree</label>
            <select id="fc-pedigree">
              <option value="non" ${!chien?.pedigree ? 'selected':''}>Non</option>
              <option value="oui" ${chien?.pedigree ? 'selected':''}>Oui</option>
            </select>
          </div>
        </div>

        <div class="form-grid">
          <div class="field"><label>Origine</label>
            <select id="fc-origine">
              <option value="" ${!chien?.origine ? 'selected':''}>—</option>
              <option value="Elevage familial" ${chien?.origine==='Elevage familial' ? 'selected':''}>Élevage familial</option>
              <option value="Petshop" ${chien?.origine==='Petshop' ? 'selected':''}>Petshop</option>
              <option value="Refuge" ${chien?.origine==='Refuge' ? 'selected':''}>Refuge</option>
              <option value="Autre" ${chien?.origine==='Autre' ? 'selected':''}>Autre</option>
            </select>
          </div>
          <div class="field"><label>Nom et lieu de l'origine</label><input id="fc-origineDetail" value="${chien ? escapeHtml(chien.origineDetail||'') : ''}" placeholder="ex: Élevage du Bois Joli, Andenne"></div>
        </div>

        <h3 style="margin-top:16px;">Vaccins</h3>
        <div class="form-grid">
          <div class="field"><label>Leptospirose — marque</label><select id="fc-vaxLepto-marque">${optionsMarqueVaccinMembre(v.leptospirose?.marque)}</select></div>
          <div class="field"><label>Leptospirose — date</label><input type="date" id="fc-vaxLepto-date" value="${v.leptospirose?.date||''}"></div>
          <div class="field"><label>Parvovirose — marque</label><select id="fc-vaxParvo-marque">${optionsMarqueVaccinMembre(v.parvovirose?.marque)}</select></div>
          <div class="field"><label>Parvovirose — date</label><input type="date" id="fc-vaxParvo-date" value="${v.parvovirose?.date||''}"></div>
          <div class="field"><label>Toux du chenil — marque</label><select id="fc-vaxToux-marque">${optionsMarqueVaccinMembre(v.touxChenils?.marque)}</select></div>
          <div class="field"><label>Toux du chenil — date</label><input type="date" id="fc-vaxToux-date" value="${v.touxChenils?.date||''}"></div>
          <div class="field"><label>Rage — date</label><input type="date" id="fc-vaxRage-date" value="${v.rage?.date||''}"></div>
        </div>

        <div class="modal-actions">
          <button class="btn-sm" type="button" onclick="document.getElementById('modalOverlayChien').remove()">Annuler</button>
          <button class="btn-sm primary" type="button" id="fc-save">Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('fc-save').addEventListener('click', async () => {
    const nouveauChien = {
      id: chien ? chien.id : 'chien-' + Date.now(),
      nom: document.getElementById('fc-nom').value.trim(),
      race: document.getElementById('fc-race').value.trim(),
      naissance: document.getElementById('fc-naissance').value,
      sexe: document.getElementById('fc-sexe').value,
      sterilise: document.getElementById('fc-sterilise').value === 'oui',
      dateSterilisation: document.getElementById('fc-dateSterilisation').value,
      puce: document.getElementById('fc-puce').value.trim(),
      passeport: document.getElementById('fc-passeport').value.trim(),
      pedigree: document.getElementById('fc-pedigree').value === 'oui',
      origine: document.getElementById('fc-origine').value,
      origineDetail: document.getElementById('fc-origineDetail').value.trim(),
      archive: false,
      vaccins: {
        leptospirose: { marque: document.getElementById('fc-vaxLepto-marque').value, date: document.getElementById('fc-vaxLepto-date').value },
        parvovirose: { marque: document.getElementById('fc-vaxParvo-marque').value, date: document.getElementById('fc-vaxParvo-date').value },
        touxChenils: { marque: document.getElementById('fc-vaxToux-marque').value, date: document.getElementById('fc-vaxToux-date').value },
        rage: { date: document.getElementById('fc-vaxRage-date').value }
      }
    };
    if (!nouveauChien.nom) { alert('Merci d\'indiquer le nom du chien.'); return; }

    const chiensActuels = membreData.chiens || [];
    const nouveauxChiens = chien
      ? chiensActuels.map(c => c.id === chien.id ? nouveauChien : c)
      : [...chiensActuels, nouveauChien];

    await updateDoc(doc(db, 'membres', membreUid), { chiens: nouveauxChiens });
    membreData.chiens = nouveauxChiens;
    document.getElementById('modalOverlayChien').remove();
    afficherMesChiens();
    document.getElementById('chienNom').textContent = nomsChiensActifs();
  });
};

window.archiverMonChien = async (chienId) => {
  if (!confirm('Archiver ce chien ? (par ex. en cas de décès) Ses informations resteront conservées.')) return;
  const nouveauxChiens = (membreData.chiens || []).map(c => c.id === chienId ? { ...c, archive: true } : c);
  await updateDoc(doc(db, 'membres', membreUid), { chiens: nouveauxChiens });
  membreData.chiens = nouveauxChiens;
  afficherMesChiens();
  document.getElementById('chienNom').textContent = nomsChiensActifs();
};

// ==========================================================================
// HISTORIQUE DE MES PAIEMENTS (lecture seule)
// ==========================================================================
async function chargerHistoriquePaiementsMembre() {
  const zone = document.getElementById('zonePaiements');
  const snap = await getDocs(query(collection(db, 'paiements'), where('membreId', '==', membreUid)));
  const paiements = [];
  snap.forEach(d => paiements.push(d.data()));
  paiements.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (paiements.length === 0) {
    zone.innerHTML = '<div class="empty-state">Aucun paiement enregistré pour l\'instant.</div>';
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
        ${p.numeroFacture ? `<button class="btn-sm" onclick="window.telechargerMaFacture('${p.numeroFacture}')">Télécharger ma facture</button>` : ''}
      </div>
    </div>`).join('');
}

// ==========================================================================
// VACCINS — échéances calculées à 1 an après la dernière date indiquée
// ==========================================================================
const LABELS_VACCINS_MEMBRE = { leptospirose: 'Leptospirose', parvovirose: 'Parvovirose', touxChenils: 'Toux du chenil', rage: 'Rage' };
const DUREE_VALIDITE_ANNEES_VACCINS_MEMBRE = { rage: 3 };
const FENETRE_RAPPEL_JOURS_VACCINS_MEMBRE = { rage: 90 };

function alerteVaccinsChien(chien) {
  const aujourdhui = new Date(); aujourdhui.setHours(0,0,0,0);
  const v = chien.vaccins || {};
  const alertes = [];
  Object.keys(LABELS_VACCINS_MEMBRE).forEach(cle => {
    const date = v[cle]?.date;
    if (!date) return;
    const echeance = new Date(date + 'T00:00:00');
    echeance.setFullYear(echeance.getFullYear() + (DUREE_VALIDITE_ANNEES_VACCINS_MEMBRE[cle] || 1));
    const fenetreRappelJours = FENETRE_RAPPEL_JOURS_VACCINS_MEMBRE[cle] || 30;
    const dateRappel = new Date(aujourdhui); dateRappel.setDate(aujourdhui.getDate() + fenetreRappelJours);
    if (echeance <= dateRappel) {
      const enRetard = echeance < aujourdhui;
      alertes.push(`${LABELS_VACCINS_MEMBRE[cle]}${enRetard ? ' en retard' : ' à renouveler bientôt'}`);
    }
  });
  return alertes;
}

// ==========================================================================
// BOUTIQUE — panier local puis commande à valider par l'admin
// ==========================================================================
let panierLocal = [];
let mesDemandesDogSittingIds = [];

async function chargerBoutiqueMembre() {
  const wrap = document.getElementById('zoneArticlesBoutique');
  try {
    const snap = await getDocs(query(collection(db, 'articles_boutique'), where('actif', '==', true)));
    const articles = [];
    snap.forEach(d => articles.push({ id: d.id, ...d.data() }));
    articles.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

    if (articles.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Aucun article disponible pour l\'instant.</div>';
    } else {
      wrap.innerHTML = articles.map(a => `
        <div class="data-row">
          <div class="data-row-left">
            ${a.photoURL ? `<img class="data-thumb" src="${escapeHtml(a.photoURL)}">` : ''}
            <div class="data-main">
              <div class="data-title">${escapeHtml(a.nom)}</div>
              <div class="data-sub">${a.poids ? `${formaterPoids(a.poids, a.poidsUnite)} ${a.poidsUnite || 'g'} · ` : ''}${Number(a.prix).toFixed(2)} € TTC · ${a.stock > 0 ? `${a.stock} en stock` : '<span class="badge badge-danger">Rupture de stock</span>'}</div>
              ${a.infoDescription ? `<div class="data-sub" style="white-space:pre-wrap;">${texteAvecLiens(a.infoDescription)}</div>` : ''}
            </div>
          </div>
          <div class="data-actions">
            <button class="btn-sm primary" ${a.stock <= 0 ? 'disabled' : ''} onclick="window.ajouterAuPanier('${a.id}', '${escapeHtml(a.nom)}', ${a.prix}, ${a.stock})">Ajouter au panier</button>
          </div>
        </div>`).join('');
    }
  } catch (err) {
    wrap.innerHTML = `<div class="banner-alert" style="background:#FBEAEA; border-color:#E3B4B4; color:#8A2E2E;">Erreur : ${escapeHtml(err.code || '')} — ${escapeHtml(err.message || String(err))}</div>`;
    return;
  }

  afficherPanier();
  chargerMesCommandes();
}

// Aperçu simplifié de quelques articles, pour la page d'accueil des membres
// qui ne sont rattachés à aucun groupe (Dog Sitting / Boutique uniquement).
async function afficherApercuBoutique() {
  const wrap = document.getElementById('zoneApercuBoutique');
  if (!wrap) return;
  const snap = await getDocs(query(collection(db, 'articles_boutique'), where('actif', '==', true)));
  const articles = [];
  snap.forEach(d => articles.push({ id: d.id, ...d.data() }));
  articles.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  if (articles.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun article disponible pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = articles.slice(0, 4).map(a => `
    <div class="data-row">
      <div class="data-row-left">
        ${a.photoURL ? `<img class="data-thumb" src="${escapeHtml(a.photoURL)}">` : ''}
        <div class="data-main">
          <div class="data-title">${escapeHtml(a.nom)}</div>
          <div class="data-sub">${Number(a.prix).toFixed(2)} € TTC</div>
        </div>
      </div>
    </div>`).join('');
}

window.ajouterAuPanier = (articleId, nom, prix, stock) => {
  const existant = panierLocal.find(l => l.articleId === articleId);
  if (existant) {
    if (existant.quantite >= stock) { alert('Stock insuffisant.'); return; }
    existant.quantite++;
  } else {
    panierLocal.push({ articleId, nom, prix, quantite: 1 });
  }
  afficherPanier();
};

window.retirerDuPanier = (articleId) => {
  panierLocal = panierLocal.filter(l => l.articleId !== articleId);
  afficherPanier();
};

function afficherPanier() {
  const wrap = document.getElementById('zonePanier');
  const totalEl = document.getElementById('panierTotal');
  if (panierLocal.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Panier vide.</div>';
    totalEl.textContent = '';
    return;
  }
  wrap.innerHTML = panierLocal.map(l => `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${l.quantite} × ${escapeHtml(l.nom)}</div>
        <div class="data-sub">${(l.prix * l.quantite).toFixed(2)} € TTC</div>
      </div>
      <div class="data-actions">
        <button class="btn-sm danger" onclick="window.retirerDuPanier('${l.articleId}')">Retirer</button>
      </div>
    </div>`).join('');
  const total = panierLocal.reduce((s, l) => s + l.prix * l.quantite, 0);
  totalEl.textContent = `Total : ${total.toFixed(2)} € TTC`;
}

document.getElementById('btnValiderPanier').addEventListener('click', async () => {
  if (panierLocal.length === 0) { alert('Votre panier est vide.'); return; }
  const total = panierLocal.reduce((s, l) => s + l.prix * l.quantite, 0);
  await addDoc(collection(db, 'commandes'), {
    membreId: membreUid,
    lignes: panierLocal.map(l => ({ articleId: l.articleId, nom: l.nom, prixUnitaire: l.prix, quantite: l.quantite })),
    total,
    statut: 'en_attente',
    dateCreation: serverTimestamp()
  });
  panierLocal = [];
  afficherPanier();
  alert('Commande envoyée à Katia pour validation.');
  chargerMesCommandes();
});

async function chargerMesCommandes() {
  const snap = await getDocs(query(collection(db, 'commandes'), where('membreId', '==', membreUid)));
  const commandes = [];
  snap.forEach(d => commandes.push({ id: d.id, ...d.data() }));
  commandes.sort((a, b) => (b.dateCreation?.toMillis?.() || 0) - (a.dateCreation?.toMillis?.() || 0));

  const wrap = document.getElementById('zoneMesCommandes');
  if (commandes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune commande pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = commandes.map(c => {
    const detail = (c.lignes || []).map(l => `${l.quantite} × ${escapeHtml(l.nom)}`).join(', ');
    const badge = c.statut === 'validee' ? '<span class="badge badge-ok">Validée</span>'
      : c.statut === 'annulee' ? '<span class="badge badge-danger">Annulée</span>'
      : '<span class="badge badge-warn">En attente</span>';
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${Number(c.total).toFixed(2)} € TTC ${badge}</div>
        <div class="data-sub">${detail}</div>
        ${c.numeroFacture ? `<div class="data-sub">Facture n° <strong>${escapeHtml(c.numeroFacture)}</strong></div>` : ''}
      </div>
      <div class="data-actions">
        ${c.numeroFacture ? `<button class="btn-sm" onclick="window.telechargerMaFacture('${c.numeroFacture}')">Télécharger ma facture</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ==========================================================================
// Filet de sécurité : si une zone reste bloquée sur "..." après un moment,
// c'est qu'un chargement a échoué silencieusement — on le dit clairement.
// ==========================================================================
setTimeout(() => {
  document.querySelectorAll('.empty-state').forEach(el => {
    if (el.textContent.trim() === '...') {
      el.textContent = 'Page vide — une erreur a peut-être empêché le chargement. Recharge la page (Ctrl+F5).';
    }
  });
}, 7000);

// ==========================================================================
// BLOG — lecture seule, avec point rouge sur l'onglet si nouvel article
// ==========================================================================
async function chargerBlogMembre() {
  const snap = await getDocs(collection(db, 'articles'));
  const articles = [];
  snap.forEach(d => { const a = { id: d.id, ...d.data() }; if (!a.archive) articles.push(a); });
  articles.sort((a, b) => (b.datePublication || '').localeCompare(a.datePublication || ''));

  const wrap = document.getElementById('zoneBlog');
  if (articles.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun article publié pour l\'instant.</div>';
  } else {
    wrap.innerHTML = articles.map(a => `
      <div class="app-panel" style="margin-bottom:14px;">
        ${a.image ? `<img src="${escapeHtml(a.image)}" alt="${escapeHtml(a.titre)}" style="width:100%; max-height:260px; object-fit:cover; border-radius:6px; margin-bottom:14px;">` : ''}
        <h3 style="font-size:1.15rem;">${escapeHtml(a.titre)}</h3>
        <p style="color:var(--slate); font-size:0.8rem; margin-bottom:10px;">${a.datePublication || ''}</p>
        <p style="white-space:pre-wrap;">${texteAvecLiens(a.contenu)}</p>
        ${a.lien ? `<a href="${escapeHtml(a.lien)}" target="_blank" rel="noopener noreferrer" class="btn-sm" style="display:inline-block; text-decoration:none; margin-top:10px;">🔗 En savoir plus</a>` : ''}
      </div>`).join('');
  }

  const dernierArticle = articles[0]?.datePublication || '';
  const dernierVu = membreData.dernierBlogVu || '';
  document.getElementById('tabBlogBtn')?.classList.toggle('has-unread', dernierArticle > dernierVu);
}

window.marquerBlogLu = async () => {
  const aujourdhui = dateISOLocale(new Date());
  await updateDoc(doc(db, 'membres', membreUid), { dernierBlogVu: aujourdhui });
  membreData.dernierBlogVu = aujourdhui;
  document.getElementById('tabBlogBtn')?.classList.remove('has-unread');
};

// ==========================================================================
// HISTORIQUE DE MES PRÉSENCES
// ==========================================================================
async function chargerHistoriquePresencesMembre() {
  const snap = await getDocs(query(collection(db, 'presences'), where('uid', '==', membreUid)));
  const presences = [];
  snap.forEach(d => presences.push(d.data()));
  presences.sort((a, b) => (b.dateISO || '').localeCompare(a.dateISO || ''));

  const wrap = document.getElementById('zonePresences');
  if (presences.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucun historique pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = presences.map(p => {
    let badge;
    if (p.statut === 'present') badge = '<span class="badge badge-ok">Présent(e)</span>';
    else if (p.statut === 'absent-auto') badge = '<span class="badge badge-warn">Non répondu — décompté</span>';
    else if (p.statut === 'absent-justifie') badge = '<span class="badge badge-neutral">Absent(e) justifié(e) — non décompté</span>';
    else badge = '<span class="badge badge-neutral">Absent(e) (signalé)</span>';
    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${p.dateISO || ''}</div>
        <div class="data-sub">${badge}</div>
      </div>
    </div>`;
  }).join('');
}

// ==========================================================================
// DOG SITTING — visible uniquement si l'admin a donné l'accès. Un seul
// chien accueilli à la fois : si la période chevauche une réservation déjà
// validée, la demande part "en attente" et Katia doit valider elle-même.
// ==========================================================================
async function chargerDogSittingMembre() {
  const selectChien = document.getElementById('ds-chien');
  const chiensActifs = (membreData.chiens || []).filter(c => !c.archive);
  selectChien.innerHTML = chiensActifs.map(c => `<option value="${escapeHtml(c.nom)}">${escapeHtml(c.nom)}</option>`).join('')
    || '<option value="">Ajoutez d\'abord un chien dans "Mon chien"</option>';

  await chargerMesDemandesDogSitting();
}

async function prixDogSittingParJour() {
  const snap = await getDocs(query(collection(db, 'services'), where('categorie', '==', 'Dog Sitting')));
  let prix = 22; // valeur par défaut si le service n'a pas encore été configuré
  snap.forEach(d => { if (typeof d.data().prix === 'number') prix = d.data().prix; });
  return prix;
}

function nbJoursDogSitting(dateDebut, dateFin) {
  const d1 = new Date(dateDebut + 'T00:00:00');
  const d2 = new Date(dateFin + 'T00:00:00');
  return Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
}

async function chargerMesDemandesDogSitting() {
  const snap = await getDocs(query(collection(db, 'dogsitting'), where('membreId', '==', membreUid)));
  const demandes = [];
  snap.forEach(d => demandes.push({ id: d.id, ...d.data() }));
  demandes.sort((a, b) => (b.dateDebut || '').localeCompare(a.dateDebut || ''));

  const nonVues = demandes.filter(r => r.vuParMembre === false);
  mesDemandesDogSittingIds = demandes.map(r => r.id);
  document.getElementById('tabDogSittingBtn')?.classList.toggle('has-unread', nonVues.length > 0);

  const wrap = document.getElementById('zoneDogSitting');
  if (demandes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune demande pour l\'instant.</div>';
    return;
  }
  wrap.innerHTML = demandes.map(r => {
    const badge = r.statut === 'validee' ? '<span class="badge badge-ok">Validée</span>'
      : r.statut === 'refusee' ? '<span class="badge badge-danger">Refusée</span>'
      : r.statut === 'annulee' ? '<span class="badge badge-danger">Annulée par Katia</span>'
      : '<span class="badge badge-warn">En attente de validation (dates déjà réservées)</span>';

    let blocAcompte = '';
    if (r.statut === 'annulee' && r.motifAnnulation) {
      blocAcompte = `<div class="banner-alert" style="margin-top:8px;">Motif : ${escapeHtml(r.motifAnnulation)}</div>`;
    } else if (r.statut === 'validee' && r.acompte) {
      const communication = `Dog Sitting ${r.chienNom} ${r.dateDebut}`;
      if (r.acompteValide) {
        blocAcompte = `<div style="margin-top:8px;"><span class="badge badge-ok">✅ Date bloquée — acompte reçu et validé</span></div>`;
      } else {
        blocAcompte = `
          <div class="banner-alert" style="margin-top:8px;">
            Un acompte de <strong>30%</strong> est requis pour bloquer définitivement ces dates : <strong>${r.acompte.toFixed(2)} €</strong> (sur un total estimé de ${r.total.toFixed(2)} €).<br>
            À verser sur : <strong>${ENTREPRISE_IBAN}</strong> (BIC ${ENTREPRISE_BIC})<br>
            Communication : <strong>${escapeHtml(communication)}</strong>
            <div class="presence-btns" style="margin-top:8px;">
              ${r.acomptePaye
                ? '<span class="badge badge-ok">Vous avez indiqué avoir payé</span> <span class="badge badge-warn">En attente de validation par Katia</span>'
                : `<button class="btn-sm primary" onclick="window.signalerAcomptePaye('${r.id}')">J'ai payé l'acompte</button>`}
            </div>
          </div>`;
      }
    }

    return `
    <div class="data-row">
      <div class="data-main">
        <div class="data-title">${escapeHtml(r.chienNom)} ${badge}</div>
        <div class="data-sub">Du ${r.dateDebut} ${r.heureArrivee || ''} au ${r.dateFin} ${r.heureDepart || ''}</div>
        ${blocAcompte}
      </div>
    </div>`;
  }).join('');
}

window.signalerAcomptePaye = async (reservationId) => {
  await updateDoc(doc(db, 'dogsitting', reservationId), { acomptePaye: true });
  chargerMesDemandesDogSitting();
};

document.getElementById('ds-envoyer').addEventListener('click', async () => {
  const statutEl = document.getElementById('ds-statut');
  const chienNom = document.getElementById('ds-chien').value;
  const dateDebut = document.getElementById('ds-dateDebut').value;
  const dateFin = document.getElementById('ds-dateFin').value;
  const heureArrivee = document.getElementById('ds-heureArrivee').value;
  const heureDepart = document.getElementById('ds-heureDepart').value;

  if (!chienNom || !dateDebut || !dateFin) { statutEl.textContent = 'Merci de remplir le chien et les deux dates.'; return; }
  if (dateFin < dateDebut) { statutEl.textContent = 'La date de départ doit être après la date d\'arrivée.'; return; }
  if (!document.getElementById('ds-consentement').checked) { statutEl.textContent = 'Merci de confirmer avoir pris connaissance des conditions (case à cocher en bas du formulaire).'; return; }

  const apporte = {
    carnet: document.getElementById('ds-apporte-carnet').checked,
    couche: document.getElementById('ds-apporte-couche').checked,
    gamelle: document.getElementById('ds-apporte-gamelle').checked,
    nourriture: document.getElementById('ds-apporte-nourriture').checked
  };
  const servicesDemandes = {
    domicile: document.getElementById('ds-service-domicile').checked,
    balades: document.getElementById('ds-service-balades').checked,
    reeducation: document.getElementById('ds-service-reeducation').checked,
    toilettage: document.getElementById('ds-service-toilettage').value
  };
  const habitudesDeVie = document.getElementById('ds-habitudes').value.trim();

  statutEl.textContent = 'Envoi en cours...';

  try {
    // Vérifie s'il y a chevauchement avec une réservation déjà validée
    // (tous membres confondus) : un seul chien à la fois par défaut.
    // Utilise le miroir "dogsitting_dates" (dates + statut UNIQUEMENT,
    // jamais de nom de membre/chien/notes) pour ne jamais exposer les
    // données personnelles des autres membres pendant cette vérification.
    const snap = await getDocs(query(collection(db, 'dogsitting_dates'), where('statut', '==', 'validee')));
    let chevauchement = false;
    snap.forEach(d => {
      const r = d.data();
      if (dateDebut <= r.dateFin && r.dateDebut <= dateFin) chevauchement = true;
    });

    const prixJour = await prixDogSittingParJour();
    const nbJours = nbJoursDogSitting(dateDebut, dateFin);
    const total = prixJour * nbJours;
    const acompte = Math.round(total * TAUX_ACOMPTE_DOGSITTING_MEMBRE * 100) / 100;
    const statutDemande = chevauchement ? 'attente' : 'validee';

    const refDemande = await addDoc(collection(db, 'dogsitting'), {
      membreId: membreUid, chienNom, dateDebut, dateFin, heureArrivee, heureDepart,
      apporte, servicesDemandes, habitudesDeVie,
      statut: statutDemande,
      total, acompte, acomptePaye: false, acompteValide: false, vuParMembre: true, vuParAdmin: false,
      dateCreation: serverTimestamp()
    });
    await setDoc(doc(db, 'dogsitting_dates', refDemande.id), { dateDebut, dateFin, statut: statutDemande });

    statutEl.textContent = chevauchement
      ? 'Ces dates chevauchent une réservation existante : votre demande est en attente de validation par Katia.'
      : 'Demande envoyée et validée automatiquement (aucun autre chien sur ces dates) !';
    chargerMesDemandesDogSitting();
  } catch (err) {
    statutEl.textContent = 'Erreur : ' + (err.code || '') + ' — ' + (err.message || err);
  }
});

// ==========================================================================
// COMMANDES GROUPÉES (précommandes) — ex: commande groupée de croquettes.
// Modifiable tant que la date limite n'est pas dépassée et que Katia n'a
// pas clôturé la commande groupée.
// ==========================================================================
async function chargerCampagnesMembre() {
  const snap = await getDocs(collection(db, 'campagnes'));
  let campagnes = [];
  snap.forEach(d => campagnes.push({ id: d.id, ...d.data() }));
  const aujourdhuiISO = dateISOLocale(new Date());
  campagnes = campagnes.filter(c => c.statut !== 'cloturee' && c.dateLimite >= aujourdhuiISO);
  campagnes.sort((a, b) => (a.dateLimite || '').localeCompare(b.dateLimite || ''));

  const wrap = document.getElementById('zoneCampagnes');
  if (campagnes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aucune commande groupée en cours.</div>';
    return;
  }

  const precSnap = await getDocs(query(collection(db, 'precommandes'), where('membreId', '==', membreUid)));
  const mesPrecommandes = {};
  precSnap.forEach(d => { mesPrecommandes[d.data().campagneId] = { id: d.id, ...d.data() }; });

  wrap.innerHTML = campagnes.map(c => {
    const dateLimiteLabel = new Date(c.dateLimite + 'T00:00:00').toLocaleDateString('fr-BE');
    const maPrecommande = mesPrecommandes[c.id];
    const quantitesActuelles = {};
    (maPrecommande?.lignes || []).forEach(l => { quantitesActuelles[l.articleId] = l.quantite; });

    return `
    <div class="app-panel" style="margin-bottom:14px;">
      <h3>${escapeHtml(c.titre)}</h3>
      <p style="color:var(--slate); font-size:0.85rem;">${c.description ? escapeHtml(c.description) + ' — ' : ''}À commander avant le <strong>${dateLimiteLabel}</strong></p>
      <div class="form-grid" style="margin-top:10px;">
        ${(c.articles || []).map(a => `
          <div class="field">
            <label>${escapeHtml(a.nom)} (${a.prix.toFixed(2)} € TTC)</label>
            <input type="number" min="0" value="${quantitesActuelles[a.articleId] || 0}" id="camp-${c.id}-${a.articleId}" data-prix="${a.prix}" oninput="window.recalculerTotalPrecommande('${c.id}')">
          </div>`).join('')}
      </div>
      <p id="camp-total-${c.id}" style="font-weight:600; color:var(--navy-dark); margin-top:10px;"></p>
      <button class="btn-sm primary" style="margin-top:4px;" onclick="window.envoyerPrecommande('${c.id}')">
        ${maPrecommande ? 'Mettre à jour ma précommande' : 'Envoyer ma précommande'}
      </button>
      <p id="camp-statut-${c.id}" style="font-size:0.85rem; color:var(--slate); margin-top:6px;"></p>
    </div>`;
  }).join('');

  // Affiche le total initial (précommande déjà envoyée ou tout à 0).
  campagnes.forEach(c => window.recalculerTotalPrecommande(c.id));
}

window.recalculerTotalPrecommande = (campagneId) => {
  const el = document.getElementById(`camp-total-${campagneId}`);
  if (!el) return;
  const inputs = document.querySelectorAll(`input[id^="camp-${campagneId}-"]`);
  let total = 0;
  inputs.forEach(input => {
    const qte = parseInt(input.value, 10) || 0;
    const prix = parseFloat(input.dataset.prix) || 0;
    total += qte * prix;
  });
  el.textContent = `Total à payer : ${total.toFixed(2)} € TTC`;
};

window.envoyerPrecommande = async (campagneId) => {
  const snap = await getDoc(doc(db, 'campagnes', campagneId));
  const campagne = { id: campagneId, ...snap.data() };
  const statutEl = document.getElementById(`camp-statut-${campagneId}`);

  const lignes = [];
  (campagne.articles || []).forEach(a => {
    const qte = parseInt(document.getElementById(`camp-${campagneId}-${a.articleId}`).value, 10) || 0;
    if (qte > 0) lignes.push({ articleId: a.articleId, nom: a.nom, prix: a.prix, quantite: qte });
  });

  if (lignes.length === 0) { statutEl.textContent = 'Indiquez au moins une quantité.'; return; }

  const total = lignes.reduce((s, l) => s + l.prix * l.quantite, 0);

  // Le membre doit valider explicitement le prix avant l'envoi.
  const recap = lignes.map(l => `${l.quantite} × ${l.nom} = ${(l.prix * l.quantite).toFixed(2)} €`).join('\n');
  const confirme = confirm(`Confirmer votre précommande ?\n\n${recap}\n\nTotal à payer : ${total.toFixed(2)} € TTC`);
  if (!confirme) return;

  await setDoc(doc(db, 'precommandes', `${campagneId}_${membreUid}`), {
    campagneId, membreId: membreUid, lignes, total, dateCommande: serverTimestamp(), vu: false
  });
  statutEl.textContent = `Précommande envoyée (${total.toFixed(2)} € TTC) ✓`;
};

// ==========================================================================
// 🎂 Petite surprise annuelle — visible UNIQUEMENT côté membre, jamais dans
// l'admin, pour que Katia ne découvre pas le pot aux roses elle-même.
// Rappelle son anniversaire (18 novembre) aux membres, dans les 10 jours
// précédents et le jour même.
// ==========================================================================
function afficherSurpriseAnniversaireKatia() {
  const aujourdhui = new Date();
  const annee = aujourdhui.getFullYear();
  const anniversaire = new Date(annee, 10, 18); // mois 10 = novembre (0-indexé)
  anniversaire.setHours(0, 0, 0, 0);
  const auj = new Date(aujourdhui); auj.setHours(0, 0, 0, 0);

  const joursRestants = Math.round((anniversaire - auj) / (1000 * 60 * 60 * 24));
  if (joursRestants < 0 || joursRestants > 10) return; // hors fenêtre, rien à afficher

  let texte;
  if (joursRestants === 0) {
    texte = "🎉🎂 Aujourd'hui, c'est l'anniversaire de Katia ! Une petite pensée dans son fil de messages lui ferait sûrement très plaisir 🐾";
  } else if (joursRestants === 1) {
    texte = "🎂 C'est demain, le 18 novembre — l'anniversaire de Katia ! Chut, c'est une surprise 🤫";
  } else {
    texte = `🎂 Dans ${joursRestants} jours (le 18 novembre), c'est l'anniversaire de Katia ! Chut, c'est une surprise 🤫`;
  }

  const banniere = document.createElement('div');
  banniere.className = 'alerte-anniversaire';
  banniere.textContent = texte;
  const main = document.querySelector('.app-main');
  if (main) main.insertBefore(banniere, main.firstChild);
}

// ==========================================================================
// TÉLÉCHARGER MA FACTURE — régénère le même PDF que l'admin, à partir des
// données déjà stockées dans 'factures' (aucun nouvel envoi de mail requis :
// le membre a directement accès à ses propres factures depuis son espace).
// ==========================================================================
const ENTREPRISE_MEMBRE = {
  nom: 'LES BEAUX CABOTS SRL',
  adresse: 'Rue Grande 26',
  codePostal: '4219',
  ville: 'Wasseiges (Meeffe)',
  tva: 'BE0729593814',
  email: 'cabotsdefernelmont@gmail.com',
  tel: '0032 494 05 17 96',
  iban: ENTREPRISE_IBAN,
  bic: ENTREPRISE_BIC
};
const TAUX_TVA_MEMBRE = 21;

window.telechargerMaFacture = async (numeroFacture) => {
  // Filtre à la fois par numéro ET par son propre membreId : garantit qu'un
  // membre ne peut jamais récupérer la facture d'un autre, même en théorie.
  const snap = await getDocs(query(collection(db, 'factures'), where('numero', '==', numeroFacture), where('membreId', '==', membreUid)));
  if (snap.empty) { alert('Facture introuvable.'); return; }
  const facture = snap.docs[0].data();

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let y = 20;

  pdf.setFontSize(16); pdf.setFont(undefined, 'bold');
  pdf.text(ENTREPRISE_MEMBRE.nom, 15, y);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  y += 6; pdf.text('Les Cabots de Fernelmont', 15, y);
  y += 5; pdf.text(`${ENTREPRISE_MEMBRE.adresse}, ${ENTREPRISE_MEMBRE.codePostal} ${ENTREPRISE_MEMBRE.ville}`, 15, y);
  y += 5; pdf.text(`TVA ${ENTREPRISE_MEMBRE.tva}`, 15, y);
  y += 5; pdf.text(`${ENTREPRISE_MEMBRE.email} — ${ENTREPRISE_MEMBRE.tel}`, 15, y);

  pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
  pdf.text('FACTURE', 150, 20);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  pdf.text(`N° ${facture.numero}`, 150, 27);
  pdf.text(`Date : ${new Date(facture.dateEmission + 'T00:00:00').toLocaleDateString('fr-BE')}`, 150, 32);

  y = 55;
  pdf.setFont(undefined, 'bold'); pdf.text('Client', 15, y); pdf.setFont(undefined, 'normal');
  y += 6; pdf.text(membreData.nomMaitre || '', 15, y);
  if (membreData.adressePostale) { y += 5; pdf.text(membreData.adressePostale, 15, y); }
  if (membreData.email) { y += 5; pdf.text(membreData.email, 15, y); }

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

  (facture.lignes || []).forEach(l => {
    y += 8;
    pdf.text(String(l.description).slice(0, 55), 18, y);
    pdf.text(String(l.quantite), 120, y);
    pdf.text(l.prixUnitaireTTC.toFixed(2) + ' €', 140, y);
    pdf.text(l.totalTTC.toFixed(2) + ' €', 168, y);
  });

  y += 14;
  pdf.line(120, y, 195, y);
  y += 6;
  pdf.text('Total HT :', 140, y); pdf.text(facture.totalHT.toFixed(2) + ' €', 168, y);
  y += 6;
  pdf.text(`TVA ${TAUX_TVA_MEMBRE}% :`, 140, y); pdf.text(facture.totalTVA.toFixed(2) + ' €', 168, y);
  y += 6;
  pdf.setFont(undefined, 'bold');
  pdf.text('Total TTC :', 140, y); pdf.text(facture.totalTTC.toFixed(2) + ' €', 168, y);
  pdf.setFont(undefined, 'normal');

  y += 14;
  pdf.setFontSize(9);
  pdf.text(`À payer sur le compte ${ENTREPRISE_MEMBRE.iban} (BIC ${ENTREPRISE_MEMBRE.bic}) — communication : ${facture.numero}`, 15, y);

  y += 14;
  pdf.setFontSize(8); pdf.setTextColor(90, 100, 110);
  pdf.text('Facture soumise aux Conditions Générales de Vente disponibles sur le site du club.', 15, y);
  y += 10;
  pdf.text(`${ENTREPRISE_MEMBRE.nom} — TVA ${ENTREPRISE_MEMBRE.tva} — ${ENTREPRISE_MEMBRE.adresse}, ${ENTREPRISE_MEMBRE.codePostal} ${ENTREPRISE_MEMBRE.ville}`, 15, y);

  pdf.save(`Facture_${facture.numero}.pdf`);
};

// ==========================================================================
// NOTIFICATIONS NAVIGATEUR — pas de vraies notifications "push" façon appli
// mobile (ça demanderait un service payant), mais tant que cette page reste
// ouverte dans un onglet (même en arrière-plan), on peut alerter le membre
// en temps réel pour un nouveau message ou un nouvel article.
// ==========================================================================
let notifsActives = false;
let premierChargementArticles = true;
let dernierNbArticlesConnu = null;

function initNotifications() {
  const btn = document.getElementById('btnActiverNotifs');
  const statutEl = document.getElementById('notifsStatut');
  if (!btn) return;

  if (!('Notification' in window)) {
    statutEl.textContent = 'Ton navigateur ne supporte pas les notifications.';
    btn.disabled = true;
    return;
  }

  if (Notification.permission === 'granted') {
    activerEcouteNotifications();
    btn.textContent = 'Notifications activées ✓';
    btn.disabled = true;
  } else if (Notification.permission === 'denied') {
    statutEl.textContent = 'Les notifications sont bloquées pour ce site — active-les dans les réglages de ton navigateur si tu changes d\'avis.';
  }

  btn.addEventListener('click', async () => {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      activerEcouteNotifications();
      btn.textContent = 'Notifications activées ✓';
      btn.disabled = true;
      statutEl.textContent = '';
    } else {
      statutEl.textContent = 'Notifications refusées. Tu peux réessayer en cliquant à nouveau, ou les activer depuis les réglages du navigateur.';
    }
  });
}

function activerEcouteNotifications() {
  if (notifsActives) return;
  notifsActives = true;

  // Nouveau message de Katia
  onSnapshot(doc(db, 'conversations', membreUid), (snap) => {
    if (snap.exists() && snap.data().nonLuMembre) {
      new Notification('Les Beaux Cabots', {
        body: '💬 Nouveau message de Katia !',
        icon: 'assets/logo.png'
      });
    }
  });

  // Nouvel article sur le blog
  onSnapshot(collection(db, 'articles'), (snap) => {
    if (premierChargementArticles) {
      premierChargementArticles = false;
      dernierNbArticlesConnu = snap.size;
      return;
    }
    if (dernierNbArticlesConnu !== null && snap.size > dernierNbArticlesConnu) {
      new Notification('Les Beaux Cabots', {
        body: '📰 Un nouvel article a été publié sur le blog du club !',
        icon: 'assets/logo.png'
      });
    }
    dernierNbArticlesConnu = snap.size;
  });
}

window.marquerDogSittingVu = async () => {
  if (mesDemandesDogSittingIds.length === 0) return;
  await Promise.all(mesDemandesDogSittingIds.map(id =>
    updateDoc(doc(db, 'dogsitting', id), { vuParMembre: true })
  ));
  document.getElementById('tabDogSittingBtn')?.classList.remove('has-unread');
};

// ==========================================================================
// RÈGLEMENT D'ORDRE INTÉRIEUR (ROI) — lecture + approbation obligatoire.
// ==========================================================================
async function chargerRoiMembre() {
  const snap = await getDoc(doc(db, 'reglement', 'roi'));
  const version = snap.exists() ? snap.data().version : 1;
  const texte = snap.exists() ? snap.data().texte : '';

  document.getElementById('roi-zoneTexte').textContent = texte || 'Le règlement sera bientôt disponible ici.';

  const dejaApprouve = (membreData.reglementVersionApprouvee || 0) >= version;
  document.getElementById('tabReglementBtn')?.classList.toggle('has-unread', !!texte && !dejaApprouve);

  const zoneApprobation = document.getElementById('roi-zoneApprobation');
  if (!texte) {
    zoneApprobation.innerHTML = '';
  } else if (dejaApprouve) {
    const dateLabel = membreData.reglementApprouveLe ? new Date(membreData.reglementApprouveLe + 'T00:00:00').toLocaleDateString('fr-BE') : '';
    zoneApprobation.innerHTML = `<span class="badge badge-ok">✅ Vous avez approuvé ce règlement (version ${version})${dateLabel ? ' le ' + dateLabel : ''}</span>`;
  } else {
    zoneApprobation.innerHTML = `
      <label class="membre-check-row">
        <input type="checkbox" id="roi-checkbox">
        <span>Je déclare avoir lu et j'approuve le Règlement d'Ordre Intérieur ci-dessus.</span>
      </label>
      <button class="btn-sm primary" id="roi-valider" style="margin-top:10px;">Valider mon approbation</button>
      <p id="roi-statutMembre" style="font-size:0.85rem; color:var(--slate); margin-top:6px;"></p>`;

    document.getElementById('roi-valider').addEventListener('click', async () => {
      const statutEl = document.getElementById('roi-statutMembre');
      if (!document.getElementById('roi-checkbox').checked) { statutEl.textContent = 'Merci de cocher la case avant de valider.'; return; }
      const aujourdhui = dateISOLocale(new Date());
      await updateDoc(doc(db, 'membres', membreUid), {
        reglementApprouve: true, reglementApprouveLe: aujourdhui, reglementVersionApprouvee: version
      });
      membreData.reglementApprouve = true;
      membreData.reglementApprouveLe = aujourdhui;
      membreData.reglementVersionApprouvee = version;
      chargerRoiMembre();
    });
  }
}

// ==========================================================================
// FICHE DE RENSEIGNEMENTS — questionnaire anonyme (aucun lien avec le
// compte du membre dans les réponses elles-mêmes).
// ==========================================================================
function chargerEnqueteAnonyme() {
  const wrap = document.getElementById('enquete-form');
  if (!wrap) return;

  if (membreData.enqueteRenseignementsSoumise) {
    wrap.innerHTML = '<div class="empty-state">Merci, vous avez déjà répondu à ce questionnaire. 🙏</div>';
    return;
  }

  const chiensActifs = (membreData.chiens || []).filter(c => !c.archive);

  wrap.innerHTML = `
    <div class="banner-alert" style="margin-bottom:14px;">
      Par défaut, votre identifiant et le nom de votre chien sont joints à vos réponses (utile pour Katia). Vous pouvez cocher la case ci-dessous pour les retirer et répondre anonymement.
    </div>
    <label class="membre-check-row" style="margin-bottom:14px;">
      <input type="checkbox" id="eq-anonymiser">
      <span>Je préfère répondre anonymement (retire mon identifiant et le nom de mon chien)</span>
    </label>

    <div class="form-grid" id="eq-identiteWrap">
      <div class="field"><label>Identifiant</label><input id="eq-identifiant" value="${escapeHtml(membreData.identifiant || '')}" disabled></div>
      <div class="field"><label>Chien concerné</label>
        <select id="eq-chienNom">
          ${chiensActifs.map(c => `<option value="${escapeHtml(c.nom)}">${escapeHtml(c.nom)}</option>`).join('') || '<option value="">—</option>'}
        </select>
      </div>
    </div>

    <div class="field"><label>Tranche d'âge du maître</label>
      <select id="eq-age">
        <option value="20-30 ans">20-30 ans</option>
        <option value="30-40 ans">30-40 ans</option>
        <option value="40-50 ans">40-50 ans</option>
        <option value="50-60 ans">50-60 ans</option>
        <option value="60 ans et plus">60 ans et plus</option>
      </select>
    </div>
    <div class="form-grid">
      <div class="field"><label>Race du chien</label><input id="eq-race"></div>
      <div class="field"><label>Sexe</label>
        <select id="eq-sexe"><option value="Mâle">Mâle</option><option value="Femelle">Femelle</option></select>
      </div>
    </div>
    <div class="field"><label>Élevage (nom, si connu)</label><input id="eq-elevage"></div>
    <div class="field"><label>Âge du retrait du chiot (en semaines)</label><input type="number" id="eq-ageRetrait"></div>
    <div class="form-grid">
      <div class="field"><label>Avez-vous pu voir le chiot régulièrement chez l'éleveur ?</label>
        <select id="eq-vuRegulierement"><option value="Oui">Oui</option><option value="Non">Non</option></select>
      </div>
      <div class="field"><label>L'avez-vous choisi vous-même ?</label>
        <select id="eq-choisiSoiMeme"><option value="Oui">Oui, moi-même</option><option value="Non">Non, imposé par l'éleveur</option></select>
      </div>
    </div>
    <div class="field"><label>Si choisi vous-même, sur quels critères ?</label><input id="eq-criteres"></div>
    <div class="field"><label>Est-ce votre premier chien ?</label>
      <select id="eq-premierChien"><option value="Oui">Oui</option><option value="Non">Non</option></select>
    </div>
    <div class="field"><label>Avez-vous cherché longtemps pour trouver cette race/cet élevage ?</label><input id="eq-recherche"></div>
    <div class="field"><label>Pourquoi un mâle ? Pourquoi une femelle ?</label><input id="eq-pourquoiSexe"></div>
    <div class="field"><label>Avez-vous des enfants ? Si oui, combien et de quel âge ?</label><input id="eq-enfants"></div>
    <div class="field"><label>Connaissez-vous bien cette race ?</label><input id="eq-connaissanceRace"></div>
    <div class="field"><label>Quelles sont les raisons qui vous ont mené à ce choix de race ?</label><textarea id="eq-raisonsChoix" rows="2" style="width:100%; box-sizing:border-box; resize:vertical;"></textarea></div>
    <div class="field"><label>Comment se sont passées les premières semaines à la maison ?</label><textarea id="eq-premieresSemaines" rows="3" style="width:100%; box-sizing:border-box; resize:vertical;"></textarea></div>

    <button class="btn-sm primary" id="eq-envoyer" style="margin-top:10px;">Envoyer mes réponses</button>
    <p id="eq-statut" style="font-size:0.85rem; color:var(--slate); margin-top:8px;"></p>`;

  document.getElementById('eq-anonymiser').addEventListener('change', (e) => {
    document.getElementById('eq-identiteWrap').classList.toggle('hidden', e.target.checked);
  });

  document.getElementById('eq-envoyer').addEventListener('click', async () => {
    const statutEl = document.getElementById('eq-statut');
    statutEl.textContent = 'Envoi en cours...';
    const anonymiser = document.getElementById('eq-anonymiser').checked;
    try {
      await addDoc(collection(db, 'enquetes_renseignements'), {
        identifiant: anonymiser ? null : (membreData.identifiant || null),
        chienNom: anonymiser ? null : (document.getElementById('eq-chienNom').value || null),
        age: document.getElementById('eq-age').value,
        race: document.getElementById('eq-race').value.trim(),
        sexe: document.getElementById('eq-sexe').value,
        elevage: document.getElementById('eq-elevage').value.trim(),
        ageRetrait: document.getElementById('eq-ageRetrait').value,
        vuRegulierement: document.getElementById('eq-vuRegulierement').value,
        choisiSoiMeme: document.getElementById('eq-choisiSoiMeme').value,
        criteres: document.getElementById('eq-criteres').value.trim(),
        premierChien: document.getElementById('eq-premierChien').value,
        recherche: document.getElementById('eq-recherche').value.trim(),
        pourquoiSexe: document.getElementById('eq-pourquoiSexe').value.trim(),
        enfants: document.getElementById('eq-enfants').value.trim(),
        connaissanceRace: document.getElementById('eq-connaissanceRace').value.trim(),
        raisonsChoix: document.getElementById('eq-raisonsChoix').value.trim(),
        premieresSemaines: document.getElementById('eq-premieresSemaines').value.trim(),
        dateEnvoi: serverTimestamp()
      });
      await updateDoc(doc(db, 'membres', membreUid), { enqueteRenseignementsSoumise: true });
      membreData.enqueteRenseignementsSoumise = true;
      chargerEnqueteAnonyme();
    } catch (err) {
      statutEl.textContent = 'Erreur : ' + (err.message || err);
    }
  });
}

// ==========================================================================
// ANNULATION TARDIVE D'UNE PRÉSENCE DÉJÀ VALIDÉE — possible jusqu'à 1h
// avant le cours, avec justificatif obligatoire. Katia doit valider pour
// que le cours ne soit pas décompté de l'abonnement.
// ==========================================================================
window.ouvrirDemandeAnnulation = (dateISO) => {
  const html = `
    <div class="modal-overlay" id="modalOverlayAnnulPresence">
      <div class="modal-box">
        <h3>Annuler ma présence</h3>
        <p style="color:var(--slate); font-size:0.85rem;">Katia doit valider votre demande pour que ce cours ne compte pas dans votre abonnement. Sans validation, il reste décompté normalement.</p>
        <div class="field"><label>Motif (obligatoire)</label><textarea id="annulpres-motif" rows="3" style="width:100%; box-sizing:border-box; resize:vertical;" placeholder="ex: mon chien est malade, empêchement de dernière minute..."></textarea></div>
        <div class="modal-actions">
          <button class="btn-sm" onclick="document.getElementById('modalOverlayAnnulPresence').remove()">Retour</button>
          <button class="btn-sm primary" id="annulpres-envoyer">Envoyer la demande</button>
        </div>
        <p id="annulpres-statut" style="font-size:0.85rem; color:var(--slate); margin-top:8px;"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('annulpres-envoyer').addEventListener('click', async () => {
    const statutEl = document.getElementById('annulpres-statut');
    const motif = document.getElementById('annulpres-motif').value.trim();
    if (!motif) { statutEl.textContent = 'Merci d\'indiquer un motif.'; return; }

    const clePres = `${groupeData.id}_${dateISO}_${membreUid}`;
    try {
      await updateDoc(doc(db, 'presences', clePres), {
        demandeAnnulationMotif: motif,
        demandeAnnulationStatut: 'attente',
        demandeAnnulationDate: serverTimestamp()
      });
      document.getElementById('modalOverlayAnnulPresence').remove();
      afficherProchainsCours();
    } catch (err) {
      statutEl.textContent = 'Erreur : ' + (err.message || err);
    }
  });
};
