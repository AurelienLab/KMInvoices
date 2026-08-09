/**
 * templates/default/template.js — moteur de rendu du document imprimable.
 *
 * CONTRAT :
 *   App.templates.default.render(model) -> HTMLElement (racine .doc-root)
 *
 * La fonction est PURE : elle ne lit ni le store, ni IndexedDB, ni le DOM
 * existant, et ne fait AUCUN calcul ni AUCUN formatage. Tout arrive deja
 * calcule, arrondi et formate par 30-calc.js.
 *
 * Elle ne produit aucun champ de saisie : ce document n'est pas la vue
 * d'edition restylee, c'est un document distinct.
 *
 * Ajouter une variante = copier ce dossier, changer l'identifiant, ajouter
 * deux balises dans index.html. Rien d'autre.
 */
(function (App) {
  'use strict';

  // --- Petits utilitaires de construction DOM ------------------------------

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null && text !== '') n.textContent = text;
    return n;
  }

  function add(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var c = arguments[i];
      if (c) parent.appendChild(c);
    }
    return parent;
  }

  /** Bloc de lignes de texte (adresse, mentions). Renvoie null si vide. */
  function lignesBloc(tag, className, lignes) {
    if (!lignes || !lignes.length) return null;
    var n = el(tag, className);
    lignes.forEach(function (l) { add(n, el('div', null, l)); });
    return n;
  }

  /** Paire libelle/valeur, masquee si la valeur est vide. */
  function paire(libelle, valeur, className) {
    if (!valeur) return null;
    var n = el('div', className || 'kv');
    add(n, el('span', 'kv-k', libelle), el('span', 'kv-v', valeur));
    return n;
  }

  // --- Blocs du document ---------------------------------------------------

  function renderEnTete(m) {
    var head = el('header', 'doc-head');

    var ident = el('div', 'doc-emetteur');
    if (m.societe.logoUrl) {
      var logo = el('img', 'doc-logo');
      logo.src = m.societe.logoUrl;
      logo.alt = m.societe.nom;
      add(ident, logo);
    }
    add(ident, el('div', 'doc-emetteur-nom', m.societe.nom));
    add(ident, lignesBloc('div', 'doc-emetteur-adr', m.societe.adresseLignes));

    var contact = el('div', 'doc-emetteur-contact');
    add(contact,
      m.societe.telephone ? el('div', null, 'Tél. ' + m.societe.telephone) : null,
      m.societe.email ? el('div', null, m.societe.email) : null,
      m.societe.siteWeb ? el('div', null, m.societe.siteWeb) : null
    );
    if (contact.childNodes.length) add(ident, contact);

    var ids = el('div', 'doc-emetteur-ids');
    add(ids,
      m.societe.siret ? el('div', null, 'SIRET ' + m.societe.siret) : null,
      m.societe.tvaIntracom ? el('div', null, 'TVA ' + m.societe.tvaIntracom) : null
    );
    if (ids.childNodes.length) add(ident, ids);

    /*
     * Cartouche, a droite.
     *
     * Ni numero, ni date de fin de validite : ce document est une FICHE
     * INFORMATIVE, pas une offre engageante. Un numero laisserait croire a une
     * piece comptable, une date de validite a un engagement de prix. Le devis
     * garde son numero en interne, pour nommer les fichiers ; il ne s'imprime
     * plus.
     */
    var meta = el('div', 'doc-meta');
    add(meta, el('div', 'doc-titre', 'Proposition commerciale'));
    var table = el('div', 'doc-meta-liste');
    add(table, paire('Date d\'émission', m.devis.dateEmissionTexte));
    add(meta, table);

    return add(head, ident, meta);
  }

  function renderClient(m) {
    var bloc = el('section', 'doc-client');
    add(bloc, el('div', 'doc-bloc-titre', 'Destinataire'));
    var corps = el('div', 'doc-client-corps');
    add(corps, el('div', 'doc-client-nom', m.client.nom));
    if (m.client.contact) add(corps, el('div', 'doc-client-contact', 'À l\'attention de ' + m.client.contact));
    add(corps, lignesBloc('div', 'doc-client-adr', m.client.adresseLignes));
    var c = el('div', 'doc-client-contacts');
    add(c,
      m.client.telephone ? el('div', null, 'Tél. ' + m.client.telephone) : null,
      m.client.email ? el('div', null, m.client.email) : null
    );
    if (c.childNodes.length) add(corps, c);
    return add(bloc, corps);
  }

  function renderLignes(m) {
    var table = el('table', 'doc-lignes');

    // display: table-header-group en CSS -> l'en-tete se repete a chaque page.
    var thead = el('thead');
    var tr = el('tr');
    add(tr, el('th', 'c-des', 'Désignation'));

    // Colonnes d'attributs, entre la designation et les chiffres : elles
    // decrivent la machine, elles ne la chiffrent pas.
    m.colonnes.forEach(function (c) {
      add(tr, el('th', 'c-attr', c.uniteCommune ? c.nom + ' (' + c.uniteCommune + ')' : c.nom));
    });

    add(tr,
      el('th', 'c-qte', 'Qté'),
      el('th', 'c-pu', 'P.U. HT'),
      m.afficherRemise ? el('th', 'c-rem', 'Remise') : null,
      el('th', 'c-tva', 'TVA'),
      el('th', 'c-tot', 'Total HT')
    );
    add(thead, tr);
    add(table, thead);

    var tbody = el('tbody');
    m.lignes.forEach(function (l) {
      var row = el('tr', 'doc-ligne');

      var des = el('td', 'c-des');
      var desWrap = el('div', 'lig-wrap');

      if (l.imageUrl) {
        var fig = el('div', 'lig-img');
        var img = el('img');
        img.src = l.imageUrl;
        img.alt = l.titre;
        add(fig, img);
        add(desWrap, fig);
      }

      var txt = el('div', 'lig-txt');
      if (l.reference) add(txt, el('div', 'lig-ref', l.reference));
      add(txt, el('div', 'lig-titre', l.titre));
      add(txt, lignesBloc('div', 'lig-desc', l.descriptionLignes));
      add(desWrap, txt);
      add(des, desWrap);

      var qte = el('td', 'c-qte');
      add(qte, el('span', 'lig-qte-n', l.quantiteTexte));
      if (l.unite) add(qte, el('span', 'lig-unite', ' ' + l.unite));

      add(row, des);
      l.attributsTexte.forEach(function (v) {
        add(row, el('td', 'c-attr', v || '—'));
      });
      add(row,
        qte,
        el('td', 'c-pu', l.prixUnitaireTexte),
        m.afficherRemise ? el('td', 'c-rem', l.remiseTexte || '—') : null,
        el('td', 'c-tva', l.tauxTVATexte),
        el('td', 'c-tot', l.totalHTTexte)
      );
      add(tbody, row);
    });
    add(table, tbody);

    return table;
  }

  /**
   * Cumuls des attributs numeriques marques « totaliser » au catalogue.
   *
   * Multiplies par les quantites : c'est le total de l'installation proposee,
   * pas la somme des caracteristiques unitaires. Absent si rien n'est
   * cumulable — ce bloc n'a pas de raison d'exister a vide.
   */
  function renderTotauxAttributs(m) {
    if (!m.totauxAttributs || !m.totauxAttributs.length) return null;

    var bloc = el('section', 'doc-attr-totaux');
    add(bloc, el('div', 'doc-bloc-titre', 'Totaux de l\'ensemble'));

    var liste = el('div', 'attr-liste');
    m.totauxAttributs.forEach(function (t) {
      var n = el('div', 'attr-tot');
      add(n, el('span', 'attr-tot-k', t.nom), el('span', 'attr-tot-v', t.totalTexte));
      add(liste, n);
    });

    return add(bloc, liste);
  }

  function renderRecapTVA(m) {
    var bloc = el('div', 'doc-tva');
    add(bloc, el('div', 'doc-bloc-titre', 'Récapitulatif de TVA'));
    var t = el('table', 'doc-tva-table');
    var thead = el('thead');
    var tr = el('tr');
    add(tr, el('th', null, 'Taux'), el('th', null, 'Base HT'), el('th', null, 'Montant'));
    add(thead, tr);
    add(t, thead);
    var tb = el('tbody');
    m.recapTVA.forEach(function (r) {
      var row = el('tr');
      add(row,
        el('td', 'tva-taux', r.tauxTexte),
        el('td', 'tva-base', r.baseHTTexte),
        el('td', 'tva-mnt', r.montantTVATexte)
      );
      add(tb, row);
    });
    add(t, tb);
    return add(bloc, t);
  }

  function renderTotaux(m) {
    var bloc = el('div', 'doc-totaux');
    var t = m.totaux;

    function ligne(libelle, valeur, cls) {
      var n = el('div', 'tot-l' + (cls ? ' ' + cls : ''));
      add(n, el('span', 'tot-k', libelle), el('span', 'tot-v', valeur));
      return n;
    }

    if (t.remiseGlobaleTexte) {
      add(bloc, ligne('Sous-total HT', t.sousTotalHTTexte));
      add(bloc, ligne(
        'Remise globale' + (t.remiseGlobalePctTexte ? ' (' + t.remiseGlobalePctTexte + ')' : ''),
        t.remiseGlobaleTexte, 'tot-remise'));
    }
    add(bloc, ligne('Total HT', t.totalHTTexte));
    add(bloc, ligne('Total TVA', t.totalTVATexte));
    add(bloc, ligne('Total TTC', t.totalTTCTexte, 'tot-ttc'));

    if (m.acompte) {
      add(bloc, ligne('Acompte à la commande (' + m.acompte.pctTexte + ')', m.acompte.montantTexte, 'tot-acompte'));
      add(bloc, ligne('Reste à payer', m.acompte.resteTexte, 'tot-reste'));
    }

    return bloc;
  }

  function renderSynthese(m) {
    // TVA a gauche, totaux a droite, l'ensemble insecable.
    var bloc = el('section', 'doc-synthese');
    return add(bloc, renderRecapTVA(m), renderTotaux(m));
  }

  function renderConditions(m) {
    var lignes = m.societe.conditionsPaiementLignes;
    if ((!lignes || !lignes.length) && !m.notesLignes.length && !m.societe.mentionTVA) return null;
    var bloc = el('section', 'doc-conditions');

    if (lignes && lignes.length) {
      var c = el('div', 'doc-cond-bloc');
      add(c, el('div', 'doc-bloc-titre', 'Conditions de paiement'));
      add(c, lignesBloc('div', 'doc-cond-corps', lignes));
      add(bloc, c);
    }
    if (m.notesLignes && m.notesLignes.length) {
      var n = el('div', 'doc-cond-bloc');
      add(n, el('div', 'doc-bloc-titre', 'Observations'));
      add(n, lignesBloc('div', 'doc-cond-corps', m.notesLignes));
      add(bloc, n);
    }
    if (m.societe.mentionTVA) {
      add(bloc, el('div', 'doc-mention-tva', m.societe.mentionTVA));
    }
    return bloc;
  }

  /*
   * Pas d'encart de signature.
   *
   * Le document est une fiche informative : il ne se signe pas, il ne se
   * retourne pas. Un cadre « Bon pour accord » en transformerait la nature —
   * un client qui le renvoie signe croit avoir commande.
   */

  function renderPied(m) {
    var pied = el('footer', 'doc-pied');
    var l = el('div', 'pied-l');
    add(l, el('span', null, m.societe.nom));
    if (m.societe.siret) add(l, el('span', 'pied-sep', '·'), el('span', null, 'SIRET ' + m.societe.siret));
    if (m.societe.tvaIntracom) add(l, el('span', 'pied-sep', '·'), el('span', null, 'TVA ' + m.societe.tvaIntracom));
    add(pied, l);
    var mentions = lignesBloc('div', 'pied-mentions', m.societe.mentionsLegalesLignes);
    if (mentions) add(pied, mentions);
    // Sans numero, c'est la date qui identifie le document d'une page a l'autre.
    add(pied, el('div', 'pied-doc',
      'Proposition commerciale' +
      (m.devis.dateEmissionTexte ? ' du ' + m.devis.dateEmissionTexte : '')));
    return pied;
  }

  // --- Point d'entree ------------------------------------------------------

  App.templates.default = {
    id: 'default',
    label: 'Standard',
    modelVersion: 1,

    /**
     * @param {object} model modele fige produit par App.calc.buildDocumentModel
     * @returns {HTMLElement} racine .doc-root, detachee du document
     */
    render: function (model) {
      var root = el('article', 'doc-root');
      root.setAttribute('lang', 'fr');

      /*
       * Le document entier est porte par un tableau, uniquement pour son
       * <tfoot>.
       *
       * C'est le SEUL mecanisme de Chromium qui repete un bloc en bas de
       * chaque feuille ET lui reserve sa place dans le flux. Un pied en
       * position: fixed se repete aussi, mais ne reserve rien : le contenu
       * descend jusqu'au bord de la page et le pied s'imprime par-dessus.
       *
       * Les zones de marge @page (@bottom-center) feraient cela proprement,
       * mais Chromium ne les implemente pas — meme raison qui interdit la
       * numerotation de page automatique.
       */
      var page = el('table', 'doc-page');

      var corps = el('tbody');
      var trCorps = el('tr');
      var tdCorps = el('td');
      add(tdCorps,
        renderEnTete(model),
        renderClient(model),
        renderLignes(model),
        renderTotauxAttributs(model),
        renderSynthese(model),
        renderConditions(model)
      );
      add(trCorps, tdCorps);
      add(corps, trCorps);

      var pied = el('tfoot');
      var trPied = el('tr');
      var tdPied = el('td');
      add(tdPied, renderPied(model));
      add(trPied, tdPied);
      add(pied, trPied);

      add(page, corps, pied);
      add(root, page);

      return root;
    }
  };

})(window.App);
