/**
 * 70-preview.js — montage du document rendu, a l'ecran et a l'impression.
 *
 * L'apercu et le PDF passent par LA MEME fonction de rendu. C'est ce qui
 * garantit qu'ils ne peuvent pas diverger : les seules differences sont
 * celles du bloc @media print du template.
 *
 * Les images arrivent sous forme d'URL blob:. Elles ne sont revoquees
 * qu'APRES l'impression — jamais avant, sinon le PDF sort sans images.
 */
(function (App) {
  'use strict';

  var P = {};

  /** Construit le modele fige d'un devis, images resolues en URL blob:. */
  P.modele = function (devisId) {
    var data = App.store.get();
    if (!data) return Promise.reject(new Error('Aucun document ouvert.'));

    var devis = (data.devis || []).filter(function (d) { return d.id === devisId; })[0];
    if (!devis) return Promise.reject(new Error('Devis introuvable : ' + devisId));

    var noms = [];
    if (data.societe.logoFile) noms.push(data.societe.logoFile);
    (devis.lignes || []).forEach(function (l) {
      if (l.imageFile && l.afficherImage !== false) noms.push(l.imageFile);
    });

    return App.store.urlsImages(noms).then(function (imageUrls) {
      return App.calc.buildDocumentModel({
        societe: data.societe,
        devis: devis,
        imageUrls: imageUrls
      });
    });
  };

  P.template = function () {
    var data = App.store.get();
    var nom = (data && data.settings && data.settings.template) || 'default';
    var tpl = App.templates[nom] || App.templates.default;
    if (!tpl) throw new Error('Aucun template disponible : vérifier les <script> de index.html.');
    return tpl;
  };

  /**
   * Rend un devis dans un conteneur.
   * @param {HTMLElement} hote
   * @param {string} devisId
   */
  P.monter = function (hote, devisId) {
    return P.modele(devisId).then(function (model) {
      hote.innerHTML = '';
      hote.appendChild(P.template().render(model));
      return model;
    });
  };

  /**
   * Imprime un devis. Le document est monte dans un conteneur dedie, seul
   * visible a l'impression (le chrome de l'application est masque par
   * app.css). On attend le chargement effectif des images avant d'appeler
   * window.print() : imprimer trop tot produit des cadres vides.
   */
  P.imprimer = function (devisId) {
    var hote = document.getElementById('impression');
    if (!hote) return Promise.reject(new Error('Conteneur d\'impression absent de index.html.'));

    return P.monter(hote, devisId)
      .then(function () { return P.attendreImages(hote); })
      .then(function () {
        window.print();
        // Le nettoyage attend la fin du dialogue d'impression : vider trop
        // tot revoquerait les URL blob: encore utilisees par le moteur PDF.
        setTimeout(function () { hote.innerHTML = ''; }, 1500);
      });
  };

  /** Resout quand toutes les <img> du conteneur sont chargees ou en echec. */
  P.attendreImages = function (hote) {
    var imgs = Array.prototype.slice.call(hote.querySelectorAll('img'));
    if (!imgs.length) return Promise.resolve();

    return Promise.all(imgs.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        // Filet de securite : une image qui ne se decode pas ne doit pas
        // bloquer l'impression indefiniment.
        setTimeout(resolve, 4000);
      });
    }));
  };

  App.preview = P;

})(window.App);
