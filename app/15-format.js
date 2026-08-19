/**
 * 15-format.js — formatage fr-FR. Fonctions pures, aucun acces au DOM.
 *
 * Charge AVANT 30-calc.js : le moteur de calcul produit un modele deja
 * formate, pour que les templates n'aient aucune mise en forme a faire.
 * C'est la seule garantie que deux templates affichent les nombres pareil.
 *
 * Intl est natif dans Edge, aucun reseau requis.
 */
(function (App) {
  'use strict';

  var F = App.format;

  var nfEuro = new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  // Montant sans symbole, toujours 2 decimales : les colonnes de tableau
  // doivent s'aligner, "10 000" a cote de "1 234,56" casse la lecture.
  var nfMontant = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  var nfQte = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0, maximumFractionDigits: 3
  });

  var nfPct = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0, maximumFractionDigits: 2
  });

  /** Centimes entiers -> "1 234,56 €". */
  F.euros = function (cents) {
    return nfEuro.format((cents || 0) / 100);
  };

  /** Centimes entiers -> "1 234,56" sans symbole (colonnes de tableau). */
  F.montant = function (cents) {
    return nfMontant.format((cents || 0) / 100);
  };

  /**
   * Centimes + unite de tarif -> "1 234,56 €/mois".
   *
   * L'unite vient du type de tarif (voir App.schema.typesTarifs) : « € » pour
   * un prix de vente, « €/mois » pour une location. Espace insecable entre le
   * nombre et l'unite, comme le fait Intl pour le symbole seul.
   */
  F.prix = function (cents, unite) {
    return F.montant(cents) + '\u00a0' + (unite || '€');
  };

  /** Quantite numerique -> "7,5". */
  F.quantite = function (n) {
    return nfQte.format(n || 0);
  };

  /** Pourcentage -> "5,5 %". Espace insecable fine avant le %. */
  F.pourcent = function (n) {
    return nfPct.format(n || 0) + ' %';
  };

  /** Taux de TVA -> "20 %" ou "TVA 20 %". */
  F.taux = function (n) {
    return F.pourcent(n);
  };

  /**
   * Date ISO "2026-08-07" -> "7 août 2026".
   * Accepte aussi un Date. Renvoie "" si vide ou invalide.
   */
  F.dateLongue = function (iso) {
    var d = F.toDate(iso);
    if (!d) return '';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  /** Date ISO -> "07/08/2026". */
  F.dateCourte = function (iso) {
    var d = F.toDate(iso);
    if (!d) return '';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  F.toDate = function (v) {
    if (!v) return null;
    var d = (v instanceof Date) ? v : new Date(v + (/^\d{4}-\d{2}-\d{2}$/.test(v) ? 'T00:00:00' : ''));
    return isNaN(d.getTime()) ? null : d;
  };

  /** Date ISO "YYYY-MM-DD" a partir d'un Date. */
  F.toIso = function (d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  /** Ajoute des jours a une date ISO et renvoie une date ISO. */
  F.ajouterJours = function (iso, jours) {
    var d = F.toDate(iso);
    if (!d) return '';
    d.setDate(d.getDate() + (jours || 0));
    return F.toIso(d);
  };

  /**
   * Decoupe un texte multiligne en tableau de lignes non vides.
   * Utilise pour les adresses et les mentions legales : le template
   * ne doit jamais avoir a interpreter des \n lui-meme.
   */
  F.lignes = function (texte) {
    if (!texte) return [];
    return String(texte).split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
  };

})(window.App);
