/**
 * 00-namespace.js — racine du namespace applicatif.
 *
 * Doit etre charge en premier. Tous les autres fichiers font
 * `window.App = window.App || {}` par securite, mais c'est ici que
 * les sous-espaces sont declares une bonne fois.
 *
 * Aucun module ES : scripts classiques uniquement, contrainte file://.
 */
(function (global) {
  'use strict';

  var App = global.App || {};

  // Source unique de la version. outils/build.py la lit pour estampiller le
  // livrable ; il ne la reecrit jamais, sous peine de divergence entre la
  // version affichee et la version reellement executee.
  App.version = '1.0.0';
  App.schemaVersion = 2;

  // Renseigne par outils/build.py dans le livrable en fichier unique, absent
  // quand la page tourne sur les sources eclatees. Sert a adapter les messages
  // qui parlent de fichiers voisins : dans le fichier unique, il n'y en a plus.
  App.build = global.__KMI_BUILD__ ||
    { fichierUnique: false, version: App.version, date: null };

  // Sous-espaces, crees ici pour que l'ordre de chargement des fichiers
  // suivants n'ait pas a s'en preoccuper.
  App.format = App.format || {};
  App.calc = App.calc || {};
  App.templates = App.templates || {};

  /** Genere un identifiant unique. Repli si crypto.randomUUID est absent. */
  App.uid = function () {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    if (global.crypto && global.crypto.getRandomValues) {
      var b = new Uint8Array(16);
      global.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
      var hex = [];
      for (var i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1));
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
             hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
             hex.slice(10, 16).join('');
    }
    throw new Error('Aucune source d\'aléa disponible pour générer un identifiant.');
  };

  global.App = App;
})(window);
