/*
 * Compteur 10 000 — calcul des scores selon les règles de la maison.
 *
 * Le serveur ne fait que garder la liste des tours notés par chaque joueur.
 * Ce fichier rejoue cette liste dans l'ordre pour en déduire les totaux,
 * les paliers, les croix et le gagnant. Il sert à la fois à l'appli
 * (navigateur) et aux tests (Node).
 */
(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.Regles = fabrique();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAUT = { objectif: 10000, entree: 1000, minTour: 250, pile: true, troisCroix: true };
  var CLES_REGLES = { objectif: 1, entree: 1, minTour: 1, pile: 1, troisCroix: 1 };
  var MAX_JOUEURS = 20;
  var NB_COULEURS = 10;
  var MAX_NOM = 24;

  var nombre = (typeof Intl !== 'undefined' && Intl.NumberFormat)
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
    : null;

  /** 10000 → « 10 000 ». Espace insécable normale : bien visible même en très gros chiffres. */
  function fmt(n) {
    n = Math.round(Number(n) || 0);
    if (nombre) return nombre.format(n).replace(/[  ]/g, ' ');
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function borne(valeur, defaut, min, max) {
    var n = Math.round(Number(valeur));
    if (!isFinite(n)) return defaut;
    return Math.min(max, Math.max(min, n));
  }

  function normaliser(r) {
    r = r || {};
    return {
      objectif: borne(r.objectif, DEFAUT.objectif, 500, 100000),
      entree: borne(r.entree, DEFAUT.entree, 0, 5000),
      minTour: borne(r.minTour, DEFAUT.minTour, 0, 5000),
      pile: r.pile === undefined ? DEFAUT.pile : !!r.pile,
      troisCroix: r.troisCroix === undefined ? DEFAUT.troisCroix : !!r.troisCroix
    };
  }

  /** Prénom nettoyé : sans caractères de contrôle, espaces simples, 24 caractères au plus. */
  function nomPropre(nom) {
    if (typeof nom !== 'string') return '';
    return nom.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOM).trim();
  }

  function memeNom(a, b) {
    return a.toLocaleLowerCase('fr-FR') === b.toLocaleLowerCase('fr-FR');
  }

  /**
   * Rejoue le journal d'une partie, tel qu'il est stocké dans Firebase
   * ({ cléChronologique: événement }), et reconstruit son état :
   * { existe, numero, creee, derniere, statut, depuis, regles, joueurs, tours, rejets }.
   * statut : 'en_cours', 'pause', 'close' (clôturée) ou 'effacee'.
   * Chaque appareil fait le même calcul dans le même ordre, donc tout le monde
   * voit exactement la même partie, même si deux joueurs écrivent en même temps.
   */
  function plier(evenements) {
    var cles = Object.keys(evenements || {}).sort();
    var etat = {
      existe: false, numero: 0, creee: 0, derniere: 0, statut: 'en_cours', depuis: 0,
      regles: normaliser({}), joueurs: [], tours: [], rejets: {}
    };
    var parJoueur = {};

    cles.forEach(function (cle) {
      var e = evenements[cle];
      if (!e || typeof e !== 'object') return;
      if (!etat.existe) {
        if (e.type === 'creation') {
          etat.existe = true;
          etat.creee = etat.derniere = etat.depuis = Number(e.t) || 0;
        }
        return;
      }
      if (etat.statut === 'effacee') return;   // une partie effacée l'est pour de bon
      var quand = Number(e.t) || 0;
      if (quand > etat.derniere) etat.derniere = quand;
      var nom, autre, i;
      switch (e.type) {
        case 'joueur':
          nom = nomPropre(e.nom);
          if (!nom) { etat.rejets[cle] = { code: 'nom_vide' }; return; }
          autre = null;
          for (i = 0; i < etat.joueurs.length; i++) if (memeNom(etat.joueurs[i].nom, nom)) autre = etat.joueurs[i];
          if (autre) { etat.rejets[cle] = { code: 'nom_pris', joueur: autre.id, nom: autre.nom }; return; }
          if (etat.joueurs.length >= MAX_JOUEURS) { etat.rejets[cle] = { code: 'complet' }; return; }
          var prises = etat.joueurs.map(function (j) { return j.couleur; });
          var couleur = 0;
          while (couleur < NB_COULEURS && prises.indexOf(couleur) >= 0) couleur++;
          if (couleur >= NB_COULEURS) couleur = etat.joueurs.length % NB_COULEURS;
          // Un nouveau venu rejoint la manche du joueur le moins avancé.
          var decalage = 0;
          if (etat.joueurs.length && etat.tours.length) {
            var compte = {};
            etat.tours.forEach(function (t) { compte[t.j] = (compte[t.j] || 0) + 1; });
            decalage = Math.min.apply(null, etat.joueurs.map(function (j) { return j.decalage + (compte[j.id] || 0); }));
          }
          var joueur = { id: cle, nom: nom, couleur: couleur, decalage: decalage, arrivee: Number(e.t) || 0 };
          etat.joueurs.push(joueur);
          parJoueur[cle] = joueur;
          return;
        case 'tour':
          if (!parJoueur[e.j]) return;
          var pts = Math.round(Number(e.pts));
          if (!isFinite(pts) || pts < 0 || pts > 100000) return;
          var tour = { id: cle, j: e.j, pts: pts, t: quand, par: typeof e.par === 'string' ? e.par : e.j };
          if (etat.statut === 'close') tour.horsJeu = true;   // noté après la clôture : ne compte pas
          etat.tours.push(tour);
          return;
        case 'annuler':
          etat.tours = etat.tours.filter(function (t) { return t.id !== e.tour; });
          return;
        case 'renommer':
          var cible = parJoueur[e.j];
          nom = nomPropre(e.nom);
          if (!cible || !nom) return;
          for (i = 0; i < etat.joueurs.length; i++) {
            if (etat.joueurs[i] !== cible && memeNom(etat.joueurs[i].nom, nom)) { etat.rejets[cle] = { code: 'nom_pris' }; return; }
          }
          cible.nom = nom;
          return;
        case 'retirer':
          if (!parJoueur[e.j]) return;
          etat.joueurs = etat.joueurs.filter(function (j) { return j.id !== e.j; });
          etat.tours = etat.tours.filter(function (t) { return t.j !== e.j; });
          delete parJoueur[e.j];
          return;
        case 'regle':
          if (!CLES_REGLES[e.cle]) return;
          var r = {};
          Object.keys(etat.regles).forEach(function (k) { r[k] = etat.regles[k]; });
          r[e.cle] = e.valeur;
          etat.regles = normaliser(r);
          return;
        case 'rejouer':
          etat.numero++;
          etat.tours = [];
          etat.statut = 'en_cours';
          etat.depuis = quand;
          if (e.garder === false) {
            etat.joueurs = [];
            parJoueur = {};
          } else {
            etat.joueurs.forEach(function (j) { j.decalage = 0; });
          }
          return;
        case 'pause':
          if (etat.statut === 'en_cours') { etat.statut = 'pause'; etat.depuis = quand; }
          return;
        case 'reprise':
          if (etat.statut === 'pause' || etat.statut === 'close') { etat.statut = 'en_cours'; etat.depuis = quand; }
          return;
        case 'cloture':
          if (etat.statut === 'en_cours' || etat.statut === 'pause') { etat.statut = 'close'; etat.depuis = quand; }
          return;
        case 'effacer':
          etat.statut = 'effacee';
          etat.depuis = quand;
          return;
      }
    });
    return etat;
  }

  /** Points nécessaires en un seul tour pour entrer dans la partie. */
  function seuilEntree(regles) {
    return Math.max(regles.entree, regles.minTour);
  }

  function atteint(regles, total) {
    return regles.pile ? total === regles.objectif : total >= regles.objectif;
  }

  /**
   * Rejoue tous les tours d'une partie.
   * partie = { regles, joueurs: [{id, nom, couleur, decalage}], tours: [{id, j, pts, t, par}] }
   */
  function analyser(partie) {
    partie = partie || {};
    var regles = normaliser(partie.regles);
    var joueurs = partie.joueurs || [];
    var tours = partie.tours || [];
    var parId = {};
    var parTour = {};
    var gagnant = null;

    var liste = joueurs.map(function (j, i) {
      var f = {
        id: j.id,
        nom: j.nom,
        couleur: j.couleur || 0,
        ordre: i,
        decalage: j.decalage || 0,
        total: 0,
        ouvert: regles.entree <= 0,
        croix: 0,
        paliers: [0],
        lignes: [],
        nbTours: 0,
        meilleur: 0,
        dernier: null,
        rang: 0,
        aJouer: false
      };
      parId[j.id] = f;
      return f;
    });

    tours.forEach(function (t, index) {
      var f = parId[t.j];
      if (!f) return;
      var p = Math.max(0, Math.round(Number(t.pts) || 0));
      var l = {
        id: t.id, index: index, joueur: f.id, points: p, t: t.t || 0, par: t.par || null,
        avant: f.total, apres: f.total, type: 'points', croix: 0, raye: null
      };
      f.nbTours++;

      if (gagnant || t.horsJeu) {
        l.type = 'apres-fin';
        l.apresCloture = !gagnant;
      } else if (p === 0) {
        if (!f.ouvert) {
          l.type = 'rate-dehors';            // pas de croix avant d'être entré
        } else {
          f.croix++;
          if (regles.troisCroix && f.croix >= 3) {
            l.raye = f.total;                // le palier est rayé
            if (f.paliers.length > 1) f.paliers.pop();
            f.total = f.paliers[f.paliers.length - 1];
            f.croix = 0;
            l.type = 'chute';
          } else {
            l.type = 'rate';
          }
        }
      } else if (!f.ouvert && p < seuilEntree(regles)) {
        l.type = 'trop-peu-entree';
      } else if (f.ouvert && p < regles.minTour) {
        l.type = 'trop-peu';
      } else if (regles.pile && f.total + p > regles.objectif) {
        l.type = 'depasse';                  // le tour ne compte pas, sans croix
        f.croix = 0;
      } else {
        f.ouvert = true;
        f.total += p;
        f.paliers.push(f.total);
        f.croix = 0;
        if (p > f.meilleur) f.meilleur = p;
        if (atteint(regles, f.total)) {
          gagnant = f;
          l.type = 'victoire';
        }
      }

      l.apres = f.total;
      l.croix = f.croix;
      f.lignes.push(l);
      f.dernier = l;
      parTour[t.id] = l;
    });

    // Classement : le gagnant d'abord, puis le total, puis l'ordre d'arrivée.
    var classement = liste.slice().sort(function (a, b) {
      if (gagnant) {
        if (a === gagnant) return -1;
        if (b === gagnant) return 1;
      }
      return (b.total - a.total) || (a.ordre - b.ordre);
    });
    classement.forEach(function (f, i) {
      var prec = classement[i - 1];
      f.rang = (prec && prec !== gagnant && f !== gagnant && prec.total === f.total) ? prec.rang : i + 1;
    });

    // Manche en cours : celle du joueur le moins avancé.
    var minimum = Infinity;
    liste.forEach(function (f) { minimum = Math.min(minimum, f.decalage + f.nbTours); });
    if (!liste.length) minimum = 0;
    var manche = minimum + 1;
    var tousAJour = liste.every(function (f) { return f.decalage + f.nbTours === minimum; });
    liste.forEach(function (f) {
      f.aJouer = !tousAJour && (f.decalage + f.nbTours) < manche;
    });

    var journal = [];
    for (var i = tours.length - 1; i >= 0 && journal.length < 30; i--) {
      var ligne = parTour[tours[i].id];
      if (ligne) journal.push(ligne);
    }

    // Partie clôturée avant la fin : le premier du classement l'emporte (s'il est seul en tête).
    var statut = partie.statut || 'en_cours';
    var vainqueur = gagnant;
    var egalite = false;
    if (!gagnant && statut === 'close' && classement.length && classement[0].total > 0) {
      var tete = classement.filter(function (f) { return f.rang === 1; });
      if (tete.length === 1) vainqueur = tete[0];
      else egalite = true;
    }

    return {
      regles: regles,
      joueurs: liste,
      classement: classement,
      parId: parId,
      gagnant: gagnant,          // a atteint l'objectif
      vainqueur: vainqueur,      // gagnant, ou premier d'une partie clôturée
      egalite: egalite,          // partie clôturée avec plusieurs premiers
      statut: statut,
      pause: statut === 'pause',
      fini: !!gagnant || statut === 'close',
      manche: manche,
      commencee: tours.length > 0,
      journal: journal
    };
  }

  /**
   * Ce qui se passerait si l'on notait « points » pour ce joueur.
   * finie : true (partie terminée) ou 'pause' (partie en pause).
   * Renvoie { ok, type, texte, total } ; ok = false bloque la validation.
   */
  function apercu(f, reglesBrutes, points, finie) {
    var regles = normaliser(reglesBrutes);
    points = Math.max(0, Math.round(Number(points) || 0));
    if (finie === 'pause') return { ok: false, type: 'pause', texte: 'La partie est en pause.' };
    if (finie) return { ok: false, type: 'fin', texte: 'La partie est terminée.' };
    if (!f) return { ok: false, type: 'inconnu', texte: 'Joueur introuvable.' };

    if (points === 0) {
      if (!f.ouvert) return { ok: true, type: 'rate', texte: 'Raté : pas de croix avant d’être entré dans la partie.' };
      if (regles.troisCroix && f.croix >= 2) {
        var precedent = f.paliers.length > 1 ? f.paliers[f.paliers.length - 2] : 0;
        return { ok: true, type: 'chute', texte: '3e croix : retour au palier de ' + fmt(precedent) + '.' };
      }
      return {
        ok: true, type: 'rate',
        texte: regles.troisCroix ? 'Raté : ' + (f.croix + 1 === 1 ? '1re' : (f.croix + 1) + 'e') + ' croix.' : 'Raté : ce tour ne rapporte rien.'
      };
    }
    if (points % 50 !== 0) {
      return { ok: false, type: 'cinquante', texte: 'Les points vont de 50 en 50 (ex. 650, 1 200).' };
    }
    var seuil = seuilEntree(regles);
    if (!f.ouvert && points < seuil) {
      return { ok: false, type: 'entree', texte: 'Il faut au moins ' + fmt(seuil) + ' points en un tour pour entrer dans la partie.' };
    }
    if (f.ouvert && points < regles.minTour) {
      return { ok: false, type: 'minimum', texte: 'Il faut au moins ' + fmt(regles.minTour) + ' points pour s’arrêter.' };
    }
    var total = f.total + points;
    if (regles.pile && total > regles.objectif) {
      return {
        ok: true, type: 'depasse', total: f.total,
        texte: 'Ça dépasse ' + fmt(regles.objectif) + ' : ce tour ne comptera pas. Il faut pile ' + fmt(regles.objectif - f.total) + '.'
      };
    }
    if (atteint(regles, total)) {
      return { ok: true, type: 'victoire', total: total, texte: (regles.pile ? 'Pile ' : '') + fmt(regles.objectif) + ' : partie gagnée !' };
    }
    return { ok: true, type: 'points', total: total, texte: 'Nouveau total : ' + fmt(total) };
  }

  /** Libellés d'une ligne de la feuille de score. */
  function texteLigne(l) {
    var plus = '+' + fmt(l.points);
    switch (l.type) {
      case 'victoire': return { coup: plus, note: 'partie gagnée', classe: 'victoire' };
      case 'rate': return { coup: 'Raté', note: '', classe: 'rate' };
      case 'rate-dehors': return { coup: 'Raté', note: '', classe: 'rate' };
      case 'chute': return { coup: 'Raté', note: '3e croix : retour à ' + fmt(l.apres), classe: 'chute' };
      case 'trop-peu-entree': return { coup: plus, note: 'pas assez pour entrer', classe: 'nul' };
      case 'trop-peu': return { coup: plus, note: 'sous le minimum', classe: 'nul' };
      case 'depasse': return { coup: plus, note: 'dépasse, ne compte pas', classe: 'nul' };
      case 'apres-fin': return { coup: plus, note: l.apresCloture ? 'après la clôture, ne compte pas' : 'après la fin', classe: 'nul' };
      default: return { coup: plus, note: '', classe: 'points' };
    }
  }

  function rang(n) {
    return n === 1 ? '1er' : n + 'e';
  }

  return {
    DEFAUT: DEFAUT,
    MAX_JOUEURS: MAX_JOUEURS,
    fmt: fmt,
    nomPropre: nomPropre,
    memeNom: memeNom,
    plier: plier,
    normaliser: normaliser,
    seuilEntree: seuilEntree,
    analyser: analyser,
    apercu: apercu,
    texteLigne: texteLigne,
    rang: rang
  };
});
