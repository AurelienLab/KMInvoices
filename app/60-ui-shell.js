/**
 * 60-ui-shell.js — coquille de la vue d'edition : en-tete, navigation,
 * indicateur de modifications, notifications, routage des vues.
 *
 * Les vues s'enregistrent elles-memes dans App.ui.vues :
 *   App.ui.vues.societe = { titre, sous, icone, monter: function (hote) {...} };
 * Le shell ne sait rien de leur contenu.
 */
(function (App) {
  'use strict';

  var UI = App.ui || {};
  App.ui = UI;

  UI.vues = UI.vues || {};

  var vueCourante = null;
  var refs = {};

  // --- Icones (SVG inline : aucun fichier externe, aucun CDN) --------------

  UI.icones = {
    societe: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 11h.01M15 11h.01"/>',
    clients: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    catalogue: '<path d="M3 7h18M3 12h18M3 17h18"/>',
    devis: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    enregistrer: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    ouvrir: '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    nouveau: '<path d="M12 5v14M5 12h14"/>',
    imprimer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>'
  };

  UI.icone = function (nom, taille) {
    var d = UI.icones[nom] || '';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
           'stroke-linecap="round" stroke-linejoin="round"' +
           (taille ? ' width="' + taille + '" height="' + taille + '"' : '') + '>' + d + '</svg>';
  };

  // --- Notifications -------------------------------------------------------

  /**
   * @param {string} message
   * @param {string} [type]   "succes" | "erreur" | "alerte" | ""
   * @param {string} [detail] texte secondaire, multiligne accepte
   */
  UI.notifier = function (message, type, detail) {
    var hote = document.getElementById('notifs');
    if (!hote) { console.log('[ui]', message, detail || ''); return; }

    var n = document.createElement('div');
    n.className = 'notif' + (type ? ' ' + type : '');
    var t = document.createElement('div');
    t.textContent = message;
    n.appendChild(t);
    if (detail) {
      var d = document.createElement('div');
      d.className = 'notif-detail';
      d.textContent = detail;
      n.appendChild(d);
    }
    hote.appendChild(n);

    var duree = type === 'erreur' ? 9000 : 4200;
    setTimeout(function () {
      n.style.transition = 'opacity .2s';
      n.style.opacity = '0';
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 220);
    }, duree);
  };

  UI.erreur = function (prefixe, err) {
    console.error(prefixe, err);
    UI.notifier(prefixe, 'erreur', (err && err.message) || String(err));
  };

  // --- Navigation ----------------------------------------------------------

  UI.ouvrirVue = function (nom) {
    var vue = UI.vues[nom];
    if (!vue) { console.warn('[ui] vue inconnue :', nom); return; }

    vueCourante = nom;

    Array.prototype.forEach.call(refs.nav.querySelectorAll('.nav-item'), function (b) {
      b.classList.toggle('actif', b.dataset.vue === nom);
    });

    refs.vue.innerHTML = '';

    var tete = document.createElement('div');
    tete.className = 'vue-tete';
    var h = document.createElement('div');
    h.className = 'vue-titre';
    h.textContent = vue.titre;
    tete.appendChild(h);
    if (vue.sous) {
      var s = document.createElement('div');
      s.className = 'vue-sous';
      s.textContent = vue.sous;
      tete.appendChild(s);
    }
    refs.vue.appendChild(tete);

    var hote = document.createElement('div');
    refs.vue.appendChild(hote);

    try {
      vue.monter(hote);
    } catch (e) {
      UI.erreur('Impossible d\'afficher cette vue.', e);
    }

    refs.vue.scrollTop = 0;
  };

  UI.vueCourante = function () { return vueCourante; };

  function construireNav() {
    refs.nav.innerHTML = '';

    var groupe = document.createElement('div');
    groupe.className = 'nav-groupe';
    groupe.textContent = 'Document';
    refs.nav.appendChild(groupe);

    Object.keys(UI.vues).forEach(function (nom) {
      var vue = UI.vues[nom];
      var b = document.createElement('button');
      b.className = 'nav-item';
      b.dataset.vue = nom;
      b.innerHTML = UI.icone(vue.icone || 'devis') +
                    '<span>' + vue.libelle + '</span>' +
                    '<span class="compteur" data-compteur="' + nom + '"></span>';
      b.onclick = function () { UI.ouvrirVue(nom); };
      refs.nav.appendChild(b);
    });

    var pied = document.createElement('div');
    pied.className = 'nav-pied';
    pied.id = 'nav-pied';
    refs.nav.appendChild(pied);
  }

  // --- Indicateur d'etat du document --------------------------------------

  function rafraichirEtat() {
    var st = App.store.etat();
    var modifie = App.store.estModifie();

    refs.etat.className = 'etat-doc' + (modifie ? ' modifie' : '');
    refs.etat.innerHTML = '<span class="point"></span><span></span>';
    refs.etat.lastChild.textContent = modifie
      ? 'Modifications non enregistrées'
      : (st.lastExportedAt ? 'Enregistré' : 'Aucune modification');

    // Affiche le fichier que produira le PROCHAIN enregistrement : chaque
    // enregistrement crée une version, autant savoir laquelle arrive.
    var cible = App.store.nomEnregistrement();
    refs.doc.textContent = (st.nomFichierSource || 'Nouveau document') + '  →  ' + cible;
    refs.doc.title = 'Le prochain enregistrement créera « ' + cible + ' »';

    // Compteurs de navigation.
    var data = App.store.get();
    if (data) {
      var compteurs = {
        clients: (data.clients || []).filter(function (c) { return !c.archive; }).length,
        catalogue: (data.catalogue || []).filter(function (p) { return !p.archive; }).length,
        devis: (data.devis || []).length
      };
      Object.keys(compteurs).forEach(function (k) {
        var n = refs.nav.querySelector('[data-compteur="' + k + '"]');
        if (n) n.textContent = compteurs[k] || '';
      });
    }

    var pied = document.getElementById('nav-pied');
    if (pied) {
      pied.textContent = 'Version ' + App.version +
        (st.lastModifiedAt ? ' · modifié à ' + new Date(st.lastModifiedAt).toLocaleTimeString('fr-FR') : '');
    }
  }

  UI.rafraichirEtat = rafraichirEtat;

  // --- Enregistrement ------------------------------------------------------

  UI.enregistrer = function () {
    if (!App.archive.disponible()) {
      UI.erreur('Enregistrement impossible.', App.archive.erreurJSZip());
      return Promise.resolve();
    }
    refs.btnSave.disabled = true;

    return App.store.enregistrer().then(function (res) {
      UI.notifier('Version ' + res.version + ' enregistrée.', 'succes',
        res.nom + ' · ' + Math.round(res.taille / 1024) + ' Ko' +
        (res.imagesManquantes && res.imagesManquantes.length
          ? '\n' + res.imagesManquantes.length + ' image(s) introuvable(s) et non incluse(s).'
          : ''));
    }).catch(function (err) {
      UI.erreur('Enregistrement impossible.', err);
    }).then(function () {
      refs.btnSave.disabled = false;
    });
  };

  // --- Montage -------------------------------------------------------------

  UI.monterCoquille = function () {
    refs.app = document.getElementById('app');
    refs.nav = document.getElementById('nav');
    refs.vue = document.getElementById('vue');
    refs.etat = document.getElementById('etat-doc');
    refs.doc = document.getElementById('entete-doc');
    refs.btnSave = document.getElementById('btn-enregistrer');

    construireNav();

    refs.btnSave.onclick = function () { UI.enregistrer(); };

    document.getElementById('btn-ouvrir').onclick = function () {
      App.boot.demanderOuverture();
    };
    document.getElementById('btn-nouveau').onclick = function () {
      App.boot.demanderNouveau();
    };

    App.store.subscribe(function (st, raison) {
      rafraichirEtat();
      if (raison === 'ouverture' && vueCourante) UI.ouvrirVue(vueCourante);
      void st;
    });

    // Garde-fou : le cache navigateur n'est pas une sauvegarde.
    window.addEventListener('beforeunload', function (e) {
      if (App.store.estModifie()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });

    // Ctrl/Cmd+S : enregistrer une nouvelle version.
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        UI.enregistrer();
      }
    });

    refs.app.classList.add('actif');
    rafraichirEtat();
    UI.ouvrirVue(Object.keys(UI.vues)[0]);
  };

  // --- Aides de formulaire, partagees par les vues -------------------------

  /**
   * Champ texte lie a une propriete de l'etat.
   * L'ecriture passe toujours par App.store.mutate : c'est ce qui declenche
   * l'autosave et le drapeau de modification.
   */
  UI.champ = function (opts) {
    var wrap = document.createElement('div');
    wrap.className = 'champ' + (opts.taille ? ' ' + opts.taille : '');

    var id = 'f-' + Math.random().toString(36).slice(2, 9);
    var lab = document.createElement('label');
    lab.setAttribute('for', id);
    lab.textContent = opts.libelle;
    wrap.appendChild(lab);

    var input;
    if (opts.type === 'textarea') {
      input = document.createElement('textarea');
      if (opts.lignes) input.rows = opts.lignes;
    } else if (opts.type === 'select') {
      input = document.createElement('select');
      (opts.options || []).forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.valeur;
        op.textContent = o.libelle;
        input.appendChild(op);
      });
    } else {
      input = document.createElement('input');
      input.type = opts.type || 'text';
      if (opts.pas) input.step = opts.pas;
      if (opts.min != null) input.min = opts.min;
    }

    input.id = id;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.value = opts.valeur == null ? '' : opts.valeur;

    var evenement = (opts.type === 'select') ? 'change' : 'input';
    input.addEventListener(evenement, function () {
      opts.onchange(input.value, input);
    });

    wrap.appendChild(input);

    if (opts.aide) {
      var a = document.createElement('div');
      a.className = 'aide';
      a.textContent = opts.aide;
      wrap.appendChild(a);
    }

    wrap.input = input;
    return wrap;
  };

  /**
   * Fenetre modale.
   *
   * @param {object} opts
   *   .titre     titre affiche
   *   .sous      sous-titre facultatif
   *   .corps     HTMLElement insere dans le corps
   *   .largeur   largeur CSS, defaut 640px
   *   .actions   [{ libelle, classe, onclick(fermer) }] , de gauche a droite
   *   .onFermer  appele a la fermeture, quelle qu'en soit la cause
   * @returns {{fermer: function, corps: HTMLElement}}
   */
  UI.modal = function (opts) {
    var o = opts || {};

    var fond = document.createElement('div');
    fond.className = 'modal-fond';

    var boite = document.createElement('div');
    boite.className = 'modal';
    if (o.largeur) boite.style.maxWidth = o.largeur;

    var tete = document.createElement('div');
    tete.className = 'modal-tete';
    var titres = document.createElement('div');
    var t = document.createElement('div');
    t.className = 'modal-titre';
    t.textContent = o.titre || '';
    titres.appendChild(t);
    if (o.sous) {
      var s = document.createElement('div');
      s.className = 'modal-sous';
      s.textContent = o.sous;
      titres.appendChild(s);
    }
    tete.appendChild(titres);

    var croix = document.createElement('button');
    croix.className = 'btn btn-discret modal-croix';
    croix.innerHTML = '&times;';
    croix.title = 'Fermer (Échap)';
    tete.appendChild(croix);
    boite.appendChild(tete);

    var corps = document.createElement('div');
    corps.className = 'modal-corps';
    if (o.corps) corps.appendChild(o.corps);
    boite.appendChild(corps);

    var pied = document.createElement('div');
    pied.className = 'modal-pied';
    boite.appendChild(pied);

    var ferme = false;
    function fermer() {
      if (ferme) return;
      ferme = true;
      document.removeEventListener('keydown', surTouche, true);
      if (fond.parentNode) fond.parentNode.removeChild(fond);
      if (o.onFermer) o.onFermer();
    }

    function surTouche(e) {
      if (e.key === 'Escape') { e.stopPropagation(); fermer(); }
    }

    (o.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + (a.classe || '');
      b.textContent = a.libelle;
      b.onclick = function () { a.onclick(fermer, b); };
      if (a.aDroite) b.style.marginLeft = 'auto';
      pied.appendChild(b);
    });

    croix.onclick = fermer;
    fond.onclick = function (e) { if (e.target === fond) fermer(); };
    document.addEventListener('keydown', surTouche, true);

    fond.appendChild(boite);
    document.body.appendChild(fond);

    // Premier champ focalise : on enchaine souvent plusieurs saisies.
    var premier = corps.querySelector('input, textarea, select');
    if (premier) premier.focus();

    return { fermer: fermer, corps: corps, boite: boite };
  };

  /** Confirmation modale. Renvoie une promesse resolue par un booleen. */
  UI.confirmer = function (titre, message, opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      var corps = document.createElement('div');
      corps.className = 'modal-message';
      corps.textContent = message;
      var decide = null;

      UI.modal({
        titre: titre,
        corps: corps,
        largeur: '480px',
        actions: [
          { libelle: o.annuler || 'Annuler', onclick: function (f) { decide = false; f(); } },
          {
            libelle: o.confirmer || 'Confirmer',
            classe: o.danger ? 'btn-danger' : 'btn-primaire',
            aDroite: true,
            onclick: function (f) { decide = true; f(); }
          }
        ],
        onFermer: function () { resolve(decide === true); }
      });
    });
  };

  /** Carte de formulaire avec titre et grille. */
  UI.carte = function (titre, note) {
    var c = document.createElement('div');
    c.className = 'carte';

    var tete = document.createElement('div');
    tete.className = 'carte-tete';
    var t = document.createElement('div');
    t.className = 'carte-titre';
    t.textContent = titre;
    tete.appendChild(t);
    if (note) {
      var n = document.createElement('div');
      n.className = 'carte-note';
      n.textContent = note;
      tete.appendChild(n);
    }
    c.appendChild(tete);

    var corps = document.createElement('div');
    corps.className = 'carte-corps';
    var grille = document.createElement('div');
    grille.className = 'grille';
    corps.appendChild(grille);
    c.appendChild(corps);

    c.grille = grille;
    c.corps = corps;
    return c;
  };

})(window.App);
