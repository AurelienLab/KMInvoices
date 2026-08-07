/**
 * 60-ui-catalogue.js — vue catalogue des machines.
 *
 * Fiches reutilisables : reference, libelle, description, prix, TVA, unite,
 * photo. Une fiche n'est jamais consommee directement par un devis : la ligne
 * de devis en fait un SNAPSHOT a l'insertion (voir 20-schema.js). Modifier une
 * fiche ne doit donc rien changer aux devis deja etablis.
 *
 * La liste se redessine explicitement apres chaque enregistrement, jamais a
 * chaque frappe : les champs de saisie vivent dans une modale, ils ne doivent
 * pas perdre le focus.
 */
(function (App) {
  'use strict';

  var UI = App.ui;

  // Etat local de la vue, non persiste : un filtre de recherche n'a rien a
  // faire dans le fichier .devis.
  var vueEtat = {
    recherche: '',
    montrerArchives: false,
    tri: 'reference'
  };

  var hoteListe = null;

  // --- Selection et filtrage ----------------------------------------------

  function produitsFiltres() {
    var data = App.store.get();
    var q = vueEtat.recherche.trim().toLowerCase();

    var liste = (data.catalogue || []).filter(function (p) {
      if (!vueEtat.montrerArchives && p.archive) return false;
      if (!q) return true;
      return [p.reference, p.titre, p.description]
        .some(function (v) { return (v || '').toLowerCase().indexOf(q) !== -1; });
    });

    return liste.sort(function (a, b) {
      if (vueEtat.tri === 'prix') return (b.prixHTCents || 0) - (a.prixHTCents || 0);
      if (vueEtat.tri === 'titre') return (a.titre || '').localeCompare(b.titre || '', 'fr');
      return (a.reference || '').localeCompare(b.reference || '', 'fr', { numeric: true });
    });
  }

  /** Devis utilisant ce produit. Sert a interdire une suppression destructrice. */
  function devisUtilisant(produitId) {
    var data = App.store.get();
    return (data.devis || []).filter(function (d) {
      return (d.lignes || []).some(function (l) { return l.produitId === produitId; });
    });
  }

  function referenceLibre(reference, sauf) {
    var ref = (reference || '').trim().toLowerCase();
    if (!ref) return true;
    return !(App.store.get().catalogue || []).some(function (p) {
      return p.id !== sauf && (p.reference || '').trim().toLowerCase() === ref;
    });
  }

  // --- Editeur de fiche ----------------------------------------------------

  /**
   * @param {object|null} produit fiche existante, ou null pour une creation
   */
  function ouvrirEditeur(produit) {
    var creation = !produit;
    // On travaille sur une copie : annuler doit vraiment tout annuler,
    // y compris l'image deja importee.
    var brouillon = Object.assign(App.schema.nouveauProduit(), produit || {});
    var imageOrigine = brouillon.imageFile;

    var form = document.createElement('div');
    form.className = 'grille';

    function set(champ, valeur) { brouillon[champ] = valeur; }

    // --- Identification ---

    var champRef = UI.champ({
      libelle: 'Référence', taille: 'c4', valeur: brouillon.reference,
      placeholder: 'KM-1200',
      onchange: function (v) { set('reference', v); validerRef(); }
    });
    form.appendChild(champRef);

    var erreurRef = document.createElement('div');
    erreurRef.className = 'champ-erreur';
    champRef.appendChild(erreurRef);

    function validerRef() {
      var ref = (brouillon.reference || '').trim();
      if (!ref) {
        erreurRef.textContent = 'Référence obligatoire.';
      } else if (!referenceLibre(ref, brouillon.id)) {
        erreurRef.textContent = 'Cette référence est déjà utilisée par une autre machine.';
      } else {
        erreurRef.textContent = '';
      }
      champRef.input.classList.toggle('invalide', !!erreurRef.textContent);
      return !erreurRef.textContent;
    }

    form.appendChild(UI.champ({
      libelle: 'Désignation', taille: 'c8', valeur: brouillon.titre,
      placeholder: 'Tour parallèle KM-450',
      onchange: function (v) { set('titre', v); }
    }));

    form.appendChild(UI.champ({
      libelle: 'Description', taille: 'c12', type: 'textarea', lignes: 4,
      valeur: brouillon.description,
      aide: 'Reprise telle quelle sur le devis, retours à la ligne compris.',
      onchange: function (v) { set('description', v); }
    }));

    // --- Prix et TVA ---

    form.appendChild(UI.champ({
      libelle: 'Prix HT (€)', taille: 'c3', type: 'number', pas: '0.01', min: 0,
      valeur: App.calc.centsToEuros(brouillon.prixHTCents),
      onchange: function (v) { set('prixHTCents', App.calc.eurosToCents(v)); }
    }));

    form.appendChild(UI.champ({
      libelle: 'Taux de TVA', taille: 'c3', type: 'select',
      valeur: String(brouillon.tauxTVA),
      options: App.schema.TAUX_TVA.map(function (t) {
        return { valeur: String(t), libelle: App.format.pourcent(t) };
      }),
      onchange: function (v) { set('tauxTVA', parseFloat(v)); }
    }));

    var champUnite = UI.champ({
      libelle: 'Unité', taille: 'c3', valeur: brouillon.unite,
      onchange: function (v) { set('unite', v); }
    });
    // Suggestions sans fermer la porte a une unite libre.
    var liste = document.createElement('datalist');
    liste.id = 'unites-' + App.uid().slice(0, 8);
    App.schema.UNITES.forEach(function (u) {
      var o = document.createElement('option');
      o.value = u;
      liste.appendChild(o);
    });
    champUnite.appendChild(liste);
    champUnite.input.setAttribute('list', liste.id);
    form.appendChild(champUnite);

    var champArchive = document.createElement('div');
    champArchive.className = 'champ c3';
    champArchive.innerHTML = '<label>Disponibilité</label>';
    var bascule = document.createElement('label');
    bascule.className = 'bascule';
    var caseArchive = document.createElement('input');
    caseArchive.type = 'checkbox';
    caseArchive.checked = !!brouillon.archive;
    caseArchive.onchange = function () { set('archive', caseArchive.checked); };
    bascule.appendChild(caseArchive);
    bascule.appendChild(document.createTextNode(' Archivée'));
    champArchive.appendChild(bascule);
    var aideArchive = document.createElement('div');
    aideArchive.className = 'aide';
    aideArchive.textContent = 'Masquée à la sélection, sans casser les devis existants.';
    champArchive.appendChild(aideArchive);
    form.appendChild(champArchive);

    // --- Photo ---

    var champPhoto = document.createElement('div');
    champPhoto.className = 'champ c12';
    champPhoto.innerHTML = '<label>Photo</label>';

    var zone = document.createElement('div');
    zone.className = 'depot';
    champPhoto.appendChild(zone);

    var apercu = document.createElement('div');
    apercu.className = 'depot-apercu';
    zone.appendChild(apercu);

    var texte = document.createElement('div');
    texte.className = 'depot-texte';
    zone.appendChild(texte);

    var fichierInput = document.createElement('input');
    fichierInput.type = 'file';
    fichierInput.accept = 'image/jpeg,image/png,image/webp';
    fichierInput.style.display = 'none';
    zone.appendChild(fichierInput);

    function rafraichirPhoto() {
      apercu.innerHTML = '';
      texte.innerHTML = '';

      if (brouillon.imageFile) {
        App.store.urlImage(brouillon.imageFile).then(function (url) {
          if (!url || !brouillon.imageFile) return;
          var img = document.createElement('img');
          img.src = url;
          apercu.appendChild(img);
        });
        var actions = document.createElement('div');
        actions.className = 'depot-actions';

        var remplacer = document.createElement('button');
        remplacer.className = 'btn';
        remplacer.textContent = 'Remplacer';
        remplacer.onclick = function (e) { e.preventDefault(); fichierInput.click(); };

        var retirer = document.createElement('button');
        retirer.className = 'btn btn-danger';
        retirer.textContent = 'Retirer';
        retirer.onclick = function (e) {
          e.preventDefault();
          brouillon.imageFile = null;
          rafraichirPhoto();
        };

        actions.appendChild(remplacer);
        actions.appendChild(retirer);
        texte.appendChild(actions);
      } else {
        var invite = document.createElement('div');
        invite.className = 'depot-invite';
        invite.innerHTML =
          '<strong>Glisser une photo ici</strong><br>' +
          'ou <button class="lien" type="button">parcourir…</button>';
        invite.querySelector('button').onclick = function (e) {
          e.preventDefault();
          fichierInput.click();
        };
        texte.appendChild(invite);

        var note = document.createElement('div');
        note.className = 'aide';
        note.textContent = 'Réduite à ' + App.images.MAX_COTE_PRODUIT +
          ' px de plus grand côté, réencodée en JPEG qualité 0,8.';
        texte.appendChild(note);
      }
    }

    function importer(fichier) {
      zone.classList.add('occupe');
      App.images.importer(fichier, { maxCote: App.images.MAX_COTE_PRODUIT })
        .then(function (res) {
          brouillon.imageFile = res.nom;
          rafraichirPhoto();
          UI.notifier('Photo importée.', 'succes',
            res.largeur + '×' + res.hauteur + ' px · ' + Math.round(res.taille / 1024) + ' Ko');
        })
        .catch(function (err) { UI.erreur('Import de la photo impossible.', err); })
        .then(function () { zone.classList.remove('occupe'); });
    }

    fichierInput.onchange = function () {
      var f = fichierInput.files && fichierInput.files[0];
      fichierInput.value = '';
      if (f) importer(f);
    };

    // 99-boot.js ecoute « drop » au niveau de window pour ouvrir un .devis
    // depose n'importe ou. Sans stopPropagation, deposer une photo ici
    // tenterait de l'ouvrir comme une archive.
    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('survol');
      });
    });
    ['dragleave', 'dragend'].forEach(function (type) {
      zone.addEventListener(type, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('survol');
      });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('survol');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importer(f);
    });

    rafraichirPhoto();
    form.appendChild(champPhoto);

    // --- Enregistrement ---

    function enregistrer(fermer) {
      if (!validerRef()) {
        champRef.input.focus();
        return;
      }
      if (!(brouillon.titre || '').trim()) {
        UI.notifier('La désignation est obligatoire.', 'alerte');
        return;
      }

      App.store.mutate(function (data) {
        // Insertion ou remplacement, comme au repertoire clients : une fiche
        // a enregistrer ne doit jamais se perdre parce que la recherche a
        // echoue. Le drapeau `creation` ne sert qu'a l'habillage.
        var i = data.catalogue.findIndex(function (p) { return p.id === brouillon.id; });
        if (i === -1) data.catalogue.push(brouillon);
        else data.catalogue[i] = brouillon;
      });

      // L'ancienne photo n'est purgee que si plus aucun devis ne s'y refere.
      if (imageOrigine && imageOrigine !== brouillon.imageFile) {
        App.store.purgerImages();
      }

      fermer();
      rendreListe();
      UI.notifier(creation ? 'Machine ajoutée.' : 'Fiche mise à jour.', 'succes',
        brouillon.reference + ' — ' + brouillon.titre);
    }

    function annuler(fermer) {
      // Une photo importee puis abandonnee ne doit pas rester dans la base.
      if (brouillon.imageFile && brouillon.imageFile !== imageOrigine) {
        App.store.purgerImages();
      }
      fermer();
    }

    UI.modal({
      titre: creation ? 'Nouvelle machine' : 'Modifier la fiche',
      sous: creation ? null : 'Les devis déjà établis ne seront pas modifiés.',
      corps: form,
      largeur: '760px',
      actions: [
        { libelle: 'Annuler', onclick: annuler },
        {
          libelle: creation ? 'Ajouter' : 'Enregistrer',
          classe: 'btn-primaire', aDroite: true,
          onclick: enregistrer
        }
      ]
    });

    validerRef();
  }

  // --- Suppression ---------------------------------------------------------

  function supprimer(produit) {
    var utilisateurs = devisUtilisant(produit.id);

    if (utilisateurs.length) {
      var numeros = utilisateurs.map(function (d) { return d.numero || d.id; }).join(', ');
      UI.confirmer(
        'Machine utilisée dans un devis',
        'Cette machine figure dans ' + utilisateurs.length + ' devis (' + numeros + '). ' +
        'La supprimer romprait le lien avec ces lignes.\n\n' +
        'Les lignes elles-mêmes ne bougeront pas — elles portent leur propre copie du ' +
        'libellé et du prix — mais la fiche disparaîtra du catalogue.\n\n' +
        'L\'archiver la masque de la sélection tout en gardant le lien intact.',
        { confirmer: 'Archiver', annuler: 'Ne rien faire' }
      ).then(function (ok) {
        if (!ok) return;
        App.store.mutate(function (data) {
          var p = data.catalogue.filter(function (x) { return x.id === produit.id; })[0];
          if (p) p.archive = true;
        });
        rendreListe();
        UI.notifier('Machine archivée.', 'succes');
      });
      return;
    }

    UI.confirmer(
      'Supprimer cette machine ?',
      produit.reference + ' — ' + produit.titre + '\n\n' +
      'Aucun devis ne l\'utilise. La suppression est définitive.',
      { confirmer: 'Supprimer', danger: true }
    ).then(function (ok) {
      if (!ok) return;
      App.store.mutate(function (data) {
        data.catalogue = data.catalogue.filter(function (x) { return x.id !== produit.id; });
      });
      App.store.purgerImages();
      rendreListe();
      UI.notifier('Machine supprimée.', 'succes');
    });
  }

  function dupliquer(produit) {
    var copie = Object.assign({}, produit, {
      id: App.uid(),
      reference: produit.reference + '-COPIE',
      archive: false
    });
    App.store.mutate(function (data) { data.catalogue.push(copie); });
    rendreListe();
    ouvrirEditeur(copie);
  }

  // --- Liste ---------------------------------------------------------------

  function ligneProduit(p) {
    var row = document.createElement('div');
    row.className = 'cat-ligne' + (p.archive ? ' archivee' : '');

    var vignette = document.createElement('div');
    vignette.className = 'cat-vignette';
    if (p.imageFile) {
      App.store.urlImage(p.imageFile).then(function (url) {
        if (!url) return;
        var img = document.createElement('img');
        img.src = url;
        img.alt = p.titre;
        vignette.innerHTML = '';
        vignette.appendChild(img);
      });
    } else {
      vignette.classList.add('vide');
      vignette.textContent = 'sans photo';
    }
    row.appendChild(vignette);

    var corps = document.createElement('div');
    corps.className = 'cat-corps';

    var haut = document.createElement('div');
    haut.className = 'cat-haut';
    var ref = document.createElement('span');
    ref.className = 'cat-ref';
    ref.textContent = p.reference || '(sans référence)';
    haut.appendChild(ref);
    if (p.archive) {
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'archivée';
      haut.appendChild(badge);
    }
    corps.appendChild(haut);

    var titre = document.createElement('div');
    titre.className = 'cat-titre';
    titre.textContent = p.titre || '(sans désignation)';
    corps.appendChild(titre);

    if (p.description) {
      var desc = document.createElement('div');
      desc.className = 'cat-desc';
      desc.textContent = p.description.split(/\r?\n/)[0];
      corps.appendChild(desc);
    }
    row.appendChild(corps);

    var prix = document.createElement('div');
    prix.className = 'cat-prix';
    prix.innerHTML =
      '<div class="cat-prix-v">' + App.format.euros(p.prixHTCents) + '</div>' +
      '<div class="cat-prix-d">HT / ' + (p.unite || 'u') +
      ' · TVA ' + App.format.pourcent(p.tauxTVA) + '</div>';
    row.appendChild(prix);

    var actions = document.createElement('div');
    actions.className = 'cat-actions';

    [
      { libelle: 'Modifier', classe: 'btn', action: function () { ouvrirEditeur(p); } },
      { libelle: 'Dupliquer', classe: 'btn btn-discret', action: function () { dupliquer(p); } },
      { libelle: 'Supprimer', classe: 'btn btn-discret btn-danger', action: function () { supprimer(p); } }
    ].forEach(function (a) {
      var b = document.createElement('button');
      b.className = a.classe;
      b.textContent = a.libelle;
      b.onclick = a.action;
      actions.appendChild(b);
    });
    row.appendChild(actions);

    row.ondblclick = function () { ouvrirEditeur(p); };
    return row;
  }

  function rendreListe() {
    if (!hoteListe) return;
    hoteListe.innerHTML = '';

    var data = App.store.get();
    var total = (data.catalogue || []).length;
    var archivees = (data.catalogue || []).filter(function (p) { return p.archive; }).length;
    var liste = produitsFiltres();

    if (!total) {
      var vide = document.createElement('div');
      vide.className = 'vide';
      vide.innerHTML =
        '<div class="vide-titre">Aucune machine au catalogue</div>' +
        '<div>Créer une première fiche pour pouvoir l\'insérer dans un devis.</div>';
      var b = document.createElement('button');
      b.className = 'btn btn-primaire';
      b.style.marginTop = '14px';
      b.textContent = 'Nouvelle machine';
      b.onclick = function () { ouvrirEditeur(null); };
      vide.appendChild(b);
      hoteListe.appendChild(vide);
      return;
    }

    if (!liste.length) {
      var rien = document.createElement('div');
      rien.className = 'vide';
      rien.innerHTML =
        '<div class="vide-titre">Aucun résultat</div>' +
        '<div>Aucune machine ne correspond à « ' + vueEtat.recherche +' »' +
        (archivees && !vueEtat.montrerArchives
          ? ', et ' + archivees + ' fiche(s) archivée(s) sont masquée(s).'
          : '.') + '</div>';
      hoteListe.appendChild(rien);
      return;
    }

    var conteneur = document.createElement('div');
    conteneur.className = 'cat-liste';
    liste.forEach(function (p) { conteneur.appendChild(ligneProduit(p)); });
    hoteListe.appendChild(conteneur);

    var pied = document.createElement('div');
    pied.className = 'cat-pied';
    pied.textContent = liste.length + ' machine(s) affichée(s) sur ' + total +
      (archivees ? ' · ' + archivees + ' archivée(s)' : '');
    hoteListe.appendChild(pied);
  }

  // --- Vue -----------------------------------------------------------------

  UI.vues.catalogue = {
    libelle: 'Catalogue',
    icone: 'catalogue',
    titre: 'Catalogue des machines',
    sous: 'Fiches réutilisables. Une ligne de devis en fait une copie figée : ' +
          'modifier une fiche ne change aucun devis déjà établi.',

    monter: function (hote) {
      var barre = document.createElement('div');
      barre.className = 'barre-outils';

      var recherche = document.createElement('input');
      recherche.type = 'text';
      recherche.className = 'recherche';
      recherche.placeholder = 'Rechercher une référence, une désignation…';
      recherche.value = vueEtat.recherche;
      recherche.oninput = function () {
        vueEtat.recherche = recherche.value;
        rendreListe();
      };
      barre.appendChild(recherche);

      var tri = document.createElement('select');
      [
        { v: 'reference', l: 'Trier par référence' },
        { v: 'titre', l: 'Trier par désignation' },
        { v: 'prix', l: 'Trier par prix décroissant' }
      ].forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.v;
        op.textContent = o.l;
        tri.appendChild(op);
      });
      tri.value = vueEtat.tri;
      tri.onchange = function () { vueEtat.tri = tri.value; rendreListe(); };
      barre.appendChild(tri);

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
      basculeArchives.appendChild(document.createTextNode(' Archivées'));
      barre.appendChild(basculeArchives);

      var espace = document.createElement('span');
      espace.style.flex = '1 1 auto';
      barre.appendChild(espace);

      var nouveau = document.createElement('button');
      nouveau.className = 'btn btn-primaire';
      nouveau.textContent = 'Nouvelle machine';
      nouveau.onclick = function () { ouvrirEditeur(null); };
      barre.appendChild(nouveau);

      hote.appendChild(barre);

      hoteListe = document.createElement('div');
      hote.appendChild(hoteListe);
      rendreListe();
    }
  };

})(window.App);
