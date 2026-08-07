/**
 * 60-ui-societe.js — vue d'edition des informations de la societe et des
 * reglages du document.
 *
 * Toute ecriture passe par App.store.mutate : c'est ce qui declenche
 * l'autosave debounce et le drapeau « modifications non enregistrees ».
 */
(function (App) {
  'use strict';

  var UI = App.ui;

  function maj(chemin, valeur) {
    App.store.mutate(function (data) {
      var parts = chemin.split('.');
      var cible = data;
      for (var i = 0; i < parts.length - 1; i++) cible = cible[parts[i]];
      cible[parts[parts.length - 1]] = valeur;
    });
  }

  function champLie(opts) {
    var chemin = opts.chemin;
    var data = App.store.get();
    var parts = chemin.split('.');
    var valeur = data;
    parts.forEach(function (p) { valeur = valeur == null ? null : valeur[p]; });

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
        maj(chemin, opts.nombre ? (parseFloat(v) || 0) : v);
      }
    });
  }

  // --- Logo ----------------------------------------------------------------

  function blocLogo() {
    var carte = UI.carte('Logo', 'PNG conservé tel quel, transparence préservée');
    var data = App.store.get();

    var zone = document.createElement('div');
    zone.style.cssText = 'display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap';

    var apercu = document.createElement('div');
    apercu.style.cssText =
      'width:180px;height:80px;border:1px solid var(--ui-bord);border-radius:6px;' +
      'display:grid;place-items:center;background:#fbfcfd;overflow:hidden;padding:6px';
    apercu.innerHTML = '<span style="font-size:12px;color:var(--ui-encre-faible)">Aucun logo</span>';

    if (data.societe.logoFile) {
      App.store.urlImage(data.societe.logoFile).then(function (url) {
        if (!url) return;
        apercu.innerHTML = '';
        var img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
        apercu.appendChild(img);
      });
    }

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:8px';

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.style.display = 'none';

    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = data.societe.logoFile ? 'Remplacer le logo' : 'Choisir un logo…';
    btn.onclick = function () { input.click(); };

    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      App.images.importer(f, { maxCote: App.images.MAX_COTE_LOGO, preserverPng: true })
        .then(function (res) {
          maj('societe.logoFile', res.nom);
          UI.notifier('Logo importé.', 'succes',
            res.largeur + '×' + res.hauteur + ' px · ' + Math.round(res.taille / 1024) + ' Ko');
          UI.ouvrirVue('societe');
        })
        .catch(function (err) { UI.erreur('Import du logo impossible.', err); });
      input.value = '';
    };

    var aide = document.createElement('div');
    aide.className = 'aide';
    aide.textContent = 'Réduit à ' + App.images.MAX_COTE_LOGO +
      ' px de plus grand côté. Hauteur d\'impression limitée à 20 mm.';

    actions.appendChild(btn);
    if (data.societe.logoFile) {
      var sup = document.createElement('button');
      sup.className = 'btn btn-danger';
      sup.textContent = 'Retirer';
      sup.onclick = function () {
        maj('societe.logoFile', null);
        App.store.purgerImages();
        UI.ouvrirVue('societe');
      };
      actions.appendChild(sup);
    }
    actions.appendChild(aide);

    zone.appendChild(apercu);
    zone.appendChild(actions);
    carte.corps.innerHTML = '';
    carte.corps.appendChild(zone);
    return carte;
  }

  // --- Vue -----------------------------------------------------------------

  UI.vues.societe = {
    libelle: 'Société',
    icone: 'societe',
    titre: 'Société et réglages',
    sous: 'Ces informations alimentent l\'en-tête et le pied de page de tous les devis.',

    monter: function (hote) {
      var form = document.createElement('div');
      form.className = 'form';

      // --- Identification ---
      var c1 = UI.carte('Identification');
      [
        champLie({ chemin: 'societe.nom', libelle: 'Raison sociale', taille: 'c8', placeholder: 'KM Mécanique SARL' }),
        champLie({ chemin: 'societe.siret', libelle: 'SIRET', taille: 'c4' }),
        champLie({ chemin: 'societe.adresse', libelle: 'Adresse', taille: 'c12', type: 'textarea', lignes: 2 }),
        champLie({ chemin: 'societe.codePostal', libelle: 'Code postal', taille: 'c3' }),
        champLie({ chemin: 'societe.ville', libelle: 'Ville', taille: 'c4' }),
        champLie({ chemin: 'societe.tvaIntracom', libelle: 'TVA intracommunautaire', taille: 'c5' })
      ].forEach(function (c) { c1.grille.appendChild(c); });
      form.appendChild(c1);

      // --- Contact ---
      var c2 = UI.carte('Contact');
      [
        champLie({ chemin: 'societe.telephone', libelle: 'Téléphone', taille: 'c4', type: 'tel' }),
        champLie({ chemin: 'societe.email', libelle: 'Courriel', taille: 'c4', type: 'email' }),
        champLie({ chemin: 'societe.siteWeb', libelle: 'Site web', taille: 'c4' })
      ].forEach(function (c) { c2.grille.appendChild(c); });
      form.appendChild(c2);

      // --- Logo ---
      form.appendChild(blocLogo());

      // --- Regime et mentions ---
      var c3 = UI.carte('Régime de TVA et mentions');
      c3.grille.appendChild(champLie({
        chemin: 'societe.regimeTVA',
        libelle: 'Régime de TVA',
        type: 'select',
        taille: 'c6',
        options: [
          { valeur: 'normal', libelle: 'Assujetti à la TVA' },
          { valeur: 'franchise', libelle: 'Franchise en base (article 293 B)' }
        ],
        aide: 'En franchise, la mention « TVA non applicable, article 293 B du CGI » ' +
              'est ajoutée automatiquement au document.'
      }));
      c3.grille.appendChild(champLie({
        chemin: 'societe.conditionsPaiement',
        libelle: 'Conditions de paiement',
        type: 'textarea', lignes: 3, taille: 'c12',
        placeholder: 'Acompte de 30 % à la commande, solde à la mise en service.'
      }));
      c3.grille.appendChild(champLie({
        chemin: 'societe.mentionsLegales',
        libelle: 'Mentions légales (pied de page)',
        type: 'textarea', lignes: 3, taille: 'c12',
        placeholder: 'SARL au capital de 45 000 € — RCS Nantes 812 456 903'
      }));
      form.appendChild(c3);

      // --- Reglages ---
      var c4 = UI.carte('Réglages des devis');
      c4.grille.appendChild(champLie({
        chemin: 'settings.numerotation.prefixe', libelle: 'Préfixe de numérotation', taille: 'c3',
        aide: 'Exemple : 2026'
      }));
      c4.grille.appendChild(champLie({
        chemin: 'settings.numerotation.prochainSeq', libelle: 'Prochain numéro', taille: 'c3',
        type: 'number', min: 1, nombre: true
      }));
      c4.grille.appendChild(champLie({
        chemin: 'settings.validiteJoursParDefaut', libelle: 'Validité par défaut (jours)', taille: 'c3',
        type: 'number', min: 0, nombre: true
      }));
      c4.grille.appendChild(champLie({
        chemin: 'settings.acomptePctParDefaut', libelle: 'Acompte par défaut (%)', taille: 'c3',
        type: 'number', min: 0, pas: '0.5', nombre: true,
        aide: 'Calculé sur le TTC.'
      }));

      var apercuNum = document.createElement('div');
      apercuNum.className = 'champ c12';
      apercuNum.innerHTML = '<div class="aide">Prochain numéro généré : <strong>' +
        App.schema.formaterNumero(App.store.get().settings.numerotation) + '</strong></div>';
      c4.grille.appendChild(apercuNum);

      form.appendChild(c4);

      hote.appendChild(form);
    }
  };

})(window.App);
