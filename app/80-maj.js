/**
 * 80-maj.js — verification de version, facultative et silencieuse.
 *
 * Lit un `version.json` publie sur le depot et, si une version plus recente
 * existe, affiche un bandeau discret. Rien d'autre. Ce fichier ne peut pas
 * mettre l'application a jour : une page ouverte en file:// n'a aucun droit
 * d'ecriture sur le disque. Le remplacement du fichier reste un geste manuel,
 * et le seul role du code est de le rendre trivial.
 *
 * REGLES NON NEGOCIABLES, dans l'ordre d'importance :
 *
 *   1. AUCUNE TELEMETRIE. La requete est une lecture de fichier statique.
 *      Rien n'est envoye, rien n'est mesure, aucun identifiant n'existe.
 *      Sur ce poste, « aucune donnee ne quitte le poste » est un engagement.
 *   2. AUCUN MESSAGE HORS LIGNE. Pas de reseau est le mode de fonctionnement
 *      normal de cet outil, pas une anomalie. Toute erreur est avalee.
 *   3. AUCUN BLOCAGE. Une version perimee n'empeche jamais de travailler.
 *   4. AUCUNE PERTE. Un document modifie est enregistre en .devis avant tout
 *      telechargement — c'est le seul moment ou l'on est certain que
 *      l'utilisateur detient une sauvegarde.
 *
 * Voir docs/plan-mise-a-jour.md.
 */
(function (App) {
  'use strict';

  var M = {};

  // Lu sur raw.githubusercontent.com, qui repond Access-Control-Allow-Origin: *
  // — le seul hote valide depuis une origine opaque, verifie par probe.html
  // sur le poste cible. L'hote des releases, lui, redirige et n'offre aucune
  // garantie CORS : d'ou le repli sur l'ouverture d'onglet au telechargement.
  M.URL_VERSION =
    'https://raw.githubusercontent.com/AurelienLab/KMInvoices/main/version.json';

  // Court : au-dela, l'utilisateur travaille deja et la reponse n'a plus
  // d'interet. Hors ligne, l'abandon doit etre imperceptible.
  M.DELAI_MS = 6000;

  var CLE_PREF = 'kmi.maj.desactivee';

  var refs = {};
  var etat = { info: null, verifiee: false };

  // --- Preference ----------------------------------------------------------
  // localStorage est autorise ici, et seulement ici : c'est un reglage
  // d'interface, jamais une donnee metier. Sa perte est sans consequence.

  M.activee = function () {
    try {
      return localStorage.getItem(CLE_PREF) !== '1';
    } catch (e) {
      return true;   // localStorage bloque par une strategie : comportement par defaut
    }
  };

  M.definirActivee = function (oui) {
    try {
      if (oui) localStorage.removeItem(CLE_PREF);
      else localStorage.setItem(CLE_PREF, '1');
    } catch (e) { /* sans consequence */ }
  };

  // --- Comparaison de versions ---------------------------------------------

  function decouper(v) {
    var m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(v || '').trim());
    if (!m) return null;
    return {
      chiffres: [Number(m[1]), Number(m[2]), Number(m[3])],
      pre: m[4] ? m[4].split('.') : null
    };
  }

  /**
   * Ordre semver, restreint a ce que le projet utilise : X.Y.Z[-prerelease].
   *
   * Une pre-version precede toujours la version stable de meme numero :
   * 0.1.0-poc < 0.1.0. C'est ce qui permet de proposer 0.1.0 a un poste qui
   * tourne encore sur 0.1.0-poc.
   *
   * @returns {number} -1 si a < b, 0 si egales, 1 si a > b.
   *                   0 aussi quand une version est illisible : dans le doute,
   *                   ne rien proposer.
   */
  M.comparerVersions = function (a, b) {
    var x = decouper(a), y = decouper(b);
    if (!x || !y) return 0;

    for (var i = 0; i < 3; i++) {
      if (x.chiffres[i] !== y.chiffres[i]) return x.chiffres[i] < y.chiffres[i] ? -1 : 1;
    }
    if (!x.pre && !y.pre) return 0;
    if (!x.pre) return 1;
    if (!y.pre) return -1;

    var n = Math.max(x.pre.length, y.pre.length);
    for (var j = 0; j < n; j++) {
      var p = x.pre[j], q = y.pre[j];
      if (p === undefined) return -1;
      if (q === undefined) return 1;
      if (p === q) continue;
      var pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
      if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
      if (pn !== qn) return pn ? -1 : 1;   // numerique avant alphanumerique
      return p < q ? -1 : 1;
    }
    return 0;
  };

  // --- Interrogation -------------------------------------------------------

  function valider(info) {
    if (!info || typeof info !== 'object') return null;
    if (!decouper(info.version)) return null;
    if (typeof info.url !== 'string' || !/^https:\/\//.test(info.url)) return null;
    return info;
  }

  /**
   * Lit le version.json distant.
   *
   * @returns {Promise<object|null>} null en cas d'echec, quelle qu'en soit la
   *   cause — hors ligne, proxy, CORS, JSON illisible. L'appelant n'a pas a
   *   distinguer : dans tous les cas, on se tait.
   */
  M.interroger = function () {
    if (!M.activee()) return Promise.resolve(null);
    if (typeof fetch !== 'function') return Promise.resolve(null);

    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var minuteur = setTimeout(function () { if (ctrl) ctrl.abort(); }, M.DELAI_MS);

    return fetch(M.URL_VERSION, {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (info) {
      return valider(info);
    }).catch(function (err) {
      // Silence delibere. Le mode hors ligne est le mode nominal.
      console.debug('[maj] verification abandonnee :', err && err.message);
      return null;
    }).then(function (res) {
      clearTimeout(minuteur);
      return res;
    });
  };

  /**
   * @returns {Promise<object|null>} l'info distante si elle decrit une version
   *   PLUS RECENTE que celle qui s'execute, null sinon.
   */
  M.verifier = function () {
    return M.interroger().then(function (info) {
      etat.verifiee = true;
      if (!info) return null;
      etat.info = info;
      return M.comparerVersions(App.version, info.version) < 0 ? info : null;
    });
  };

  // --- Bandeau -------------------------------------------------------------

  function bouton(libelle, principal) {
    var b = document.createElement('button');
    b.className = 'maj-btn' + (principal ? ' maj-btn-principal' : '');
    b.type = 'button';
    b.textContent = libelle;
    return b;
  }

  function fermer() {
    if (refs.bandeau && refs.bandeau.parentNode) {
      refs.bandeau.parentNode.removeChild(refs.bandeau);
    }
    refs.bandeau = null;
  }

  function poser(contenu) {
    fermer();
    var b = document.createElement('div');
    b.className = 'bandeau-maj';
    b.setAttribute('role', 'status');
    contenu.forEach(function (n) { b.appendChild(n); });

    var app = document.getElementById('app');
    var corps = app && app.querySelector('.corps');
    if (!corps) return;
    app.insertBefore(b, corps);
    refs.bandeau = b;
  }

  function texte(html) {
    var s = document.createElement('div');
    s.className = 'maj-texte';
    s.innerHTML = html;
    return s;
  }

  function espace() {
    var s = document.createElement('span');
    s.className = 'maj-espace';
    return s;
  }

  function croix() {
    var b = document.createElement('button');
    b.className = 'maj-croix';
    b.type = 'button';
    b.title = 'Masquer jusqu\'au prochain démarrage';
    b.setAttribute('aria-label', 'Masquer');
    b.textContent = '×';
    b.onclick = fermer;
    return b;
  }

  function echapper(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  // --- Etape 1 : annonce ---------------------------------------------------

  function annoncer(info) {
    var msg = 'Version <strong>' + echapper(info.version) + '</strong> disponible — ' +
              'vous utilisez la ' + echapper(App.version) + '.';
    if (info.notes) msg += ' ' + echapper(info.notes);

    // Une schemaVersion distante superieure signifie que les fichiers produits
    // par la nouvelle version ne seront plus lisibles par l'ancienne. Le dire :
    // c'est ce qui compte si plusieurs postes se partagent des .devis.
    var incompatible = typeof info.schemaVersion === 'number' &&
                       info.schemaVersion > App.schemaVersion;
    if (incompatible) {
      msg += ' <strong>Le format de fichier change :</strong> les <code>.devis</code> ' +
             'enregistrés avec cette nouvelle version ne pourront plus être ouverts ' +
             'par l\'ancienne. Mettre à jour tous les postes concernés.';
    }

    var noeuds = [texte(msg), espace()];

    if (App.build.fichierUnique) {
      var b = bouton('Mettre à jour…', true);
      b.onclick = function () { lancer(info, b); };
      noeuds.push(b);
    } else {
      // Sources eclatees : il n'y a pas de fichier unique a remplacer, et le
      // poste de developpement sait deja quoi faire.
      noeuds.push(texte('<em>Sources éclatées : mettre à jour depuis le dépôt.</em>'));
    }

    var jamais = bouton('Ne plus vérifier');
    jamais.onclick = function () { M.definirActivee(false); fermer(); };
    noeuds.push(jamais, croix());

    poser(noeuds);
  }

  // --- Etape 2 : sauvegarde forcee puis telechargement ---------------------

  /**
   * Non negociable : on ne propose jamais un telechargement au-dessus d'un
   * document modifie. Un echec d'enregistrement interrompt la mise a jour.
   */
  function assurerSauvegarde() {
    if (!App.store.pret() || !App.store.estModifie()) return Promise.resolve();
    App.ui.notifier('Enregistrement du document avant la mise à jour…');
    return App.store.enregistrer().then(function (res) {
      App.ui.notifier('Version ' + res.version + ' enregistrée.', 'succes', res.nom);
    });
  }

  function telecharger(info) {
    // Tentative de telechargement direct. L'hote des releases peut refuser la
    // lecture cross-origin ; dans ce cas on ouvre simplement l'URL, ce qui
    // marche toujours et laisse le navigateur faire son travail.
    return fetch(info.url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      App.archive.telecharger(blob, 'KMInvoices.html');
    }).catch(function (err) {
      console.debug('[maj] téléchargement direct impossible, ouverture de l\'URL :',
        err && err.message);
      window.open(info.url, '_blank', 'noopener');
    });
  }

  function lancer(info, btn) {
    btn.disabled = true;
    assurerSauvegarde()
      .then(function () { return telecharger(info); })
      .then(function () { consigne(info); })
      .catch(function (err) {
        btn.disabled = false;
        App.ui.erreur('Mise à jour interrompue.', err);
      });
  }

  // --- Etape 3 : consigne de remplacement ----------------------------------

  function consigne(info) {
    var b = bouton('J\'ai remplacé le fichier — recharger', true);
    b.onclick = function () { location.reload(); };

    poser([
      texte('<strong>KMInvoices ' + echapper(info.version) + ' téléchargé.</strong> ' +
            'Fermer cet onglet, remplacer le fichier <code>KMInvoices.html</code> du ' +
            'poste par celui qui vient d\'arriver, puis le rouvrir par double-clic. ' +
            'Les fichiers <code>.devis</code> existants restent lisibles.'),
      espace(),
      b,
      croix()
    ]);
  }

  // --- Point d'entree ------------------------------------------------------

  /**
   * Appele par 99-boot APRES le montage de la coquille : jamais pendant
   * l'ecran d'accueil, jamais au milieu d'une saisie.
   */
  M.demarrer = function () {
    M.verifier().then(function (info) {
      if (info) annoncer(info);
    });
  };

  App.maj = M;

})(window.App);
