/**
 * 30-calc.js — moteur de calcul. Fonctions PURES.
 *
 * Aucun acces au DOM, a IndexedDB, au store. Entree : des donnees. Sortie :
 * des donnees. C'est la partie ou les bugs coutent cher, elle doit rester
 * testable a la main dans tests.html.
 *
 * Conventions retenues pour le POC (regroupees ici pour etre revisitables
 * en un seul endroit) :
 *   - tous les montants circulent en CENTIMES ENTIERS ;
 *   - le total HT est arrondi AU NIVEAU DE LA LIGNE, puis somme
 *     (convention comptable francaise : on ne somme pas avant d'arrondir) ;
 *   - arrondi ROUND_HALF_UP explicite, jamais Math.round sur un flottant
 *     signe ;
 *   - la remise globale s'applique apres le sous-total HT et se ventile au
 *     prorata sur chaque taux de TVA ; le residu d'arrondi de la ventilation
 *     va sur la plus grosse base ;
 *   - l'acompte se calcule sur le TTC.
 */
(function (App) {
  'use strict';

  var C = App.calc;
  var F = App.format;

  // --- Arrondi -------------------------------------------------------------

  /**
   * ROUND_HALF_UP sur une valeur en centimes, symetrique autour de zero.
   * Math.round() arrondit -0.5 vers 0 : comportement asymetrique dont on ne
   * veut pas sur des montants qui peuvent etre negatifs (avoirs, remises).
   */
  C.roundHalfUp = function (x) {
    if (!isFinite(x)) return 0;
    var s = x < 0 ? -1 : 1;
    return s * Math.floor(Math.abs(x) + 0.5);
  };

  /** Euros (nombre saisi par l'utilisateur) -> centimes entiers. */
  C.eurosToCents = function (euros) {
    return C.roundHalfUp((Number(euros) || 0) * 100);
  };

  /** Centimes -> euros flottant. Affichage uniquement. */
  C.centsToEuros = function (cents) {
    return (cents || 0) / 100;
  };

  // --- Ligne ---------------------------------------------------------------

  /**
   * Total HT d'une ligne, en centimes, arrondi.
   *   prixHTCents x quantite x (1 - remisePct/100)
   */
  C.ligneTotalHTCents = function (ligne) {
    var pu = Number(ligne.prixHTCents) || 0;
    var q = Number(ligne.quantite) || 0;
    var r = Number(ligne.remisePct) || 0;
    return C.roundHalfUp(pu * q * (1 - r / 100));
  };

  // --- Devis ---------------------------------------------------------------

  /**
   * Calcule un devis complet. Renvoie un resultat NUMERIQUE (centimes),
   * sans aucun formatage : c'est ce que testent les assertions.
   *
   * @param {object} devis  { lignes, remiseGlobalePct, acomptePct }
   * @returns {object}
   */
  C.computeDevis = function (devis) {
    var lignes = (devis && devis.lignes) || [];

    // 1. Total de chaque ligne, arrondi individuellement.
    var lignesCalc = lignes.map(function (l) {
      return {
        source: l,
        tauxTVA: Number(l.tauxTVA) || 0,
        totalHTCents: C.ligneTotalHTCents(l)
      };
    });

    // 2. Sous-total HT et bases brutes par taux.
    var sousTotalHTCents = 0;
    var basesBrutes = Object.create(null); // taux -> centimes
    lignesCalc.forEach(function (lc) {
      sousTotalHTCents += lc.totalHTCents;
      basesBrutes[lc.tauxTVA] = (basesBrutes[lc.tauxTVA] || 0) + lc.totalHTCents;
    });

    var taux = Object.keys(basesBrutes)
      .map(Number)
      .sort(function (a, b) { return b - a; }); // decroissant : 20, 10, 5.5, 0

    // 3. Remise globale, ventilee au prorata des bases brutes.
    var remisePct = Number(devis && devis.remiseGlobalePct) || 0;
    var remiseGlobaleCents = sousTotalHTCents > 0
      ? C.roundHalfUp(sousTotalHTCents * remisePct / 100)
      : 0;

    var parts = {};
    if (remiseGlobaleCents !== 0 && sousTotalHTCents !== 0) {
      var cumul = 0;
      taux.forEach(function (t) {
        parts[t] = C.roundHalfUp(remiseGlobaleCents * basesBrutes[t] / sousTotalHTCents);
        cumul += parts[t];
      });
      // Le residu d'arrondi (souvent 1 centime) va sur la plus grosse base,
      // pour que la somme des parts egale exactement la remise globale.
      var residu = remiseGlobaleCents - cumul;
      if (residu !== 0) {
        var plusGrosse = taux[0];
        taux.forEach(function (t) {
          if (basesBrutes[t] > basesBrutes[plusGrosse]) plusGrosse = t;
        });
        parts[plusGrosse] += residu;
      }
    } else {
      taux.forEach(function (t) { parts[t] = 0; });
    }

    // 4. Recapitulatif de TVA par taux, sur les bases nettes.
    var recapTVA = taux.map(function (t) {
      var baseNette = basesBrutes[t] - (parts[t] || 0);
      return {
        taux: t,
        baseHTCents: baseNette,
        remiseVentileeCents: parts[t] || 0,
        montantTVACents: C.roundHalfUp(baseNette * t / 100)
      };
    });

    var totalHTCents = recapTVA.reduce(function (s, r) { return s + r.baseHTCents; }, 0);
    var totalTVACents = recapTVA.reduce(function (s, r) { return s + r.montantTVACents; }, 0);
    var totalTTCCents = totalHTCents + totalTVACents;

    // 5. Acompte sur le TTC.
    var acomptePct = Number(devis && devis.acomptePct) || 0;
    var acompteCents = acomptePct > 0 ? C.roundHalfUp(totalTTCCents * acomptePct / 100) : 0;

    return {
      lignes: lignesCalc.map(function (lc) {
        return { id: lc.source.id, totalHTCents: lc.totalHTCents, tauxTVA: lc.tauxTVA };
      }),
      sousTotalHTCents: sousTotalHTCents,
      remiseGlobalePct: remisePct,
      remiseGlobaleCents: remiseGlobaleCents,
      totalHTCents: totalHTCents,
      recapTVA: recapTVA,
      totalTVACents: totalTVACents,
      totalTTCCents: totalTTCCents,
      acomptePct: acomptePct,
      acompteCents: acompteCents,
      resteAPayerCents: totalTTCCents - acompteCents
    };
  };

  // --- Modele de document --------------------------------------------------

  /**
   * Produit le modele fige consomme par App.templates[x].render(model).
   *
   * Tout y est deja calcule, arrondi et FORMATE : le template n'a aucun
   * calcul ni aucune mise en forme a faire, il ne fait que du markup.
   *
   * Les images sont passees en parametre sous forme d'URL deja resolues
   * (blob: cotes app, data: cotes lab) : cette fonction reste pure et
   * n'ouvre jamais IndexedDB elle-meme.
   *
   * @param {object} input
   *   .societe    donnees societe
   *   .devis      le devis a rendre
   *   .imageUrls  { "<nomFichier>": "blob:..." } , facultatif
   */
  C.buildDocumentModel = function (input) {
    var societe = input.societe || {};
    var devis = input.devis || {};
    var urls = input.imageUrls || {};
    var r = C.computeDevis(devis);

    var url = function (nom) { return nom && urls[nom] ? urls[nom] : null; };

    var dateValidite = devis.validiteJours
      ? F.ajouterJours(devis.dateEmission, devis.validiteJours)
      : '';

    // Mention legale obligatoire en franchise de TVA.
    var mentionTVA = societe.regimeTVA === 'franchise'
      ? 'TVA non applicable, article 293 B du CGI'
      : '';

    return {
      meta: {
        genereLe: F.dateCourte(new Date()),
        appVersion: App.version
      },

      societe: {
        nom: societe.nom || '',
        adresseLignes: F.lignes(
          [societe.adresse, [societe.codePostal, societe.ville].filter(Boolean).join(' ')]
            .filter(Boolean).join('\n')
        ),
        siret: societe.siret || '',
        tvaIntracom: societe.tvaIntracom || '',
        telephone: societe.telephone || '',
        email: societe.email || '',
        siteWeb: societe.siteWeb || '',
        logoUrl: url(societe.logoFile),
        mentionsLegalesLignes: F.lignes(societe.mentionsLegales),
        conditionsPaiementLignes: F.lignes(societe.conditionsPaiement),
        mentionTVA: mentionTVA
      },

      client: {
        nom: (devis.client && devis.client.nom) || '',
        contact: (devis.client && devis.client.contact) || '',
        adresseLignes: F.lignes(
          [
            devis.client && devis.client.adresse,
            [devis.client && devis.client.codePostal, devis.client && devis.client.ville]
              .filter(Boolean).join(' ')
          ].filter(Boolean).join('\n')
        ),
        email: (devis.client && devis.client.email) || '',
        telephone: (devis.client && devis.client.telephone) || ''
      },

      devis: {
        numero: devis.numero || '',
        dateEmissionTexte: F.dateLongue(devis.dateEmission),
        dateValiditeTexte: F.dateLongue(dateValidite),
        validiteJoursTexte: devis.validiteJours ? devis.validiteJours + ' jours' : '',
        statut: devis.statut || 'brouillon'
      },

      lignes: (devis.lignes || []).map(function (l, i) {
        var totalCents = C.ligneTotalHTCents(l);
        return {
          numero: i + 1,
          reference: l.reference || '',
          titre: l.titre || '',
          descriptionLignes: F.lignes(l.description),
          imageUrl: l.afficherImage === false ? null : url(l.imageFile),
          unite: l.unite || '',
          quantiteTexte: F.quantite(l.quantite),
          prixUnitaireTexte: F.montant(l.prixHTCents),
          remisePct: Number(l.remisePct) || 0,
          remiseTexte: Number(l.remisePct) ? F.pourcent(l.remisePct) : '',
          tauxTVATexte: F.taux(l.tauxTVA),
          totalHTTexte: F.montant(totalCents)
        };
      }),

      recapTVA: r.recapTVA.map(function (t) {
        return {
          tauxTexte: F.taux(t.taux),
          baseHTTexte: F.montant(t.baseHTCents),
          montantTVATexte: F.montant(t.montantTVACents)
        };
      }),

      totaux: {
        sousTotalHTTexte: F.montant(r.sousTotalHTCents),
        remiseGlobaleTexte: r.remiseGlobaleCents
          ? '- ' + F.montant(r.remiseGlobaleCents)
          : null,
        remiseGlobalePctTexte: r.remiseGlobalePct ? F.pourcent(r.remiseGlobalePct) : null,
        totalHTTexte: F.montant(r.totalHTCents),
        totalTVATexte: F.montant(r.totalTVACents),
        totalTTCTexte: F.euros(r.totalTTCCents)
      },

      acompte: r.acompteCents ? {
        pctTexte: F.pourcent(r.acomptePct),
        montantTexte: F.euros(r.acompteCents),
        resteTexte: F.euros(r.resteAPayerCents)
      } : null,

      notesLignes: F.lignes(devis.notes),

      // Resultat numerique brut, pour l'UI temps reel qui veut les centimes.
      brut: r
    };
  };

})(window.App);
