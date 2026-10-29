/*
 * Compteur 10 000 — accès à la base Firebase (Realtime Database).
 *
 * SDK officiel en modules : il ne passe par aucune variable globale
 * (« window.firebase »), donc rien ne peut le remplacer pendant la partie,
 * pas même une extension du navigateur.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase, ref, push, onValue, get, query, limitToFirst, serverTimestamp, goOffline, goOnline
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

export function ouvrirBase(adresse) {
  const app = initializeApp({ databaseURL: adresse });
  const db = getDatabase(app);

  return {
    /** Appelle rappel(valeur) maintenant puis à chaque changement. */
    ecouter(chemin, rappel, siErreur) {
      return onValue(ref(db, chemin), (instantane) => rappel(instantane.val()), siErreur);
    },

    /** Appelle rappel(true/false) quand la connexion à la base change. */
    connexion(rappel) {
      return onValue(ref(db, '.info/connected'), (instantane) => rappel(instantane.val() === true));
    },

    /** Ajoute un élément ; l'écran est prévenu tout de suite, l'envoi suit. */
    ajouter(chemin, valeur) {
      const nouveau = push(ref(db, chemin), valeur);
      return { cle: nouveau.key, ecriture: Promise.resolve(nouveau).then(() => nouveau.key) };
    },

    /** Indique si quelque chose existe déjà à ce chemin. */
    existe(chemin) {
      return get(query(ref(db, chemin), limitToFirst(1))).then((instantane) => instantane.exists());
    },

    /** Lit une fois ce qui se trouve à ce chemin (null s'il n'y a rien). */
    lire(chemin) {
      return get(ref(db, chemin)).then((instantane) => instantane.val());
    },

    /** Heure du serveur, remplie par Firebase au moment de l'enregistrement. */
    horodatage() {
      return serverTimestamp();
    },

    /** Relance la connexion (Safari la coupe parfois sans prévenir). */
    relancer() {
      goOffline(db);
      goOnline(db);
    }
  };
}
