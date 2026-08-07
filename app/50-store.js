/**
 * 50-store.js — etat applicatif, autosave, drapeau de modification.
 *
 * Modele mental : application documentaire type Photoshop. Le FICHIER SUR
 * DISQUE est la source de verite ; IndexedDB n'est qu'un cache de reprise.
 * D'ou les deux horodatages :
 *
 *   lastModifiedAt  derniere mutation de l'etat
 *   lastExportedAt  dernier enregistrement reel dans un .devis
 *
 * Tant que lastModifiedAt > lastExportedAt, le travail n'existe QUE dans le
 * cache navigateur : c'est ce que signale l'indicateur « modifications non
 * enregistrées » et le garde-fou beforeunload.
 */
(function (App) {
  'use strict';

  var AUTOSAVE_MS = 800;
  var SNAPSHOTS_GARDES = 5;

  var state = {
    data: null,             // espace de travail normalise
    lastModifiedAt: 0,
    lastExportedAt: 0,
    nomFichierSource: null, // nom du .devis ouvert, pour renommer les exports
    versionExport: 0,       // incrementee a chaque enregistrement
    createdAt: null,
    pret: false
  };

  var abonnes = [];
  var timerAutosave = null;
  var urlCache = Object.create(null);   // nomImage -> objectURL
  var sauvegardeEnCours = null;

  // --- Abonnement ----------------------------------------------------------

  function notifier(raison) {
    abonnes.forEach(function (cb) {
      try { cb(state, raison); } catch (e) { console.error('[store] abonné en erreur', e); }
    });
  }

  // --- Persistance ---------------------------------------------------------

  function metaAPersister() {
    return {
      lastModifiedAt: state.lastModifiedAt,
      lastExportedAt: state.lastExportedAt,
      nomFichierSource: state.nomFichierSource,
      versionExport: state.versionExport,
      createdAt: state.createdAt,
      appVersion: App.version
    };
  }

  function persister() {
    if (!state.data) return Promise.resolve();
    var instantane = JSON.parse(JSON.stringify(state.data));
    return App.db.put('workspace', instantane)
      .then(function () { return App.db.put('meta', metaAPersister()); })
      .then(function () { return App.db.pushSnapshot(instantane, SNAPSHOTS_GARDES); })
      .then(function () { notifier('sauvegarde-locale'); })
      .catch(function (err) {
        console.error('[store] autosave impossible', err);
        notifier('erreur-sauvegarde');
        throw err;
      });
  }

  function planifierAutosave() {
    if (timerAutosave) clearTimeout(timerAutosave);
    timerAutosave = setTimeout(function () {
      timerAutosave = null;
      sauvegardeEnCours = persister().catch(function () {});
    }, AUTOSAVE_MS);
  }

  /** Force l'ecriture immediate de l'autosave en attente. */
  function viderFileAutosave() {
    if (timerAutosave) {
      clearTimeout(timerAutosave);
      timerAutosave = null;
      sauvegardeEnCours = persister();
    }
    return sauvegardeEnCours || Promise.resolve();
  }

  // --- Images --------------------------------------------------------------

  function libererUrls() {
    Object.keys(urlCache).forEach(function (n) { URL.revokeObjectURL(urlCache[n]); });
    urlCache = Object.create(null);
  }

  var Store = {

    AUTOSAVE_MS: AUTOSAVE_MS,

    // --- Cycle de vie ------------------------------------------------------

    /**
     * Charge l'etat depuis IndexedDB s'il en existe un.
     * @returns {Promise<{reprise: boolean, meta: object|null}>}
     */
    init: function () {
      return Promise.all([App.db.get('workspace'), App.db.get('meta')])
        .then(function (r) {
          var data = r[0], meta = r[1] || {};
          if (data) {
            try {
              state.data = App.schema.normalize(App.schema.migrate(data));
            } catch (e) {
              console.error('[store] session illisible, ignorée', e);
              return { reprise: false, meta: null };
            }
            state.lastModifiedAt = meta.lastModifiedAt || 0;
            state.lastExportedAt = meta.lastExportedAt || 0;
            state.nomFichierSource = meta.nomFichierSource || null;
            state.versionExport = meta.versionExport || 0;
            state.createdAt = meta.createdAt || null;
            state.pret = true;
            return { reprise: true, meta: meta };
          }
          return { reprise: false, meta: null };
        });
    },

    /** Ouvre l'etat charge par init(). A appeler apres avoir choisi la reprise. */
    reprendre: function () {
      if (!state.data) return Promise.reject(new Error('Aucune session à reprendre.'));
      state.pret = true;
      notifier('ouverture');
      return Promise.resolve(state);
    },

    /** Nouveau document vierge. Efface tout le cache local. */
    nouveau: function () {
      libererUrls();
      return App.db.reset().then(function () {
        state.data = App.schema.defaultWorkspace();
        state.lastModifiedAt = Date.now();
        state.lastExportedAt = 0;
        state.nomFichierSource = null;
        state.versionExport = 0;
        state.createdAt = new Date().toISOString();
        state.pret = true;
        return persister();
      }).then(function () {
        notifier('ouverture');
        return state;
      });
    },

    /**
     * Ouvre un fichier .devis. REMPLACE integralement l'espace de travail :
     * il n'y a pas de fusion, un fichier = un espace de travail complet.
     */
    ouvrirFichier: function (fichier) {
      libererUrls();
      return App.archive.read(fichier).then(function (res) {
        return App.db.reset()
          .then(function () {
            // Ecriture des images en Blob natifs, pas en base64.
            var jobs = Object.keys(res.images).map(function (nom) {
              return App.db.putImage(nom, res.images[nom]);
            });
            return Promise.all(jobs);
          })
          .then(function () {
            state.data = res.data;
            state.lastModifiedAt = Date.now();
            state.lastExportedAt = Date.now();   // on vient de lire le disque
            state.nomFichierSource = fichier.name || null;
            // Reprend la numerotation la ou le fichier ouvert l'avait laissee :
            // rouvrir « devis-2026-0042-v3.devis » doit produire un v4, jamais
            // un v1 qui viendrait ecraser une version deja sur le disque.
            state.versionExport = Store.versionDepuisNom(fichier.name);
            state.createdAt = (res.manifest && res.manifest.createdAt) || new Date().toISOString();
            state.pret = true;
            return persister();
          })
          .then(function () {
            notifier('ouverture');
            return { avertissements: res.avertissements || [] };
          });
      });
    },

    // --- Lecture -----------------------------------------------------------

    get: function () { return state.data; },
    etat: function () { return state; },
    pret: function () { return state.pret; },

    estModifie: function () {
      return state.pret && state.lastModifiedAt > state.lastExportedAt;
    },

    subscribe: function (cb) {
      abonnes.push(cb);
      return function () {
        var i = abonnes.indexOf(cb);
        if (i !== -1) abonnes.splice(i, 1);
      };
    },

    // --- Mutation ----------------------------------------------------------

    /**
     * Seule porte d'entree pour modifier l'etat.
     *   App.store.mutate(function (data) { data.societe.nom = 'X'; });
     * Marque le document comme modifie, planifie l'autosave, notifie.
     */
    mutate: function (fn, raison) {
      if (!state.data) throw new Error('Aucun document ouvert.');
      fn(state.data);
      state.lastModifiedAt = Date.now();
      planifierAutosave();
      notifier(raison || 'mutation');
      return state.data;
    },

    /** Ecrit l'autosave en attente sans attendre le debounce. */
    flush: viderFileAutosave,

    // --- Images ------------------------------------------------------------

    /**
     * Enregistre un Blob image et renvoie son nom de fichier.
     * Le nom n'est JAMAIS reutilise : remplacer la photo d'un produit ne doit
     * pas modifier retroactivement l'image figee dans un ancien devis.
     */
    ajouterImage: function (blob, extension) {
      var nom = App.schema.nomImage(extension || 'jpg');
      return App.db.putImage(nom, blob).then(function () { return nom; });
    },

    /** URL blob: memorisee pour un nom d'image. */
    urlImage: function (nom) {
      if (!nom) return Promise.resolve(null);
      if (urlCache[nom]) return Promise.resolve(urlCache[nom]);
      return App.db.getImage(nom).then(function (blob) {
        if (!blob) return null;
        urlCache[nom] = URL.createObjectURL(blob);
        return urlCache[nom];
      });
    },

    /** Resout d'un coup toutes les images d'une liste de noms. */
    urlsImages: function (noms) {
      var out = {};
      return Promise.all((noms || []).map(function (n) {
        return Store.urlImage(n).then(function (u) { if (u) out[n] = u; });
      })).then(function () { return out; });
    },

    /**
     * Supprime les images qu'aucun produit ni aucune ligne de devis ne
     * reference. Le balayage porte sur TOUT l'espace de travail, jamais sur
     * le seul catalogue.
     */
    purgerImages: function () {
      var vivantes = App.schema.imagesReferencees(state.data);
      var vues = Object.create(null);
      vivantes.forEach(function (n) { vues[n] = true; });

      return App.db.listImages().then(function (noms) {
        var mortes = (noms || []).filter(function (n) { return !vues[n]; });
        return Promise.all(mortes.map(function (n) {
          if (urlCache[n]) { URL.revokeObjectURL(urlCache[n]); delete urlCache[n]; }
          return App.db.delImage(n);
        })).then(function () { return mortes.length; });
      });
    },

    // --- Export ------------------------------------------------------------

    /**
     * Ecrit l'espace de travail dans un fichier .devis et le telecharge.
     *
     * Sur file:// il n'existe pas de sauvegarde sur place : la File System
     * Access API est indisponible sur une origine opaque, donc chaque
     * enregistrement est techniquement un telechargement.
     *
     * Puisque le navigateur suffixe de toute facon « (1) », « (2) » quand le
     * dialogue Enregistrer-sous est desactive par reglage ou par strategie,
     * autant que l'application maitrise elle-meme la numerotation : chaque
     * enregistrement produit une VERSION explicite, -v1, -v2, -v3. Le fichier
     * le plus recent est identifiable au premier coup d'oeil, et aucun
     * enregistrement n'en ecrase un autre.
     *
     * @param {object} [options]
     *   .nomFichier  nom impose, court-circuite la numerotation
     */
    enregistrer: function (options) {
      var o = options || {};
      if (!state.data) return Promise.reject(new Error('Aucun document ouvert.'));

      return viderFileAutosave().then(function () {
        var noms = App.schema.imagesReferencees(state.data);
        var images = {};
        return Promise.all(noms.map(function (n) {
          return App.db.getImage(n).then(function (b) { if (b) images[n] = b; });
        })).then(function () { return images; });
      }).then(function (images) {
        return App.archive.write(state.data, images, { createdAt: state.createdAt });
      }).then(function (res) {
        state.versionExport += 1;
        var nom = o.nomFichier || Store.nomEnregistrement(state.versionExport);

        App.archive.telecharger(res.blob, nom);
        state.lastExportedAt = Date.now();
        state.nomFichierSource = nom;

        return App.db.put('meta', metaAPersister()).then(function () {
          notifier('export');
          return {
            nom: nom,
            version: state.versionExport,
            taille: res.blob.size,
            imagesManquantes: res.imagesManquantes
          };
        });
      });
    },

    /**
     * Racine du nom de fichier, sans version ni suffixe de navigateur.
     *
     * Deduite du fichier ouvert quand il y en a un, pour qu'une serie
     * d'enregistrements reste groupee sous le meme prefixe alphabetique dans
     * l'explorateur, quel que soit le contenu du document.
     */
    baseStable: function () {
      if (state.nomFichierSource) {
        var base = state.nomFichierSource
          .replace(/\.devis$/i, '')
          .replace(/ \(\d+\)$/, '')     // « (1) » ajoute par le navigateur
          .replace(/-v\d+$/i, '');      // version precedente
        if (base) return base;
      }
      return Store.baseNomExport();
    },

    /**
     * Nom de fichier pour une version donnee. Sans argument, celui que
     * produira le PROCHAIN enregistrement — c'est ce qu'affiche l'en-tete.
     */
    nomEnregistrement: function (version) {
      return App.archive.nomFichier({
        base: Store.baseStable(),
        version: version == null ? Store.prochaineVersion() : version
      });
    },

    /** Numero de la prochaine version, sans rien ecrire. */
    prochaineVersion: function () {
      return state.versionExport + 1;
    },

    /**
     * Extrait le numero de version d'un nom de fichier.
     * « devis-2026-0042-v3.devis » -> 3 · « devis-2026-0042 (1).devis » -> 0
     * Le « (1) » du navigateur n'est PAS une version : c'est un doublon du
     * meme enregistrement, le compteur ne doit pas avancer a cause de lui.
     */
    versionDepuisNom: function (nom) {
      if (!nom) return 0;
      var m = /-v(\d+)(?: \(\d+\))?\.devis$/i.exec(nom);
      return m ? parseInt(m[1], 10) : 0;
    },

    /**
     * Base du nom d'export, deterministe et parlante :
     *   un seul devis   -> "devis-2026-0042"
     *   plusieurs devis -> "devis-km-mecanique-2026-08-07"
     */
    baseNomExport: function () {
      var d = state.data;
      if (!d) return 'espace';
      if (d.devis && d.devis.length === 1 && d.devis[0].numero) {
        return 'devis-' + d.devis[0].numero;
      }
      var societe = (d.societe && d.societe.nom) || 'espace';
      return 'devis-' + App.archive.slug(societe) + '-' + App.format.toIso(new Date());
    },

    // --- Reprise apres crash -----------------------------------------------

    instantanes: function () { return App.db.listSnapshots(); },

    restaurerInstantane: function (snap) {
      state.data = App.schema.normalize(snap.payload);
      state.lastModifiedAt = Date.now();
      notifier('ouverture');
      return persister();
    },

    // --- Divers ------------------------------------------------------------

    libererUrls: libererUrls
  };

  App.store = Store;

})(window.App);
