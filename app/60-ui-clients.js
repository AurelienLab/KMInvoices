/**
 * 60-ui-clients.js — repertoire des clients.
 *
 * Meme principe que le catalogue : une fiche reutilisable, dont le devis fait
 * une COPIE FIGEE a l'insertion. Modifier une fiche ne change aucun devis
 * deja etabli — si un client demenage, les devis anterieurs doivent continuer
 * de porter l'adresse a laquelle ils ont ete envoyes.
 *
 * `devis.clientId` conserve le lien, uniquement pour proposer une
 * resynchronisation explicite depuis l'editeur de devis.
 */
(function (App) {
  'use strict';

  var UI = App.ui;

  var vueEtat = {
    recherche: '',
    montrerArchives: false
  };

  var hoteListe = null;

  // --- Selection -----------------------------------------------------------

  function clientsFiltres() {
    var data = App.store.get();
    var q = vueEtat.recherche.trim().toLowerCase();

    return (data.clients || []).filter(function (c) {
      if (!vueEtat.montrerArchives && c.archive) return false;
      if (!q) return true;
      return [c.nom, c.contact, c.ville, c.email, c.codePostal]
        .some(function (v) { return (v || '').toLowerCase().indexOf(q) !== -1; });
    }).sort(function (a, b) {
      return (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' });
    });
  }

  /** Devis rattaches a cette fiche. Interdit une suppression destructrice. */
  function devisUtilisant(clientId) {
    var data = App.store.get();
    return (data.devis || []).filter(function (d) { return d.clientId === clientId; });
  }

  function nomLibre(nom, sauf) {
    var n = (nom || '').trim().toLowerCase();
    if (!n) return true;
    return !(App.store.get().clients || []).some(function (c) {
      return c.id !== sauf && (c.nom || '').trim().toLowerCase() === n;
    });
  }

  // --- Editeur de fiche ----------------------------------------------------

  /**
   * @param {object|null} client fiche existante, fiche PREREMPLIE a creer,
   *                             ou null pour partir d'une fiche vierge
   * @param {function} [apres]   rappel recevant la fiche enregistree
   */
  function ouvrirEditeur(client, apres) {
    var brouillon = Object.assign(App.schema.nouveauClient(), client || {});

    /*
     * Creation ou modification se decide sur la PRESENCE DE L'IDENTIFIANT
     * dans le repertoire, jamais sur le fait qu'un objet ait ete passe.
     *
     * L'editeur est aussi appele avec une fiche preremplie depuis un devis
     * (« Enregistrer ce client ») : elle porte deja un identifiant mais
     * n'existe pas encore dans le repertoire. Se fier a l'argument faisait
     * croire a une modification, la recherche dans le tableau echouait, et
     * rien n'etait ecrit — tout en rattachant le devis a une fiche fantome.
     */
    var creation = !(App.store.get().clients || []).some(function (c) {
      return c.id === brouillon.id;
    });

    var form = document.createElement('div');
    form.className = 'grille';

    function set(champ, valeur) { brouillon[champ] = valeur; }

    var champNom = UI.champ({
      libelle: 'Raison sociale', taille: 'c7', valeur: brouillon.nom,
      placeholder: 'Ateliers Fournier & Fils',
      onchange: function (v) { set('nom', v); validerNom(); }
    });
    form.appendChild(champNom);

    var erreurNom = document.createElement('div');
    erreurNom.className = 'champ-erreur';
    champNom.appendChild(erreurNom);

    function validerNom() {
      var nom = (brouillon.nom || '').trim();
      if (!nom) {
        erreurNom.textContent = 'La raison sociale est obligatoire.';
      } else if (!nomLibre(nom, brouillon.id)) {
        erreurNom.textContent = 'Un client porte déjà ce nom dans le répertoire.';
      } else {
        erreurNom.textContent = '';
      }
      champNom.input.classList.toggle('invalide', !!erreurNom.textContent);
      return !erreurNom.textContent;
    }

    [
      { chemin: 'siret', libelle: 'SIRET', taille: 'c5' },
      { chemin: 'contact', libelle: 'À l\'attention de', taille: 'c12',
        placeholder: 'Laurent Fournier, responsable production' },
      { chemin: 'adresse', libelle: 'Adresse', taille: 'c12', type: 'textarea', lignes: 2 },
      { chemin: 'codePostal', libelle: 'Code postal', taille: 'c3' },
      { chemin: 'ville', libelle: 'Ville', taille: 'c4' },
      { chemin: 'telephone', libelle: 'Téléphone', taille: 'c5', type: 'tel' },
      { chemin: 'email', libelle: 'Courriel', taille: 'c6', type: 'email' }
    ].forEach(function (c) {
      form.appendChild(UI.champ({
        libelle: c.libelle, taille: c.taille, type: c.type, lignes: c.lignes,
        placeholder: c.placeholder, valeur: brouillon[c.chemin],
        onchange: function (v) { set(c.chemin, v); }
      }));
    });

    form.appendChild(UI.champ({
      libelle: 'Notes internes', taille: 'c12', type: 'textarea', lignes: 2,
      valeur: brouillon.notes,
      aide: 'Jamais imprimées sur le devis.',
      onchange: function (v) { set('notes', v); }
    }));

    var champArchive = document.createElement('div');
    champArchive.className = 'champ c12';
    var bascule = document.createElement('label');
    bascule.className = 'bascule';
    var caseArchive = document.createElement('input');
    caseArchive.type = 'checkbox';
    caseArchive.checked = !!brouillon.archive;
    caseArchive.onchange = function () { set('archive', caseArchive.checked); };
    bascule.appendChild(caseArchive);
    bascule.appendChild(document.createTextNode(
      ' Archivé — masqué à la sélection, sans casser les devis existants'));
    champArchive.appendChild(bascule);
    form.appendChild(champArchive);

    function enregistrer(fermer) {
      if (!validerNom()) { champNom.input.focus(); return; }

      App.store.mutate(function (data) {
        // Ecriture par insertion ou remplacement : une fiche a enregistrer
        // ne doit jamais pouvoir se perdre parce que la recherche a echoue.
        var i = data.clients.findIndex(function (c) { return c.id === brouillon.id; });
        if (i === -1) data.clients.push(brouillon);
        else data.clients[i] = brouillon;
      });

      fermer();
      // hoteListe survit au changement de vue en pointant sur un noeud
      // detache : ne redessiner que si la liste est reellement affichee.
      if (hoteListe && hoteListe.isConnected) rendreListe();
      UI.notifier(creation ? 'Client ajouté.' : 'Fiche mise à jour.', 'succes', brouillon.nom);
      // Le rappel recoit la fiche ENREGISTREE. L'appelant ne doit pas garder
      // la reference qu'il avait passee : elle vient d'etre remplacee dans le
      // tableau, pas mutee.
      if (apres) apres(brouillon);
    }

    UI.modal({
      titre: creation ? 'Nouveau client' : 'Modifier la fiche',
      sous: creation
        ? ((client && (client.nom || '').trim())
            ? 'Prérempli avec les coordonnées saisies dans le devis.'
            : null)
        : 'Les devis déjà établis ne seront pas modifiés.',
      corps: form,
      largeur: '720px',
      actions: [
        { libelle: 'Annuler', onclick: function (f) { f(); } },
        {
          libelle: creation ? 'Ajouter' : 'Enregistrer',
          classe: 'btn-primaire', aDroite: true,
          onclick: enregistrer
        }
      ]
    });

    validerNom();
  }

  // --- Suppression ---------------------------------------------------------

  function supprimer(client) {
    var utilisateurs = devisUtilisant(client.id);

    if (utilisateurs.length) {
      var numeros = utilisateurs.map(function (d) { return d.numero || d.id; }).join(', ');
      UI.confirmer(
        'Client rattaché à un devis',
        'Ce client est rattaché à ' + utilisateurs.length + ' devis (' + numeros + ').\n\n' +
        'Les devis eux-mêmes ne bougeront pas — ils portent leur propre copie des ' +
        'coordonnées — mais la fiche disparaîtrait du répertoire.\n\n' +
        'L\'archiver la masque de la sélection tout en gardant le lien intact.',
        { confirmer: 'Archiver', annuler: 'Ne rien faire' }
      ).then(function (ok) {
        if (!ok) return;
        App.store.mutate(function (data) {
          var c = data.clients.filter(function (x) { return x.id === client.id; })[0];
          if (c) c.archive = true;
        });
        rendreListe();
        UI.notifier('Client archivé.', 'succes');
      });
      return;
    }

    UI.confirmer(
      'Supprimer ce client ?',
      client.nom + '\n\nAucun devis ne lui est rattaché. La suppression est définitive.',
      { confirmer: 'Supprimer', danger: true }
    ).then(function (ok) {
      if (!ok) return;
      App.store.mutate(function (data) {
        data.clients = data.clients.filter(function (x) { return x.id !== client.id; });
      });
      rendreListe();
      UI.notifier('Client supprimé.', 'succes');
    });
  }

  // --- Liste ---------------------------------------------------------------

  function ligneClient(c) {
    var data = App.store.get();
    var nbDevis = (data.devis || []).filter(function (d) { return d.clientId === c.id; }).length;

    var row = document.createElement('div');
    row.className = 'cli-ligne' + (c.archive ? ' archivee' : '');

    var pastille = document.createElement('div');
    pastille.className = 'cli-initiales';
    pastille.textContent = (c.nom || '?').trim().slice(0, 2).toUpperCase();
    row.appendChild(pastille);

    var corps = document.createElement('div');
    corps.className = 'cli-corps';

    var haut = document.createElement('div');
    haut.className = 'cli-haut';
    var nom = document.createElement('span');
    nom.className = 'cli-nom';
    nom.textContent = c.nom || '(sans nom)';
    haut.appendChild(nom);
    if (c.archive) {
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'archivé';
      haut.appendChild(badge);
    }
    corps.appendChild(haut);

    var detail = document.createElement('div');
    detail.className = 'cli-detail';
    detail.textContent = [
      c.contact,
      [c.codePostal, c.ville].filter(Boolean).join(' '),
      c.telephone,
      c.email
    ].filter(Boolean).join(' · ') || 'Coordonnées non renseignées';
    corps.appendChild(detail);
    row.appendChild(corps);

    var compte = document.createElement('div');
    compte.className = 'cli-compte';
    compte.innerHTML = nbDevis
      ? '<div class="cli-compte-v">' + nbDevis + '</div><div class="cli-compte-d">devis</div>'
      : '<div class="cli-compte-d">aucun devis</div>';
    row.appendChild(compte);

    var actions = document.createElement('div');
    actions.className = 'cli-actions';
    [
      { l: 'Modifier', c: 'btn', f: function () { ouvrirEditeur(c); } },
      { l: 'Nouveau devis', c: 'btn btn-discret', f: function () { App.ui.creerDevisPour(c); } },
      { l: 'Supprimer', c: 'btn btn-discret btn-danger', f: function () { supprimer(c); } }
    ].forEach(function (a) {
      var b = document.createElement('button');
      b.className = a.c;
      b.textContent = a.l;
      b.onclick = a.f;
      actions.appendChild(b);
    });
    row.appendChild(actions);

    row.ondblclick = function () { ouvrirEditeur(c); };
    return row;
  }

  function rendreListe() {
    if (!hoteListe) return;
    hoteListe.innerHTML = '';

    var data = App.store.get();
    var total = (data.clients || []).length;
    var archives = (data.clients || []).filter(function (c) { return c.archive; }).length;
    var liste = clientsFiltres();

    if (!total) {
      var vide = document.createElement('div');
      vide.className = 'vide';
      vide.innerHTML =
        '<div class="vide-titre">Répertoire vide</div>' +
        '<div>Enregistrer un client permet de le réutiliser d\'un devis à l\'autre ' +
        'sans ressaisir ses coordonnées.</div>';
      var b = document.createElement('button');
      b.className = 'btn btn-primaire';
      b.style.marginTop = '14px';
      b.textContent = 'Nouveau client';
      b.onclick = function () { ouvrirEditeur(null); };
      vide.appendChild(b);
      hoteListe.appendChild(vide);
      return;
    }

    if (!liste.length) {
      var rien = document.createElement('div');
      rien.className = 'vide';
      rien.innerHTML = '<div class="vide-titre">Aucun résultat</div>';
      hoteListe.appendChild(rien);
      return;
    }

    var conteneur = document.createElement('div');
    conteneur.className = 'cli-liste';
    liste.forEach(function (c) { conteneur.appendChild(ligneClient(c)); });
    hoteListe.appendChild(conteneur);

    var pied = document.createElement('div');
    pied.className = 'cat-pied';
    pied.textContent = liste.length + ' client(s) affiché(s) sur ' + total +
      (archives ? ' · ' + archives + ' archivé(s)' : '');
    hoteListe.appendChild(pied);
  }

  // --- Exposition pour la vue devis ---------------------------------------

  /**
   * Selecteur de client, ouvert depuis l'editeur de devis.
   * @param {function} onChoix recoit la fiche choisie
   */
  UI.choisirClient = function (onChoix) {
    var data = App.store.get();
    var disponibles = (data.clients || []).filter(function (c) { return !c.archive; });

    var corps = document.createElement('div');

    var champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'recherche';
    champ.placeholder = 'Filtrer…';
    champ.style.marginBottom = '12px';
    corps.appendChild(champ);

    var liste = document.createElement('div');
    liste.className = 'sel-liste';
    corps.appendChild(liste);

    var fermerModale = null;

    function rendre() {
      var q = champ.value.trim().toLowerCase();
      liste.innerHTML = '';

      var resultats = disponibles.filter(function (c) {
        if (!q) return true;
        return [c.nom, c.ville, c.contact].some(function (v) {
          return (v || '').toLowerCase().indexOf(q) !== -1;
        });
      });

      if (!resultats.length) {
        var rien = document.createElement('div');
        rien.className = 'aide';
        rien.style.padding = '14px 4px';
        rien.textContent = disponibles.length
          ? 'Aucun client ne correspond.'
          : 'Le répertoire est vide.';
        liste.appendChild(rien);
        return;
      }

      resultats.forEach(function (c) {
        var item = document.createElement('button');
        item.className = 'sel-item';
        item.type = 'button';

        var pastille = document.createElement('div');
        pastille.className = 'cli-initiales petite';
        pastille.textContent = (c.nom || '?').trim().slice(0, 2).toUpperCase();
        item.appendChild(pastille);

        var txt = document.createElement('div');
        txt.className = 'sel-txt';
        txt.innerHTML =
          '<div class="sel-titre">' + (c.nom || '') + '</div>' +
          '<div class="sel-ref">' +
          ([c.contact, [c.codePostal, c.ville].filter(Boolean).join(' ')]
            .filter(Boolean).join(' · ') || 'coordonnées non renseignées') + '</div>';
        item.appendChild(txt);

        item.onclick = function () {
          onChoix(c);
          if (fermerModale) fermerModale();
        };
        liste.appendChild(item);
      });
    }

    champ.oninput = rendre;
    rendre();

    var modale = UI.modal({
      titre: 'Choisir un client',
      sous: 'Le devis copiera les coordonnées actuelles. Les modifier ensuite dans le ' +
            'devis ne touchera pas au répertoire.',
      corps: corps,
      largeur: '600px',
      actions: [
        { libelle: 'Annuler', onclick: function (f) { f(); } },
        {
          libelle: 'Nouveau client…', classe: 'btn-primaire', aDroite: true,
          onclick: function (f) {
            f();
            ouvrirEditeur(null, function (fiche) { onChoix(fiche); });
          }
        }
      ]
    });
    fermerModale = modale.fermer;
  };

  /** Ouvre l'editeur d'une fiche depuis une autre vue. */
  UI.editerClient = ouvrirEditeur;

  // --- Vue -----------------------------------------------------------------

  UI.vues.clients = {
    libelle: 'Clients',
    icone: 'clients',
    titre: 'Répertoire des clients',
    sous: 'Fiches réutilisables. Un devis copie les coordonnées à l\'insertion : ' +
          'modifier une fiche ne change aucun devis déjà établi.',

    monter: function (hote) {
      var barre = document.createElement('div');
      barre.className = 'barre-outils';

      var recherche = document.createElement('input');
      recherche.type = 'text';
      recherche.className = 'recherche';
      recherche.placeholder = 'Rechercher un nom, une ville, un contact…';
      recherche.value = vueEtat.recherche;
      recherche.oninput = function () {
        vueEtat.recherche = recherche.value;
        rendreListe();
      };
      barre.appendChild(recherche);

      var basculeArchives = document.createElement('label');
      basculeArchives.className = 'bascule';
      var caseArch = document.createElement('input');
      caseArch.type = 'checkbox';
      caseArch.checked = vueEtat.montrerArchives;
      caseArch.onchange = function () {
        vueEtat.montrerArchives = caseArch.checked;
        rendreListe();
      };
      basculeArchives.appendChild(caseArch);
      basculeArchives.appendChild(document.createTextNode(' Archivés'));
      barre.appendChild(basculeArchives);

      var espace = document.createElement('span');
      espace.style.flex = '1 1 auto';
      barre.appendChild(espace);

      var nouveau = document.createElement('button');
      nouveau.className = 'btn btn-primaire';
      nouveau.textContent = 'Nouveau client';
      nouveau.onclick = function () { ouvrirEditeur(null); };
      barre.appendChild(nouveau);

      hote.appendChild(barre);

      hoteListe = document.createElement('div');
      hote.appendChild(hoteListe);
      rendreListe();
    }
  };

})(window.App);
