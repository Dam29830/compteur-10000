/*
 * Compteur 10 000 — version en ligne (GitHub Pages + Firebase Realtime Database).
 *
 *   ./                      accueil : nouvelle partie, rejoindre avec un code
 *   ./?p=CODE               joueurs (téléphones)
 *   ./?p=CODE&vue=ecran     écran de partie : QR code et classement en grand
 *
 * Chaque partie est un journal d'événements dans Firebase
 * (parties/CODE/evenements). On n'y fait qu'ajouter des événements ;
 * chaque appareil rejoue le journal (Regles.plier) pour obtenir la partie.
 */
(function () {
  'use strict';

  var R = window.Regles;
  var QR = window.QR;
  var CONFIG = window.COMPTEUR_10000 || {};
  var racine = document.getElementById('app');
  var conteneurModale = document.getElementById('modale');
  var zoneToasts = document.getElementById('toasts');
  var bandeau = document.getElementById('bandeau');
  var REDUIT = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var fmt = R.fmt;
  var VERSION = '3';

  var BASE = typeof CONFIG.base === 'string' ? CONFIG.base.trim().replace(/\/+$/, '') : '';
  var BASE_OK = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebasedatabase\.app|firebaseio\.com)$/i.test(BASE);
  var SITE = location.origin + location.pathname.replace(/[^\/]*$/, '');
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  var parametres = new URLSearchParams(location.search);
  var CODE_BRUT = parametres.get('p') || '';
  var CODE = normaliserCode(CODE_BRUT);
  var ECRAN = !!CODE && parametres.get('vue') === 'ecran';

  document.documentElement.classList.add(ECRAN ? 'mode-ecran' : 'mode-joueur');

  function normaliserCode(c) {
    c = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^[A-HJKMNP-Z2-9]{4}$/.test(c) ? c : '';
  }

  function genererCode() {
    var octets = new Uint8Array(4);
    window.crypto.getRandomValues(octets);
    var s = '';
    for (var i = 0; i < 4; i++) s += ALPHABET.charAt(octets[i] % ALPHABET.length);
    return s;
  }

  function lienPartie(code, vue) {
    return SITE + '?p=' + code + (vue ? '&vue=' + vue : '');
  }
  function siteCourt() {
    return SITE.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  // --- Mémoire de cet appareil ------------------------------------------------

  var CLE_WIFI = 'c10k.wifi';
  var CLE_RECENTES = 'c10k.recentes';
  function cleMoi() { return 'c10k.moi.' + CODE; }
  function cleSpectateur() { return 'c10k.spectateur.' + CODE; }

  function lire(cle) { try { return window.localStorage.getItem(cle); } catch (e) { return null; } }
  function ecrire(cle, valeur) {
    try {
      if (valeur === null || valeur === undefined) window.localStorage.removeItem(cle);
      else window.localStorage.setItem(cle, valeur);
    } catch (e) { /* stockage indisponible : tant pis */ }
  }

  function recentes() {
    try {
      var l = JSON.parse(lire(CLE_RECENTES) || '[]');
      return Array.isArray(l) ? l.filter(function (x) { return x && normaliserCode(x.code); }) : [];
    } catch (e) { return []; }
  }
  function memoriserRecente(code) {
    var l = recentes().filter(function (x) { return x.code !== code; });
    l.unshift({ code: code, t: Date.now() });
    ecrire(CLE_RECENTES, JSON.stringify(l.slice(0, 4)));
  }

  var S = {
    etat: null,            // partie reconstruite depuis le journal
    a: null,               // analyse (scores calculés)
    connecte: false,
    moi: CODE ? lire(cleMoi()) : null,
    spectateur: CODE ? lire(cleSpectateur()) === '1' : false,
    modale: null,
    saisie: { valeur: '', envoi: false },
    vus: null,
    gagnantVu: undefined,
    partieVue: null,
    affiches: {},
    erreurRejoindre: null,
    erreurCode: CODE_BRUT && !CODE ? 'Ce code ne correspond à aucune partie : il fait 4 caractères, par exemple K7PM.' : null,
    creation: false,
    fatal: null,
    retourFocus: null
  };

  // --- Petits outils ---------------------------------------------------------

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initiale(nom) {
    var premiere = Array.from(String(nom || '?').trim())[0] || '?';
    return premiere.toLocaleUpperCase('fr-FR');
  }

  var I = {
    qr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5h2v1.5h-2zM18 14h2v2h-2z" fill="currentColor"/></svg>',
    livre: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    rejouer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 3.5V8H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    agrandir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fermer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    effacer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H9l-6-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5l5 5M17 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    annuler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    crayon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    retirer: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 20a7 7 0 0 1 12.5-4.3M16 18h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    personne: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19.2" r="1.4" fill="currentColor"/></svg>',
    reglages: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    partager: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M6 12H5v8.5h14V12h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copier: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    ecran: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 20h7M12 16.5V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  /** Un dé dessiné : n points, le 1 en rouge comme sur les vrais dés. */
  var POSITIONS = {
    1: [[1, 1]],
    2: [[0, 2], [2, 0]],
    3: [[0, 2], [1, 1], [2, 0]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]]
  };
  function de(n, classe) {
    var points = POSITIONS[n].map(function (p) {
      var cx = 11 + p[1] * 9, cy = 11 + p[0] * 9;
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + (n === 1 ? 4.6 : 3.1) + '" class="' + (n === 1 ? 'point point-un' : 'point') + '"/>';
    }).join('');
    return '<svg class="de ' + (classe || '') + '" viewBox="0 0 40 40" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="37" rx="9" class="face"/>' + points + '</svg>';
  }

  function croix(n) {
    if (!n) return '';
    var une = '<svg class="croix" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.2 3.4l7.7 7.4M10.6 3L3.5 11.1"/></svg>';
    var s = '';
    for (var i = 0; i < n; i++) s += une;
    return '<span class="croix-groupe" role="img" aria-label="' + n + ' croix">' + s + '</span>';
  }

  function avatar(f, classe) {
    return '<span class="avatar ' + (classe || '') + '" style="--c: var(--j' + ((f.couleur || 0) % 10) + ')" aria-hidden="true">' + esc(initiale(f.nom)) + '</span>';
  }

  function objectifTexte(r) {
    return 'Objectif ' + fmt(r.objectif) + (r.pile ? ' pile' : '');
  }

  function reglesActuelles() {
    return S.a ? S.a.regles : R.normaliser({});
  }

  // QR codes (blancs même en mode sombre : les appareils photo les lisent mieux).
  var cacheQr = {};
  function qrSvg(texte, etiquette) {
    if (!cacheQr[texte]) {
      var m = QR.matrice(texte, 'M');
      var n = m.taille, d = '';
      for (var l = 0; l < n; l++) {
        var c = 0;
        while (c < n) {
          if (m.sombre(l, c)) {
            var debut = c;
            while (c < n && m.sombre(l, c)) c++;
            d += 'M' + debut + ' ' + l + 'h' + (c - debut) + 'v1h-' + (c - debut) + 'z';
          } else c++;
        }
      }
      var cote = n + 8;
      cacheQr[texte] = '<svg class="qr" viewBox="-4 -4 ' + cote + ' ' + cote + '" shape-rendering="crispEdges" role="img" aria-label="' +
        esc(etiquette) + '"><rect x="-4" y="-4" width="' + cote + '" height="' + cote + '" fill="#ffffff"/><path d="' + d + '" fill="#0e1512"/></svg>';
    }
    return cacheQr[texte];
  }

  function lireWifi() {
    try {
      var w = JSON.parse(lire(CLE_WIFI) || 'null');
      return w && w.nom ? w : null;
    } catch (e) { return null; }
  }
  function echapperWifi(s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); }
  function chaineWifi(w) {
    return 'WIFI:T:' + (w.mdp ? 'WPA' : 'nopass') + ';S:' + echapperWifi(w.nom) + ';' +
      (w.mdp ? 'P:' + echapperWifi(w.mdp) + ';' : '') + ';';
  }

  // --- Firebase ------------------------------------------------------------------

  // Accès à la base (base.js, chargé au démarrage). Aucune variable globale.
  var base = null;

  function cheminPartie(code) {
    return 'parties/' + code + '/evenements';
  }

  function erreur(message, code, res) {
    var e = new Error(message);
    e.code = code || 'refus';
    e.res = res || {};
    return e;
  }

  function messageFirebase(e) {
    var texte = String((e && (e.code || e.message)) || '');
    if (/permission|denied/i.test(texte)) {
      return 'La base Firebase refuse l’accès. Vérifie que les règles du guide sont bien publiées (étape 3).';
    }
    return 'Impossible de joindre la partie. Vérifie que ce téléphone est connecté à internet.';
  }

  function ecouter() {
    base.ecouter(cheminPartie(CODE), function (valeur) {
      recevoir(R.plier(valeur));
    }, function (e) {
      S.fatal = { titre: 'Lecture impossible', texte: messageFirebase(e) };
      rendre();
    });
    base.connexion(marquerConnexion);
  }

  /**
   * Ajoute un événement au journal. L'écran se met à jour tout de suite.
   * Une erreur lève une exception avec un message lisible (rattrapée par envoyer).
   */
  function publier(evenement, silencieux) {
    if (!base) throw erreur('Le compteur se charge encore, réessaie dans un instant.', 'attente');
    evenement.t = base.horodatage();
    var p;
    try {
      p = base.ajouter(cheminPartie(CODE), evenement);
    } catch (e) {
      throw erreur('Enregistrement impossible : ' + ((e && e.message) || e) + '. Recharge la page.', 'firebase');
    }
    if (!silencieux) {
      p.ecriture.catch(function (e) { toast(messageFirebase(e), { erreur: true, duree: 9000 }); });
    }
    return p;
  }

  // Attendre qu'un événement publié soit pris en compte (pour savoir si un prénom est accepté).
  var attentes = [];
  function retirerAttente(a) {
    var i = attentes.indexOf(a);
    if (i >= 0) attentes.splice(i, 1);
    clearTimeout(a.minuteur);
  }
  function attendre(test, delai) {
    return new Promise(function (ok, ko) {
      var a = { test: test, ok: ok, ko: ko };
      attentes.push(a);
      a.minuteur = setTimeout(function () {
        retirerAttente(a);
        ko(erreur('La partie ne répond pas. Vérifie la connexion internet.', 'delai'));
      }, delai || 15000);
      verifierAttentes();
    });
  }
  function verifierAttentes() {
    if (!S.etat) return;
    attentes.slice().forEach(function (a) {
      var r = a.test(S.etat);
      if (!r) return;
      retirerAttente(a);
      if (r.erreur) a.ko(r.erreur);
      else a.ok(r.valeur);
    });
  }

  function joueurNomme(nom, sauf) {
    var trouve = null;
    S.etat.joueurs.forEach(function (j) {
      if (j.id !== sauf && R.memeNom(j.nom, nom)) trouve = j;
    });
    return trouve;
  }

  /** Les actions de l'appli, traduites en événements du journal. Ne lève jamais d'exception. */
  function envoyer(type, d) {
    try {
      return envoyerSansFilet(type, d);
    } catch (e) {
      return Promise.reject(e && e.code ? e : erreur('Problème technique : ' + ((e && e.message) || e) + '. Recharge la page.', 'technique'));
    }
  }

  function envoyerSansFilet(type, d) {
    d = d || {};
    if (!S.etat || !base) return Promise.reject(erreur('La partie n’est pas encore chargée.', 'attente'));
    var p;
    switch (type) {
      case 'rejoindre': {
        var nom = R.nomPropre(d.nom);
        if (!nom) return Promise.reject(erreur('Écris un prénom pour rejoindre la partie.', 'nom_vide'));
        var pris = joueurNomme(nom);
        if (pris) return Promise.reject(erreur(pris.nom + ' est déjà dans la partie.', 'nom_pris', { joueur: pris.id }));
        if (S.etat.joueurs.length >= R.MAX_JOUEURS) {
          return Promise.reject(erreur('La partie est complète (' + R.MAX_JOUEURS + ' joueurs au maximum).', 'complet'));
        }
        p = publier({ type: 'joueur', nom: nom }, true);
        return new Promise(function (ok, ko) {
          p.ecriture.catch(function (e) { ko(erreur(messageFirebase(e), 'firebase')); });
          attendre(function (etat) {
            if (etat.joueurs.some(function (j) { return j.id === p.cle; })) return { valeur: { joueur: p.cle } };
            var rejet = etat.rejets[p.cle];
            if (!rejet) return null;
            if (rejet.code === 'nom_pris') return { erreur: erreur(rejet.nom + ' est déjà dans la partie.', 'nom_pris', { joueur: rejet.joueur }) };
            if (rejet.code === 'complet') return { erreur: erreur('La partie est complète.', 'complet') };
            return { erreur: erreur('Ce prénom n’est pas accepté.', 'nom_vide') };
          }, 10000).then(ok, ko);
        });
      }
      case 'tour':
        if (!S.a.parId[d.joueur]) return Promise.reject(erreur('Ce joueur n’est plus dans la partie.', 'joueur_inconnu'));
        p = publier({ type: 'tour', j: d.joueur, pts: Math.max(0, Math.round(Number(d.points) || 0)), par: d.par === 'ecran' ? 'ecran' : d.joueur });
        return Promise.resolve({ tour: p.cle });
      case 'annuler': {
        var dernier = null;
        S.etat.tours.forEach(function (t) { if (t.j === d.joueur) dernier = t; });
        if (!dernier) return Promise.reject(erreur('Aucun tour à annuler.', 'rien'));
        publier({ type: 'annuler', tour: dernier.id });
        return Promise.resolve({ retire: dernier });
      }
      case 'supprimerTour':
        if (!S.etat.tours.some(function (t) { return t.id === d.tour; })) return Promise.reject(erreur('Ce tour a déjà été annulé.', 'rien'));
        publier({ type: 'annuler', tour: d.tour });
        return Promise.resolve({});
      case 'renommer': {
        var nouveau = R.nomPropre(d.nom);
        if (!nouveau) return Promise.reject(erreur('Écris un prénom.', 'nom_vide'));
        var autre = joueurNomme(nouveau, d.joueur);
        if (autre) return Promise.reject(erreur(autre.nom + ' est déjà dans la partie.', 'nom_pris'));
        publier({ type: 'renommer', j: d.joueur, nom: nouveau });
        return Promise.resolve({});
      }
      case 'retirerJoueur':
        publier({ type: 'retirer', j: d.joueur });
        return Promise.resolve({});
      case 'regles':
        Object.keys(d.regles || {}).forEach(function (cle) {
          publier({ type: 'regle', cle: cle, valeur: d.regles[cle] });
        });
        return Promise.resolve({});
      case 'nouvellePartie':
        publier({ type: 'rejouer', garder: d.garderJoueurs !== false });
        return Promise.resolve({});
    }
    return Promise.reject(erreur('Action inconnue.'));
  }

  function erreurAction(e) {
    if (e && e.code) toast(e.message, { erreur: true, duree: 8000 });
    else toast('Impossible de joindre la partie. Vérifie que ce téléphone est connecté à internet.', { erreur: true, duree: 8000 });
  }

  /** Crée une partie avec un code libre, puis ouvre son écran de partie. */
  function creerPartie() {
    if (S.creation) return;
    if (!base) { toast('Le compteur se charge encore, réessaie dans un instant.'); return; }
    S.creation = true;
    rendre();
    var essais = 0;
    function delai(promesse) {
      return Promise.race([promesse, new Promise(function (ok, ko) {
        setTimeout(function () { ko(erreur('Pas de réponse : vérifie la connexion internet.', 'delai')); }, 15000);
      })]);
    }
    function essayer() {
      var code = genererCode();
      return delai(base.existe(cheminPartie(code))).then(function (existe) {
        if (existe) {
          essais++;
          if (essais > 6) throw erreur('Aucun code libre trouvé, réessaie.', 'code');
          return essayer();
        }
        var p = base.ajouter(cheminPartie(code), { type: 'creation', t: base.horodatage() });
        return delai(p.ecriture).then(function () { return code; });
      });
    }
    essayer().then(function (code) {
      memoriserRecente(code);
      location.href = lienPartie(code, 'ecran');
    }).catch(function (e) {
      S.creation = false;
      rendre();
      toast(e && e.code === 'delai' ? e.message : messageFirebase(e), { erreur: true, duree: 9000 });
    });
  }

  var minuteurPerte = null;
  function marquerConnexion(ok) {
    S.connecte = ok;
    if (ok) {
      clearTimeout(minuteurPerte);
      minuteurPerte = null;
      bandeau.hidden = true;
      document.documentElement.classList.remove('hors-ligne');
    } else if (!minuteurPerte && bandeau.hidden) {
      minuteurPerte = setTimeout(function () {
        minuteurPerte = null;
        if (S.connecte) return;
        bandeau.textContent = 'Pas de connexion internet. Le compteur réessaie…';
        bandeau.hidden = false;
        document.documentElement.classList.add('hors-ligne');
      }, 4000);
    }
  }

  // --- Réception de l'état ----------------------------------------------------

  function recevoir(etat) {
    var premier = !S.etat;
    S.etat = etat;
    S.a = R.analyser(etat);

    if (!etat.existe) {
      rendre();
      verifierAttentes();
      return;
    }
    if (premier) memoriserRecente(CODE);

    if (S.moi && !S.a.parId[S.moi]) {
      S.moi = null;
      ecrire(cleMoi(), null);
    }

    var idPartie = CODE + ':' + etat.numero;
    var nouvellePartie = !premier && S.partieVue !== null && S.partieVue !== idPartie;
    S.partieVue = idPartie;

    var nouveaux = [];
    var ids = {};
    etat.tours.forEach(function (t) {
      ids[t.id] = true;
      if (S.vus && !S.vus[t.id]) nouveaux.push(t);
    });
    S.vus = ids;

    var cleGagnant = S.a.gagnant ? idPartie + ':' + S.a.gagnant.id : null;
    var victoire = !premier && cleGagnant && cleGagnant !== S.gagnantVu;
    S.gagnantVu = cleGagnant;

    rendre(nouveaux);

    if (victoire) {
      ouvrir({ type: 'victoire', fete: true });
    } else if (!cleGagnant && S.modale && S.modale.type === 'victoire') {
      fermer();
    } else {
      majModale();
    }
    if (nouvellePartie) toast('Nouvelle partie : les scores repartent à zéro.');
    verifierAttentes();
  }

  // --- Rendu principal --------------------------------------------------------

  function moiValide() {
    return !ECRAN && S.moi && S.a && S.a.parId[S.moi];
  }

  function avecChamps(conteneur, fabriquer) {
    var valeurs = {};
    conteneur.querySelectorAll('input[id]').forEach(function (el) {
      if (el.type !== 'checkbox' && el.type !== 'radio') valeurs[el.id] = el.value;
    });
    var actif = document.activeElement;
    var idActif = actif && actif.id && conteneur.contains(actif) ? actif.id : null;
    var selection = null;
    if (idActif) { try { selection = [actif.selectionStart, actif.selectionEnd]; } catch (err) { selection = null; } }
    fabriquer();
    Object.keys(valeurs).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.value !== valeurs[id]) el.value = valeurs[id];
    });
    if (idActif) {
      var el = document.getElementById(idActif);
      if (el) {
        try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
        if (selection && el.setSelectionRange && selection[0] !== null) {
          try { el.setSelectionRange(selection[0], selection[1]); } catch (err) { /* rien */ }
        }
      }
    }
  }

  function positions(selecteur) {
    var p = {};
    racine.querySelectorAll(selecteur).forEach(function (el) {
      p[el.getAttribute('data-id')] = el.getBoundingClientRect().top;
    });
    return p;
  }

  function vueCourante() {
    if (S.fatal) return vueErreur(S.fatal);
    if (!BASE_OK) return vueConfiguration();
    if (!CODE) return vueAccueil();
    if (!S.etat) return '<p class="chargement">Connexion à la partie ' + esc(CODE) + '…</p>';
    if (!S.etat.existe) return vueIntrouvable();
    if (ECRAN) return vueEcran();
    if (moiValide()) return vueJoueur();
    if (S.spectateur) return vueSpectateur();
    return vueRejoindre();
  }

  function rendre(nouveaux) {
    var avant = positions('.ligne-joueur[data-id]');
    avecChamps(racine, function () { racine.innerHTML = vueCourante(); });
    if (!REDUIT) {
      racine.querySelectorAll('.ligne-joueur[data-id]').forEach(function (el) {
        var ancien = avant[el.getAttribute('data-id')];
        if (ancien === undefined) return;
        var ecart = ancien - el.getBoundingClientRect().top;
        if (Math.abs(ecart) > 2 && el.animate) {
          el.animate([{ transform: 'translateY(' + ecart + 'px)' }, { transform: 'none' }],
            { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      });
    }
    (nouveaux || []).forEach(function (t) {
      racine.querySelectorAll('.ligne-joueur[data-id="' + t.j + '"]').forEach(function (el) {
        el.classList.remove('eclair');
        void el.offsetWidth;
        el.classList.add('eclair');
      });
      var item = racine.querySelector('[data-tour="' + t.id + '"]');
      if (item) item.classList.add('nouveau');
    });
    if (S.a) animerTotaux();
  }

  function animerTotaux() {
    racine.querySelectorAll('[data-total]').forEach(function (el) {
      var id = el.getAttribute('data-total');
      var f = S.a.parId[id];
      if (!f) return;
      var cle = id + '|' + (el.getAttribute('data-ctx') || '');
      var avant = S.affiches[cle];
      S.affiches[cle] = f.total;
      if (avant === undefined || avant === f.total || REDUIT) return;
      var debut = null, duree = 700, de0 = avant, a1 = f.total;
      el.textContent = fmt(de0);
      function pas(t) {
        if (!document.body.contains(el)) return;
        if (debut === null) debut = t;
        var k = Math.min(1, (t - debut) / duree);
        var lisse = 1 - Math.pow(1 - k, 3);
        var v = Math.round((de0 + (a1 - de0) * lisse) / 50) * 50;
        el.textContent = fmt(k >= 1 ? a1 : v);
        if (k < 1) requestAnimationFrame(pas);
      }
      requestAnimationFrame(pas);
    });
  }

  function marque() {
    return '<div class="marque">' + de(1, 'de-marque') + '<span class="mot-marque">10 000</span></div>';
  }

  function enteteAccueil(sousTitre) {
    return '<header class="accueil-marque">' + de(1, 'de-accueil') +
      '<h1 class="mot-marque mot-marque-accueil">10 000</h1>' +
      '<p class="accroche">' + (sousTitre || 'Le compteur de points du jeu de dés') + '</p></header>';
  }

  function pastilleManche(a) {
    if (a.gagnant) return '<span class="pastille pastille-fin">Partie terminée</span>';
    return '<span class="pastille">' + (a.commencee ? 'Tour ' + a.manche : 'Prêts ?') + '</span>';
  }

  function boutonBarre(action, icone, texte, masquerTexte) {
    return '<button class="bouton-barre" data-action="' + action + '" title="' + esc(texte) + '"' + (masquerTexte ? ' aria-label="' + esc(texte) + '"' : '') + '>' +
      icone + '<span class="' + (masquerTexte ? 'sr' : 'bouton-barre-texte') + '">' + esc(texte) + '</span></button>';
  }

  // --- Vues : configuration, erreur, accueil, partie introuvable ------------------

  function vueConfiguration() {
    return '<main class="accueil">' + enteteAccueil() +
      '<section class="carte" aria-labelledby="titre-config"><h2 id="titre-config" class="titre-bloc">Il reste une étape</h2>' +
      '<p class="texte">Le compteur ne connaît pas encore l’adresse de ta base Firebase.</p>' +
      '<ol class="liste-etapes">' +
        '<li>Sur GitHub, ouvre le fichier <strong>config.js</strong> et clique sur le crayon.</li>' +
        '<li>Colle entre les guillemets l’adresse de ta base. Elle se termine par <strong>firebasedatabase.app</strong>.</li>' +
        '<li>Clique sur <strong>Commit changes</strong>, attends une minute, puis recharge cette page.</li>' +
      '</ol></section></main>';
  }

  function vueErreur(f) {
    return '<main class="accueil">' + enteteAccueil() +
      '<section class="carte" role="alert"><h2 class="titre-bloc">' + esc(f.titre) + '</h2><p class="texte">' + esc(f.texte) + '</p>' +
      '<button class="bouton bouton-principal bouton-large" data-action="recharger">Réessayer</button></section></main>';
  }

  function dateCourte(t) {
    var d = new Date(t);
    var auj = new Date();
    if (d.toDateString() === auj.toDateString()) {
      return 'aujourd’hui ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  function vueAccueil() {
    var liste = recentes();
    var recentesHtml = liste.length
      ? '<section class="deja" aria-labelledby="titre-recentes"><h2 id="titre-recentes" class="etiquette">Reprendre une partie</h2><div class="puces">' +
        liste.map(function (x) {
          return '<a class="puce-joueur puce-code" href="' + esc(lienPartie(x.code)) + '"><span class="code-mini">' + esc(x.code) + '</span><span class="note">' + esc(dateCourte(x.t)) + '</span></a>';
        }).join('') + '</div></section>'
      : '';
    return '<main class="accueil">' + enteteAccueil() +
      '<section class="carte">' +
        '<button class="bouton bouton-principal bouton-large" data-action="creer"' + (S.creation ? ' disabled' : '') + '>' +
          (S.creation ? 'Création de la partie…' : 'Nouvelle partie') + '</button>' +
        '<p class="note note-centree">Un QR code s’affiche : les autres le scannent pour rejoindre la partie.</p>' +
      '</section>' +
      '<form class="carte" data-form="code" novalidate>' +
        '<label for="champ-code" class="etiquette-champ">Rejoindre avec un code</label>' +
        '<div class="ligne-code">' +
          '<input id="champ-code" class="champ champ-code" maxlength="4" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="K7PM" aria-describedby="aide-code">' +
          '<button class="bouton bouton-secondaire" type="submit">Rejoindre</button>' +
        '</div>' +
        (S.erreurCode ? '<p class="message message-alerte" role="alert" id="aide-code">' + esc(S.erreurCode) + '</p>' : '<p class="note" id="aide-code">Le code de 4 caractères est affiché sous le QR code.</p>') +
      '</form>' + recentesHtml +
      '<div class="liens-bas"><button class="lien" data-action="regles">Règles du jeu</button></div>' +
    '</main>';
  }

  function vueIntrouvable() {
    return '<main class="accueil">' + enteteAccueil() +
      '<section class="carte" role="alert"><h2 class="titre-bloc">Partie introuvable</h2>' +
      '<p class="texte">Le code <strong class="code-mini">' + esc(CODE) + '</strong> ne correspond à aucune partie. Vérifie le code, ou demande le QR code à la personne qui a créé la partie.</p>' +
      '<a class="bouton bouton-principal bouton-large" href="' + esc(SITE) + '">Retour à l’accueil</a></section></main>';
  }

  // --- Vue : rejoindre une partie ------------------------------------------------------

  function vueRejoindre() {
    var a = S.a;
    var nb = a.joueurs.length;
    var etatPartie = nb
      ? nb + (nb > 1 ? ' joueurs' : ' joueur') + (a.gagnant ? ' · partie terminée' : (a.commencee ? ' · tour ' + a.manche : ' · la partie va commencer'))
      : 'Tu es le premier : les autres apparaîtront ici.';
    var erreurHtml = '';
    if (S.erreurRejoindre) {
      erreurHtml = '<div class="message message-alerte" role="alert"><p>' + esc(S.erreurRejoindre.texte) + '</p>' +
        (S.erreurRejoindre.joueur
          ? '<div class="boutons-ligne"><button type="button" class="bouton bouton-secondaire" data-action="etre" data-joueur="' + esc(S.erreurRejoindre.joueur) + '">Oui, c’est moi</button>' +
            '<button type="button" class="bouton bouton-texte" data-action="autre-nom">Changer de prénom</button></div>'
          : '') + '</div>';
    }
    var deja = '';
    if (nb) {
      deja = '<section class="deja" aria-labelledby="titre-deja"><h2 id="titre-deja" class="etiquette">Déjà dans la partie ? Touche ton prénom</h2><div class="puces">' +
        a.joueurs.map(function (f) {
          return '<button class="puce-joueur" data-action="etre" data-joueur="' + esc(f.id) + '">' + avatar(f) + '<span>' + esc(f.nom) + '</span></button>';
        }).join('') + '</div></section>';
    }
    return '<main class="accueil">' +
      enteteAccueil('Partie <strong class="code-mini">' + esc(CODE) + '</strong>') +
      '<form class="carte carte-rejoindre" data-form="rejoindre" novalidate>' +
        '<label for="champ-nom" class="etiquette-champ">Ton prénom</label>' +
        '<input id="champ-nom" name="nom" class="champ" autocomplete="given-name" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="go" maxlength="24" placeholder="Ex. Léa">' +
        erreurHtml +
        '<button class="bouton bouton-principal bouton-large" type="submit">Rejoindre la partie</button>' +
        '<p class="note note-centree">' + esc(etatPartie) + '</p>' +
      '</form>' + deja +
      '<div class="liens-bas"><button class="lien" data-action="regarder">Juste regarder les scores</button>' +
      '<button class="lien" data-action="regles">Règles du jeu</button></div>' +
    '</main>';
  }

  // --- Vue : joueur -----------------------------------------------------------

  function barreJoueur(spectateur) {
    return '<header class="barre">' + marque() + pastilleManche(S.a) +
      '<nav class="barre-actions" aria-label="Menu">' +
        boutonBarre('inviter', I.qr, 'Inviter', true) +
        boutonBarre('regles', I.livre, 'Règles', true) +
        (spectateur ? boutonBarre('jouer', I.personne, 'Jouer') : '') +
      '</nav></header>';
  }

  function piedJoueur() {
    return '<div class="liens-bas">' +
      '<a class="lien" href="' + esc(lienPartie(CODE, 'ecran')) + '">Écran de partie</a>' +
      '<button class="lien" data-action="changer-joueur">Changer de joueur</button></div>';
  }

  function vueJoueur() {
    var f = S.a.parId[S.moi];
    return barreJoueur(false) + '<main class="page">' + ficheMoi(f, S.a) + sectionClassement(S.a, f.id, false) + piedJoueur() + '</main>';
  }

  function vueSpectateur() {
    return barreJoueur(true) + '<main class="page">' +
      '<div class="message message-info"><p>Tu regardes la partie sans jouer.</p><button class="bouton bouton-secondaire" data-action="jouer">Jouer aussi</button></div>' +
      sectionClassement(S.a, null, false) + '</main>';
  }

  function ficheMoi(f, a) {
    var r = a.regles;
    var fini = !!a.gagnant;
    var statut;
    if (fini) {
      statut = a.gagnant === f ? 'Bravo, tu as gagné la partie !' : esc(a.gagnant.nom) + ' a gagné la partie.';
    } else if (!f.ouvert) {
      statut = 'Pour entrer dans la partie : <strong class="num">' + fmt(R.seuilEntree(r)) + '</strong> points en un tour';
    } else {
      statut = 'Reste <strong class="num">' + fmt(Math.max(0, r.objectif - f.total)) + '</strong> pour atteindre ' + fmt(r.objectif);
    }
    var alerteCroix = '';
    if (!fini && r.troisCroix && f.croix > 0) {
      var precedent = f.paliers.length > 1 ? f.paliers[f.paliers.length - 2] : 0;
      alerteCroix = '<p class="fiche-croix">' + croix(f.croix) + '<span>' + (f.croix === 1
        ? '1 croix'
        : '2 croix : au prochain raté, retour à ' + fmt(precedent)) + '</span></p>';
    }
    var nb = a.joueurs.length;
    var rang = nb > 1 ? '<span class="fiche-rang">' + R.rang(f.rang) + ' sur ' + nb + '</span>' : '';
    var dernier = '';
    if (f.dernier) {
      var t = R.texteLigne(f.dernier);
      dernier = '<button class="lien lien-clair" data-action="annuler-dernier">' + I.annuler +
        '<span>Annuler mon dernier tour (' + esc(t.coup) + ')</span></button>';
    }
    var action = fini
      ? '<button class="bouton bouton-de bouton-large" data-action="nouvelle">' + I.rejouer + '<span>Rejouer</span></button>'
      : '<button class="bouton bouton-de bouton-large" data-action="saisir">Noter mon tour</button>';
    return '<section class="fiche-moi' + (fini && a.gagnant === f ? ' fiche-gagnante' : '') + '" aria-labelledby="nom-moi">' +
      '<div class="fiche-entete">' + avatar(f, 'avatar-clair') + '<h1 id="nom-moi" class="fiche-nom">' + esc(f.nom) + '</h1>' + rang + '</div>' +
      '<p class="fiche-total num" data-total="' + esc(f.id) + '" data-ctx="moi" aria-label="Ton total : ' + fmt(f.total) + ' points">' + fmt(f.total) + '</p>' +
      '<p class="fiche-statut">' + statut + '</p>' + alerteCroix +
      action + dernier +
    '</section>';
  }

  function sectionClassement(a, moiId, grand) {
    var r = a.regles;
    if (!a.joueurs.length) {
      return '<section class="classement"><p class="vide">Personne n’a encore rejoint la partie.</p></section>';
    }
    var dense = grand && a.joueurs.length > 6 ? ' dense' : '';
    return '<section class="classement" aria-labelledby="titre-classement">' +
      '<div class="entete-section"><h2 id="titre-classement" class="titre-section">Classement</h2><span class="note">' + objectifTexte(r) + '</span></div>' +
      '<ol class="liste-joueurs' + (grand ? ' grande' : '') + dense + '">' +
      a.classement.map(function (f) { return ligneJoueur(f, a, moiId); }).join('') +
      '</ol></section>';
  }

  function ligneJoueur(f, a, moiId) {
    var r = a.regles;
    var etat = [];
    if (a.gagnant === f) etat.push('<span class="etiquette-gagnant">Gagnant</span>');
    else if (!f.ouvert) etat.push('pas encore entré');
    if (f.aJouer && !a.gagnant) etat.push('<span class="a-jouer">à jouer</span>');
    if (r.troisCroix && f.croix && !a.gagnant) etat.push(croix(f.croix));
    var t = f.dernier ? R.texteLigne(f.dernier) : null;
    var pct = Math.max(0, Math.min(100, f.total / r.objectif * 100));
    var estMoi = f.id === moiId;
    return '<li class="ligne-joueur' + (estMoi ? ' moi' : '') + (a.gagnant === f ? ' gagnant' : '') + '" data-id="' + esc(f.id) + '">' +
      '<button class="ligne-bouton" data-action="voir" data-joueur="' + esc(f.id) + '" aria-label="' +
        esc(f.nom + ', ' + R.rang(f.rang) + ', ' + fmt(f.total) + ' points. Voir sa feuille de score.') + '">' +
        '<span class="rang num">' + f.rang + '</span>' + avatar(f) +
        '<span class="qui"><span class="nom">' + esc(f.nom) + (estMoi ? ' <span class="toi">toi</span>' : '') + '</span>' +
          (etat.length ? '<span class="etat">' + etat.join('<span class="sep" aria-hidden="true">·</span>') + '</span>' : '') + '</span>' +
        '<span class="score"><span class="total num" data-total="' + esc(f.id) + '">' + fmt(f.total) + '</span>' +
          (t ? '<span class="dernier dernier-' + t.classe + ' num">' + esc(t.coup) + '</span>' : '') + '</span>' +
      '</button>' +
      '<span class="progression" aria-hidden="true"><span style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '</li>';
  }

  // --- Vue : écran de partie -------------------------------------------------

  var PLEIN_ECRAN = !!(document.documentElement.requestFullscreen);

  function vueEcran() {
    var a = S.a;
    return '<header class="barre barre-ecran">' + marque() +
      '<div class="infos-partie">' + pastilleManche(a) + '<span class="note">' + objectifTexte(a.regles) + '</span></div>' +
      '<nav class="actions-ecran" aria-label="Partie">' +
        boutonBarre('jouer-ici', I.personne, 'Jouer sur cet appareil') +
        boutonBarre('ajouter', I.plus, 'Ajouter un joueur') +
        boutonBarre('parametres', I.reglages, 'Règles de la maison') +
        boutonBarre('nouvelle', I.rejouer, 'Nouvelle partie') +
        (PLEIN_ECRAN ? boutonBarre('plein-ecran', I.agrandir, 'Plein écran', true) : '') +
      '</nav></header>' +
      '<main class="ecran' + (a.joueurs.length ? '' : ' ecran-attente') + '">' + panneauRejoindre() +
        '<div class="tableau">' + (a.joueurs.length ? sectionClassement(a, null, true) + journal(a) : attente()) + '</div>' +
      '</main>';
  }

  function panneauRejoindre() {
    var url = lienPartie(CODE);
    var wifi = lireWifi();
    var etapes;
    if (wifi) {
      etapes = '<div class="etape-wifi"><div class="qr-cadre qr-petit">' + qrSvg(chaineWifi(wifi), 'QR code du Wi‑Fi ' + wifi.nom) + '</div>' +
        '<p><span class="etape-num">1</span> Scannez pour vous connecter au Wi‑Fi <strong>' + esc(wifi.nom) + '</strong></p></div>' +
        '<p class="consigne"><span class="etape-num">2</span> Puis scannez ce code pour rejoindre la partie</p>';
    } else {
      etapes = '<p class="consigne">Scannez ce code avec l’appareil photo du téléphone.</p>';
    }
    return '<aside class="rejoindre" aria-labelledby="titre-rejoindre">' +
      '<h2 id="titre-rejoindre" class="titre-rejoindre">Rejoindre la partie</h2>' + etapes +
      '<div class="qr-cadre">' + qrSvg(url, 'QR code pour rejoindre la partie ' + CODE) + '</div>' +
      '<p class="code-partie">Code <strong>' + esc(CODE) + '</strong></p>' +
      '<p class="adresse">ou allez sur <strong>' + esc(siteCourt()) + '</strong> et tapez le code</p>' +
      '<a class="bouton bouton-de jouer-ici" href="' + esc(url) + '">' + I.personne + '<span>Je joue aussi</span></a>' +
      '<button class="lien lien-clair" data-action="aide">Le code ne marche pas ?</button>' +
    '</aside>';
  }

  function attente() {
    return '<div class="attente">' + de(5, 'de-attente') +
      '<h2 class="titre-attente">En attente des joueurs</h2>' +
      '<p>Scannez le code avec vos téléphones. Les prénoms apparaîtront ici dès que chacun aura rejoint la partie.</p>' +
      '<p class="note">Un joueur sans téléphone ? <button class="lien" data-action="ajouter">Ajoutez-le ici</button> et notez ses points depuis cet écran.</p>' +
    '</div>';
  }

  function journal(a) {
    if (!a.journal.length) {
      return '<section class="journal"><h2 class="titre-section">Derniers coups</h2><p class="note">Les coups notés apparaîtront ici.</p></section>';
    }
    var items = a.journal.slice(0, 6).map(function (l) {
      var f = a.parId[l.joueur];
      var t = R.texteLigne(l);
      var fin = '';
      if (l.type === 'points' || l.type === 'victoire' || l.type === 'chute') {
        fin = '<span class="j-total num"><span class="j-fleche" aria-hidden="true">→</span> ' + fmt(l.apres) + '</span>';
      } else if (l.type === 'rate' && a.regles.troisCroix) {
        fin = croix(l.croix);
      }
      return '<li class="j-item j-' + t.classe + '" data-tour="' + esc(l.id) + '">' + avatar(f, 'avatar-petit') +
        '<span class="j-nom">' + esc(f.nom) + '</span>' +
        '<span class="j-coup num">' + esc(t.coup) + (t.note ? ' <span class="j-note">' + esc(t.note) + '</span>' : '') + '</span>' + fin + '</li>';
    }).join('');
    return '<section class="journal" aria-labelledby="titre-journal"><h2 id="titre-journal" class="titre-section">Derniers coups</h2><ol class="j-liste">' + items + '</ol></section>';
  }

  // --- Modales ----------------------------------------------------------------

  function cadre(contenu, classe, horsPanneau) {
    return '<div class="modale ' + (classe || '') + '" role="dialog" aria-modal="true" aria-labelledby="titre-modale">' +
      '<div class="voile" data-action="fermer"></div>' + (horsPanneau || '') +
      '<div class="panneau" tabindex="-1"><div class="poignee" aria-hidden="true"></div>' + contenu + '</div></div>';
  }

  function entete(titre, sousTitre, idSous) {
    return '<div class="panneau-entete"><div class="panneau-titres"><h2 id="titre-modale" class="titre-modale">' + titre + '</h2>' +
      (sousTitre !== undefined ? '<p class="note"' + (idSous ? ' id="' + idSous + '"' : '') + '>' + sousTitre + '</p>' : '') + '</div>' +
      '<button class="bouton-icone" data-action="fermer" aria-label="Fermer">' + I.fermer + '</button></div>';
  }

  function contenuModale(m) {
    switch (m.type) {
      case 'saisie': return modaleSaisie(m);
      case 'joueur': return modaleJoueur(m);
      case 'regles': return modaleRegles();
      case 'inviter': return modaleInviter();
      case 'parametres': return modaleParametres();
      case 'nouvelle': return modaleNouvelle();
      case 'ajouter': return modaleNom('ajouter');
      case 'renommer': return modaleNom('renommer', m.joueur);
      case 'retirer': return modaleRetirer(m);
      case 'aide': return modaleAide();
      case 'victoire': return modaleVictoire();
    }
    return '';
  }

  function ouvrir(m) {
    var etaitOuverte = !!S.modale;
    if (!etaitOuverte) S.retourFocus = document.activeElement;
    S.modale = m;
    if (m.type === 'saisie') S.saisie = { valeur: '', envoi: false };
    conteneurModale.innerHTML = contenuModale(m);
    document.documentElement.classList.add('modale-ouverte');
    if (m.type === 'saisie') majSaisie();
    if (m.type === 'joueur') descendreFeuille();
    if (m.fete) confettis();
    var cible = conteneurModale.querySelector('[data-focus]') || conteneurModale.querySelector('.panneau');
    if (cible) { try { cible.focus({ preventScroll: true }); } catch (e) { cible.focus(); } }
  }

  function fermer() {
    S.modale = null;
    conteneurModale.innerHTML = '';
    document.documentElement.classList.remove('modale-ouverte');
    var retour = S.retourFocus;
    S.retourFocus = null;
    if (retour && document.body.contains(retour) && retour.focus) {
      try { retour.focus({ preventScroll: true }); } catch (e) { /* rien */ }
    }
  }

  var SANS_RAFRAICHIR = { ajouter: 1, renommer: 1, nouvelle: 1, retirer: 1, victoire: 1, inviter: 1, aide: 1 };

  function majModale() {
    var m = S.modale;
    if (!m) return;
    if (m.type === 'saisie') {
      var f = S.a.parId[m.joueur];
      if (!f) { fermer(); return; }
      var sous = document.getElementById('sous-saisie');
      if (sous) sous.innerHTML = sousTitreSaisie(f);
      majSaisie();
      return;
    }
    if ((m.type === 'joueur' || m.type === 'renommer' || m.type === 'retirer') && !S.a.parId[m.joueur]) { fermer(); return; }
    if (SANS_RAFRAICHIR[m.type]) return;
    var panneau = conteneurModale.querySelector('.panneau');
    var defilement = panneau ? panneau.scrollTop : 0;
    var feuille = conteneurModale.querySelector('.feuille-defile');
    var defilementFeuille = feuille ? feuille.scrollTop : 0;
    avecChamps(conteneurModale, function () { conteneurModale.innerHTML = contenuModale(m); });
    panneau = conteneurModale.querySelector('.panneau');
    if (panneau) panneau.scrollTop = defilement;
    feuille = conteneurModale.querySelector('.feuille-defile');
    if (feuille) feuille.scrollTop = defilementFeuille;
  }

  // Saisie d'un tour ------------------------------------------------------------

  function sousTitreSaisie(f) {
    var r = S.a.regles;
    return 'Total actuel : <strong class="num">' + fmt(f.total) + '</strong>' +
      (r.troisCroix && f.croix ? ' <span class="sep">·</span> ' + croix(f.croix) : '');
  }

  function modaleSaisie(m) {
    var f = S.a.parId[m.joueur];
    if (!f) return '';
    var pourMoi = !ECRAN && m.joueur === S.moi;
    var titre = pourMoi ? 'Mon tour' : 'Tour de ' + esc(f.nom);
    var touches = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'eff'].map(function (k) {
      if (k === 'eff') return '<button type="button" class="touche touche-eff" data-touche="eff" aria-label="Effacer le dernier chiffre">' + I.effacer + '</button>';
      return '<button type="button" class="touche" data-touche="' + k + '">' + k + '</button>';
    }).join('');
    return cadre(entete(titre, sousTitreSaisie(f), 'sous-saisie') +
      '<div class="ecran-saisie"><output id="valeur-saisie" class="valeur-saisie num" aria-live="polite">0</output>' +
      '<p id="apercu-saisie" class="apercu"></p></div>' +
      '<div class="pave" role="group" aria-label="Pavé numérique">' + touches + '</div>' +
      '<div class="actions-saisie">' +
        '<button type="button" class="bouton bouton-rate" data-action="rate">' + croix(1) + '<span>Raté</span></button>' +
        '<button type="button" class="bouton bouton-principal" id="bouton-valider" data-action="valider" data-focus>Valider</button>' +
      '</div>', 'modale-saisie');
  }

  function majSaisie() {
    var m = S.modale;
    if (!m || m.type !== 'saisie') return;
    var f = S.a.parId[m.joueur];
    var v = S.saisie.valeur;
    var p = v ? parseInt(v, 10) : 0;
    var sortie = document.getElementById('valeur-saisie');
    var apercu = document.getElementById('apercu-saisie');
    var bouton = document.getElementById('bouton-valider');
    var rate = conteneurModale.querySelector('[data-action="rate"]');
    if (!sortie || !f) return;
    sortie.textContent = v ? fmt(p) : '0';
    sortie.classList.toggle('vide', !v);
    var fini = !!S.a.gagnant;
    var info;
    if (fini) info = { ok: false, type: 'fin', texte: 'La partie est terminée.' };
    else if (!v) info = { ok: false, type: 'vide', texte: (!ECRAN && m.joueur === S.moi) ? 'Tape tes points, ou « Raté » si ton tour n’a rien rapporté.' : 'Tape les points de ' + f.nom + ', ou « Raté ».' };
    else info = R.apercu(f, S.a.regles, p, fini);
    apercu.textContent = info.texte;
    apercu.className = 'apercu apercu-' + info.type;
    bouton.disabled = !v || p === 0 || !info.ok;
    bouton.textContent = info.type === 'depasse' ? 'Noter (ne compte pas)' : (info.type === 'victoire' ? 'Valider et gagner' : 'Valider');
    if (rate) rate.disabled = fini;
  }

  function touche(k) {
    var v = S.saisie.valeur;
    if (k === 'eff') v = v.slice(0, -1);
    else if (k === '00') { if (v && v.length <= 3) v += '00'; }
    else if (v.length < 5) v += k;
    v = v.replace(/^0+/, '');
    S.saisie.valeur = v;
    majSaisie();
  }

  function secouer() {
    var el = document.getElementById('apercu-saisie');
    if (!el || REDUIT || !el.animate) return;
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320 });
  }

  function valider() {
    var m = S.modale;
    if (!m || m.type !== 'saisie') return;
    var f = S.a.parId[m.joueur];
    var p = parseInt(S.saisie.valeur || '0', 10);
    if (!p || !f) return;
    var info = R.apercu(f, S.a.regles, p, !!S.a.gagnant);
    if (!info.ok) { secouer(); return; }
    noter(m.joueur, p, info);
  }

  function noterRate() {
    var m = S.modale;
    if (!m || m.type !== 'saisie') return;
    var f = S.a.parId[m.joueur];
    if (!f || S.a.gagnant) return;
    noter(m.joueur, 0, R.apercu(f, S.a.regles, 0, false));
  }

  function noter(jid, points, info) {
    if (S.saisie.envoi) return;
    S.saisie.envoi = true;
    var f = S.a.parId[jid];
    var nom = f ? f.nom : '';
    envoyer('tour', { joueur: jid, points: points, par: ECRAN ? 'ecran' : jid })
      .then(function (res) {
        S.saisie.envoi = false;
        if (S.modale && S.modale.type === 'saisie') fermer();
        var qui = (!ECRAN && jid === S.moi) ? '' : nom + ' : ';
        var texte;
        if (points === 0) texte = qui + (info.type === 'chute' ? info.texte : 'raté noté.');
        else if (info.type === 'depasse') texte = qui + 'ça dépasse, ce tour ne compte pas.';
        else texte = qui + '+' + fmt(points) + ' → ' + fmt(info.total);
        texte = texte.charAt(0).toUpperCase() + texte.slice(1);
        toast(texte, {
          action: 'Annuler',
          faire: function () {
            envoyer('supprimerTour', { tour: res.tour })
              .then(function () { toast('Tour annulé.'); })
              .catch(erreurAction);
          }
        });
      })
      .catch(function (e) {
        S.saisie.envoi = false;
        erreurAction(e);
      });
  }

  // Feuille de score d'un joueur ------------------------------------------------

  function modaleJoueur(m) {
    var a = S.a;
    var f = a.parId[m.joueur];
    if (!f) return '';
    var r = a.regles;
    var estMoi = !ECRAN && f.id === S.moi;
    var lignes;
    if (!f.lignes.length) {
      lignes = '<li class="f-vide">Aucun tour noté pour l’instant.</li>';
    } else {
      lignes = f.lignes.map(function (l, i) {
        var t = R.texteLigne(l);
        var droite;
        if (l.type === 'points' || l.type === 'victoire') droite = '<span class="f-palier num">' + fmt(l.apres) + '</span>';
        else if (l.type === 'chute') droite = '<span class="f-palier num"><s>' + fmt(l.raye) + '</s> ' + fmt(l.apres) + '</span>';
        else if (l.type === 'rate' && r.troisCroix) droite = '<span class="f-palier">' + croix(l.croix) + '</span>';
        else droite = '<span class="f-palier f-palier-nul num">' + fmt(l.apres) + '</span>';
        return '<li class="f-ligne f-' + t.classe + '"><span class="f-num num">' + (i + 1) + '</span>' +
          '<span class="f-coup"><span class="num">' + esc(t.coup) + '</span>' + (t.note ? '<span class="f-note">' + esc(t.note) + '</span>' : '') + '</span>' + droite + '</li>';
      }).join('');
    }
    var stats = R.rang(f.rang) + ' · <span class="num">' + fmt(f.total) + '</span> points · ' + f.nbTours + (f.nbTours > 1 ? ' tours' : ' tour') +
      (f.meilleur ? ' · meilleur tour <span class="num">' + fmt(f.meilleur) + '</span>' : '');
    var actions = '';
    if (ECRAN) {
      actions = '<div class="actions-feuille">' +
        (a.gagnant ? '' : '<button class="bouton bouton-principal" data-action="saisir-pour" data-joueur="' + esc(f.id) + '">Noter un tour</button>') +
        (f.dernier ? '<button class="bouton bouton-secondaire" data-action="annuler-joueur" data-joueur="' + esc(f.id) + '">' + I.annuler + '<span>Annuler son dernier tour</span></button>' : '') +
        '<button class="bouton bouton-secondaire" data-action="renommer" data-joueur="' + esc(f.id) + '">' + I.crayon + '<span>Renommer</span></button>' +
        '<button class="bouton bouton-danger" data-action="retirer" data-joueur="' + esc(f.id) + '">' + I.retirer + '<span>Retirer de la partie</span></button>' +
      '</div>';
    } else if (estMoi) {
      actions = '<div class="actions-feuille">' +
        (a.gagnant ? '' : '<button class="bouton bouton-principal" data-action="saisir">Noter mon tour</button>') +
        (f.dernier ? '<button class="bouton bouton-secondaire" data-action="annuler-dernier">' + I.annuler + '<span>Annuler mon dernier tour</span></button>' : '') +
        '<button class="bouton bouton-secondaire" data-action="renommer" data-joueur="' + esc(f.id) + '">' + I.crayon + '<span>Changer mon prénom</span></button>' +
      '</div>';
    }
    return cadre(entete('<span class="titre-avec-avatar">' + avatar(f) + '<span>' + esc(f.nom) + '</span></span>', stats) +
      '<div class="feuille-defile"><ol class="feuille" aria-label="Feuille de score de ' + esc(f.nom) + '">' + lignes + '</ol></div>' + actions, 'modale-joueur');
  }

  function descendreFeuille() {
    var feuille = conteneurModale.querySelector('.feuille-defile');
    if (feuille) feuille.scrollTop = feuille.scrollHeight;
  }

  // Règles ----------------------------------------------------------------------

  function modaleRegles() {
    var r = reglesActuelles();
    var maison = [];
    maison.push('<li><strong>Objectif :</strong> ' + fmt(r.objectif) + (r.pile ? ' pile. Si on dépasse, le tour ne compte pas.' : ' ou plus.') + '</li>');
    maison.push(r.entree > 0
      ? '<li><strong>Pour entrer dans la partie :</strong> ' + fmt(R.seuilEntree(r)) + ' points en un seul tour. Avant ça, on relance.</li>'
      : '<li><strong>Pour entrer dans la partie :</strong> pas de minimum.</li>');
    if (r.minTour > 0) maison.push('<li><strong>À chaque tour :</strong> au moins ' + fmt(r.minTour) + ' points pour avoir le droit de s’arrêter.</li>');
    if (r.troisCroix) maison.push('<li><strong>3 ratés de suite</strong> (3 croix) : on revient au palier précédent.</li>');

    var bareme = [
      [[1], 'Un 1', '100'],
      [[5], 'Un 5', '50'],
      [[1, 1, 1], 'Trois 1', fmt(1000)],
      [[4, 4, 4], 'Trois 2, 3, 4, 5 ou 6', 'valeur × 100<span class="b-ex">trois 4 = 400</span>'],
      [[3, 3, 3, 3], 'Quatre identiques', 'le double du brelan<span class="b-ex">quatre 3 = 600</span>'],
      [[6, 6, 6, 6, 6], 'Cinq identiques', 'encore le double<span class="b-ex">cinq 6 = ' + fmt(2400) + '</span>'],
      [[1, 2, 3, 4, 5], 'Suite', fmt(1000) + '<span class="b-ex">1-2-3-4-5 ou 2-3-4-5-6</span>']
    ].map(function (b) {
      return '<li class="b-ligne"><span class="b-des">' + b[0].map(function (n) { return de(n, 'de-bareme'); }).join('') + '</span>' +
        '<span class="b-nom">' + b[1] + '</span><span class="b-points num">' + b[2] + '</span></li>';
    }).join('');

    return cadre(entete('Règles du 10 000', 'Avec 5 dés, chacun son tour.') +
      '<div class="contenu-regles">' +
        '<section><h3 class="titre-bloc">Règles de cette partie</h3><ul class="liste-regles">' + maison.join('') + '</ul></section>' +
        '<section><h3 class="titre-bloc">Un tour de jeu</h3><ol class="liste-etapes">' +
          '<li>Lance les 5 dés et mets de côté ceux qui rapportent des points.</li>' +
          '<li>Relance les autres pour cumuler… ou arrête-toi et note le total de ton tour.</li>' +
          '<li>Si un lancer ne rapporte rien, tu perds les points du tour : note « Raté ».</li>' +
          '<li>Main pleine : si les 5 dés ont rapporté, tu relances les 5 et tu continues.</li>' +
        '</ol></section>' +
        '<section><h3 class="titre-bloc">Ce qui rapporte des points</h3><ul class="bareme">' + bareme + '</ul>' +
          '<p class="note">Une combinaison ne compte que si elle sort d’un seul lancer. Les barèmes changent d’une famille à l’autre : mettez-vous d’accord avant de commencer. Le compteur, lui, additionne simplement les points que vous notez.</p></section>' +
      '</div>', 'modale-regles');
  }

  // Inviter -----------------------------------------------------------------------

  function modaleInviter() {
    var url = lienPartie(CODE);
    var partage = navigator.share ? '<button class="bouton bouton-principal" data-action="partager">' + I.partager + '<span>Partager le lien</span></button>' : '';
    return cadre(entete('Inviter des joueurs', 'Fais scanner ce code avec l’appareil photo.') +
      '<div class="inviter"><div class="qr-cadre">' + qrSvg(url, 'QR code pour rejoindre la partie ' + CODE) + '</div>' +
      '<p class="code-partie code-partie-sombre">Code <strong>' + esc(CODE) + '</strong></p>' +
      '<p class="note note-centree">Sur <strong>' + esc(siteCourt()) + '</strong>, il suffit de taper ce code.</p>' +
      '<div class="actions-inviter">' + partage +
        '<button class="bouton bouton-secondaire" data-action="copier">' + I.copier + '<span>Copier le lien</span></button></div>' +
      '<input id="lien-a-copier" class="champ champ-petit champ-lien" value="' + esc(url) + '" readonly aria-label="Lien de la partie" hidden>' +
      '<a class="lien" href="' + esc(lienPartie(CODE, 'ecran')) + '">' + I.ecran + '<span>Afficher l’écran de partie sur cet appareil</span></a></div>', 'modale-inviter');
  }

  function modaleAide() {
    return cadre(entete('Le code ne marche pas ?') +
      '<div class="contenu-regles"><ul class="liste-regles">' +
        '<li>Le téléphone doit être connecté à internet : Wi‑Fi ou 4G.</li>' +
        '<li>Ouvrez l’appareil photo, visez le code, puis touchez le lien qui apparaît.</li>' +
        '<li>Sinon, allez sur <strong>' + esc(siteCourt()) + '</strong> et tapez le code <strong class="code-mini">' + esc(CODE) + '</strong>.</li>' +
      '</ul></div>', 'modale-courte');
  }

  // Règles de la maison ------------------------------------------------------------

  function segments(cle, valeurActuelle, options) {
    return '<div class="segments" role="group">' + options.map(function (o) {
      var actif = o[0] === valeurActuelle;
      return '<button type="button" class="segment' + (actif ? ' actif' : '') + '" aria-pressed="' + actif + '" data-action="regle" data-cle="' + cle + '" data-valeur="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function modaleParametres() {
    var r = S.a.regles;
    var w = lireWifi() || { nom: '', mdp: '' };
    var ent = [[0, 'Aucun'], [350, '350'], [500, '500'], [750, '750'], [1000, fmt(1000)]];
    var mini = [[0, 'Aucun'], [250, '250'], [300, '300'], [350, '350'], [400, '400'], [500, '500']];
    return cadre(entete('Règles de la maison', 'Les changements s’appliquent tout de suite, pour tout le monde.') +
      '<div class="reglages">' +
        '<div class="reglage"><p class="reglage-titre">Objectif</p>' + segments('objectif', r.objectif, [[5000, fmt(5000)], [10000, fmt(10000)]]) + '</div>' +
        '<div class="reglage"><p class="reglage-titre">Pour entrer dans la partie, en un seul tour</p>' + segments('entree', r.entree, ent) + '</div>' +
        '<div class="reglage"><p class="reglage-titre">Minimum pour s’arrêter, à chaque tour</p>' + segments('minTour', r.minTour, mini) + '</div>' +
        '<label class="interrupteur"><input type="checkbox" id="regle-pile" data-cle="pile"' + (r.pile ? ' checked' : '') + '>' +
          '<span class="interrupteur-texte"><strong>Finir pile</strong><span class="note">Si on dépasse l’objectif, le tour ne compte pas.</span></span></label>' +
        '<label class="interrupteur"><input type="checkbox" id="regle-croix" data-cle="troisCroix"' + (r.troisCroix ? ' checked' : '') + '>' +
          '<span class="interrupteur-texte"><strong>3 ratés de suite, on redescend</strong><span class="note">À la 3e croix, retour au palier précédent.</span></span></label>' +
        '<form class="bloc-wifi" data-form="wifi" novalidate>' +
          '<h3 class="titre-bloc">' + I.wifi + ' QR code du Wi‑Fi <span class="facultatif">facultatif</span></h3>' +
          '<p class="note">Vos invités se connectent au Wi‑Fi en scannant un code. Le mot de passe reste enregistré sur cet écran uniquement.</p>' +
          '<label class="etiquette-champ" for="wifi-nom">Nom du réseau</label>' +
          '<input class="champ champ-petit" id="wifi-nom" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(w.nom) + '">' +
          '<label class="etiquette-champ" for="wifi-mdp">Mot de passe</label>' +
          '<input class="champ champ-petit" id="wifi-mdp" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(w.mdp) + '">' +
          '<div class="boutons-ligne"><button class="bouton bouton-secondaire" type="submit">Afficher le QR du Wi‑Fi</button>' +
          (lireWifi() ? '<button class="bouton bouton-texte" type="button" data-action="wifi-retirer">Retirer</button>' : '') + '</div>' +
        '</form>' +
      '</div>', 'modale-parametres');
  }

  function modaleNouvelle() {
    var nb = S.a.joueurs.length;
    return cadre(entete('Nouvelle partie', 'Les scores repartent à zéro pour tout le monde.') +
      '<div class="actions-feuille">' +
        (nb ? '<button class="bouton bouton-principal" data-action="rejouer" data-focus>' + I.rejouer + '<span>Rejouer avec les mêmes joueurs</span></button>' : '') +
        '<button class="bouton bouton-secondaire" data-action="tout-effacer">Recommencer avec de nouveaux joueurs</button>' +
        '<button class="bouton bouton-texte" data-action="fermer">Annuler</button>' +
      '</div>', 'modale-courte');
  }

  function modaleNom(mode, jid) {
    var f = jid ? S.a.parId[jid] : null;
    var titre = mode === 'ajouter' ? 'Ajouter un joueur' : (!ECRAN && jid === S.moi ? 'Changer mon prénom' : 'Renommer ' + esc(f ? f.nom : ''));
    var sous = mode === 'ajouter' ? 'Pour quelqu’un qui joue sans téléphone : vous noterez ses points depuis cet écran.' : undefined;
    return cadre(entete(titre, sous) +
      '<form class="form-nom" data-form="' + mode + '" data-joueur="' + esc(jid || '') + '" novalidate>' +
        '<label class="etiquette-champ" for="champ-modale-nom">Prénom</label>' +
        '<input class="champ" id="champ-modale-nom" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="' + esc(f ? f.nom : '') + '" data-focus>' +
        '<p class="message message-alerte" id="erreur-nom" hidden></p>' +
        '<div class="boutons-ligne"><button class="bouton bouton-principal" type="submit">' + (mode === 'ajouter' ? 'Ajouter' : 'Enregistrer') + '</button>' +
        '<button class="bouton bouton-texte" type="button" data-action="fermer">Annuler</button></div>' +
      '</form>', 'modale-courte');
  }

  function modaleRetirer(m) {
    var f = S.a.parId[m.joueur];
    if (!f) return '';
    return cadre(entete('Retirer ' + esc(f.nom) + ' ?', 'Ses points seront effacés de la partie.') +
      '<div class="actions-feuille">' +
        '<button class="bouton bouton-danger" data-action="confirmer-retirer" data-joueur="' + esc(f.id) + '">' + I.retirer + '<span>Retirer ' + esc(f.nom) + '</span></button>' +
        '<button class="bouton bouton-texte" data-action="fermer" data-focus>Annuler</button>' +
      '</div>', 'modale-courte');
  }

  function modaleVictoire() {
    var a = S.a;
    var g = a.gagnant;
    if (!g) return '';
    var r = a.regles;
    var podium = a.classement.slice(0, 3).map(function (f) {
      return '<li class="podium-ligne"><span class="rang num">' + f.rang + '</span>' + avatar(f) + '<span class="nom">' + esc(f.nom) + '</span><span class="total num">' + fmt(f.total) + '</span></li>';
    }).join('');
    var estMoi = !ECRAN && g.id === S.moi;
    return cadre(
      '<div class="victoire">' + de(1, 'de-victoire') +
        '<p class="surtitre">Partie terminée</p>' +
        '<h2 id="titre-modale" class="titre-victoire">' + (estMoi ? 'Tu as gagné !' : esc(g.nom) + ' gagne !') + '</h2>' +
        '<p class="note note-centree">' + (r.pile ? fmt(r.objectif) + ' pile' : fmt(g.total) + ' points') + ' en ' + g.nbTours + ' tours · meilleur tour <span class="num">' + fmt(g.meilleur) + '</span></p>' +
        '<ol class="podium">' + podium + '</ol>' +
        '<div class="actions-feuille">' +
          '<button class="bouton bouton-principal" data-action="fermer" data-focus>Voir les scores</button>' +
          '<button class="bouton bouton-secondaire" data-action="nouvelle">' + I.rejouer + '<span>Rejouer</span></button>' +
        '</div>' +
      '</div>', 'modale-victoire', '<canvas class="confettis" id="confettis" aria-hidden="true"></canvas>');
  }

  function confettis() {
    if (REDUIT) return;
    var toile = document.getElementById('confettis');
    if (!toile || !toile.getContext) return;
    var ctx = toile.getContext('2d');
    var ratio = window.devicePixelRatio || 1;
    var l = toile.clientWidth, h = toile.clientHeight;
    toile.width = l * ratio; toile.height = h * ratio;
    ctx.scale(ratio, ratio);
    var styles = getComputedStyle(document.documentElement);
    var couleurs = ['--j0', '--j1', '--j2', '--j3', '--j4', '--pip', '--ivoire'].map(function (v) { return styles.getPropertyValue(v).trim() || '#ffffff'; });
    var morceaux = [];
    for (var i = 0; i < 90; i++) {
      morceaux.push({
        x: l / 2 + (Math.random() - 0.5) * l * 0.3, y: h * 0.35,
        vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 3,
        t: 5 + Math.random() * 6, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3,
        c: couleurs[i % couleurs.length]
      });
    }
    var debut = null;
    function image(ts) {
      if (debut === null) debut = ts;
      var ecoule = ts - debut;
      ctx.clearRect(0, 0, l, h);
      morceaux.forEach(function (m) {
        m.vy += 0.25; m.x += m.vx; m.y += m.vy; m.a += m.va; m.vx *= 0.99;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.a);
        ctx.globalAlpha = Math.max(0, 1 - ecoule / 2800);
        ctx.fillStyle = m.c;
        ctx.fillRect(-m.t / 2, -m.t / 2, m.t, m.t);
        ctx.restore();
      });
      if (ecoule < 2800 && document.body.contains(toile)) requestAnimationFrame(image);
      else ctx.clearRect(0, 0, l, h);
    }
    requestAnimationFrame(image);
  }

  // --- Messages brefs ---------------------------------------------------------

  function toast(texte, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'toast' + (opts.erreur ? ' toast-erreur' : '');
    el.innerHTML = '<span class="toast-texte">' + esc(texte) + '</span>' +
      (opts.action ? '<button type="button" class="toast-action">' + esc(opts.action) + '</button>' : '');
    var parti = false;
    function retirer() {
      if (parti) return;
      parti = true;
      el.classList.add('sortie');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, REDUIT ? 0 : 250);
    }
    if (opts.action) {
      el.querySelector('.toast-action').addEventListener('click', function () {
        retirer();
        if (opts.faire) opts.faire();
      });
    }
    while (zoneToasts.children.length >= 2) zoneToasts.removeChild(zoneToasts.firstChild);
    zoneToasts.appendChild(el);
    setTimeout(retirer, opts.duree || (opts.action ? 7000 : 4000));
  }

  // --- Actions ----------------------------------------------------------------

  function devenir(id, nouveau) {
    S.moi = id;
    S.spectateur = false;
    S.erreurRejoindre = null;
    ecrire(cleMoi(), id);
    ecrire(cleSpectateur(), null);
    fermer();
    rendre();
    window.scrollTo(0, 0);
    var f = S.a.parId[id];
    if (f) toast(nouveau ? 'Bienvenue dans la partie, ' + f.nom + ' !' : 'Tu joues en tant que ' + f.nom + '.');
  }

  function soumettreRejoindre(form) {
    var champ = form.querySelector('#champ-nom');
    var nom = (champ.value || '').trim();
    if (!nom) {
      S.erreurRejoindre = { texte: 'Écris ton prénom pour rejoindre la partie.' };
      rendre();
      var c = document.getElementById('champ-nom');
      if (c) c.focus();
      return;
    }
    var bouton = form.querySelector('[type="submit"]');
    bouton.disabled = true;
    function echec(e) {
      var b = racine.querySelector('form[data-form="rejoindre"] [type="submit"]');
      if (b) b.disabled = false;
      if (e && e.code === 'nom_pris') S.erreurRejoindre = { texte: e.message + ' C’est toi ?', joueur: e.res.joueur };
      else if (e && e.code) S.erreurRejoindre = { texte: e.message };
      else S.erreurRejoindre = { texte: 'Problème technique : ' + ((e && e.message) || String(e)) + '. Recharge la page et réessaie.' };
      rendre();
    }
    try {
      envoyer('rejoindre', { nom: nom })
        .then(function (res) { devenir(res.joueur, true); })
        .catch(echec);
    } catch (e) {
      echec(e);
    }
  }

  function soumettreCode(form) {
    var code = normaliserCode(form.querySelector('#champ-code').value);
    if (!code) {
      S.erreurCode = 'Ce code n’est pas valide : il fait 4 caractères, par exemple K7PM.';
      rendre();
      var c = document.getElementById('champ-code');
      if (c) c.focus();
      return;
    }
    location.href = lienPartie(code);
  }

  function soumettreNom(form) {
    var mode = form.getAttribute('data-form');
    var jid = form.getAttribute('data-joueur');
    var champ = form.querySelector('#champ-modale-nom');
    var nom = (champ.value || '').trim();
    var zone = form.querySelector('#erreur-nom');
    function montrer(t) { zone.textContent = t; zone.hidden = false; champ.focus(); }
    if (!nom) { montrer('Écris un prénom.'); return; }
    var bouton = form.querySelector('[type="submit"]');
    bouton.disabled = true;
    var promesse = mode === 'ajouter' ? envoyer('rejoindre', { nom: nom }) : envoyer('renommer', { joueur: jid, nom: nom });
    promesse.then(function () {
      fermer();
      toast(mode === 'ajouter' ? R.nomPropre(nom) + ' a rejoint la partie.' : 'Prénom enregistré.');
    }).catch(function (e) {
      bouton.disabled = false;
      if (e.code) montrer(e.message);
      else erreurAction(e);
    });
  }

  function soumettreWifi(form) {
    var nom = form.querySelector('#wifi-nom').value.trim();
    var mdp = form.querySelector('#wifi-mdp').value;
    if (!nom) {
      ecrire(CLE_WIFI, null);
      toast('Indique le nom du réseau Wi‑Fi.', { erreur: true });
      return;
    }
    ecrire(CLE_WIFI, JSON.stringify({ nom: nom, mdp: mdp }));
    fermer();
    rendre();
    toast('Le QR code du Wi‑Fi est affiché sur cet écran.');
  }

  function changerRegle(cle, valeur) {
    var nouvelles = {};
    nouvelles[cle] = valeur;
    envoyer('regles', { regles: nouvelles }).catch(erreurAction);
  }

  function copierLien() {
    var url = lienPartie(CODE);
    function repli() {
      var champ = document.getElementById('lien-a-copier');
      if (!champ) return;
      champ.hidden = false;
      champ.focus();
      champ.select();
      toast('Sélectionne le lien pour le copier.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('Lien copié.'); }, repli);
    } else {
      repli();
    }
  }

  function partagerLien() {
    if (!navigator.share) { copierLien(); return; }
    navigator.share({ title: 'Partie de 10 000', text: 'Rejoins la partie de 10 000 (code ' + CODE + ') :', url: lienPartie(CODE) })
      .catch(function () { /* partage annulé */ });
  }

  function pleinEcran() {
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else document.documentElement.requestFullscreen().catch(function () { toast('Le plein écran n’est pas disponible ici.'); });
  }

  var verrouEcran = null;
  function reveil() {
    // Garde l'écran de partie allumé (quand le navigateur le permet).
    if (!ECRAN || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    if (verrouEcran && !verrouEcran.released) return;
    navigator.wakeLock.request('screen').then(function (v) { verrouEcran = v; }).catch(function () {});
  }

  var ACTIONS = {
    fermer: fermer,
    recharger: function () { location.reload(); },
    creer: creerPartie,
    regles: function () { ouvrir({ type: 'regles' }); },
    inviter: function () { ouvrir({ type: 'inviter' }); },
    aide: function () { ouvrir({ type: 'aide' }); },
    partager: partagerLien,
    copier: copierLien,
    'jouer-ici': function () { location.href = lienPartie(CODE); },
    regarder: function () { S.spectateur = true; ecrire(cleSpectateur(), '1'); rendre(); },
    jouer: function () {
      S.spectateur = false;
      ecrire(cleSpectateur(), null);
      rendre();
      var c = document.getElementById('champ-nom');
      if (c) c.focus();
    },
    etre: function (el) { devenir(el.getAttribute('data-joueur'), false); },
    'autre-nom': function () {
      S.erreurRejoindre = null;
      rendre();
      var c = document.getElementById('champ-nom');
      if (c) { c.value = ''; c.focus(); }
    },
    'changer-joueur': function () { S.moi = null; ecrire(cleMoi(), null); rendre(); window.scrollTo(0, 0); },
    saisir: function () { if (S.moi) ouvrir({ type: 'saisie', joueur: S.moi }); },
    'saisir-pour': function (el) { ouvrir({ type: 'saisie', joueur: el.getAttribute('data-joueur') }); },
    voir: function (el) { ouvrir({ type: 'joueur', joueur: el.getAttribute('data-joueur') }); },
    valider: valider,
    rate: noterRate,
    'annuler-dernier': function () {
      if (!S.moi) return;
      envoyer('annuler', { joueur: S.moi }).then(function () { toast('Dernier tour annulé.'); }).catch(erreurAction);
    },
    'annuler-joueur': function (el) {
      var jid = el.getAttribute('data-joueur');
      var f = S.a.parId[jid];
      envoyer('annuler', { joueur: jid }).then(function () { toast('Dernier tour de ' + (f ? f.nom : '') + ' annulé.'); }).catch(erreurAction);
    },
    renommer: function (el) { ouvrir({ type: 'renommer', joueur: el.getAttribute('data-joueur') }); },
    retirer: function (el) { ouvrir({ type: 'retirer', joueur: el.getAttribute('data-joueur') }); },
    'confirmer-retirer': function (el) {
      var jid = el.getAttribute('data-joueur');
      var f = S.a.parId[jid];
      envoyer('retirerJoueur', { joueur: jid }).then(function () { fermer(); toast((f ? f.nom : 'Le joueur') + ' a été retiré de la partie.'); }).catch(erreurAction);
    },
    ajouter: function () { ouvrir({ type: 'ajouter' }); },
    parametres: function () { ouvrir({ type: 'parametres' }); },
    regle: function (el) { changerRegle(el.getAttribute('data-cle'), parseInt(el.getAttribute('data-valeur'), 10)); },
    nouvelle: function () { ouvrir({ type: 'nouvelle' }); },
    rejouer: function () { envoyer('nouvellePartie', { garderJoueurs: true }).then(fermer).catch(erreurAction); },
    'tout-effacer': function () { envoyer('nouvellePartie', { garderJoueurs: false }).then(fermer).catch(erreurAction); },
    'plein-ecran': pleinEcran,
    'wifi-retirer': function () { ecrire(CLE_WIFI, null); fermer(); rendre(); toast('QR code du Wi‑Fi retiré.'); }
  };

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-touche]');
    if (t && conteneurModale.contains(t)) { touche(t.getAttribute('data-touche')); return; }
    var el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var action = ACTIONS[el.getAttribute('data-action')];
    if (action) { ev.preventDefault(); action(el); }
  });

  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    var genre = form.getAttribute('data-form');
    if (!genre) return;
    ev.preventDefault();
    if (genre === 'rejoindre') soumettreRejoindre(form);
    else if (genre === 'code') soumettreCode(form);
    else if (genre === 'ajouter' || genre === 'renommer') soumettreNom(form);
    else if (genre === 'wifi') soumettreWifi(form);
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.matches('input[type="checkbox"][data-cle]')) changerRegle(el.getAttribute('data-cle'), el.checked);
  });

  document.addEventListener('keydown', function (ev) {
    if (!S.modale) return;
    if (ev.key === 'Escape') { fermer(); return; }
    if (S.modale.type !== 'saisie' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (/^[0-9]$/.test(ev.key)) { ev.preventDefault(); touche(ev.key); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); touche('eff'); }
    else if (ev.key === 'Enter') { ev.preventDefault(); valider(); }
  });

  // Safari coupe souvent la connexion en silence quand on change d'onglet ou que
  // l'écran se met en veille : au retour, on la relance.
  var cacheDepuis = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { cacheDepuis = Date.now(); return; }
    if (base && cacheDepuis && Date.now() - cacheDepuis > 4000) {
      try { base.relancer(); } catch (e) { /* rien */ }
    }
    cacheDepuis = 0;
    reveil();
  });
  // Page restaurée telle quelle par le navigateur (bouton retour) : on la recharge.
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted) location.reload();
  });
  document.addEventListener('pointerdown', reveil, { once: true });

  // Toute erreur imprévue s'affiche, pour pouvoir la signaler avec une capture d'écran.
  var dernieresErreurs = {};
  function signalerErreur(message) {
    message = String(message || 'erreur inconnue').slice(0, 160);
    if (/ResizeObserver|Script error/i.test(message)) return;
    if (dernieresErreurs[message] && Date.now() - dernieresErreurs[message] < 10000) return;
    dernieresErreurs[message] = Date.now();
    toast('Problème technique : ' + message, { erreur: true, duree: 12000 });
  }
  window.addEventListener('error', function (ev) { signalerErreur(ev.message); });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    signalerErreur(r && (r.message || r.code) ? (r.message || r.code) : r);
  });

  // --- Démarrage ----------------------------------------------------------------

  function demarrer() {
    if (!BASE_OK) { rendre(); return; }
    rendre();
    var chargement = import('./base.js?v=' + VERSION).then(function (module) {
      base = module.ouvrirBase(BASE);
      rendre();
      if (CODE) ecouter();
    });
    chargement.catch(function () {
      S.fatal = {
        titre: 'Chargement impossible',
        texte: 'Le compteur n’a pas pu se charger. Vérifie que cet appareil est connecté à internet, puis réessaie.'
      };
      rendre();
    });
  }

  demarrer();
})();
