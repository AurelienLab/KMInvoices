/**
 * 45-images.js — preparation des images avant stockage.
 *
 * Redimensionne au canvas puis produit un Blob. Aucun chemin relatif n'est
 * jamais utilise : une <img src="images/x.jpg"> contaminerait le canvas en
 * file:// et toDataURL()/toBlob() leveraient une SecurityError. On ne
 * travaille qu'a partir de Blob et de File, tous deux same-origin.
 *
 * Le PNG est conserve en PNG quand il a de la transparence a preserver
 * (logo) : le convertir en JPEG remplirait l'alpha de noir.
 */
(function (App) {
  'use strict';

  var I = {};

  I.MAX_COTE_PRODUIT = 1200;
  // Le logo s'imprime jusqu'a 80 mm de large (template.css) : a 600 px il
  // sortait a ~190 dpi, visiblement flou sur papier. 1000 px donne ~320 dpi.
  I.MAX_COTE_LOGO = 1000;
  I.QUALITE_JPEG = 0.8;

  I.TYPES_ACCEPTES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];

  /** Decode un Blob en source dessinable, sans passer par un chemin relatif. */
  function decoder(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob).catch(function () { return decoderViaImg(blob); });
    }
    return decoderViaImg(blob);
  }

  function decoderViaImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Image illisible ou format non pris en charge.'));
      };
      img.src = url;
    });
  }

  function dimensions(src) {
    return {
      w: src.width || src.naturalWidth,
      h: src.height || src.naturalHeight
    };
  }

  /**
   * Redimensionne et re-encode.
   *
   * @param {File|Blob} fichier
   * @param {object} [opts]
   *   .maxCote     plus grand cote autorise (defaut 1200)
   *   .qualite     qualite JPEG (defaut 0.8)
   *   .preserverPng conserve le PNG au lieu de convertir en JPEG
   * @returns {Promise<{blob: Blob, extension: string, largeur: number, hauteur: number}>}
   */
  I.preparer = function (fichier, opts) {
    var o = opts || {};
    var maxCote = o.maxCote || I.MAX_COTE_PRODUIT;
    var qualite = o.qualite == null ? I.QUALITE_JPEG : o.qualite;
    var estPng = /png$/i.test(fichier.type || '') || /\.png$/i.test(fichier.name || '');
    var sortiePng = !!o.preserverPng && estPng;

    if (fichier.type && I.TYPES_ACCEPTES.indexOf(fichier.type) === -1) {
      return Promise.reject(new Error(
        'Format d\'image non pris en charge : ' + fichier.type + '. ' +
        'Utiliser un JPEG, un PNG ou un WebP.'
      ));
    }

    return decoder(fichier).then(function (src) {
      var d = dimensions(src);
      if (!d.w || !d.h) throw new Error('Image de dimensions nulles.');

      // On ne fabrique jamais de pixels : une image plus petite que la cible
      // est laissee a sa taille.
      var facteur = Math.min(1, maxCote / Math.max(d.w, d.h));
      var lw = Math.max(1, Math.round(d.w * facteur));
      var lh = Math.max(1, Math.round(d.h * facteur));

      var c = document.createElement('canvas');
      c.width = lw;
      c.height = lh;
      var g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';

      // Un JPEG n'a pas de canal alpha : sans fond blanc, la transparence
      // ressortirait en noir a l'impression.
      if (!sortiePng) {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, lw, lh);
      }
      g.drawImage(src, 0, 0, lw, lh);
      if (src.close) src.close();

      return new Promise(function (resolve, reject) {
        c.toBlob(function (blob) {
          if (!blob) { reject(new Error('Conversion de l\'image impossible.')); return; }
          resolve({
            blob: blob,
            extension: sortiePng ? 'png' : 'jpg',
            largeur: lw,
            hauteur: lh
          });
        }, sortiePng ? 'image/png' : 'image/jpeg', sortiePng ? undefined : qualite);
      });
    });
  };

  /** Raccourci : prepare puis enregistre, renvoie le nom de fichier. */
  I.importer = function (fichier, opts) {
    return I.preparer(fichier, opts).then(function (res) {
      return App.store.ajouterImage(res.blob, res.extension).then(function (nom) {
        return { nom: nom, largeur: res.largeur, hauteur: res.hauteur, taille: res.blob.size };
      });
    });
  };

  App.images = I;

})(window.App);
