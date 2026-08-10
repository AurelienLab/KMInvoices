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

  // --- Texte riche ---------------------------------------------------------

  /*
   * Les descriptions de produit sont saisies dans un petit editeur WYSIWYG et
   * stockees en HTML. Ce HTML finit injecte par innerHTML dans le document
   * imprimable : il ne peut donc JAMAIS etre fait confiance a la source.
   *
   * S.assainirHtml ne filtre pas, il RECONSTRUIT : il retokenise l'entree,
   * ne reemet que des balises de la liste blanche, SANS AUCUN ATTRIBUT, et
   * reechappe tout le texte. La sortie est donc du markup que ce fichier a
   * ecrit lui-meme — aucun `onclick`, aucun `style`, aucun `href` ne peut
   * survivre au passage, quelle que soit l'ingeniosite de l'entree.
   *
   * Volontairement sans DOM : ce fichier reste testable sans navigateur, et
   * la sanitisation ne depend pas de la maniere dont un parseur particulier
   * interprete un fragment malforme.
   */

  var BALISES_RICHES = {
    b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1,
    br: 1, p: 1, div: 1, ul: 1, ol: 1, li: 1
  };

  // Balises dont le CONTENU doit disparaitre avec elles : garder le texte d'un
  // <script> reviendrait a recracher le payload en clair dans le document.
  //
  // Ouverture stricte, fermeture permissive : ouvrir large ferait disparaitre
  // « il faut < script minutes » jusqu'a la fin du texte, alors que fermer
  // large ne peut que sortir plus tot d'une zone deja condamnee.
  var BALISES_TOXIQUES = /<(script|style|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi;

  var BALISES_VIDES = { br: 1 };

  /** Echappe un texte brut destine a du HTML. */
  S.echapperHtml = function (texte) {
    return String(texte == null ? '' : texte)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  /**
   * Reconstruit un fragment HTML sur : liste blanche de balises, zero
   * attribut, texte reechappe, balises rouvertes/refermees proprement.
   */
  S.assainirHtml = function (html) {
    var src = String(html == null ? '' : html)
      .replace(BALISES_TOXIQUES, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    var sortie = [];
    var pile = [];

    /*
     * Une balise, c'est « < » COLLE a une lettre — ou « </ » colle a une
     * lettre. La norme HTML est stricte la-dessus, et il faut l'etre autant :
     * tolerer une espace ferait lire « a < b & c > d » comme une balise <b>,
     * et le texte de l'utilisateur disparaitrait dans un gras fantome.
     */
    var re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
    var pos = 0;
    var m;

    // Une entite deja formee (&nbsp;, &#233;) doit passer telle quelle :
    // reechapper son « & » l'afficherait en clair dans le document.
    function texte(t) {
      if (!t) return;
      sortie.push(
        t.replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;')
      );
    }

    while ((m = re.exec(src)) !== null) {
      texte(src.slice(pos, m.index));
      pos = re.lastIndex;

      var fermante = m[1] === '/';
      var nom = m[2].toLowerCase();
      if (!BALISES_RICHES[nom]) continue;          // balise inconnue : effacee

      if (BALISES_VIDES[nom]) {
        if (!fermante) sortie.push('<' + nom + '>');
        continue;
      }

      if (!fermante) {
        sortie.push('<' + nom + '>');
        pile.push(nom);
        continue;
      }

      // Fermeture : sans ouverture correspondante, elle est orpheline et on
      // l'ignore — la reemettre produirait un fragment desequilibre.
      var i = pile.lastIndexOf(nom);
      if (i === -1) continue;
      for (var j = pile.length - 1; j >= i; j--) sortie.push('</' + pile[j] + '>');
      pile.length = i;
    }
    texte(src.slice(pos));

    for (var k = pile.length - 1; k >= 0; k--) sortie.push('</' + pile[k] + '>');

    return sortie.join('');
  };

  /** Texte brut multiligne -> HTML equivalent. Migration des anciennes fiches. */
  S.htmlDepuisTexte = function (texte) {
    var t = String(texte == null ? '' : texte);
    if (!t.trim()) return '';
    return t.split(/\r?\n/).map(S.echapperHtml).join('<br>');
  };

  /**
   * HTML -> texte brut lisible. Sert partout ou du markup n'a pas sa place :
   * apercu d'une fiche dans la liste du catalogue, recherche plein texte.
   */
  S.htmlVersTexte = function (html) {
    return String(html == null ? '' : html)
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|ul|ol)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, '\'')
      .replace(/&amp;/gi, '&')          // en dernier : sinon &amp;lt; -> <
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  /**
   * Forme canonique d'une description, quelle que soit son origine.
   *
   * Un fichier anterieur au WYSIWYG porte du texte brut dont les retours a la
   * ligne sont la seule mise en forme : on les convertit une fois pour toutes.
   * Un fragment qui ne contient plus aucun texte devient la chaine vide, pour
   * que le document n'imprime pas un bloc de description vide.
   */
  S.normaliserDescription = function (valeur) {
    var v = String(valeur == null ? '' : valeur);
    if (!v) return '';
    var html = /<[a-zA-Z][^>]*>/.test(v) ? S.assainirHtml(v) : S.htmlDepuisTexte(v);
    return S.htmlVersTexte(html) ? html : '';
  };

  // --- Attributs personnalises ---------------------------------------------

  /**
   * Caracteristique libre portee par un produit : puissance, poids, garantie.
   *
   * `valeur` est stockee en TEXTE, jamais en nombre. Un attribut vaut aussi
   * bien « 5 » que « 400 V triphase » ; forcer un type a la saisie
   * interdirait le second cas. Le caractere numerique se decide a la lecture,
   * via S.valeurNumerique.
   *
   * `totaliser` n'a d'effet que sur les valeurs numeriques. Cumuler une
   * puissance a du sens, cumuler une duree de garantie n'en a aucun : c'est a
   * la personne qui saisit la fiche de le dire, l'outil ne peut pas le deviner.
   */
  S.nouvelAttribut = function (partial) {
    return Object.assign({
      id: App.uid(),
      nom: '',
      valeur: '',
      unite: '',
      totaliser: false
    }, partial || {});
  };

  /**
   * Lecture numerique d'une valeur d'attribut, ou null.
   *
   * Accepte la virgule decimale : la saisie se fait en francais, « 5,5 » est
   * la forme naturelle et Number('5,5') vaut NaN.
   */
  S.valeurNumerique = function (v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  };

  /** Normalise une liste d'attributs venant d'un fichier. */
  S.normaliserAttributs = function (liste) {
    if (!Array.isArray(liste)) return [];
    return liste
      .filter(function (a) { return a && typeof a === 'object'; })
      .map(function (a) {
        return {
          id: a.id || App.uid(),
          nom: String(a.nom || '').trim(),
          valeur: a.valeur == null ? '' : String(a.valeur),
          unite: String(a.unite || '').trim(),
          totaliser: !!a.totaliser
        };
      })
      .filter(function (a) { return a.nom !== ''; });
  };

  /**
   * Copie profonde des attributs, pour la regle du snapshot. Une copie de
   * surface ferait partager les objets entre la fiche et la ligne : modifier
   * la fiche modifierait un devis deja emis, exactement ce que le snapshot
   * existe pour empecher.
   */
  S.copierAttributs = function (liste) {
    return S.normaliserAttributs(liste).map(function (a) {
      return Object.assign({}, a, { id: App.uid() });
    });
  };

  /** Noms d'attributs deja employes dans le catalogue, tries. Sert aux suggestions. */
  S.nomsAttributs = function (data) {
    var vus = Object.create(null);
    ((data && data.catalogue) || []).forEach(function (p) {
      (p.attributs || []).forEach(function (a) {
        if (a && a.nom) vus[a.nom] = true;
      });
    });
    return Object.keys(vus).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
  };

  /**
   * Unite la plus souvent employee dans le catalogue pour un nom d'attribut.
   *
   * Sert a pre-remplir l'unite quand on choisit une caracteristique deja
   * existante : « Puissance » a ete saisie dix fois en kW, la onzieme n'a
   * aucune raison de repartir a vide. Ne renvoie rien si le nom n'a jamais
   * porte d'unite.
   */
  S.uniteHabituelle = function (data, nom) {
    var comptes = Object.create(null);
    ((data && data.catalogue) || []).forEach(function (p) {
      (p.attributs || []).forEach(function (a) {
        if (!a || a.nom !== nom || !a.unite) return;
        comptes[a.unite] = (comptes[a.unite] || 0) + 1;
      });
    });
    return Object.keys(comptes).sort(function (a, b) {
      return comptes[b] - comptes[a] || a.localeCompare(b, 'fr');
    })[0] || '';
  };

  /** Noms d'attributs presents sur les lignes d'un devis, dans l'ordre d'apparition. */
  S.nomsAttributsDevis = function (devis) {
    var vus = Object.create(null);
    var ordre = [];
    ((devis && devis.lignes) || []).forEach(function (l) {
      (l.attributs || []).forEach(function (a) {
        if (a && a.nom && !vus[a.nom]) {
          vus[a.nom] = true;
          ordre.push(a.nom);
        }
      });
    });
    return ordre;
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
      attributs: [],
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
      // Noms d'attributs promus en colonnes du document. Une liste de NOMS,
      // pas d'identifiants : les attributs sont recopies sur chaque ligne, et
      // deux lignes portent deux objets distincts pour le meme nom.
      colonnesAttributs: [],
      remiseGlobalePct: 0,
      acomptePct: st.acomptePctParDefaut,
      notes: ''
    }, partial || {});
  };

  /**
   * Cree une ligne de devis a partir d'un produit du catalogue.
   *
   * REGLE DU SNAPSHOT : la ligne COPIE le libelle, le prix, le taux, le nom
   * de l'image ET LES ATTRIBUTS au moment de l'insertion. Un devis emis ne
   * doit jamais bouger parce que le catalogue a change. produitId ne sert qu'a
   * proposer une resynchronisation explicite, jamais a recalculer
   * automatiquement.
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
      attributs: S.copierAttributs(produit.attributs),
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
      attributs: [],
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
      // La description passe par normaliserDescription A CHAQUE ouverture :
      // c'est le seul point de passage obligatoire de toute donnee entrante,
      // donc le bon endroit pour que le HTML d'un fichier venu d'ailleurs soit
      // assaini avant d'atteindre le moindre innerHTML.
      catalogue: (data.catalogue || []).map(function (p) {
        return Object.assign(S.nouveauProduit(), p, {
          id: p.id || App.uid(),
          description: S.normaliserDescription(p.description),
          attributs: S.normaliserAttributs(p.attributs)
        });
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
          ll.description = S.normaliserDescription(ll.description);
          ll.attributs = S.normaliserAttributs(ll.attributs);
          return ll;
        });
        if (dd.remiseGlobalePct === undefined) dd.remiseGlobalePct = 0;
        if (dd.acomptePct === undefined) dd.acomptePct = 0;
        // Une colonne dont plus aucune ligne ne porte l'attribut serait une
        // colonne vide sur le document : on ne garde que celles qui ont encore
        // un sens. Supprimer la derniere ligne concernee retire la colonne.
        var presents = S.nomsAttributsDevis(dd);
        dd.colonnesAttributs = (Array.isArray(dd.colonnesAttributs) ? dd.colonnesAttributs : [])
          .filter(function (nom, i, tab) {
            return presents.indexOf(nom) !== -1 && tab.indexOf(nom) === i;
          });
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
