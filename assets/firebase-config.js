// © 2026 LES BEAUX CABOTS SRL. Tous droits réservés.
// Ce code ne peut être utilisé, copié ou modifié sans autorisation
// écrite — voir LICENSE.txt à la racine du dépôt.
// Contenu du site sous la responsabilité de Katia Renard (LES BEAUX CABOTS SRL).

// ==========================================================================
// Configuration Firebase — Les Cabots de Fernelmont
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, where, orderBy,
  serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC29dcTbC4PZ_zc5tF6fovc0s_3BZeupXU",
  authDomain: "cabots-de-fernelmont-901ee.firebaseapp.com",
  projectId: "cabots-de-fernelmont-901ee",
  storageBucket: "cabots-de-fernelmont-901ee.firebasestorage.app",
  messagingSenderId: "183891864365",
  appId: "1:183891864365:web:7d08f8c12abf918f5341a4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, where, orderBy,
  serverTimestamp, onSnapshot
};

// Les identifiants membres/admin ne sont pas de vraies adresses e-mail.
// On les transforme en "faux e-mail" pour pouvoir utiliser
// l'authentification Firebase par e-mail/mot de passe avec un simple
// identifiant (ex: "Katia" -> "katia@membres.cabots-de-fernelmont.local").
export function identifiantVersEmail(identifiant) {
  return identifiant.trim().toLowerCase() + "@membres.cabots-de-fernelmont.local";
}

// Lecture d'un document avec plusieurs tentatives (absorbe un éventuel
// petit délai de propagation Firestore juste après une modification).
export async function getDocAvecReessai(refDoc, maxEssais = 3, delaiMs = 900) {
  let d = null;
  for (let i = 0; i < maxEssais; i++) {
    d = await getDoc(refDoc);
    if (d.exists()) return d;
    if (i < maxEssais - 1) await new Promise(r => setTimeout(r, delaiMs));
  }
  return d;
}
