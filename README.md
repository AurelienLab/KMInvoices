# Générateur de devis — outil local

Génère des devis PDF pour la vente de machines. Fonctionne **hors ligne**, sur un poste
verrouillé, sans installation, sans serveur et sans compte.

L'outil s'ouvre en double-cliquant sur `index.html` dans Microsoft Edge. Aucune donnée
ne quitte le poste : tout vit dans le fichier `.devis` que vous enregistrez sur le disque.

---

## Sommaire

- [Prérequis](#prérequis)
- [Installation](#installation)
- [Premier démarrage](#premier-démarrage)
- [Utilisation](#utilisation)
- [Enregistrer et rouvrir](#enregistrer-et-rouvrir)
- [Imprimer en PDF](#imprimer-en-pdf)
- [Réglage Edge recommandé](#réglage-edge-recommandé)
- [Procédure de sauvegarde](#procédure-de-sauvegarde)
- [Le format `.devis`](#le-format-devis)
- [Limitations connues](#limitations-connues)
- [Personnaliser le document](#personnaliser-le-document)
- [Structure du projet](#structure-du-projet)
- [Outils de mise au point](#outils-de-mise-au-point)
- [Dépannage](#dépannage)

---

## Prérequis

| | |
|---|---|
| Navigateur | Microsoft Edge (Chromium) ou Google Chrome, version récente |
| Système | Windows, macOS ou Linux |
| Installation | **Aucune.** Pas de Node.js, pas de Python, pas de droits administrateur |
| Réseau | **Aucun.** L'outil fonctionne intégralement hors ligne |

Firefox et Safari ne sont pas pris en charge. Le moteur d'impression PDF et le
comportement d'IndexedDB en `file://` diffèrent trop pour être garantis.

---

## Installation

1. Copier le dossier complet où vous voulez sur le poste — un disque local, une clé USB,
   un partage réseau. Aucun chemin n'est codé en dur.

2. **Déposer `jszip.min.js` dans le dossier `vendor/`.**

   C'est la seule dépendance externe, et elle n'est pas fournie. Récupérer le fichier
   `dist/jszip.min.js` d'une version 3.10.x sur <https://github.com/Stuk/jszip/releases>
   depuis un poste connecté, puis le copier dans `vendor/`.

   Prendre le build **UMD**, pas un build ESM : les modules JavaScript sont soumis à la
   politique CORS et échouent systématiquement en `file://`.

   Sans ce fichier l'application démarre quand même et affiche un avertissement explicite,
   mais ouvrir et enregistrer des fichiers `.devis` est impossible.

3. Double-cliquer sur `index.html`.

Rien d'autre. Pas de `npm install`, pas d'étape de compilation : le livrable est
exécutable tel quel.

---

## Premier démarrage

L'écran d'accueil propose trois entrées :

- **Reprendre la session** — recharge le travail en cours depuis le cache du navigateur.
  Grisé si aucune session n'existe.
- **Ouvrir un fichier `.devis`** — vous pouvez aussi faire glisser le fichier n'importe
  où sur la page.
- **Nouveau document** — repart d'une fiche société, d'un répertoire clients et d'un
  catalogue vides.

> **Le cache du navigateur n'est pas une sauvegarde.** Il permet de reprendre le travail
> après une fermeture accidentelle. Il disparaît si Edge est configuré pour effacer les
> données de site à la fermeture, ou si quelqu'un vide l'historique. Le fichier `.devis`
> sur le disque est la seule source de vérité.

---

## Utilisation

L'ordre naturel de mise en route :

### 1. Société

Renseigner une fois la raison sociale, l'adresse, le SIRET, la TVA intracommunautaire,
les coordonnées, le logo, les conditions de paiement et les mentions légales. Ces
informations alimentent l'en-tête et le pied de page de tous les devis.

**Régime de TVA** : en « Franchise en base », la mention *TVA non applicable, article
293 B du CGI* est ajoutée automatiquement au document. Obligatoire si vous n'êtes pas
assujetti.

**Numérotation** : préfixe et prochain numéro de séquence. `2026` + `42` produit
`2026-0042`. Le compteur avance automatiquement à chaque devis créé.

### 2. Clients

Une fiche par client : raison sociale, interlocuteur, adresse, coordonnées, SIRET et
notes internes. Le répertoire évite de ressaisir les mêmes coordonnées d'un devis à
l'autre.

Depuis une fiche, le bouton **Nouveau devis** crée directement un devis rattaché à ce
client. Depuis un devis, **Choisir dans le répertoire** rattache une fiche existante, et
**Enregistrer ce client** verse dans le répertoire un client saisi à la volée.

Les **notes internes** et le **SIRET du client** ne sont jamais imprimés sur le devis.

Comme au catalogue, une fiche **archivée** disparaît de la sélection sans casser les devis
qui la référencent.

### 3. Catalogue

Une fiche par machine : référence unique, désignation, description, prix HT, taux de TVA,
unité, photo.

La photo s'importe par glisser-déposer ou par sélection de fichier. Elle est
automatiquement réduite à 1200 px de plus grand côté et réencodée en JPEG qualité 0,8
avant stockage — inutile de préparer les images à l'avance.

Une fiche **archivée** disparaît de la sélection sans casser les devis qui l'utilisent.
C'est la bonne façon de retirer une machine du commerce.

### 4. Devis

Créer un devis, renseigner le client, puis ajouter des machines depuis le catalogue ou
des lignes libres. Quantités, remises par ligne, remise globale, acompte et observations
se saisissent directement. Les totaux se recalculent à chaque frappe.

Le panneau d'aperçu à droite montre le document réel, à l'échelle. C'est exactement ce
qui sortira à l'impression : le même moteur de rendu produit les deux.

### La règle du snapshot

Elle vaut pour le catalogue **et** pour le répertoire clients.

**Une ligne de devis copie le libellé, le prix et le taux de TVA au moment où vous
l'insérez. Un devis copie de même les coordonnées du client.** Modifier ensuite la fiche
d'origine ne change rien aux devis déjà établis. C'est voulu : un devis émis ne doit
jamais bouger dans le dos du client — s'il déménage six mois plus tard, un devis
antérieur doit continuer de porter l'adresse à laquelle il a été envoyé.

Quand le devis et la fiche divergent, l'éditeur le signale et propose deux actions
explicites : **Reprendre la fiche**, qui écrase les coordonnées du devis, ou **Mettre à
jour la fiche**, qui reporte celles du devis dans le répertoire. Aucune des deux ne se
déclenche toute seule.

Vous pouvez d'ailleurs modifier le prix directement dans la ligne pour négocier un devis
précis, sans que le catalogue en soit affecté.

Si la fiche d'origine est supprimée, la ligne porte un badge *hors catalogue* et le bloc
client un badge *hors répertoire*. C'est une information, pas une erreur : le devis
conserve intégralement ce qu'il portait au moment de son établissement.

---

## Enregistrer et rouvrir

`Ctrl+S` — ou `Cmd+S` sur Mac — enregistre le document.

**Chaque enregistrement crée une version numérotée** : `devis-2026-0042-v1.devis`,
puis `-v2`, `-v3`. Rien n'est jamais écrasé. L'en-tête affiche en permanence le fichier
que produira le prochain enregistrement.

Rouvrir `devis-2026-0042-v3.devis` reprend la numérotation à `v4` : la série continue,
elle ne recommence pas à `v1`.

L'indicateur en haut à droite signale les **modifications non enregistrées**. Fermer
l'onglet dans cet état déclenche une demande de confirmation du navigateur.

Le travail est aussi sauvegardé automatiquement dans le cache du navigateur, 800 ms après
chaque modification, avec les cinq derniers instantanés conservés pour la reprise après
plantage. Encore une fois : ce n'est pas une sauvegarde.

---

## Imprimer en PDF

Bouton **Imprimer** du panneau d'aperçu, ou `Ctrl+P` depuis l'aperçu.

Dans la boîte de dialogue d'Edge, choisir **Enregistrer au format PDF** comme
destination. Le PDF produit contient du **texte vectoriel sélectionnable**, pas une
image : il reste léger, cherchable et net à l'impression papier.

Laisser les réglages sur A4 portrait et marges par défaut. Le document impose lui-même
sa mise en page.

L'option « Graphiques d'arrière-plan » n'a pas besoin d'être cochée : le document force
l'impression de ses aplats de couleur.

---

## Réglage Edge recommandé

`edge://settings/downloads` → activer **« Toujours me demander ce que je dois faire avec
chaque téléchargement »**.

Dans Chrome, le libellé est **« Demander où enregistrer chaque fichier avant de le
télécharger »**, dans `chrome://settings/downloads`.

Avec ce réglage, `Ctrl+S` ouvre une vraie boîte Enregistrer-sous et vous choisissez le
dossier de destination. Sans lui, les fichiers tombent silencieusement dans le dossier de
téléchargements — l'outil fonctionne quand même, puisque chaque version porte un nom
distinct, mais il faut ensuite déplacer les fichiers à la main.

Le réglage est **par profil de navigateur** : l'activer sur un poste ne le propage pas
aux autres.

> Sur un poste géré par une stratégie d'entreprise, la boîte de dialogue peut être
> désactivée de force. Vérifier dans `edge://policy` la présence de
> `PromptForDownloadLocation`. Si elle y figure, aucun contournement n'existe côté
> application.

---

## Procédure de sauvegarde

L'outil ne sauvegarde rien à votre place et n'a accès à aucun dossier. La discipline
suivante suffit :

1. **Enregistrer après chaque session de travail sérieuse.** `Ctrl+S` coûte deux secondes.
2. **Ranger les `.devis` dans un dossier dédié**, hors du dossier de téléchargements —
   par exemple `Documents\Devis\`.
3. **Sauvegarder ce dossier** comme n'importe quel dossier de travail : copie sur un
   disque externe, synchronisation d'entreprise, ce que le poste autorise.
4. **Conserver les versions.** Un `.devis` d'un devis chargé en photos pèse quelques
   mégaoctets. Garder l'historique complet ne coûte presque rien et sauve les erreurs de
   manipulation.
5. **Ne jamais compter sur le cache du navigateur** pour retrouver un travail de la
   semaine précédente.

---

## Le format `.devis`

Un fichier `.devis` est une **archive ZIP** que vous pouvez ouvrir avec n'importe quel
gestionnaire d'archives, en renommant l'extension en `.zip` si besoin.

```
devis-2026-0042-v3.devis
├── manifest.json     { schemaVersion, appVersion, createdAt, updatedAt }
├── data.json         toutes les données métier, images référencées par nom
└── images/
    ├── img-<uuid>.jpg
    └── logo.png
```

Les images restent des fichiers binaires : `data.json` n'en contient aucune encodée.

Un fichier contient **l'espace de travail complet** — société, clients, catalogue et
devis. Il n'y
a pas de fichier « un seul devis ». Ouvrir un `.devis` remplace intégralement le contenu
en cours ; il n'existe pas de fusion.

`schemaVersion` est vérifié à l'ouverture. Un fichier produit par une version plus
récente de l'application est refusé avec un message explicite plutôt que lu de travers.
Un fichier plus ancien passe par une conversion automatique.

---

## Limitations connues

Elles découlent toutes de l'exécution en `file://`, sans serveur ni installation. Ce sont
des contraintes du navigateur, pas des oublis.

### 1. Pas de numérotation de page automatique

Chromium n'implémente pas les zones de marge `@page` qui permettraient d'imprimer
« page 2 / 5 ». Aucun contournement CSS ne fonctionne réellement.

**Contournement** : la case « En-têtes et pieds de page » de la boîte d'impression d'Edge
ajoute une numérotation gérée par le navigateur. Elle imprime aussi le chemin du fichier,
ce qui est peu élégant sur un document client.

### 2. Pas de sauvegarde sur place

La File System Access API, qui permettrait de réécrire un fichier existant, est
indisponible sur une origine `file://`. Chaque enregistrement est techniquement un
téléchargement — d'où le versionnement automatique, qui transforme la contrainte en
historique utile.

### 3. Polices limitées

Sans réseau ni installation, le document utilise les polices système : Segoe UI, Calibri,
Arial. Pour une typographie propre à l'entreprise, il faut embarquer un fichier `woff2`
encodé en base64 dans un `@font-face` d'un CSS local, avec une police système de repli
cohérente.

### 4. Mono-utilisateur, aucun verrouillage

Aucun mécanisme d'accès concurrent. **Si un `.devis` est posé sur un partage réseau et
que deux personnes travaillent dessus en même temps, le dernier à enregistrer écrase le
travail de l'autre sans avertissement.** Un fichier, une personne.

### 5. Le cache navigateur est volatil

IndexedDB en `file://` partage une origine commune avec tous les autres fichiers HTML
locaux du poste — d'où le préfixe `devisgen_v1` sur le nom de la base. Ce cache est effacé
par un nettoyage des données de site, par la navigation privée, et éventuellement à
chaque fermeture si une stratégie d'entreprise l'impose.

---

## Personnaliser le document

Ouvrir `templates/default/template.css`. Le premier bloc du fichier regroupe une
quinzaine de variables qui couvrent l'essentiel des personnalisations :

```css
.doc-root {
  --accent:            #14425f;   /* couleur d'accent : titres, filets forts */
  --police:            "Segoe UI", "Calibri", system-ui, Arial, sans-serif;
  --corps:             9.4pt;     /* échelle typographique de base */
  --marge-page:        15mm;      /* doit rester synchronisé avec @page */
  --lig-img-largeur:   26mm;      /* largeur des vignettes machine */
  --lig-densite:       2.6mm;     /* densité des lignes */
  --filet-couleur:     #d4dade;
  …
}
```

Deux règles à connaître :

- **La marge de page est définie à deux endroits.** `--marge-page` sert à l'écran,
  `@page { margin: 15mm }` à l'impression. Une variable CSS n'est pas visible depuis
  `@page` — il n'y a pas de contournement. Les modifier ensemble.
- **Ne pas remettre le pied de page en `position: fixed`.** Il se répéterait bien sur
  chaque feuille, mais sans réserver sa place : le contenu s'imprimerait dessous. La
  répétition passe par le `<tfoot>` du tableau porteur, seul mécanisme qui fasse les deux.

Pour créer une variante complète, copier le dossier `templates/default/` sous un autre
nom, changer l'identifiant dans `template.js`, et ajouter les deux balises correspondantes
dans `index.html`. Rien d'autre.

---

## Structure du projet

```
index.html               application
app.css                  vue d'édition uniquement, jamais le document
app/
  ├── 00-namespace.js    App et ses sous-espaces
  ├── 10-db.js           wrapper IndexedDB à base de promesses
  ├── 15-format.js       formatage fr-FR
  ├── 20-schema.js       forme des données, défauts, validation, migrations
  ├── 30-calc.js         moteur de calcul, fonctions pures
  ├── 40-archive.js      lecture/écriture .devis via JSZip
  ├── 45-images.js       redimensionnement au canvas
  ├── 50-store.js        état applicatif, autosave, versionnement
  ├── 60-ui-shell.js     en-tête, navigation, modales, notifications
  ├── 60-ui-societe.js   vue société
  ├── 60-ui-clients.js   répertoire clients
  ├── 60-ui-catalogue.js vue catalogue
  ├── 60-ui-devis.js     vue devis et panneau d'aperçu
  ├── 70-preview.js      montage du rendu, aperçu et impression
  └── 99-boot.js         diagnostic et écran de démarrage
templates/default/
  ├── template.js        App.templates.default.render(model)
  └── template.css       tout porté sous .doc-root, tokens en tête
vendor/
  └── jszip.min.js       à fournir
probe.html               validation de l'architecture sur un poste
tests.html               lanceur de tests
template-lab.html        mise au point du template sur données factices
```

### Ordre de chargement

**L'ordre des balises `<script>` dans `index.html` est significatif.** Il est documenté
en commentaire juste au-dessus, dans le fichier lui-même. Les dépendances réelles :

- `00-namespace` doit être premier ;
- `15-format` avant `20-schema` et `30-calc`, qui l'utilisent ;
- `60-ui-shell` avant les vues, qui s'enregistrent dans `App.ui.vues` ;
- les templates avant `99-boot`, qui vérifie leur présence ;
- `99-boot` en dernier : c'est le seul fichier qui déclenche quelque chose.

L'ordre entre les fichiers `60-ui-*` fixe l'ordre d'affichage dans la navigation.
`60-ui-clients` appelle `UI.creerDevisPour`, exposé par `60-ui-devis` : l'appel a lieu
au clic, l'ordre de chargement entre les deux n'a donc pas d'importance.

Cette liste est répétée à l'identique dans `tests.html` et `template-lab.html`. C'est une
duplication assumée : sans `fetch` ni modules, il n'existe pas de chargeur possible en
`file://`.

### Contraintes d'écriture

Le code respecte des contraintes qui ne sont pas négociables sur ce poste :

- JavaScript vanilla ES2020, scripts classiques, aucun module ES ;
- aucune étape de compilation, aucun gestionnaire de paquets ;
- aucune ressource chargée depuis un CDN ;
- aucune image référencée par chemin relatif — elles contamineraient le canvas en
  `file://` et rendraient `toDataURL()` inutilisable ; tout passe par des `Blob` et des
  URL `blob:` ;
- `localStorage` interdit pour les données métier : quota trop faible, origine partagée ;
- pas de rasterisation type `html2canvas` : le PDF doit contenir du vrai texte.

---

## Outils de mise au point

### `probe.html`

Valide l'architecture sur un poste donné : disponibilité d'IndexedDB, aller-retour d'un
`Blob`, dessin dans un canvas suivi d'un `toDataURL()` réussi, téléchargement,
`crypto.randomUUID()`, quota de stockage, impression des aplats de couleur.

À lancer en premier sur tout nouveau poste. Le verdict en haut de page indique si
l'architecture tient.

### `tests.html`

Lanceur de tests maison — aucun framework n'est installable. Couvre les arrondis, la TVA
multi-taux, la ventilation de la remise globale, l'acompte, la validation du schéma, la
règle du snapshot, l'aller-retour d'archive et la persistance des `Blob`.

Bilan vert en haut de page si tout passe. Les tests d'archive sont ignorés tant que
`vendor/jszip.min.js` est absent.

### `template-lab.html`

Monte le template sur un jeu de données factices réaliste — douze machines avec photos,
plusieurs taux de TVA, remise globale, acompte, description longue, débordement sur
plusieurs pages — sans dépendre du reste de l'application.

C'est là qu'on met la présentation au point sans avoir à saisir un vrai devis. Les
options de la barre supérieure permettent de faire varier le nombre de lignes, les photos
et le logo.

---

## Dépannage

**« JSZip est introuvable » au démarrage**
Le fichier `vendor/jszip.min.js` est absent, mal nommé, ou c'est un build ESM. Voir
[Installation](#installation).

**Une page blanche s'imprime avant le document**
Un conteneur de la vue d'édition survit à l'impression avec une hauteur non nulle. Vérifier
que la règle `display: none !important` du bloc `@media print` de `app.css` couvre bien
tous les conteneurs concernés, `.app` compris.

**Le pied de page s'imprime par-dessus le contenu**
Le pied a été remis en `position: fixed`. Cette technique répète le bloc mais ne lui
réserve aucune place. Revenir au `<tfoot>` du tableau porteur.

**Les photos n'apparaissent pas dans le PDF**
Les URL `blob:` ont été révoquées trop tôt. L'impression attend le chargement effectif des
images et ne nettoie qu'après ; si le problème revient, allonger le délai dans
`70-preview.js`.

**« Aucune session à reprendre » alors que du travail était en cours**
Le cache du navigateur a été effacé — nettoyage des données de site, navigation privée, ou
stratégie d'entreprise. Rouvrir le dernier `.devis` enregistré. C'est précisément le cas
que la [procédure de sauvegarde](#procédure-de-sauvegarde) sert à rendre indolore.

**Chaque enregistrement produit un fichier `(1)`, `(2)`**
Le nom versionné n'a pas été repris à l'ouverture, ou le même fichier est enregistré deux
fois de suite. Sans conséquence : la version la plus récente est toujours celle au numéro
`-vN` le plus élevé.

**Les totaux semblent faux d'un centime**
Le calcul suit la convention comptable française : chaque ligne est arrondie
individuellement, puis les lignes sont sommées. Sommer avant d'arrondir donne un résultat
différent — et faux. La remise globale est ventilée au prorata sur chaque taux de TVA, le
résidu d'arrondi étant absorbé par la plus grosse base.

---

## Licence et état

Prototype fonctionnel, version `0.1.0-poc`. Usage interne.
