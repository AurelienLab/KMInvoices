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
 *
 * Depend de 20-schema pour la lecture numerique des attributs
 * (App.schema.valeurNumerique) et les types de tarifs : la forme des donnees
 * est decrite la-bas, ce fichier ne fait que la consommer. 20-schema est
 * charge avant, partout.
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
   * Type de tarif qu'un devis met en avant. Un devis anterieur au choix du
   * tarif — ou un objet de test qui ne le precise pas — met en avant le type
   * par defaut, celui que la migration a donne a l'ancien prix unique.
   */
  C.tarifDevis = function (devis) {
    return (devis && devis.tarifId) || App.schema.TARIF_ACHAT_ID;
  };

  /**
   * Prix unitaire HT d'une ligne pour un type de tarif, en centimes.
   * Une ligne qui ne porte pas ce tarif vaut zero : elle figure sur le
   * document, elle n'y est simplement pas chiffree.
   */
  C.prixLigneCents = function (ligne, tarifId) {
    var prix = ligne && ligne.prix;
    if (!prix || typeof prix !== 'object') return 0;
    return Number(prix[tarifId || App.schema.TARIF_ACHAT_ID]) || 0;
  };

  /**
   * Total HT d'une ligne, en centimes, arrondi.
   *   prix[tarif] x quantite x (1 - remisePct/100)
   */
  C.ligneTotalHTCents = function (ligne, tarifId) {
    var pu = C.prixLigneCents(ligne, tarifId);
    var q = Number(ligne.quantite) || 0;
    var r = Number(ligne.remisePct) || 0;
    return C.roundHalfUp(pu * q * (1 - r / 100));
  };

  // --- Devis ---------------------------------------------------------------

  /**
   * Calcule un devis complet. Renvoie un resultat NUMERIQUE (centimes),
   * sans aucun formatage : c'est ce que testent les assertions.
   *
   * @param {object} devis  { lignes, tarifId, remiseGlobalePct, acomptePct }
   * @returns {object}
   */
  C.computeDevis = function (devis) {
    var lignes = (devis && devis.lignes) || [];
    var tarifId = C.tarifDevis(devis);

    // 1. Total de chaque ligne, arrondi individuellement, au tarif mis en avant.
    var lignesCalc = lignes.map(function (l) {
      return {
        source: l,
        tauxTVA: Number(l.tauxTVA) || 0,
        totalHTCents: C.ligneTotalHTCents(l, tarifId)
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
      tarifId: tarifId,
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
   *   .societe      donnees societe
   *   .devis        le devis a rendre
   *   .typesTarifs  liste des types de tarifs de l'espace de travail,
   *                 facultatif (le type par defaut sinon)
   *   .imageUrls    { "<nomFichier>": "blob:..." } , facultatif
   */
  C.buildDocumentModel = function (input) {
    var societe = input.societe || {};
    var devis = input.devis || {};
    var urls = input.imageUrls || {};
    var r = C.computeDevis(devis);

    var url = function (nom) { return nom && urls[nom] ? urls[nom] : null; };
    var lignesSource = devis.lignes || [];

    /*
     * Tarif mis en avant, et tarifs d'information.
     *
     * Le type peut avoir disparu de la liste depuis l'emission du devis : les
     * lignes portent encore leurs prix sous son identifiant, et le document
     * doit continuer de se chiffrer. Il perd alors son nom — on imprime
     * l'identifiant plutot que rien — mais jamais ses montants.
     */
    var types = App.schema.normaliserTypesTarifs(input.typesTarifs);
    function typeTarif(id) {
      return types.filter(function (t) { return t.id === id; })[0] ||
        { id: id, nom: id, unite: App.schema.TARIF_UNITE_DEFAUT };
    }
    var tarif = typeTarif(r.tarifId);
    var unite = tarif.unite;

    // Dans l'ordre de la liste des types, jamais le tarif principal, et
    // seulement ceux qu'au moins une ligne chiffre : une colonne d'information
    // vide n'informe de rien.
    var tarifsInfo = types.filter(function (t) {
      return t.id !== tarif.id &&
        (devis.tarifsInfo || []).indexOf(t.id) !== -1 &&
        lignesSource.some(function (l) { return C.prixLigneCents(l, t.id) !== 0; });
    });

    /** Prix d'information d'une ligne : [{nom, texte}], seulement ceux renseignes. */
    function prixInfoLigne(ligne) {
      return tarifsInfo
        .filter(function (t) { return C.prixLigneCents(ligne, t.id) !== 0; })
        .map(function (t) {
          return { nom: t.nom, texte: F.prix(C.prixLigneCents(ligne, t.id), t.unite) };
        });
    }

    // La colonne « Remise » ne s'affiche que si au moins une ligne en porte
    // une. Une colonne entiere de tirets occupe de la largeur et n'apprend
    // rien ; sur un document informatif, elle suggere meme une negociation
    // qui n'a pas eu lieu.
    var afficherRemise = lignesSource.some(function (l) {
      return (Number(l.remisePct) || 0) !== 0;
    });

    // Meme raisonnement pour la TVA : quand toutes les lignes portent le meme
    // taux, la colonne repete N fois la meme valeur pour ne rien apprendre. Le
    // taux ne disparait pas du document, il reste au recapitulatif de TVA, qui
    // est justement l'endroit ou on le cherche.
    var tauxDistincts = Object.create(null);
    lignesSource.forEach(function (l) { tauxDistincts[Number(l.tauxTVA) || 0] = true; });
    var afficherTVA = Object.keys(tauxDistincts).length > 1;

    // Mention legale obligatoire en franchise de TVA.
    var mentionTVA = societe.regimeTVA === 'franchise'
      ? 'TVA non applicable, article 293 B du CGI'
      : '';

    /*
     * Fiches produit annexees.
     *
     * Le tableau de la proposition ne porte plus que la reference et la
     * designation : une description dans une cellule de tableau tasse tout le
     * reste et casse la lecture des chiffres. Le detail part en annexe, une
     * fiche par machine, et la ligne y renvoie par un lien interne.
     *
     * L'ancre est prefixee d'un identifiant tire A CHAQUE RENDU. L'apercu et
     * le conteneur d'impression coexistent dans la meme page : des ancres
     * stables y seraient en double, et un lien du document imprime pourrait
     * pointer sur l'apercu, invisible a l'impression.
     */
    var prefixeAncre = 'fiche-' + App.uid().slice(0, 8) + '-';
    var fiches = [];
    var fichesParCle = Object.create(null);

    function texteAttribut(a) {
      var n = App.schema.valeurNumerique(a.valeur);
      var t = n === null ? String(a.valeur == null ? '' : a.valeur) : F.nombre(n);
      return t + (a.unite ? ' ' + a.unite : '');
    }

    /**
     * Fiche d'une ligne, ou null quand il n'y a rien a montrer de plus que ce
     * que la ligne dit deja : une fiche sans photo, sans description et sans
     * caracteristique ne serait qu'une page blanche portant un titre.
     */
    function ficheDeLigne(ligne) {
      // Deux lignes du meme produit partagent une seule fiche : le devis en
      // dupliquerait autrement la page entiere.
      var cle = ligne.produitId || ligne.id;
      if (cle && fichesParCle[cle]) return fichesParCle[cle];

      var attributs = (ligne.attributs || []).filter(function (a) { return a && a.nom; });
      var photoMasquee = ligne.afficherImage === false;
      var imageUrl = photoMasquee ? null : url(ligne.imageFile);
      var description = ligne.description || '';

      // Une photo absente appelle un substitut, une photo DECOCHEE non : dans
      // le second cas, quelqu'un a explicitement demande qu'elle ne paraisse
      // pas, et lui substituer un cadre reviendrait a passer outre.
      var sansPhoto = !photoMasquee && !imageUrl;

      if (!imageUrl && !attributs.length && !App.schema.htmlVersTexte(description)) return null;

      var fiche = {
        ancre: prefixeAncre + (fiches.length + 1),
        numero: fiches.length + 1,
        reference: ligne.reference || '',
        titre: ligne.titre || '',
        imageUrl: imageUrl,
        sansPhoto: sansPhoto,
        // Deja assaini par App.schema.normalize a l'ouverture du document :
        // le template peut l'injecter tel quel.
        descriptionHtml: description,
        attributs: attributs.map(function (a) {
          return { nom: a.nom, valeurTexte: texteAttribut(a) };
        }),
        prixUnitaireTexte: F.prix(C.prixLigneCents(ligne, tarif.id), unite),
        prixInfo: prixInfoLigne(ligne),
        unite: ligne.unite || '',
        tauxTVATexte: F.taux(ligne.tauxTVA)
      };

      fiches.push(fiche);
      if (cle) fichesParCle[cle] = fiche;
      return fiche;
    }

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
        statut: devis.statut || 'brouillon'
      },

      /*
       * Tarif mis en avant. `afficherNom` dit au template s'il vaut la peine
       * de nommer le tarif sur le document : quand l'espace de travail n'en
       * connait qu'un seul, « Prix d'achat » n'apprendrait rien au lecteur.
       * L'unite, elle, s'imprime toujours — « €/mois » n'est pas un detail.
       */
      tarif: {
        id: tarif.id,
        nom: tarif.nom,
        unite: unite,
        afficherNom: types.length > 1,
        // Libelles des en-tetes : l'unite n'y figure que si elle n'est pas le
        // simple symbole euro, que tout lecteur sous-entend.
        colonneTexte: 'P.U. HT' + (unite !== App.schema.TARIF_UNITE_DEFAUT ? ' (' + unite + ')' : ''),
        totalTexte: 'Total HT' + (unite !== App.schema.TARIF_UNITE_DEFAUT ? ' (' + unite + ')' : '')
      },
      // Types affiches en information sous le prix unitaire des lignes.
      tarifsInfo: tarifsInfo.map(function (t) { return { id: t.id, nom: t.nom, unite: t.unite }; }),

      // Faut-il une colonne de remise, une colonne de TVA. Le template ne
      // decide de rien : il lit.
      afficherRemise: afficherRemise,
      afficherTVA: afficherTVA,

      lignes: lignesSource.map(function (l, i) {
        var totalCents = C.ligneTotalHTCents(l, tarif.id);
        var fiche = ficheDeLigne(l);
        return {
          numero: i + 1,
          reference: l.reference || '',
          titre: l.titre || '',
          // Renvoi vers la fiche annexee, absent quand la ligne n'en a pas.
          ficheAncre: fiche ? fiche.ancre : null,
          ficheNumero: fiche ? fiche.numero : 0,
          imageUrl: l.afficherImage === false ? null : url(l.imageFile),
          // Voir ficheDeLigne : absente n'est pas decochee.
          sansPhoto: l.afficherImage !== false && !url(l.imageFile),
          unite: l.unite || '',
          quantiteTexte: F.quantite(l.quantite),
          prixUnitaireTexte: F.montant(C.prixLigneCents(l, tarif.id)),
          // Autres tarifs, en information : [{nom, texte}], vides exclus.
          prixInfo: prixInfoLigne(l),
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

      // Un seul taux sur tout le document : le recapitulatif de TVA n'aurait
      // qu'une ligne, qui repeterait la base HT et le total TVA deja portes
      // par le bloc des totaux. Le template le remplace alors par le taux
      // entre parentheses sur la ligne « Total TVA ». Null des qu'il y a
      // plusieurs taux (ou aucune ligne) : le recapitulatif reprend sa place.
      tauxTVAUniqueTexte: r.recapTVA.length === 1 ? F.taux(r.recapTVA[0].taux) : null,

      totaux: {
        sousTotalHTTexte: F.montant(r.sousTotalHTCents),
        remiseGlobaleTexte: r.remiseGlobaleCents
          ? '- ' + F.montant(r.remiseGlobaleCents)
          : null,
        remiseGlobalePctTexte: r.remiseGlobalePct ? F.pourcent(r.remiseGlobalePct) : null,
        totalHTTexte: F.montant(r.totalHTCents),
        // Meme montant, avec l'unite du tarif : c'est la ligne mise en avant
        // du pied de document, et un chiffre en vedette sans son unite se lit
        // mal — « 1 200,00 €/mois » n'est pas « 1 200,00 € ».
        totalHTEurosTexte: F.prix(r.totalHTCents, unite),
        totalTVATexte: F.montant(r.totalTVACents),
        totalTTCTexte: F.prix(r.totalTTCCents, unite)
      },

      acompte: r.acompteCents ? {
        pctTexte: F.pourcent(r.acomptePct),
        montantTexte: F.prix(r.acompteCents, unite),
        resteTexte: F.prix(r.resteAPayerCents, unite)
      } : null,

      notesLignes: F.lignes(devis.notes),

      // Rempli par ficheDeLigne pendant la construction de `lignes` ci-dessus.
      fiches: fiches,

      // Resultat numerique brut, pour l'UI temps reel qui veut les centimes.
      brut: r
    };
  };

})(window.App);
