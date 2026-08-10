/**
 * 60-ui-devis.js — liste et edition des devis, avec panneau d'apercu.
 *
 * DEUX MODES dans une seule vue : la liste des devis, et l'editeur d'un devis.
 * `etat.devisId` decide lequel est monte.
 *
 * REGLE DE RAFRAICHISSEMENT, c'est le point delicat de tout le fichier :
 * l'editeur n'est construit QU'UNE FOIS. Une frappe dans un champ ne
 * reconstruit jamais le DOM, sinon le champ perdrait le focus a chaque
 * caractere. Elle met a jour, par ecriture directe de textContent :
 *   - la cellule de total de la ligne concernee ;
 *   - le bloc de synthese (sous-total, TVA, TTC, acompte).
 * Seul un changement STRUCTUREL — ajout, suppression, reordonnancement —
 * reconstruit le corps du tableau des lignes.
 *
 * L'apercu, lui, appelle exactement le meme moteur de rendu que l'impression
 * (70-preview.js), avec un debounce : c'est ce qui garantit qu'il ne peut pas
 * diverger du PDF.
 */
(function (App) {
  'use strict';

  var UI = App.ui;

  var DEBOUNCE_APERCU_MS = 400;
  var A4_PX = 794;   // 210 mm a 96 dpi

  var etat = {
    devisId: null,
    recherche: '',
    apercuVisible: true
  };

  var refs = {};          // elements de l'editeur reutilises entre deux rendus
  var refsLignes = {};    // idLigne -> { total: HTMLElement }
  var timerApercu = null;

  // --- Acces au devis courant ---------------------------------------------

  function devisCourant() {
    var data = App.store.get();
    return (data.devis || []).filter(function (d) { return d.id === etat.devisId; })[0] || null;
  }

  /**
   * Mutation ciblee du devis courant, suivie du rafraichissement minimal.
   * @param {function} fn        recoit le devis
   * @param {object} [options]   .structurel true si le tableau doit etre reconstruit
   */
  function majDevis(fn, options) {
    var o = options || {};
    App.store.mutate(function (data) {
      var d = (data.devis || []).filter(function (x) { return x.id === etat.devisId; })[0];
      if (d) fn(d, data);
    });
    if (o.structurel) rendreLignes();
    rafraichirTotaux();
    rafraichirRepertoire();
    planifierApercu();
  }

  function totalTTC(devis) {
    return App.calc.computeDevis(devis).totalTTCCents;
  }

  // ========================================================================
  // LISTE DES DEVIS
  // ========================================================================

  /**
   * @param {object} [client] fiche du repertoire a rattacher d'emblee
   */
  function creerDevis(client) {
    var data = App.store.get();
    var nouveau = App.schema.nouveauDevis(data.settings);

    if (client && client.id) {
      nouveau.clientId = client.id;
      nouveau.client = App.schema.clientDepuisRepertoire(client);
    }

    App.store.mutate(function (d) {
      d.devis.push(nouveau);
      // Le compteur avance a la creation : deux devis ne doivent jamais
      // porter le meme numero, meme si le premier est abandonne.
      d.settings.numerotation.prochainSeq = (d.settings.numerotation.prochainSeq || 1) + 1;
    });

    etat.devisId = nouveau.id;
    UI.ouvrirVue('devis');
    UI.notifier('Devis ' + nouveau.numero + ' créé.', 'succes',
      client && client.nom ? 'Client : ' + client.nom : null);
  }

  /** Appele depuis le repertoire : « Nouveau devis » sur une fiche client. */
  UI.creerDevisPour = creerDevis;

  /**
   * Ouvre un devis dans l'editeur. Appele depuis le tableau de bord.
   * `etat.devisId` reste prive : une vue exterieure ne doit pas pouvoir mettre
   * l'editeur dans un etat que lui seul sait construire.
   */
  UI.ouvrirDevis = function (id) {
    etat.devisId = id;
    UI.ouvrirVue('devis');
  };

  function dupliquerDevis(source) {
    var data = App.store.get();
    var copie = JSON.parse(JSON.stringify(source));
    copie.id = App.uid();
    copie.numero = App.schema.formaterNumero(data.settings.numerotation);
    copie.dateEmission = App.format.toIso(new Date());
    copie.statut = 'brouillon';
    copie.lignes = (copie.lignes || []).map(function (l) {
      return Object.assign({}, l, { id: App.uid() });
    });

    App.store.mutate(function (d) {
      d.devis.push(copie);
      d.settings.numerotation.prochainSeq = (d.settings.numerotation.prochainSeq || 1) + 1;
    });

    etat.devisId = copie.id;
    UI.ouvrirVue('devis');
    UI.notifier('Devis dupliqué sous le numéro ' + copie.numero + '.', 'succes');
  }

  function supprimerDevis(devis) {
    UI.confirmer(
      'Supprimer ce devis ?',
      'Devis ' + devis.numero + (devis.client && devis.client.nom ? ' — ' + devis.client.nom : '') +
      '\n\nLa suppression est définitive dans ce document. ' +
      'Les fichiers .devis déjà enregistrés sur le disque ne sont pas touchés.',
      { confirmer: 'Supprimer', danger: true }
    ).then(function (ok) {
      if (!ok) return;
      App.store.mutate(function (data) {
        data.devis = data.devis.filter(function (x) { return x.id !== devis.id; });
      });
      App.store.purgerImages();
      UI.ouvrirVue('devis');
      UI.notifier('Devis supprimé.', 'succes');
    });
  }

  function rendreListe(hote) {
    var data = App.store.get();

    var barre = document.createElement('div');
    barre.className = 'barre-outils';

    var recherche = document.createElement('input');
    recherche.type = 'text';
    recherche.className = 'recherche';
    recherche.placeholder = 'Rechercher un numéro, un client…';
    recherche.value = etat.recherche;
    recherche.oninput = function () {
      etat.recherche = recherche.value;
      UI.ouvrirVue('devis');
    };
    barre.appendChild(recherche);

    var espace = document.createElement('span');
    espace.style.flex = '1 1 auto';
    barre.appendChild(espace);

    var btnNouveau = document.createElement('button');
    btnNouveau.className = 'btn btn-primaire';
    btnNouveau.textContent = 'Nouveau devis';
    btnNouveau.onclick = function () { creerDevis(); };
    barre.appendChild(btnNouveau);

    hote.appendChild(barre);

    var q = etat.recherche.trim().toLowerCase();
    var liste = (data.devis || []).filter(function (d) {
      if (!q) return true;
      return [d.numero, d.client && d.client.nom, d.client && d.client.ville]
        .some(function (v) { return (v || '').toLowerCase().indexOf(q) !== -1; });
    }).sort(function (a, b) {
      return (b.dateEmission || '').localeCompare(a.dateEmission || '');
    });

    if (!(data.devis || []).length) {
      var vide = document.createElement('div');
      vide.className = 'vide';
      vide.innerHTML =
        '<div class="vide-titre">Aucun devis</div>' +
        '<div>Créer un devis, puis y insérer des machines depuis le catalogue.</div>';
      var b = document.createElement('button');
      b.className = 'btn btn-primaire';
      b.style.marginTop = '14px';
      b.textContent = 'Nouveau devis';
      b.onclick = function () { creerDevis(); };
      vide.appendChild(b);
      hote.appendChild(vide);
      return;
    }

    if (!liste.length) {
      var rien = document.createElement('div');
      rien.className = 'vide';
      rien.innerHTML = '<div class="vide-titre">Aucun résultat</div>';
      hote.appendChild(rien);
      return;
    }

    var conteneur = document.createElement('div');
    conteneur.className = 'dev-liste';

    liste.forEach(function (d) {
      var row = document.createElement('div');
      row.className = 'dev-ligne';

      var num = document.createElement('div');
      num.className = 'dev-num';
      num.innerHTML =
        '<div class="dev-num-v">' + (d.numero || '—') + '</div>' +
        '<div class="dev-num-d">' + App.format.dateCourte(d.dateEmission) + '</div>';
      row.appendChild(num);

      var client = document.createElement('div');
      client.className = 'dev-client';
      client.innerHTML =
        '<div class="dev-client-n">' + ((d.client && d.client.nom) || '(client non renseigné)') + '</div>' +
        '<div class="dev-client-d">' + (d.lignes || []).length + ' ligne(s)' +
        ((d.client && d.client.ville) ? ' · ' + d.client.ville : '') + '</div>';
      row.appendChild(client);

      var statut = document.createElement('div');
      statut.className = 'dev-statut';
      var pastille = document.createElement('span');
      pastille.className = 'statut statut-' + d.statut;
      pastille.textContent = App.schema.LIBELLES_STATUT[d.statut] || d.statut;
      statut.appendChild(pastille);
      row.appendChild(statut);

      var montant = document.createElement('div');
      montant.className = 'dev-montant';
      montant.innerHTML =
        '<div class="dev-montant-v">' + App.format.euros(totalTTC(d)) + '</div>' +
        '<div class="dev-montant-d">TTC</div>';
      row.appendChild(montant);

      var actions = document.createElement('div');
      actions.className = 'dev-actions';
      [
        { l: 'Ouvrir', c: 'btn', f: function () { etat.devisId = d.id; UI.ouvrirVue('devis'); } },
        { l: 'Dupliquer', c: 'btn btn-discret', f: function () { dupliquerDevis(d); } },
        { l: 'Supprimer', c: 'btn btn-discret btn-danger', f: function () { supprimerDevis(d); } }
      ].forEach(function (a) {
        var b2 = document.createElement('button');
        b2.className = a.c;
        b2.textContent = a.l;
        b2.onclick = a.f;
        actions.appendChild(b2);
      });
      row.appendChild(actions);

      row.ondblclick = function () { etat.devisId = d.id; UI.ouvrirVue('devis'); };
      conteneur.appendChild(row);
    });

    hote.appendChild(conteneur);
  }

  // ========================================================================
  // SELECTEUR DE MACHINES
  // ========================================================================

  function ouvrirSelecteurMachines() {
    var data = App.store.get();
    var disponibles = (data.catalogue || []).filter(function (p) { return !p.archive; });

    if (!disponibles.length) {
      UI.notifier('Aucune machine disponible.', 'alerte',
        'Le catalogue est vide ou toutes les fiches sont archivées.');
      return;
    }

    var ajoutees = 0;
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

    var compteur = document.createElement('div');
    compteur.className = 'aide';
    compteur.style.marginTop = '10px';
    corps.appendChild(compteur);

    function ajouter(produit) {
      majDevis(function (d) {
        d.lignes.push(App.schema.ligneDepuisProduit(produit, 1));
      }, { structurel: true });
      ajoutees++;
      compteur.textContent = ajoutees + ' ligne(s) ajoutée(s) au devis.';
    }

    function rendre() {
      var q = champ.value.trim().toLowerCase();
      liste.innerHTML = '';

      disponibles.filter(function (p) {
        if (!q) return true;
        return [p.reference, p.titre].some(function (v) {
          return (v || '').toLowerCase().indexOf(q) !== -1;
        });
      }).forEach(function (p) {
        var item = document.createElement('button');
        item.className = 'sel-item';
        item.type = 'button';

        var vignette = document.createElement('div');
        vignette.className = 'sel-vignette';
        if (p.imageFile) {
          App.store.urlImage(p.imageFile).then(function (url) {
            if (!url) return;
            var img = document.createElement('img');
            img.src = url;
            vignette.innerHTML = '';
            vignette.appendChild(img);
          });
        }
        item.appendChild(vignette);

        var txt = document.createElement('div');
        txt.className = 'sel-txt';
        txt.innerHTML =
          '<div class="sel-ref">' + (p.reference || '') + '</div>' +
          '<div class="sel-titre">' + (p.titre || '') + '</div>';
        item.appendChild(txt);

        var prix = document.createElement('div');
        prix.className = 'sel-prix';
        prix.textContent = App.format.euros(p.prixHTCents);
        item.appendChild(prix);

        item.onclick = function () { ajouter(p); };
        liste.appendChild(item);
      });
    }

    champ.oninput = rendre;
    rendre();

    UI.modal({
      titre: 'Ajouter une machine',
      sous: 'La ligne copie le libellé, le prix et le taux de TVA actuels. ' +
            'Le catalogue pourra changer ensuite sans toucher à ce devis.',
      corps: corps,
      largeur: '640px',
      actions: [
        { libelle: 'Terminé', classe: 'btn-primaire', aDroite: true, onclick: function (f) { f(); } }
      ]
    });
  }

  // ========================================================================
  // EDITEUR — blocs
  // ========================================================================

  function champDevis(opts) {
    var d = devisCourant();
    var valeur = opts.chemin.split('.').reduce(function (o, k) {
      return o == null ? null : o[k];
    }, d);

    return UI.champ({
      libelle: opts.libelle,
      type: opts.type,
      taille: opts.taille,
      lignes: opts.lignes,
      options: opts.options,
      placeholder: opts.placeholder,
      aide: opts.aide,
      pas: opts.pas,
      min: opts.min,
      valeur: valeur,
      onchange: function (v) {
        majDevis(function (devis) {
          var parts = opts.chemin.split('.');
          var cible = devis;
          for (var i = 0; i < parts.length - 1; i++) cible = cible[parts[i]];
          cible[parts[parts.length - 1]] = opts.nombre ? (parseFloat(v) || 0) : v;
        });
      }
    });
  }

  function blocEntete() {
    var c = UI.carte('Devis');
    [
      // Le numero ne s'imprime plus sur le document — c'est une fiche
      // informative, pas une piece comptable. Il sert encore a nommer les
      // fichiers .devis et a s'y retrouver dans la liste, d'ou le champ.
      champDevis({
        chemin: 'numero', libelle: 'Numéro', taille: 'c4',
        aide: 'Repère interne. N\'apparaît pas sur le document imprimé.'
      }),
      champDevis({ chemin: 'dateEmission', libelle: 'Date d\'émission', taille: 'c4', type: 'date' }),
      // Plus de champ de validite : le document ne porte plus de date de fin
      // d'offre. Le champ existe encore dans les fichiers anciens, il n'est
      // simplement plus ni affiche ni modifiable.
      champDevis({
        chemin: 'statut', libelle: 'Statut', taille: 'c4', type: 'select',
        options: App.schema.STATUTS.map(function (s) {
          return { valeur: s, libelle: App.schema.LIBELLES_STATUT[s] };
        })
      })
    ].forEach(function (x) { c.grille.appendChild(x); });
    return c;
  }

  /**
   * Fiche du repertoire liee au devis courant, relue A CHAQUE APPEL.
   *
   * Ne jamais memoriser l'objet : l'editeur de fiche REMPLACE l'entree du
   * tableau plutot que de la muter, donc toute reference conservee devient
   * silencieusement perimee des le premier enregistrement.
   */
  function ficheLiee() {
    var d = devisCourant();
    if (!d || !d.clientId) return null;
    var data = App.store.get();
    return (data.clients || []).filter(function (c) { return c.id === d.clientId; })[0] || null;
  }

  /**
   * Barre d'actions liant le devis au repertoire.
   *
   * Le bloc client du devis reste un SNAPSHOT : rien ici ne recalcule quoi que
   * ce soit automatiquement. Le rattachement ne sert qu'a proposer une
   * resynchronisation explicite, et a repartir du repertoire pour un nouveau
   * devis.
   *
   * La barre se REDESSINE a chaque mutation du devis : c'est ce qui fait
   * apparaitre « modifiee dans ce devis » pendant la frappe, et non a la
   * reouverture. Elle ne contient aucun champ de saisie, la reconstruire ne
   * fait donc perdre aucun focus.
   */
  function rafraichirRepertoire() {
    var barre = refs.repertoire;
    if (!barre) return;

    var d = devisCourant();
    if (!d) return;

    var fiche = ficheLiee();
    barre.innerHTML = '';

    function bouton(libelle, classe, action) {
      var b = document.createElement('button');
      b.className = 'btn ' + (classe || '');
      b.textContent = libelle;
      b.onclick = action;
      barre.appendChild(b);
      return b;
    }

    bouton(fiche ? 'Changer de client' : 'Choisir dans le répertoire', '', function () {
      UI.choisirClient(function (choisi) {
        majDevis(function (devis) {
          devis.clientId = choisi.id;
          devis.client = App.schema.clientDepuisRepertoire(choisi);
        });
        // Les champs du bloc client doivent afficher les nouvelles valeurs :
        // seul un remontage de la vue les reecrit.
        UI.ouvrirVue('devis');
        UI.notifier('Client rattaché.', 'succes', choisi.nom);
      });
    });

    if (fiche) {
      var etiquette = document.createElement('span');
      etiquette.className = 'repertoire-etat';
      etiquette.textContent = 'Fiche : ' + fiche.nom;
      barre.appendChild(etiquette);

      if (App.schema.clientDiverge(d.client, fiche)) {
        etiquette.textContent += ' — modifiée dans ce devis';
        etiquette.classList.add('diverge');

        bouton('Reprendre la fiche', 'btn-discret', function () {
          var f = ficheLiee();
          if (!f) return;
          UI.confirmer(
            'Reprendre les coordonnées du répertoire ?',
            'Les coordonnées saisies dans ce devis seront remplacées par celles de la ' +
            'fiche « ' + f.nom + ' ».\n\nCette action est explicite et ne se produit ' +
            'jamais toute seule : un devis émis ne doit pas bouger dans le dos du client.',
            { confirmer: 'Remplacer' }
          ).then(function (ok) {
            if (!ok) return;
            majDevis(function (devis) {
              devis.client = App.schema.clientDepuisRepertoire(f);
            });
            UI.ouvrirVue('devis');
          });
        });

        bouton('Mettre à jour la fiche', 'btn-discret', function () {
          var f = ficheLiee();
          if (!f) return;
          UI.confirmer(
            'Reporter ces coordonnées dans le répertoire ?',
            'La fiche « ' + f.nom + ' » prendra les coordonnées saisies dans ce devis.\n\n' +
            'Les autres devis déjà établis ne seront pas modifiés.',
            { confirmer: 'Mettre à jour' }
          ).then(function (ok) {
            if (!ok) return;
            App.store.mutate(function (dd) {
              var cible = dd.clients.filter(function (c) { return c.id === f.id; })[0];
              if (cible) Object.assign(cible, App.schema.clientDepuisRepertoire(d.client));
            });
            // Le devis n'a pas bouge : redessiner la barre suffit.
            rafraichirRepertoire();
            UI.notifier('Fiche du répertoire mise à jour.', 'succes');
          });
        });
      }

      bouton('Ouvrir la fiche', 'btn-discret', function () {
        var f = ficheLiee();
        if (!f) return;

        UI.editerClient(f, function () {
          // La barre relit la fiche et signale la divergence que l'edition
          // vient de creer.
          rafraichirRepertoire();

          var apresEdition = ficheLiee();
          var courant = devisCourant();
          if (!apresEdition || !App.schema.clientDiverge(courant.client, apresEdition)) return;

          // On ouvre la fiche DEPUIS le devis : reporter la correction est
          // presque toujours l'intention. On le propose, sans jamais le faire
          // dans le dos de l'utilisateur.
          UI.confirmer(
            'Reporter la correction dans ce devis ?',
            'La fiche « ' + apresEdition.nom + ' » a été modifiée. Ce devis porte ' +
            'toujours les coordonnées telles qu\'elles étaient au moment de son ' +
            'établissement.\n\nLes autres devis ne seront pas touchés, quelle que soit ' +
            'votre réponse.',
            { confirmer: 'Reporter', annuler: 'Laisser le devis inchangé' }
          ).then(function (ok) {
            if (!ok) return;
            majDevis(function (devis) {
              devis.client = App.schema.clientDepuisRepertoire(apresEdition);
            });
            UI.ouvrirVue('devis');
          });
        });
      });

    } else if (d.clientId) {
      // Lien rompu : information, pas alerte. Le devis garde son snapshot.
      var orphelin = document.createElement('span');
      orphelin.className = 'badge badge-orphelin';
      orphelin.textContent = 'hors répertoire';
      orphelin.title = 'La fiche d\'origine a été supprimée. ' +
                       'Ce devis conserve les coordonnées telles qu\'elles étaient.';
      barre.appendChild(orphelin);

    } else if ((d.client && d.client.nom || '').trim()) {
      bouton('Enregistrer ce client', 'btn-discret', function () {
        var courant = devisCourant();
        UI.editerClient(
          App.schema.nouveauClient(App.schema.clientDepuisRepertoire(courant.client)),
          function (creee) {
            majDevis(function (devis) { devis.clientId = creee.id; });
            UI.notifier('Client ajouté au répertoire.', 'succes', creee.nom);
          }
        );
      });
    }
  }

  function blocClient() {
    var c = UI.carte('Client');

    refs.repertoire = document.createElement('div');
    refs.repertoire.className = 'repertoire-barre';
    c.querySelector('.carte-tete').appendChild(refs.repertoire);
    rafraichirRepertoire();

    [
      champDevis({ chemin: 'client.nom', libelle: 'Raison sociale', taille: 'c6' }),
      champDevis({ chemin: 'client.contact', libelle: 'À l\'attention de', taille: 'c6' }),
      champDevis({ chemin: 'client.adresse', libelle: 'Adresse', taille: 'c12', type: 'textarea', lignes: 2 }),
      champDevis({ chemin: 'client.codePostal', libelle: 'Code postal', taille: 'c3' }),
      champDevis({ chemin: 'client.ville', libelle: 'Ville', taille: 'c4' }),
      champDevis({ chemin: 'client.telephone', libelle: 'Téléphone', taille: 'c5', type: 'tel' }),
      champDevis({ chemin: 'client.email', libelle: 'Courriel', taille: 'c6', type: 'email' })
    ].forEach(function (x) { c.grille.appendChild(x); });
    return c;
  }

  // --- Lignes --------------------------------------------------------------

  function petitChamp(valeur, opts) {
    var i = document.createElement('input');
    i.type = opts.type || 'text';
    i.className = 'lig-champ ' + (opts.classe || '');
    if (opts.pas) i.step = opts.pas;
    if (opts.min != null) i.min = opts.min;
    i.value = valeur == null ? '' : valeur;
    i.oninput = opts.oninput;
    if (opts.titre) i.title = opts.titre;
    return i;
  }

  function ligneRow(ligne, index, total) {
    var data = App.store.get();
    var row = document.createElement('div');
    row.className = 'lig';

    // --- Ordre ---
    var ordre = document.createElement('div');
    ordre.className = 'lig-ordre';

    var monter = document.createElement('button');
    monter.className = 'btn btn-discret lig-fleche';
    monter.innerHTML = '&uarr;';
    monter.title = 'Monter';
    monter.disabled = index === 0;
    monter.onclick = function () { deplacerLigne(index, -1); };

    var descendre = document.createElement('button');
    descendre.className = 'btn btn-discret lig-fleche';
    descendre.innerHTML = '&darr;';
    descendre.title = 'Descendre';
    descendre.disabled = index === total - 1;
    descendre.onclick = function () { deplacerLigne(index, 1); };

    var rang = document.createElement('span');
    rang.className = 'lig-rang';
    rang.textContent = index + 1;

    ordre.appendChild(monter);
    ordre.appendChild(rang);
    ordre.appendChild(descendre);
    row.appendChild(ordre);

    // --- Vignette ---
    var vignette = document.createElement('div');
    vignette.className = 'lig-vignette' + (ligne.imageFile ? '' : ' vide');

    if (ligne.imageFile) {
      App.store.urlImage(ligne.imageFile).then(function (url) {
        if (!url) return;
        var img = document.createElement('img');
        img.src = url;
        vignette.appendChild(img);
      });
    } else {
      var mention = document.createElement('span');
      mention.className = 'lig-vignette-vide';
      mention.textContent = 'sans photo';
      vignette.appendChild(mention);
    }

    /*
     * La bascule est la MEME QUE LA LIGNE PORTE UNE PHOTO OU NON.
     *
     * Depuis qu'une ligne sans photo imprime un cadre de substitution, la
     * masquer sur ces lignes-la retirait le seul moyen de refuser ce cadre :
     * une ligne « Livraison » se retrouvait avec un encadre « photo non
     * disponible » que rien ne permettait d'enlever.
     */
    var bascule = document.createElement('label');
    bascule.className = 'lig-img-bascule';
    bascule.title = ligne.imageFile
      ? 'Afficher cette photo sur le document'
      : 'Aucune photo sur cette ligne : cocher réserve tout de même son ' +
        'emplacement sur le document, décocher n\'imprime rien.';
    var caseImg = document.createElement('input');
    caseImg.type = 'checkbox';
    caseImg.checked = ligne.afficherImage !== false;
    caseImg.onchange = function () {
      majDevis(function (d) {
        var l = d.lignes.filter(function (x) { return x.id === ligne.id; })[0];
        if (l) l.afficherImage = caseImg.checked;
      });
    };
    bascule.appendChild(caseImg);
    vignette.appendChild(bascule);

    row.appendChild(vignette);

    // --- Designation ---
    var des = document.createElement('div');
    des.className = 'lig-des';

    var hautDes = document.createElement('div');
    hautDes.className = 'lig-des-haut';

    var ref = petitChamp(ligne.reference, {
      classe: 'lig-ref-champ',
      titre: 'Référence',
      oninput: function () {
        majDevis(function (d) {
          var l = d.lignes.filter(function (x) { return x.id === ligne.id; })[0];
          if (l) l.reference = ref.value;
        });
      }
    });
    ref.placeholder = 'réf.';
    hautDes.appendChild(ref);

    // Signale un lien rompu vers le catalogue, sans rien recalculer :
    // la ligne garde son snapshot, c'est une information, pas une alerte.
    if (ligne.produitId) {
      var existe = (data.catalogue || []).some(function (p) { return p.id === ligne.produitId; });
      if (!existe) {
        var orphelin = document.createElement('span');
        orphelin.className = 'badge badge-orphelin';
        orphelin.textContent = 'hors catalogue';
        orphelin.title = 'La fiche d\'origine a été supprimée du catalogue. ' +
                         'Cette ligne conserve son libellé et son prix.';
        hautDes.appendChild(orphelin);
      }
    }
    des.appendChild(hautDes);

    var titre = petitChamp(ligne.titre, {
      classe: 'lig-titre-champ',
      titre: 'Désignation',
      oninput: function () {
        majDevis(function (d) {
          var l = d.lignes.filter(function (x) { return x.id === ligne.id; })[0];
          if (l) l.titre = titre.value;
        });
      }
    });
    titre.placeholder = 'Désignation';
    des.appendChild(titre);

    // La description ne s'imprime plus dans le tableau : elle alimente la
    // fiche produit annexee. Meme editeur qu'au catalogue, sinon ouvrir une
    // ligne pour la corriger en aplatirait la mise en forme.
    var desc = UI.champRiche({
      compact: true,
      valeur: ligne.description,
      placeholder: 'Description (reprise sur la fiche annexée)',
      onchange: function (v) {
        majDevis(function (d) {
          var l = d.lignes.filter(function (x) { return x.id === ligne.id; })[0];
          if (l) l.description = v;
        });
      }
    });
    desc.classList.add('lig-desc-champ');
    des.appendChild(desc);
    row.appendChild(des);

    // --- Chiffres ---
    function majNombre(champ, valeur) {
      majDevis(function (d) {
        var l = d.lignes.filter(function (x) { return x.id === ligne.id; })[0];
        if (l) l[champ] = valeur;
      });
    }

    var qte = document.createElement('div');
    qte.className = 'lig-col';
    var champQte = petitChamp(ligne.quantite, {
      type: 'number', pas: '0.01', min: 0, classe: 'aligne-droite',
      oninput: function () { majNombre('quantite', parseFloat(champQte.value) || 0); }
    });
    qte.appendChild(champQte);
    var champUnite = petitChamp(ligne.unite, {
      classe: 'lig-unite-champ',
      titre: 'Unité',
      oninput: function () {
        majDevis(function (d) {
          var l = d.lignes.filter(function (x) { return x.id === ligne.id; })[0];
          if (l) l.unite = champUnite.value;
        });
      }
    });
    qte.appendChild(champUnite);
    row.appendChild(qte);

    var pu = document.createElement('div');
    pu.className = 'lig-col';
    var champPu = petitChamp(App.calc.centsToEuros(ligne.prixHTCents), {
      type: 'number', pas: '0.01', min: 0, classe: 'aligne-droite',
      titre: 'Prix unitaire HT — copie figée, modifiable pour ce devis seulement',
      oninput: function () { majNombre('prixHTCents', App.calc.eurosToCents(champPu.value)); }
    });
    pu.appendChild(champPu);
    row.appendChild(pu);

    var rem = document.createElement('div');
    rem.className = 'lig-col';
    var champRem = petitChamp(ligne.remisePct, {
      type: 'number', pas: '0.5', min: 0, classe: 'aligne-droite',
      oninput: function () { majNombre('remisePct', parseFloat(champRem.value) || 0); }
    });
    rem.appendChild(champRem);
    row.appendChild(rem);

    var tva = document.createElement('div');
    tva.className = 'lig-col';
    var champTva = document.createElement('select');
    champTva.className = 'lig-champ';
    App.schema.TAUX_TVA.forEach(function (t) {
      var o = document.createElement('option');
      o.value = String(t);
      o.textContent = App.format.pourcent(t);
      champTva.appendChild(o);
    });
    champTva.value = String(ligne.tauxTVA);
    champTva.onchange = function () { majNombre('tauxTVA', parseFloat(champTva.value)); };
    tva.appendChild(champTva);
    row.appendChild(tva);

    // --- Total de ligne, seule cellule reecrite a chaque frappe ---
    var cellTotal = document.createElement('div');
    cellTotal.className = 'lig-total';
    cellTotal.textContent = App.format.euros(App.calc.ligneTotalHTCents(ligne));
    row.appendChild(cellTotal);
    refsLignes[ligne.id] = { total: cellTotal };

    // --- Suppression ---
    var sup = document.createElement('button');
    sup.className = 'btn btn-discret btn-danger lig-sup';
    sup.innerHTML = '&times;';
    sup.title = 'Retirer cette ligne';
    sup.onclick = function () {
      majDevis(function (d) {
        d.lignes = d.lignes.filter(function (x) { return x.id !== ligne.id; });
      }, { structurel: true });
    };
    row.appendChild(sup);

    return row;
  }

  function deplacerLigne(index, sens) {
    majDevis(function (d) {
      var cible = index + sens;
      if (cible < 0 || cible >= d.lignes.length) return;
      var tmp = d.lignes[index];
      d.lignes[index] = d.lignes[cible];
      d.lignes[cible] = tmp;
    }, { structurel: true });
  }

  function rendreLignes() {
    if (!refs.corpsLignes) return;
    refs.corpsLignes.innerHTML = '';
    refsLignes = {};
    rendreColonnes();

    var d = devisCourant();
    if (!d) return;

    if (!d.lignes.length) {
      var vide = document.createElement('div');
      vide.className = 'lig-vide';
      vide.textContent = 'Aucune ligne. Ajouter une machine du catalogue, ou une ligne libre.';
      refs.corpsLignes.appendChild(vide);
      return;
    }

    d.lignes.forEach(function (l, i) {
      refs.corpsLignes.appendChild(ligneRow(l, i, d.lignes.length));
    });
  }

  /**
   * Choix des caracteristiques promues en colonnes du document.
   *
   * Les noms proposes sont ceux que portent REELLEMENT les lignes du devis,
   * pas ceux du catalogue : une ligne est un snapshot, et le catalogue a pu
   * bouger depuis. Ajouter ou retirer une ligne change donc cette liste, d'ou
   * le redessin depuis rendreLignes().
   */
  function rendreColonnes() {
    if (!refs.colonnes) return;
    refs.colonnes.innerHTML = '';

    var d = devisCourant();
    if (!d) return;

    var noms = App.schema.nomsAttributsDevis(d);
    if (!noms.length) {
      var vide = document.createElement('span');
      vide.className = 'cols-vide';
      vide.textContent = 'Aucune caractéristique sur ces lignes. ' +
        'En ajouter aux fiches du catalogue, puis réinsérer la machine.';
      refs.colonnes.appendChild(vide);
      return;
    }

    var libelle = document.createElement('span');
    libelle.className = 'cols-vide';
    libelle.textContent = 'Colonnes :';
    refs.colonnes.appendChild(libelle);

    noms.forEach(function (nom) {
      var bascule = document.createElement('label');
      bascule.className = 'bascule';
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = (d.colonnesAttributs || []).indexOf(nom) !== -1;
      c.onchange = function () {
        majDevis(function (devis) {
          var liste = devis.colonnesAttributs || [];
          var i = liste.indexOf(nom);
          if (c.checked && i === -1) liste.push(nom);
          if (!c.checked && i !== -1) liste.splice(i, 1);
          devis.colonnesAttributs = liste;
        });
      };
      bascule.appendChild(c);
      bascule.appendChild(document.createTextNode(' ' + nom));
      refs.colonnes.appendChild(bascule);
    });
  }

  function blocLignes() {
    var c = UI.carte('Lignes du devis');

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-left:auto';

    var btnMachine = document.createElement('button');
    btnMachine.className = 'btn btn-primaire';
    btnMachine.textContent = 'Ajouter une machine';
    btnMachine.onclick = ouvrirSelecteurMachines;
    actions.appendChild(btnMachine);

    var btnLibre = document.createElement('button');
    btnLibre.className = 'btn';
    btnLibre.textContent = 'Ligne libre';
    btnLibre.onclick = function () {
      majDevis(function (d, data) {
        d.lignes.push(App.schema.ligneLibre(data.settings));
      }, { structurel: true });
    };
    actions.appendChild(btnLibre);

    c.querySelector('.carte-tete').appendChild(actions);

    // Le corps du tableau remplace la grille de formulaire standard.
    c.corps.innerHTML = '';

    var entetes = document.createElement('div');
    entetes.className = 'lig lig-entetes';
    [
      { l: '', c: 'lig-ordre' },
      { l: '', c: 'lig-vignette' },
      { l: 'Désignation', c: 'lig-des' },
      { l: 'Qté', c: 'lig-col' },
      { l: 'P.U. HT', c: 'lig-col' },
      { l: 'Remise %', c: 'lig-col' },
      { l: 'TVA', c: 'lig-col' },
      { l: 'Total HT', c: 'lig-total' },
      { l: '', c: 'lig-sup' }
    ].forEach(function (h) {
      var e = document.createElement('div');
      e.className = h.c;
      e.textContent = h.l;
      entetes.appendChild(e);
    });
    c.corps.appendChild(entetes);

    refs.corpsLignes = document.createElement('div');
    refs.corpsLignes.className = 'lig-corps';
    c.corps.appendChild(refs.corpsLignes);

    refs.colonnes = document.createElement('div');
    refs.colonnes.className = 'cols-attrs';
    c.corps.appendChild(refs.colonnes);

    rendreLignes();
    return c;
  }

  // --- Synthese ------------------------------------------------------------

  function blocSynthese() {
    var c = UI.carte('Remise, acompte et totaux');

    var gauche = document.createElement('div');
    gauche.className = 'grille';
    gauche.style.flex = '1 1 320px';

    gauche.appendChild(champDevis({
      chemin: 'remiseGlobalePct', libelle: 'Remise globale (%)', taille: 'c6',
      type: 'number', pas: '0.5', min: 0, nombre: true,
      aide: 'Appliquée après le sous-total, ventilée au prorata sur chaque taux de TVA.'
    }));
    gauche.appendChild(champDevis({
      chemin: 'acomptePct', libelle: 'Acompte (%)', taille: 'c6',
      type: 'number', pas: '0.5', min: 0, nombre: true,
      aide: 'Calculé sur le TTC.'
    }));
    gauche.appendChild(champDevis({
      chemin: 'notes', libelle: 'Observations', taille: 'c12',
      type: 'textarea', lignes: 3,
      placeholder: 'Délai de livraison, contraintes d\'accès…'
    }));

    refs.totaux = document.createElement('div');
    refs.totaux.className = 'totaux';

    var zone = document.createElement('div');
    zone.className = 'synthese';
    zone.appendChild(gauche);
    zone.appendChild(refs.totaux);

    c.corps.innerHTML = '';
    c.corps.appendChild(zone);

    rafraichirTotaux();
    return c;
  }

  /**
   * Reecrit les totaux et les cellules de total de ligne. Aucune
   * reconstruction de DOM : les champs de saisie gardent leur focus.
   */
  function rafraichirTotaux() {
    var d = devisCourant();
    if (!d) return;

    var r = App.calc.computeDevis(d);

    d.lignes.forEach(function (l) {
      var ref = refsLignes[l.id];
      if (ref) ref.total.textContent = App.format.euros(App.calc.ligneTotalHTCents(l));
    });

    if (!refs.totaux) return;
    refs.totaux.innerHTML = '';

    function ligne(libelle, valeur, classe) {
      var n = document.createElement('div');
      n.className = 'tot' + (classe ? ' ' + classe : '');
      var k = document.createElement('span');
      k.textContent = libelle;
      var v = document.createElement('span');
      v.className = 'tot-val';
      v.textContent = valeur;
      n.appendChild(k);
      n.appendChild(v);
      refs.totaux.appendChild(n);
    }

    if (r.remiseGlobaleCents) {
      ligne('Sous-total HT', App.format.euros(r.sousTotalHTCents));
      ligne('Remise ' + App.format.pourcent(r.remiseGlobalePct),
            '- ' + App.format.euros(r.remiseGlobaleCents), 'tot-remise');
    }
    // Meme hierarchie que le document imprime : le HT en vedette, le TTC en
    // ligne ordinaire. L'editeur ne doit pas mettre en avant un autre chiffre
    // que celui que le client verra.
    ligne('Total HT', App.format.euros(r.totalHTCents), 'tot-fort');

    r.recapTVA.forEach(function (t) {
      ligne('TVA ' + App.format.pourcent(t.taux) +
            ' sur ' + App.format.euros(t.baseHTCents),
            App.format.euros(t.montantTVACents), 'tot-tva');
    });

    ligne('Total TTC', App.format.euros(r.totalTTCCents), 'tot-ttc');

    if (r.acompteCents) {
      ligne('Acompte ' + App.format.pourcent(r.acomptePct), App.format.euros(r.acompteCents), 'tot-sec');
      ligne('Reste à payer', App.format.euros(r.resteAPayerCents), 'tot-sec');
    }
  }

  // ========================================================================
  // APERCU
  // ========================================================================

  function planifierApercu() {
    if (!etat.apercuVisible || !refs.apercu) return;
    if (timerApercu) clearTimeout(timerApercu);
    timerApercu = setTimeout(rendreApercu, DEBOUNCE_APERCU_MS);
  }

  function ajusterEchelle() {
    if (!refs.apercuCadre || !refs.apercuScene) return;
    var dispo = refs.apercuCadre.clientWidth - 24;
    var echelle = Math.min(1, dispo / A4_PX);
    refs.apercuScene.style.transform = 'scale(' + echelle + ')';
    // La mise a l'echelle n'affecte pas le flux : on rend sa hauteur reelle
    // au conteneur, sinon la barre de defilement est fausse.
    var h = refs.apercuScene.scrollHeight * echelle;
    refs.apercuScene.parentNode.style.height = h + 'px';
  }

  function rendreApercu() {
    if (!refs.apercuScene || !etat.devisId) return;
    App.preview.monter(refs.apercuScene, etat.devisId)
      .then(function () { return App.preview.attendreImages(refs.apercuScene); })
      .then(ajusterEchelle)
      .catch(function (err) {
        refs.apercuScene.innerHTML = '';
        var e = document.createElement('div');
        e.className = 'apercu-err';
        e.textContent = 'Aperçu indisponible : ' + (err && err.message || err);
        refs.apercuScene.appendChild(e);
      });
  }

  function panneauApercu() {
    var panneau = document.createElement('aside');
    panneau.className = 'apercu';

    var tete = document.createElement('div');
    tete.className = 'apercu-tete';
    var t = document.createElement('span');
    t.textContent = 'Aperçu du document';
    tete.appendChild(t);

    var btnImprimer = document.createElement('button');
    btnImprimer.className = 'btn btn-primaire';
    btnImprimer.textContent = 'Imprimer';
    btnImprimer.style.marginLeft = 'auto';
    btnImprimer.onclick = function () {
      App.preview.imprimer(etat.devisId).catch(function (err) {
        UI.erreur('Impression impossible.', err);
      });
    };
    tete.appendChild(btnImprimer);
    panneau.appendChild(tete);

    refs.apercuCadre = document.createElement('div');
    refs.apercuCadre.className = 'apercu-cadre';

    var piste = document.createElement('div');
    piste.className = 'apercu-piste';
    refs.apercuScene = document.createElement('div');
    refs.apercuScene.className = 'apercu-scene';
    piste.appendChild(refs.apercuScene);
    refs.apercuCadre.appendChild(piste);
    panneau.appendChild(refs.apercuCadre);

    refs.apercu = panneau;
    return panneau;
  }

  // ========================================================================
  // EDITEUR — montage
  // ========================================================================

  function rendreEditeur(hote) {
    var d = devisCourant();
    if (!d) { etat.devisId = null; rendreListe(hote); return; }

    refs = {};
    refsLignes = {};

    var barre = document.createElement('div');
    barre.className = 'barre-outils barre-editeur';

    var retour = document.createElement('button');
    retour.className = 'btn';
    retour.innerHTML = '&larr; Tous les devis';
    retour.onclick = function () { etat.devisId = null; UI.ouvrirVue('devis'); };
    barre.appendChild(retour);

    var titre = document.createElement('div');
    titre.className = 'barre-titre';
    titre.textContent = 'Devis ' + d.numero +
      (d.client && d.client.nom ? ' — ' + d.client.nom : '');
    barre.appendChild(titre);

    var espace = document.createElement('span');
    espace.style.flex = '1 1 auto';
    barre.appendChild(espace);

    var basculeApercu = document.createElement('label');
    basculeApercu.className = 'bascule';
    var caseApercu = document.createElement('input');
    caseApercu.type = 'checkbox';
    caseApercu.checked = etat.apercuVisible;
    caseApercu.onchange = function () {
      etat.apercuVisible = caseApercu.checked;
      UI.ouvrirVue('devis');
    };
    basculeApercu.appendChild(caseApercu);
    basculeApercu.appendChild(document.createTextNode(' Aperçu'));
    barre.appendChild(basculeApercu);

    hote.appendChild(barre);

    var split = document.createElement('div');
    split.className = 'split' + (etat.apercuVisible ? '' : ' sans-apercu');

    var colonne = document.createElement('div');
    colonne.className = 'split-edition';
    colonne.appendChild(blocEntete());
    colonne.appendChild(blocClient());
    colonne.appendChild(blocLignes());
    colonne.appendChild(blocSynthese());
    split.appendChild(colonne);

    if (etat.apercuVisible) {
      split.appendChild(panneauApercu());
    }

    hote.appendChild(split);

    if (etat.apercuVisible) rendreApercu();
  }

  // Un seul ecouteur pour toute la duree de vie de la page : le monter dans
  // rendreEditeur en accumulerait un par ouverture de devis.
  window.addEventListener('resize', function () {
    if (etat.apercuVisible) ajusterEchelle();
  });

  // ========================================================================
  // VUE
  // ========================================================================

  UI.vues.devis = {
    libelle: 'Devis',
    icone: 'devis',
    titre: 'Devis',
    sous: 'Sélection de machines, quantités, remises, totaux en temps réel.',

    monter: function (hote) {
      if (etat.devisId && devisCourant()) {
        rendreEditeur(hote);
      } else {
        etat.devisId = null;
        rendreListe(hote);
      }
    }
  };

})(window.App);
