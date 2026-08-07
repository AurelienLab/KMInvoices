/**
 * 10-db.js — wrapper IndexedDB maison, a base de promesses.
 *
 * Pourquoi pas la lib `idb` : ses builds recents sont ESM-first, ce qui nous
 * ramene au probleme des modules interdits en file://.
 *
 * Le nom de la base est prefixe : l'origine file:// est partagee avec tous
 * les autres fichiers HTML locaux du poste.
 *
 * Trois magasins :
 *   kv         etat de travail et metadonnees, cle = chaine
 *   images     Blob natifs, cle = nom de fichier ("img-<uuid>.jpg")
 *   snapshots  instantanes de reprise apres crash, cle auto-incrementee
 */
(function (App) {
  'use strict';

  var DB_NAME = 'devisgen_v1';
  var DB_VERSION = 1;

  var S_KV = 'kv';
  var S_IMAGES = 'images';
  var S_SNAPSHOTS = 'snapshots';

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB indisponible dans ce navigateur.'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var db = req.result;
        if (!db.objectStoreNames.contains(S_KV)) db.createObjectStore(S_KV);
        if (!db.objectStoreNames.contains(S_IMAGES)) db.createObjectStore(S_IMAGES);
        if (!db.objectStoreNames.contains(S_SNAPSHOTS)) {
          db.createObjectStore(S_SNAPSHOTS, { keyPath: 'id', autoIncrement: true });
        }
        void e;
      };

      req.onsuccess = function () {
        var db = req.result;
        // Si un autre onglet demande une montee de version, on se retire.
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('Ouverture de la base impossible.')); };
      req.onblocked = function () {
        reject(new Error('Base bloquée par un autre onglet. Fermer les autres onglets de l\'application.'));
      };
    });

    return dbPromise;
  }

  /**
   * Execute une operation dans une transaction et resout a la FIN de la
   * transaction, pas a la fin de la requete : sinon on peut lire avant que
   * l'ecriture ne soit reellement committee.
   */
  function run(storeNames, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeNames, mode);
        var result;
        var out = fn(
          Array.isArray(storeNames)
            ? storeNames.map(function (n) { return t.objectStore(n); })
            : t.objectStore(storeNames)
        );
        if (out && typeof out.then === 'function') {
          reject(new Error('Le callback de transaction ne doit pas être asynchrone.'));
          return;
        }
        if (out && 'result' in out) {
          out.onsuccess = function () { result = out.result; };
        } else {
          result = out;
        }
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Transaction annulée.')); };
      });
    });
  }

  var DB = {
    NAME: DB_NAME,

    open: open,

    // --- kv ---------------------------------------------------------------

    get: function (key) {
      return run(S_KV, 'readonly', function (s) { return s.get(key); });
    },
    put: function (key, value) {
      return run(S_KV, 'readwrite', function (s) { return s.put(value, key); });
    },
    del: function (key) {
      return run(S_KV, 'readwrite', function (s) { return s.delete(key); });
    },

    // --- images -----------------------------------------------------------

    /** @param {string} nom @param {Blob} blob */
    putImage: function (nom, blob) {
      return run(S_IMAGES, 'readwrite', function (s) { return s.put(blob, nom); });
    },
    getImage: function (nom) {
      return run(S_IMAGES, 'readonly', function (s) { return s.get(nom); });
    },
    delImage: function (nom) {
      return run(S_IMAGES, 'readwrite', function (s) { return s.delete(nom); });
    },
    listImages: function () {
      return run(S_IMAGES, 'readonly', function (s) { return s.getAllKeys(); });
    },
    /** Vide le magasin d'images : appele a l'ouverture d'un autre document. */
    clearImages: function () {
      return run(S_IMAGES, 'readwrite', function (s) { return s.clear(); });
    },

    // --- snapshots --------------------------------------------------------

    /** Ajoute un instantane et purge au-dela des `garder` plus recents. */
    pushSnapshot: function (payload, garder) {
      var max = garder || 5;
      return run(S_SNAPSHOTS, 'readwrite', function (s) {
        return s.add({ ts: Date.now(), payload: payload });
      }).then(function () {
        return run(S_SNAPSHOTS, 'readwrite', function (s) {
          var req = s.getAllKeys();
          req.onsuccess = function () {
            var keys = req.result || [];
            // Les cles auto-incrementees sont croissantes : les plus anciennes
            // sont en tete.
            keys.slice(0, Math.max(0, keys.length - max)).forEach(function (k) {
              s.delete(k);
            });
          };
          return undefined;
        });
      });
    },

    listSnapshots: function () {
      return run(S_SNAPSHOTS, 'readonly', function (s) { return s.getAll(); })
        .then(function (rows) {
          return (rows || []).sort(function (a, b) { return b.ts - a.ts; });
        });
    },

    clearSnapshots: function () {
      return run(S_SNAPSHOTS, 'readwrite', function (s) { return s.clear(); });
    },

    // --- maintenance ------------------------------------------------------

    /** Remet la base a zero. Utilise par « Nouveau document ». */
    reset: function () {
      return Promise.all([
        run(S_KV, 'readwrite', function (s) { return s.clear(); }),
        DB.clearImages(),
        DB.clearSnapshots()
      ]);
    },

    estimate: function () {
      if (!navigator.storage || !navigator.storage.estimate) {
        return Promise.resolve(null);
      }
      return navigator.storage.estimate().catch(function () { return null; });
    }
  };

  App.db = DB;

})(window.App);
