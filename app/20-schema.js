/**
 * 20-schema.js — forme des donnees, valeurs par defaut, validation, migrations.
 *
 * Fonctions PURES : aucun acces au DOM ni a IndexedDB.
 *
 * schemaVersion est verifie a chaque import :
 *   - version superieure  -> refus explicite, le fichier vient d'une version
 *     plus recente de l'outil et on ne sait pas le lire ;
 *   - version inferieure  -> passage par migrate(), meme si la table des
 *     migrations est vide au depart.
 */
(function (App) {
  'use strict';

  var S = {};

  S.CURRENT = 1;

  S.TAUX_TVA = [20, 10, 5.5, 2.1, 0];
  S.UNITES = ['u', 'h', 'jour', 'forfait', 'mois', 'm²', 'km', 'lot'];
  S.STATUTS = ['brouillon', 'envoye', 'accepte', 'refuse'];

  S.LIBELLES_STATUT = {
    brouillon: 'Brouillon',
    envoye: 'Envoyé',
    accepte: 'Accepté',
    refuse: 'Refusé'
  };

  // --- Valeurs par defaut --------------------------------------------------

  S.defaultSociete = function () {
    return {
      nom: '',
      adresse: '',
      codePostal: '',
      ville: '',
      siret: '',
      tvaIntracom: '',
      telephone: '',
      email: '',
      siteWeb: '',
      logoFile: null,
      regimeTVA: 'normal',            // "normal" | "franchise"
      mentionsLegales: '',
      conditionsPaiement: ''
    };
  };

  S.defaultSettings = function () {
    return {
      numerotation: {
        prefixe: String(new Date().getFullYear()),
        prochainSeq: 1,
        largeur: 4                     // 42 -> "0042"
      },
      validiteJoursParDefaut: 30,
      tauxTVAParDefaut: 20,
      acomptePctParDefaut: 30,
      template: 'default'
    };
  };

  S.defaultWorkspace = function () {
    return {
      schemaVersion: S.CURRENT,
      societe: S.defaultSociete(),
      settings: S.defaultSettings(),
      clients: [],
      catalogue: [],
      devis: []
    };
  };

  // --- Clients -------------------------------------------------------------

  S.nouveauClient = function (partial) {
    return Object.assign({
      id: App.uid(),
      nom: '',
      contact: '',
      adresse: '',
      codePostal: '',
      ville: '',
      email: '',
      telephone: '',
      siret: '',
      notes: '',
      archive: false
    }, partial || {});
  };

  /** Bloc client vide, tel qu'il est stocke dans un devis. */
  S.clientVide = function () {
    return {
      nom: '', contact: '', adresse: '', codePostal: '', ville: '',
      email: '', telephone: ''
    };
  };

  /**
   * Snapshot d'une fiche du repertoire vers un devis.
   *
   * MEME REGLE QUE LE CATALOGUE : le devis COPIE les coordonnees au moment de
   * l'insertion. Si le client demenage six mois plus tard, un devis deja emis
   * doit continuer de porter l'adresse a laquelle il a ete envoye.
   * `clientId` ne sert qu'a proposer une resynchronisation explicite.
   */
  S.clientDepuisRepertoire = function (fiche) {
    return {
      nom: fiche.nom || '',
      contact: fiche.contact || '',
      adresse: fiche.adresse || '',
      codePostal: fiche.codePostal || '',
      ville: fiche.ville || '',
      email: fiche.email || '',
      telephone: fiche.telephone || ''
    };
  };

  /** Vrai si le bloc client d'un devis differe encore de sa fiche d'origine. */
  S.clientDiverge = function (blocDevis, fiche) {
    if (!blocDevis || !fiche) return false;
    var snap = S.clientDepuisRepertoire(fiche);
    return Object.keys(snap).some(function (k) {
      return (blocDevis[k] || '') !== (snap[k] || '');
    });
  };

  S.nouveauProduit = function (partial) {
    var p = {
      id: App.uid(),
      reference: '',
      titre: '',
      description: '',
      prixHTCents: 0,
      tauxTVA: 20,
      unite: 'u',
      imageFile: null,
      archive: false
    };
    return Object.assign(p, partial || {});
  };

  S.nouveauDevis = function (settings, partial) {
    var st = settings || S.defaultSettings();
    return Object.assign({
      id: App.uid(),
      numero: S.formaterNumero(st.numerotation),
      dateEmission: App.format.toIso(new Date()),
      validiteJours: st.validiteJoursParDefaut,
      statut: 'brouillon',
      clientId: null,          // lien vers le repertoire, peut devenir orphelin
      client: S.clientVide(),  // SNAPSHOT des coordonnees a l'insertion
      lignes: [],
      remiseGlobalePct: 0,
      acomptePct: st.acomptePctParDefaut,
      notes: ''
    }, partial || {});
  };

  /**
   * Cree une ligne de devis a partir d'un produit du catalogue.
   *
   * REGLE DU SNAPSHOT : la ligne COPIE le libelle, le prix, le taux et le nom
   * de l'image au moment de l'insertion. Un devis emis ne doit jamais bouger
   * parce que le catalogue a change. produitId ne sert qu'a proposer une
   * resynchronisation explicite, jamais a recalculer automatiquement.
   */
  S.ligneDepuisProduit = function (produit, quantite) {
    return {
      id: App.uid(),
      produitId: produit.id,
      reference: produit.reference,
      titre: produit.titre,
      description: produit.description,
      prixHTCents: produit.prixHTCents,
      tauxTVA: produit.tauxTVA,
      unite: produit.unite,
      imageFile: produit.imageFile,
      afficherImage: true,
      quantite: quantite == null ? 1 : quantite,
      remisePct: 0
    };
  };

  /** Ligne libre, sans produit d'origine. */
  S.ligneLibre = function (settings) {
    var st = settings || S.defaultSettings();
    return {
      id: App.uid(),
      produitId: null,
      reference: '',
      titre: '',
      description: '',
      prixHTCents: 0,
      tauxTVA: st.tauxTVAParDefaut,
      unite: 'u',
      imageFile: null,
      afficherImage: false,
      quantite: 1,
      remisePct: 0
    };
  };

  // --- Numerotation --------------------------------------------------------

  S.formaterNumero = function (num) {
    var n = num || S.defaultSettings().numerotation;
    var seq = String(n.prochainSeq || 1);
    while (seq.length < (n.largeur || 4)) seq = '0' + seq;
    return (n.prefixe ? n.prefixe + '-' : '') + seq;
  };

  /** Nom de fichier image jamais reutilise : le snapshot doit rester stable. */
  S.nomImage = function (extension) {
    return 'img-' + App.uid() + '.' + (extension || 'jpg');
  };

  // --- Validation ----------------------------------------------------------

  /**
   * Verifie qu'un objet ressemble a un espace de travail exploitable.
   * @returns {{ok: boolean, erreurs: string[], avertissements: string[]}}
   */
  S.validate = function (data) {
    var erreurs = [];
    var avertissements = [];

    if (!data || typeof data !== 'object') {
      return { ok: false, erreurs: ['Le fichier ne contient pas de données exploitables.'], avertissements: [] };
    }

    var v = data.schemaVersion;
    if (typeof v !== 'number' || !isFinite(v)) {
      erreurs.push('schemaVersion absent ou invalide : ce fichier n\'a pas été produit par cet outil.');
    } else if (v > S.CURRENT) {
      erreurs.push(
        'Ce fichier a été créé avec une version plus récente de l\'application ' +
        '(schemaVersion ' + v + ', cette version lit jusqu\'à ' + S.CURRENT + '). ' +
        'Mettre l\'application à jour pour l\'ouvrir.'
      );
    }

    if (data.societe && typeof data.societe !== 'object') erreurs.push('Le bloc « societe » est invalide.');
    if (data.clients && !Array.isArray(data.clients)) erreurs.push('Le bloc « clients » est invalide.');
    if (data.catalogue && !Array.isArray(data.catalogue)) erreurs.push('Le bloc « catalogue » est invalide.');
    if (data.devis && !Array.isArray(data.devis)) erreurs.push('Le bloc « devis » est invalide.');

    if (erreurs.length) return { ok: false, erreurs: erreurs, avertissements: avertissements };

    // Contraintes metier : signalees, mais jamais bloquantes a l'import.
    // Refuser d'ouvrir un fichier a cause d'une reference en double serait
    // pire que le probleme lui-meme.
    var vues = Object.create(null);
    (data.catalogue || []).forEach(function (p, i) {
      if (!p.id) avertissements.push('Produit #' + (i + 1) + ' sans identifiant.');
      var ref = (p.reference || '').trim().toUpperCase();
      if (ref) {
        if (vues[ref]) avertissements.push('Référence en double dans le catalogue : « ' + p.reference + ' ».');
        vues[ref] = true;
      }
    });

    var nomsClients = Object.create(null);
    (data.clients || []).forEach(function (c, i) {
      if (!c.id) avertissements.push('Client #' + (i + 1) + ' sans identifiant.');
      var nom = (c.nom || '').trim().toLowerCase();
      if (nom) {
        if (nomsClients[nom]) avertissements.push('Client en double dans le répertoire : « ' + c.nom + ' ».');
        nomsClients[nom] = true;
      }
    });

    var numeros = Object.create(null);
    (data.devis || []).forEach(function (d, i) {
      if (!d.id) avertissements.push('Devis #' + (i + 1) + ' sans identifiant.');
      if (d.numero) {
        if (numeros[d.numero]) avertissements.push('Numéro de devis en double : « ' + d.numero + ' ».');
        numeros[d.numero] = true;
      }
      if (!Array.isArray(d.lignes)) avertissements.push('Devis « ' + (d.numero || d.id) + ' » : lignes invalides.');
    });

    return { ok: true, erreurs: erreurs, avertissements: avertissements };
  };

  // --- Migrations ----------------------------------------------------------

  /**
   * Table des migrations : chaque entree fait passer de la version N a N+1.
   * Vide au depart, mais la couture est en place : c'est ce qui permettra de
   * lire les fichiers d'aujourd'hui dans six mois.
   *
   *   S.migrations[1] = function (data) { ...; data.schemaVersion = 2; return data; };
   */
  S.migrations = {};

  S.migrate = function (data) {
    var d = data;
    var garde = 0;
    while (d.schemaVersion < S.CURRENT) {
      var m = S.migrations[d.schemaVersion];
      if (!m) {
        throw new Error(
          'Aucune migration disponible depuis la version ' + d.schemaVersion +
          ' vers la version ' + S.CURRENT + '.'
        );
      }
      d = m(d);
      if (++garde > 50) throw new Error('Boucle de migration détectée.');
    }
    return d;
  };

  /**
   * Complete les champs absents par leurs valeurs par defaut. Applique apres
   * migration : un fichier ancien peut manquer de champs ajoutes depuis, sans
   * que cela merite une migration a part entiere.
   */
  S.normalize = function (data) {
    var base = S.defaultWorkspace();
    var out = {
      schemaVersion: data.schemaVersion || S.CURRENT,
      societe: Object.assign(base.societe, data.societe || {}),
      settings: Object.assign(base.settings, data.settings || {}),
      // Absent des fichiers anterieurs a l'ajout du repertoire : un tableau
      // vide suffit, aucune migration de version n'est necessaire.
      clients: (data.clients || []).map(function (c) {
        return Object.assign(S.nouveauClient(), c, { id: c.id || App.uid() });
      }),
      catalogue: (data.catalogue || []).map(function (p) {
        return Object.assign(S.nouveauProduit(), p, { id: p.id || App.uid() });
      }),
      devis: (data.devis || []).map(function (d) {
        var dd = Object.assign({}, d);
        dd.id = dd.id || App.uid();
        if (dd.clientId === undefined) dd.clientId = null;
        dd.client = Object.assign(S.clientVide(), dd.client || {});
        dd.lignes = (dd.lignes || []).map(function (l) {
          var ll = Object.assign({}, l);
          ll.id = ll.id || App.uid();
          if (ll.afficherImage === undefined) ll.afficherImage = !!ll.imageFile;
          if (ll.quantite === undefined) ll.quantite = 1;
          if (ll.remisePct === undefined) ll.remisePct = 0;
          return ll;
        });
        if (dd.remiseGlobalePct === undefined) dd.remiseGlobalePct = 0;
        if (dd.acomptePct === undefined) dd.acomptePct = 0;
        return dd;
      })
    };
    out.settings.numerotation = Object.assign(
      base.settings.numerotation,
      (data.settings && data.settings.numerotation) || {}
    );
    return out;
  };

  /**
   * Liste tous les noms d'images referencees, catalogue ET lignes de devis.
   *
   * Le balayage des lignes est indispensable : une image peut n'etre plus
   * referencee par aucun produit du catalogue tout en restant necessaire a un
   * ancien devis. Purger sur la seule base du catalogue casserait l'historique.
   */
  S.imagesReferencees = function (data) {
    var vues = Object.create(null);
    if (data.societe && data.societe.logoFile) vues[data.societe.logoFile] = true;
    (data.catalogue || []).forEach(function (p) {
      if (p.imageFile) vues[p.imageFile] = true;
    });
    (data.devis || []).forEach(function (d) {
      (d.lignes || []).forEach(function (l) {
        if (l.imageFile) vues[l.imageFile] = true;
      });
    });
    return Object.keys(vues);
  };

  App.schema = S;

})(window.App);
