/**
 * 60-ui-accueil.js — tableau de bord, vue d'atterrissage de la session.
 *
 * CHARGE AVANT LES AUTRES VUES, et ce n'est pas cosmetique : la coquille ouvre
 * `Object.keys(UI.vues)[0]` au demarrage et construit la navigation dans le
 * meme ordre. Deplacer sa balise <script> dans index.html changerait la page
 * d'accueil de l'application.
 *
 * Ne detient AUCUN etat et n'ecrit jamais dans le document : il lit, il compte,
 * il renvoie ailleurs. Tout ce qu'il affiche se recalcule a chaque montage,
 * donc rien ne peut y devenir perime.
 *
 * Les actions passent par les points d'entree publics des autres vues
 * (UI.ouvrirDevis, UI.nouvelleMachine, UI.editerClient, UI.creerDevisPour) :
 * le tableau de bord ne connait l'etat interne d'aucune d'entre elles.
 */
(function (App) {
  'use strict';

  var UI = App.ui;

  var DEVIS_RECENTS = 6;

  /*
   * Le tableau de bord se redessine sur le seul evenement qu'il affiche et
   * qui peut survenir pendant qu'il est a l'ecran : l'enregistrement, qui
   * change la ligne « dernier enregistrement ».
   *
   * Pas « ouverture » : la coquille remonte deja la vue courante dans ce cas,
   * et le montage redessine. S'y abonner aussi ferait deux rendus pour rien.
   * Pas « mutation » : le document ne bouge pas depuis cet ecran.
   */
  var RAISONS_RAFRAICHISSANTES = { export: 1 };

  var desabonner = null;
  var hote = null;

  // --- Lecture des donnees -------------------------------------------------

  /**
   * Compte et cumule tout ce que le tableau de bord affiche, en UNE passe.
   * Aucun formatage ici : la mise en forme appartient au rendu.
   */
  function synthese() {
    var data = App.store.get() || {};
    var devis = data.devis || [];

    var parStatut = { brouillon: 0, envoye: 0, accepte: 0, refuse: 0 };
    var htParStatut = { brouillon: 0, envoye: 0, accepte: 0, refuse: 0 };
    var totalHT = 0;

    devis.forEach(function (d) {
      var statut = parStatut[d.statut] === undefined ? 'brouillon' : d.statut;
      var ht = App.calc.computeDevis(d).totalHTCents;
      parStatut[statut] += 1;
      htParStatut[statut] += ht;
      totalHT += ht;
    });

    return {
      societe: data.societe || {},
      devis: devis,
      nbDevis: devis.length,
      parStatut: parStatut,
      htParStatut: htParStatut,
      totalHTCents: totalHT,
      // « En cours » = ce qui peut encore se transformer en commande. Un devis
      // refuse ou accepte est sorti du pipe, il ne s'y compte plus.
      enCours: parStatut.brouillon + parStatut.envoye,
      htEnCoursCents: htParStatut.brouillon + htParStatut.envoye,
      clients: (data.clients || []).filter(function (c) { return !c.archive; }).length,
      clientsArchives: (data.clients || []).filter(function (c) { return c.archive; }).length,
      machines: (data.catalogue || []).filter(function (p) { return !p.archive; }).length,
      machinesArchivees: (data.catalogue || []).filter(function (p) { return p.archive; }).length
    };
  }

  /** Les derniers devis emis, du plus recent au plus ancien. */
  function devisRecents(devis) {
    return devis.slice().sort(function (a, b) {
      return (b.dateEmission || '').localeCompare(a.dateEmission || '');
    }).slice(0, DEVIS_RECENTS);
  }

  /**
   * La fiche societe est-elle exploitable ?
   *
   * Elle s'imprime en tete de chaque proposition : vide, le document part avec
   * un en-tete blanc. Autant le dire ici plutot que le decouvrir a l'apercu.
   */
  function societeIncomplete(societe) {
    return ['nom', 'adresse', 'ville'].filter(function (champ) {
      return !(societe[champ] || '').trim();
    });
  }

  // --- Fabriques de bloc ---------------------------------------------------

  function bloc(tag, classe, texte) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texte != null) n.textContent = texte;
    return n;
  }

  function bouton(libelle, classe, action) {
    var b = document.createElement('button');
    b.className = 'btn ' + (classe || '');
    b.textContent = libelle;
    b.onclick = action;
    return b;
  }

  /**
   * Tuile chiffree.
   * @param {object} o .valeur .libelle .detail .accent
   */
  function tuile(o) {
    var t = document.createElement('div');
    t.className = 'tb-tuile' + (o.accent ? ' tb-tuile-accent' : '');

    t.appendChild(bloc('div', 'tb-tuile-v', o.valeur));
    t.appendChild(bloc('div', 'tb-tuile-l', o.libelle));
    if (o.detail) t.appendChild(bloc('div', 'tb-tuile-d', o.detail));

    return t;
  }

  /**
   * Carte de raccourci vers une vue.
   * @param {object} o .vue .titre .detail .actions
   */
  function raccourci(o) {
    var c = document.createElement('div');
    c.className = 'tb-carte';

    var tete = bloc('div', 'tb-carte-tete');
    var ico = bloc('span', 'tb-carte-ico');
    ico.innerHTML = UI.icone(o.vue, 18);
    tete.appendChild(ico);
    tete.appendChild(bloc('span', 'tb-carte-titre', o.titre));
    c.appendChild(tete);

    c.appendChild(bloc('div', 'tb-carte-d', o.detail));

    var actions = bloc('div', 'tb-carte-actions');
    (o.actions || []).forEach(function (a) {
      actions.appendChild(bouton(a.libelle, a.classe, a.action));
    });
    c.appendChild(actions);

    return c;
  }

  // --- Sections ------------------------------------------------------------

  function sectionEntete(s) {
    var tete = bloc('div', 'tb-entete');

    var gauche = bloc('div');
    gauche.appendChild(bloc('div', 'tb-titre',
      (s.societe.nom || '').trim() || 'Document sans société'));

    var etat = App.store.etat();
    var detail = s.nbDevis
      ? s.nbDevis + ' devis · ' + s.machines + ' machine(s) · ' + s.clients + ' client(s)'
      : 'Document vide — tout commence par une machine au catalogue.';
    gauche.appendChild(bloc('div', 'tb-sous', detail));

    if (etat.lastExportedAt) {
      gauche.appendChild(bloc('div', 'tb-sous tb-sous-faible',
        'Dernier enregistrement : ' +
        new Date(etat.lastExportedAt).toLocaleString('fr-FR', {
          dateStyle: 'long', timeStyle: 'short'
        }) + (etat.nomFichierSource ? ' — ' + etat.nomFichierSource : '')));
    } else {
      gauche.appendChild(bloc('div', 'tb-sous tb-sous-faible',
        'Jamais enregistré dans un fichier .devis. Le cache du navigateur ' +
        'n\'est pas une sauvegarde.'));
    }

    tete.appendChild(gauche);

    var actions = bloc('div', 'tb-entete-actions');
    actions.appendChild(bouton('Nouveau devis', 'btn-primaire', function () {
      UI.creerDevisPour();
    }));
    actions.appendChild(bouton('Enregistrer', '', function () { UI.enregistrer(); }));
    tete.appendChild(actions);

    return tete;
  }

  function sectionAlerte(s) {
    var manquants = societeIncomplete(s.societe);
    if (!manquants.length) return null;

    var a = bloc('div', 'tb-alerte');
    var libelles = { nom: 'la raison sociale', adresse: 'l\'adresse', ville: 'la ville' };

    a.appendChild(bloc('div', 'tb-alerte-t', 'Fiche société incomplète'));
    a.appendChild(bloc('div', 'tb-alerte-d',
      'Il manque ' + manquants.map(function (m) { return libelles[m]; }).join(', ') +
      '. Ce bloc s\'imprime en tête de chaque proposition : sans lui, ' +
      'le document part avec un en-tête vide.'));
    a.appendChild(bouton('Compléter la fiche', '', function () {
      UI.ouvrirVue('societe');
    }));
    return a;
  }

  function sectionChiffres(s) {
    var g = bloc('div', 'tb-tuiles');

    g.appendChild(tuile({
      valeur: App.format.euros(s.htEnCoursCents),
      libelle: 'En cours (HT)',
      detail: s.enCours + ' devis · ' + s.parStatut.brouillon + ' brouillon(s), ' +
              s.parStatut.envoye + ' envoyé(s)',
      accent: true
    }));

    g.appendChild(tuile({
      valeur: App.format.euros(s.htParStatut.accepte),
      libelle: 'Accepté (HT)',
      detail: s.parStatut.accepte + ' devis accepté(s)' +
              (s.parStatut.refuse ? ' · ' + s.parStatut.refuse + ' refusé(s)' : '')
    }));

    g.appendChild(tuile({
      valeur: String(s.machines),
      libelle: 'Machines au catalogue',
      detail: s.machinesArchivees
        ? s.machinesArchivees + ' fiche(s) archivée(s)'
        : 'Aucune archive'
    }));

    g.appendChild(tuile({
      valeur: String(s.clients),
      libelle: 'Clients au répertoire',
      detail: s.clientsArchives
        ? s.clientsArchives + ' fiche(s) archivée(s)'
        : 'Aucune archive'
    }));

    return g;
  }

  /**
   * Repartition des devis par statut, en une barre.
   *
   * Proportionnelle au NOMBRE de devis, pas aux montants : un seul gros devis
   * accepte ecraserait visuellement dix affaires en cours, et la barre
   * raconterait le contraire de ce qu'elle montre.
   */
  function sectionRepartition(s) {
    if (!s.nbDevis) return null;

    var c = bloc('div', 'tb-bloc');
    c.appendChild(bloc('div', 'tb-bloc-t', 'Répartition des devis'));

    var barre = bloc('div', 'tb-barre');
    App.schema.STATUTS.forEach(function (statut) {
      var n = s.parStatut[statut];
      if (!n) return;
      var part = bloc('div', 'tb-barre-p statut-' + statut);
      part.style.flex = n + ' 1 0';
      part.title = App.schema.LIBELLES_STATUT[statut] + ' : ' + n + ' devis · ' +
                   App.format.euros(s.htParStatut[statut]) + ' HT';
      barre.appendChild(part);
    });
    c.appendChild(barre);

    var legende = bloc('div', 'tb-legende');
    App.schema.STATUTS.forEach(function (statut) {
      var n = s.parStatut[statut];
      if (!n) return;
      var item = bloc('span', 'tb-legende-i');
      item.appendChild(bloc('span', 'tb-puce statut-' + statut));
      item.appendChild(bloc('span', null,
        App.schema.LIBELLES_STATUT[statut] + ' · ' + n));
      legende.appendChild(item);
    });
    c.appendChild(legende);

    return c;
  }

  function sectionRecents(s) {
    var c = bloc('div', 'tb-bloc');
    c.appendChild(bloc('div', 'tb-bloc-t', 'Devis récents'));

    if (!s.nbDevis) {
      var vide = bloc('div', 'tb-vide',
        'Aucun devis pour le moment.');
      c.appendChild(vide);
      c.appendChild(bouton('Créer le premier devis', 'btn-primaire', function () {
        UI.creerDevisPour();
      }));
      return c;
    }

    var liste = bloc('div', 'tb-recents');
    devisRecents(s.devis).forEach(function (d) {
      var item = document.createElement('button');
      item.className = 'tb-recent';
      item.type = 'button';

      var gauche = bloc('span', 'tb-recent-g');
      gauche.appendChild(bloc('span', 'tb-recent-n',
        (d.client && d.client.nom) || '(client non renseigné)'));
      gauche.appendChild(bloc('span', 'tb-recent-d',
        (d.numero || '—') + ' · ' + App.format.dateCourte(d.dateEmission) +
        ' · ' + (d.lignes || []).length + ' ligne(s)'));
      item.appendChild(gauche);

      var pastille = bloc('span', 'statut statut-' + d.statut,
        App.schema.LIBELLES_STATUT[d.statut] || d.statut);
      item.appendChild(pastille);

      item.appendChild(bloc('span', 'tb-recent-m',
        App.format.euros(App.calc.computeDevis(d).totalHTCents)));

      item.onclick = function () { UI.ouvrirDevis(d.id); };
      liste.appendChild(item);
    });
    c.appendChild(liste);

    if (s.nbDevis > DEVIS_RECENTS) {
      c.appendChild(bouton('Voir les ' + s.nbDevis + ' devis', 'btn-discret',
        function () { UI.ouvrirVue('devis'); }));
    }

    return c;
  }

  function sectionRaccourcis(s) {
    var g = bloc('div', 'tb-cartes');

    g.appendChild(raccourci({
      vue: 'devis', titre: 'Devis',
      detail: s.nbDevis
        ? s.nbDevis + ' document(s), ' + s.enCours + ' encore en cours.'
        : 'Aucun devis. Sélection de machines, quantités, remises, totaux.',
      actions: [
        { libelle: 'Nouveau devis', classe: 'btn-primaire',
          action: function () { UI.creerDevisPour(); } },
        { libelle: 'Ouvrir la liste', classe: 'btn-discret',
          action: function () { UI.ouvrirVue('devis'); } }
      ]
    }));

    g.appendChild(raccourci({
      vue: 'catalogue', titre: 'Catalogue',
      detail: s.machines
        ? s.machines + ' machine(s) réutilisable(s) dans les devis.'
        : 'Vide. Une fiche ici s\'insère ensuite dans n\'importe quel devis.',
      actions: [
        { libelle: 'Nouvelle machine', classe: '',
          action: function () { UI.nouvelleMachine(); } },
        { libelle: 'Ouvrir le catalogue', classe: 'btn-discret',
          action: function () { UI.ouvrirVue('catalogue'); } }
      ]
    }));

    g.appendChild(raccourci({
      vue: 'clients', titre: 'Répertoire',
      detail: s.clients
        ? s.clients + ' fiche(s) client.'
        : 'Vide. Un devis peut s\'en passer, le répertoire évite de ressaisir.',
      actions: [
        { libelle: 'Nouveau client', classe: '', action: function () {
          // null, pas une fiche neuve : l'editeur en fabrique une lui-meme et
          // decide « creation » sur l'absence de l'identifiant du repertoire.
          UI.editerClient(null, function () { rendre(); });
        } },
        { libelle: 'Ouvrir le répertoire', classe: 'btn-discret',
          action: function () { UI.ouvrirVue('clients'); } }
      ]
    }));

    g.appendChild(raccourci({
      vue: 'societe', titre: 'Société',
      detail: (s.societe.nom || '').trim()
        ? 'En-tête et mentions imprimées sur chaque proposition.'
        : 'Non renseignée. Ce bloc s\'imprime en tête de chaque document.',
      actions: [
        { libelle: 'Modifier la fiche', classe: '',
          action: function () { UI.ouvrirVue('societe'); } }
      ]
    }));

    return g;
  }

  // --- Rendu ---------------------------------------------------------------

  function rendre() {
    if (!hote || !App.store.get()) return;
    hote.innerHTML = '';

    var s = synthese();

    [
      sectionEntete(s),
      sectionAlerte(s),
      sectionChiffres(s),
      sectionRepartition(s),
      sectionRecents(s),
      sectionRaccourcis(s)
    ].forEach(function (n) { if (n) hote.appendChild(n); });
  }

  // --- Vue -----------------------------------------------------------------

  UI.vues.accueil = {
    libelle: 'Accueil',
    icone: 'accueil',
    titre: 'Tableau de bord',
    sous: 'État du document, chiffres clés et accès direct à chaque section.',

    monter: function (h) {
      hote = document.createElement('div');
      hote.className = 'tb';
      h.appendChild(hote);

      // Un abonnement par montage fuirait : la vue est remontee a chaque
      // navigation. On coupe le precedent avant d'en poser un nouveau.
      if (desabonner) desabonner();
      desabonner = App.store.subscribe(function (st, raison) {
        if (!RAISONS_RAFRAICHISSANTES[raison]) return;
        if (UI.vueCourante() !== 'accueil') return;
        rendre();
        void st;
      });

      rendre();
    }
  };

})(window.App);
