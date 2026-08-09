/**
 * 99-boot.js — demarrage : diagnostic, ecran d'accueil, ouverture du document.
 *
 * Charge en DERNIER. Tout ce qui precede se contente de declarer ; ce fichier
 * est le seul a declencher quoi que ce soit.
 *
 * Ecran de demarrage a trois entrees :
 *   Reprendre la session du <date>  /  Ouvrir un fichier .devis  /  Nouveau document
 *
 * La reprise lit le cache IndexedDB. Ce cache n'est PAS une sauvegarde : il
 * disparait si le poste efface les donnees de site a la fermeture d'Edge.
 * Le fichier .devis sur disque reste la seule source de verite.
 */
(function (App) {
  'use strict';

  var B = {};
  var refs = {};

  // --- Diagnostic de demarrage --------------------------------------------

  function alerter(message, grave) {
    var hote = refs.alertes;
    if (!hote) return;
    var d = document.createElement('div');
    d.className = 'bandeau-alerte' + (grave ? ' grave' : '');
    d.innerHTML = message;
    hote.appendChild(d);
  }

  function diagnostiquer() {
    var bloquant = false;

    if (!window.indexedDB) {
      alerter('<strong>IndexedDB est indisponible.</strong> L\'application ne peut pas ' +
              'conserver l\'état de travail. Vérifier que la navigation privée n\'est pas ' +
              'active et que les données de site ne sont pas bloquées par une stratégie.', true);
      bloquant = true;
    }

    // Sur les sources eclatees, JSZip est un fichier a fournir : son absence est
    // un cas de figure normal, avec une consigne d'installation. Dans le
    // livrable en fichier unique il est inline, donc toujours present : le test
    // n'est plus qu'un controle de sanite sur l'integrite du fichier.
    if (!App.archive.disponible()) {
      if (App.build.fichierUnique) {
        alerter('<strong>Ce fichier est incomplet ou corrompu.</strong> JSZip devrait y être ' +
                'intégré et ne s\'y trouve pas. Retélécharger la dernière version, puis ' +
                'remplacer le fichier du poste.', true);
        bloquant = true;
      } else {
        alerter('<strong>JSZip est introuvable.</strong> Placer le fichier ' +
                '<code>vendor/jszip.min.js</code> (build UMD) à côté de <code>index.html</code>, ' +
                'puis recharger la page. Sans lui, l\'ouverture et l\'enregistrement de fichiers ' +
                '<code>.devis</code> sont impossibles — le reste de l\'application fonctionne.');
      }
    }

    if (!App.templates || !App.templates.default) {
      alerter('<strong>Aucun template chargé.</strong> Vérifier les balises ' +
              '<code>&lt;script&gt;</code> et <code>&lt;link&gt;</code> de ' +
              '<code>templates/default/</code> dans <code>index.html</code>.', true);
      bloquant = true;
    }

    if (location.protocol !== 'file:') {
      alerter('Cette page est servie en <code>' + location.protocol + '</code>. ' +
              'L\'outil est prévu pour être ouvert en double-cliquant sur ' +
              '<code>index.html</code> : penser à valider dans les conditions réelles.');
    }

    return !bloquant;
  }

  // --- Ecran de demarrage --------------------------------------------------

  function afficherAccueil(reprise) {
    refs.demarrage.style.display = 'flex';

    var btn = refs.choixReprendre;
    if (reprise.reprise) {
      var quand = reprise.meta && reprise.meta.lastModifiedAt
        ? new Date(reprise.meta.lastModifiedAt)
        : null;
      var nonEnregistre = reprise.meta &&
        reprise.meta.lastModifiedAt > (reprise.meta.lastExportedAt || 0);

      btn.querySelector('.choix-titre').textContent = quand
        ? 'Reprendre la session du ' + quand.toLocaleDateString('fr-FR') +
          ' à ' + quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : 'Reprendre la session en cours';

      btn.querySelector('.choix-detail').textContent = nonEnregistre
        ? 'Contient des modifications jamais enregistrées dans un fichier .devis.'
        : ((reprise.meta && reprise.meta.nomFichierSource) || 'Document sans nom');

      btn.disabled = false;
    } else {
      btn.querySelector('.choix-titre').textContent = 'Aucune session à reprendre';
      btn.querySelector('.choix-detail').textContent =
        'Le cache du navigateur est vide, ou il a été effacé à la fermeture d\'Edge.';
      btn.disabled = true;
    }
  }

  function masquerAccueil() {
    refs.demarrage.style.display = 'none';
  }

  function demarrerApplication() {
    masquerAccueil();
    App.ui.monterCoquille();
  }

  // --- Actions -------------------------------------------------------------

  B.demanderNouveau = function () {
    if (App.store.pret() && App.store.estModifie()) {
      var ok = window.confirm(
        'Le document en cours contient des modifications qui n\'ont jamais été ' +
        'enregistrées dans un fichier .devis.\n\n' +
        'Créer un nouveau document les supprimera définitivement.\n\nContinuer ?'
      );
      if (!ok) return Promise.resolve();
    }
    return App.store.nouveau().then(function () {
      if (!App.store.pret()) return;
      if (!document.getElementById('app').classList.contains('actif')) {
        demarrerApplication();
      }
      App.ui.notifier('Nouveau document créé.', 'succes');
    }).catch(function (err) {
      App.ui.erreur('Création impossible.', err);
    });
  };

  B.demanderOuverture = function () {
    if (!App.archive.disponible()) {
      App.ui.erreur('Ouverture impossible.', App.archive.erreurJSZip());
      return;
    }
    if (App.store.pret() && App.store.estModifie()) {
      var ok = window.confirm(
        'Le document en cours contient des modifications non enregistrées.\n\n' +
        'Ouvrir un autre fichier les supprimera définitivement.\n\nContinuer ?'
      );
      if (!ok) return;
    }
    refs.fichier.click();
  };

  function ouvrirFichier(f) {
    App.ui.notifier('Ouverture de ' + f.name + '…');
    return App.store.ouvrirFichier(f).then(function (res) {
      if (!document.getElementById('app').classList.contains('actif')) {
        demarrerApplication();
      }
      var avert = res.avertissements || [];
      if (avert.length) {
        App.ui.notifier('Fichier ouvert avec des réserves.', 'alerte', avert.join('\n'));
      } else {
        App.ui.notifier('Fichier ouvert.', 'succes', f.name);
      }
    }).catch(function (err) {
      App.ui.erreur('Ouverture impossible.', err);
    });
  }

  // --- Amorcage ------------------------------------------------------------

  function amorcer() {
    refs.demarrage = document.getElementById('demarrage');
    refs.alertes = document.getElementById('demarrage-alertes');
    refs.choixReprendre = document.getElementById('choix-reprendre');
    refs.choixOuvrir = document.getElementById('choix-ouvrir');
    refs.choixNouveau = document.getElementById('choix-nouveau');
    refs.fichier = document.getElementById('fichier-devis');

    var utilisable = diagnostiquer();

    refs.fichier.addEventListener('change', function () {
      var f = refs.fichier.files && refs.fichier.files[0];
      refs.fichier.value = '';
      if (f) ouvrirFichier(f);
    });

    refs.choixOuvrir.onclick = function () {
      if (!App.archive.disponible()) {
        App.ui.erreur('Ouverture impossible.', App.archive.erreurJSZip());
        return;
      }
      refs.fichier.click();
    };

    refs.choixNouveau.onclick = function () {
      App.store.nouveau()
        .then(demarrerApplication)
        .catch(function (err) { App.ui.erreur('Création impossible.', err); });
    };

    refs.choixReprendre.onclick = function () {
      App.store.reprendre()
        .then(demarrerApplication)
        .catch(function (err) { App.ui.erreur('Reprise impossible.', err); });
    };

    // Glisser-deposer d'un .devis directement sur l'ecran d'accueil.
    ['dragover', 'drop'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        e.preventDefault();
        if (type !== 'drop') return;
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && /\.devis$/i.test(f.name)) ouvrirFichier(f);
      });
    });

    if (!utilisable) {
      refs.choixReprendre.disabled = true;
      refs.choixOuvrir.disabled = true;
      refs.choixNouveau.disabled = true;
      refs.demarrage.style.display = 'flex';
      return;
    }

    App.store.init().then(afficherAccueil).catch(function (err) {
      alerter('<strong>Lecture du cache impossible :</strong> ' + err.message, true);
      afficherAccueil({ reprise: false, meta: null });
    });
  }

  App.boot = B;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', amorcer);
  } else {
    amorcer();
  }

})(window.App);
