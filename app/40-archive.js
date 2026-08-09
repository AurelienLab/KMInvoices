/**
 * 40-archive.js — lecture et ecriture du format .devis (archive ZIP).
 *
 *   devis-2026-0042.devis
 *   ├── manifest.json   { schemaVersion, appVersion, createdAt, updatedAt }
 *   ├── data.json       donnees metier, images referencees par NOM de fichier
 *   └── images/
 *       ├── img-<uuid>.jpg
 *       └── logo.png
 *
 * Le binaire reste binaire : data.json ne contient aucune image encodee.
 * Pas de base64, donc pas d'inflation de 33 % ni de JSON.parse sur des
 * megaoctets.
 *
 * JSZip est la seule dependance externe, vendoree en vendor/jszip.min.js
 * (build UMD, chargeable par <script> classique). Son absence doit produire
 * un message explicite, jamais un plantage.
 */
(function (App) {
  'use strict';

  var A = {};

  A.EXTENSION = '.devis';

  A.disponible = function () {
    return typeof window.JSZip === 'function';
  };

  A.erreurJSZip = function () {
    // Dans le livrable en fichier unique, JSZip est inline : son absence ne
    // peut plus venir d'un fichier oublie, mais d'un fichier tronque.
    if (App.build && App.build.fichierUnique) {
      return new Error(
        'JSZip est introuvable alors qu\'il est intégré à ce fichier. ' +
        'Le fichier est incomplet ou corrompu : le retélécharger, ' +
        'puis remplacer celui du poste.'
      );
    }
    return new Error(
      'JSZip est introuvable. Placer le fichier vendor/jszip.min.js ' +
      '(build UMD) à côté de index.html, puis recharger la page. ' +
      'Sans lui, l\'ouverture et l\'enregistrement de fichiers .devis sont impossibles.'
    );
  };

  // --- Ecriture ------------------------------------------------------------

  /**
   * Construit l'archive.
   *
   * @param {object} data    espace de travail (deja normalise)
   * @param {object} images  { "<nomFichier>": Blob }
   * @param {object} [meta]  { createdAt }
   * @returns {Promise<Blob>}
   */
  A.write = function (data, images, meta) {
    if (!A.disponible()) return Promise.reject(A.erreurJSZip());

    var zip = new JSZip();
    var maintenant = new Date().toISOString();

    var manifest = {
      schemaVersion: data.schemaVersion || App.schema.CURRENT,
      appVersion: App.version,
      createdAt: (meta && meta.createdAt) || maintenant,
      updatedAt: maintenant
    };

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('data.json', JSON.stringify(data, null, 2));

    // On n'ecrit que les images reellement referencees : le fichier ne doit
    // pas grossir indefiniment a coup d'images orphelines.
    var referencees = App.schema.imagesReferencees(data);
    var dossier = zip.folder('images');
    var manquantes = [];

    referencees.forEach(function (nom) {
      var blob = images[nom];
      if (blob) {
        dossier.file(nom, blob, { binary: true });
      } else {
        manquantes.push(nom);
      }
    });

    return zip.generateAsync({
      type: 'blob',
      // Les JPEG sont deja compresses : deflate ne gagne presque rien et
      // coute du temps. On compresse quand meme, faiblement, pour le JSON.
      compression: 'DEFLATE',
      compressionOptions: { level: 3 },
      mimeType: 'application/zip'
    }).then(function (blob) {
      return { blob: blob, manifest: manifest, imagesManquantes: manquantes };
    });
  };

  // --- Lecture -------------------------------------------------------------

  /**
   * Lit une archive .devis.
   *
   * @param {File|Blob} fichier
   * @returns {Promise<{data, images, manifest, avertissements}>}
   */
  A.read = function (fichier) {
    if (!A.disponible()) return Promise.reject(A.erreurJSZip());

    var avertissements = [];
    var zip;

    return JSZip.loadAsync(fichier)
      .catch(function () {
        throw new Error(
          'Ce fichier n\'est pas une archive .devis valide, ou il est corrompu. ' +
          'Vérifier qu\'il n\'a pas été modifié ou tronqué lors d\'une copie.'
        );
      })
      .then(function (z) {
        zip = z;
        var entree = zip.file('data.json');
        if (!entree) {
          throw new Error('Archive invalide : data.json est absent.');
        }
        return entree.async('string');
      })
      .then(function (texte) {
        var data;
        try {
          data = JSON.parse(texte);
        } catch (e) {
          throw new Error('Archive invalide : data.json est illisible (' + e.message + ').');
        }

        var verdict = App.schema.validate(data);
        if (!verdict.ok) throw new Error(verdict.erreurs.join('\n'));
        avertissements = avertissements.concat(verdict.avertissements);

        if (data.schemaVersion < App.schema.CURRENT) {
          data = App.schema.migrate(data);
          avertissements.push(
            'Fichier créé dans un format plus ancien, converti automatiquement.'
          );
        }
        return App.schema.normalize(data);
      })
      .then(function (data) {
        // Manifest facultatif : son absence n'empeche pas la lecture.
        var mf = zip.file('manifest.json');
        var manifestPromise = mf
          ? mf.async('string').then(function (t) {
              try { return JSON.parse(t); } catch (e) { return null; }
            })
          : Promise.resolve(null);

        return manifestPromise.then(function (manifest) {
          return { data: data, manifest: manifest };
        });
      })
      .then(function (ctx) {
        // Extraction des images, une par une, en Blob.
        var attendues = App.schema.imagesReferencees(ctx.data);
        var images = {};

        var jobs = attendues.map(function (nom) {
          var entree = zip.file('images/' + nom);
          if (!entree) {
            avertissements.push('Image manquante dans l\'archive : ' + nom + '.');
            return Promise.resolve();
          }
          return entree.async('blob').then(function (blob) {
            // JSZip ne restitue pas le type MIME : on le redonne d'apres
            // l'extension, sinon les <img> et le canvas s'en trouvent genes.
            var type = /\.png$/i.test(nom) ? 'image/png'
                     : /\.webp$/i.test(nom) ? 'image/webp'
                     : 'image/jpeg';
            images[nom] = blob.type ? blob : new Blob([blob], { type: type });
          });
        });

        return Promise.all(jobs).then(function () {
          return {
            data: ctx.data,
            images: images,
            manifest: ctx.manifest,
            avertissements: avertissements
          };
        });
      });
  };

  // --- Nommage et telechargement -------------------------------------------

  /** Rend une chaine utilisable dans un nom de fichier Windows. */
  A.slug = function (texte) {
    return String(texte || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 48);
  };

  /**
   * Nom de fichier deterministe et parlant.
   *   nomFichier({ base: 'devis-2026-0042', version: 3 }) -> "devis-2026-0042-v3.devis"
   */
  A.nomFichier = function (opts) {
    var o = opts || {};
    var base = o.base || ('espace-' + App.format.toIso(new Date()));
    var v = o.version ? '-v' + o.version : '';
    return A.slug(base) + v + A.EXTENSION;
  };

  /**
   * Declenche le telechargement. Sur une origine file://, il n'existe aucune
   * sauvegarde sur place : chaque enregistrement EST un telechargement.
   * Activer « Toujours demander où enregistrer les fichiers » dans
   * edge://settings/downloads transforme ceci en vraie boite Enregistrer-sous.
   */
  A.telecharger = function (blob, nom) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nom;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revocation differee : revoquer immediatement annule parfois le
    // telechargement avant qu'Edge n'ait lu le blob.
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  };

  App.archive = A;

})(window.App);
