# Plan — système de mise à jour depuis l'interface

**État : implémenté.** Les deux phases sont en place et validées sur le poste cible.

| | |
|---|---|
| Phase 1 — livrable en fichier unique | fait, `outils/build.py` |
| Prérequis phase 2 — test d'accès réseau | **OK sur le poste cible**, `probe.html` |
| Phase 2 — vérification de version | fait, `app/80-maj.js` |

Ce document reste le lieu où sont consignés les arbitrages. Il n'y a plus rien à
construire : publier une version, c'est faire évoluer `App.version` et pousser sur `main`.

## Publication automatisée

`.github/workflows/livrable.yml` — ajouté après coup, et qui change la nature du risque.

Le cadrage initial listait une procédure manuelle en quatre étapes dont deux ne devaient
jamais être inversées. Une procédure de ce genre finit toujours par être exécutée de
travers un vendredi soir. Le workflow la tient à notre place :

- **Ce qui déclenche une publication, c'est le changement de `App.version`**, pas le push.
  Si `v<version>` existe déjà, le workflow construit, vérifie, et s'arrête. Sans quoi la
  moindre correction de typo dans le README couperait une release.
- **Release d'abord, `version.json` ensuite**, puis contrôle que l'URL annoncée répond
  `200`. Un manifeste qui pointe une URL morte envoie tout le parc sur un bouton
  « Mettre à jour » qui ne mène nulle part : c'est le pire échec possible du dispositif,
  et il échoue désormais bruyamment dans la CI plutôt que silencieusement sur les postes.
- **`outils/verifier.py` garde le livrable.** Le build ne peut pas se contrôler lui-même :
  un `</script>` mal échappé ou une balise oubliée produisent un fichier qui se télécharge
  très bien et ne s'ouvre pas. Le vérificateur est testé contre trois cassures réelles —
  référence locale réintroduite, version divergente, `</script>` littéral — et les
  attrape toutes.
- **Chaque pull request produit un livrable téléchargeable.** C'est ce qui permet
  d'essayer un fichier unique avant de le publier, sans rien graver.
- **Le tag git n'existe pas comme source.** Il est créé par `gh release create`, sur le
  commit poussé. Poser un tag à la main introduirait une seconde vérité qui divergerait
  de `App.version` — et rien, dans le fichier livré, ne dit d'où vient le tag.

  Un cas mérite le détour : **tag présent, release absente**, ce qui arrive dès qu'on
  supprime une release à la main. `gh release create` réutilise alors le tag existant et
  ignore `--target` : on obtiendrait une release dont les fichiers ne correspondent pas
  au commit tagué. Le workflow détecte ce cas et échoue avec la commande de suppression
  du tag, plutôt que de publier un mensonge.

Limite connue : le workflow pousse un commit sur `main`. Une protection de branche qui
l'interdirait bloquerait cette seule étape — la release, elle, serait déjà faite.

---

## Le problème

Mettre à jour l'outil aujourd'hui veut dire écraser 26 fichiers répartis dans quatre
dossiers, sur un poste où l'utilisateur n'a ni git, ni droits d'installation, ni ligne de
commande. Personne ne fera cette manipulation correctement deux fois de suite.

## Le mur technique

**Une page en `file://` ne peut pas écrire sur le disque.** La File System Access API est
indisponible sur une origine opaque — c'est la [limitation n° 2 du
README](../README.md#2-pas-de-sauvegarde-sur-place), celle qui impose déjà de passer par
un téléchargement à chaque enregistrement.

**L'application ne pourra donc jamais remplacer ses propres fichiers.** Aucun
contournement n'existe. Toute solution se termine par une action manuelle de
l'utilisateur. Le seul levier réel est de rendre cette action triviale.

## Ce qui est possible, ce qui ne l'est pas

| Étape | Faisable | Mécanisme |
|---|---|---|
| Connaître la version installée | oui | `App.version` |
| Interroger une version distante | à valider | `fetch()` vers `raw.githubusercontent.com` |
| Comparer et prévenir l'utilisateur | oui | comparaison sémantique de versions |
| Télécharger la nouvelle version | oui | `fetch()` → `Blob` → `<a download>` |
| Sauvegarder les données avant | oui | export `.devis` existant |
| **Écrire le fichier à sa place** | **non** | aucun mécanisme en `file://` |
| Redémarrer sur la nouvelle version | oui | `location.reload()` après copie manuelle |

---

## Phase 1 — Livrable en fichier unique — FAIT

**C'est la phase qui a de la valeur.** Elle ne demande aucun réseau et résout l'essentiel
du problème : mettre à jour devient « glisser un fichier par-dessus un autre ».

### Ce qui a été construit

`outils/build.py` → `dist/KMInvoices.html`. Réponses aux points laissés ouverts :

- **Version : source unique = `App.version` dans `app/00-namespace.js`.** Le build la
  *lit* pour estampiller le livrable, il ne l'*injecte* pas. Une injection aurait supposé
  une seconde déclaration ailleurs — exactement la divergence qu'on voulait éviter.
- **Mode d'exécution : `window.__KMI_BUILD__`**, une bannière générée insérée avant
  `00-namespace.js`, qui la relit en `App.build`. Absente sur les sources éclatées.
  C'est ce drapeau qui distingue les deux distributions au démarrage.
- **JSZip : contrôle de sanité.** `40-archive.js` et `99-boot.js` branchent sur
  `App.build.fichierUnique`. Sur les sources, le message d'installation est inchangé.
  Dans le fichier unique, l'absence de JSZip ne peut plus venir d'un fichier oublié mais
  d'un fichier tronqué : le message le dit, et devient bloquant.
- **Garde-fou d'autonomie.** Le build refuse de produire quoi que ce soit s'il reste dans
  `index.html` une référence locale (`href`, `src`) qu'il n'a pas inlinée. Un futur
  `<img src>` ou une balise écrite autrement fera échouer le build au lieu de produire un
  livrable amputé en silence.
- **`dist/` est ignoré par git.** Artefact généré ; les versions publiées vivent ailleurs.
- **Poids réel : 330 Ko**, pas 250. L'estimation datait d'avant la croissance des vues.

### Principe

Un script de packaging, exécuté **sur le poste de développement**, produit un
`KMInvoices.html` autonome contenant tout le CSS, tout le JavaScript et JSZip inlinés.

La contrainte « aucune étape de build » vise le poste cible : il doit exécuter le livrable
tel quel. Un script qui tourne côté développement ne la viole pas. Mais il faut assumer
la conséquence : **le livrable devient un artefact généré**, distinct des sources.

### Le script

- Langage : Python 3 ou Node, disponibles sur le poste de développement. Aucune
  dépendance.
- Emplacement proposé : `outils/build.py`.
- **Il doit dériver l'ordre de concaténation en lisant les balises `<script src>` et
  `<link href>` de `index.html`**, jamais le redupliquer. L'ordre de chargement est déjà
  documenté à trois endroits (`index.html`, `tests.html`, `template-lab.html`) ; une
  quatrième copie divergerait tôt ou tard.

### Pièges identifiés

- **`</script>` littéral dans une chaîne JavaScript** couperait le HTML. Aucun cas
  aujourd'hui, mais le script doit échapper en `<\/script>` par principe.
- **Le CSS des templates est porté sous `.doc-root`** — l'inliner ne change rien, mais
  l'ordre entre `app.css` et `template.css` doit être préservé.
- **La détection de JSZip devient sans objet** : la bibliothèque est toujours présente
  dans le fichier unique. Le message d'absence doit disparaître du diagnostic de
  démarrage, ou devenir un simple contrôle de sanité.
- **`App.version` doit être injecté par le build** depuis une source unique, sinon la
  version affichée et la version réelle divergeront.
- **`probe.html`, `tests.html` et `template-lab.html` restent en fichiers séparés.** Ce
  sont des outils de mise au point, ils travaillent sur les sources.

### Vérification

Automatisée, faite :

- les 18 blocs `<script>` du fichier produit passent `node --check` ;
- aucune référence locale ne subsiste dans le livrable ;
- la bannière de build précède bien `00-namespace.js`.

Validé dans Edge **sur le poste cible**, le 2026-08-09 :

- [x] `tests.html` au vert sur les sources.
- [x] Le fichier unique produit un devis rigoureusement identique à celui des sources.
- [x] `probe.html` : verdict GO, aucun test bloquant en échec.

---

## Phase 2 — Vérification de version — FAIT

Utile seulement si le poste a un accès réseau. À ne construire qu'après la phase 1.

### Prérequis — validé

**Le test est en place dans `probe.html`** — bouton « Tester l'accès réseau » : un
`fetch()` depuis `file://` vers `raw.githubusercontent.com`.

Il n'est **jamais déclenché automatiquement**. L'outil promet qu'aucune donnée ne sort du
poste ; émettre une requête au chargement d'une page de diagnostic contredirait cette
promesse dans les faits, même sans rien transmettre. La requête reste un acte volontaire.

La requête part avec `Origin: null`. GitHub répond `Access-Control-Allow-Origin: *`, ce
qui suffit à Chromium.

**Résultat sur le poste cible, le 2026-08-09 : OK.** La phase 2 est donc construite.
Le test reste dans `probe.html` : c'est lui qu'on relance le jour où le bandeau cesse
d'apparaître, ou sur un nouveau poste.

### Fonctionnement

1. Au démarrage, si le réseau répond, lire un `version.json` publié sur le dépôt :

   ```json
   {
     "version": "0.2.0",
     "date": "2026-09-14",
     "url": "https://github.com/AurelienLab/KMInvoices/releases/download/v0.2.0/KMInvoices.html",
     "schemaVersion": 1,
     "notes": "Répertoire clients, corrections d'impression."
   }
   ```

2. Comparer à `App.version`. Si une version plus récente existe, afficher un bandeau
   **discret** — jamais une fenêtre modale, jamais au milieu d'une saisie.

3. Vérifier la compatibilité : une `schemaVersion` distante supérieure signifie que les
   fichiers produits par la nouvelle version ne seront plus lisibles par l'ancienne. Le
   dire explicitement.

4. **Forcer un enregistrement `.devis` avant de proposer le téléchargement.** Non
   négociable : c'est le seul moment où l'on est certain que l'utilisateur a une
   sauvegarde.

5. Télécharger le fichier, puis afficher la consigne de remplacement et un bouton
   « J'ai remplacé le fichier — recharger ».

### Règles de comportement

- **Aucun réseau : aucun message.** L'outil doit rester parfaitement silencieux hors
  ligne, c'est son mode de fonctionnement normal, pas une anomalie.
- **Aucun blocage.** Une version périmée n'empêche jamais de travailler.
- **Aucune télémétrie.** La requête est une lecture de fichier statique, rien n'est
  envoyé. À écrire noir sur blanc dans le README : sur ce poste, la promesse « aucune
  donnée ne sort » est un engagement.
- Une préférence permet de désactiver la vérification. Elle peut vivre dans
  `localStorage` : c'est un réglage d'interface, pas une donnée métier.

### Ce qui a été construit

`app/80-maj.js`, chargé après `70-preview`, appelé par `99-boot` **après** le montage de
la coquille — jamais sur l'écran d'accueil, jamais au milieu d'une saisie. Le bandeau
s'insère entre l'en-tête et le corps, en `--ui-accent-pale`, sans couleur d'alerte : une
version périmée n'est pas un incident.

Points qui ont demandé un arbitrage :

- **Deux hôtes, deux niveaux de confiance.** Le `version.json` est lu sur
  `raw.githubusercontent.com` — le seul hôte dont le CORS a été vérifié depuis une origine
  opaque. L'hôte des *releases*, lui, redirige et n'offre aucune garantie : le
  téléchargement tente un `fetch` puis **retombe sur `window.open(url)`** si la lecture
  cross-origin est refusée. Le navigateur fait alors le travail, et l'utilisateur ne voit
  pas la différence.
- **Ordre de publication.** Le `version.json` de `main` est ce que lisent tous les postes.
  Publié avant la release, il les envoie vers une URL morte. Cette faute n'est plus
  possible à la main : `.github/workflows/livrable.yml` tient l'ordre, et vérifie que
  l'URL annoncée répond `200` avant de considérer la publication réussie.
- **Toute réponse douteuse est traitée comme une absence de réponse.** JSON illisible,
  `url` non `https`, version hors format `X.Y.Z[-pre]` : `M.interroger` renvoie `null` et
  personne n'est prévenu. Un manifeste corrompu ne doit pas produire un bandeau bancal.
- **Comparaison de versions : égalité en cas de doute.** `comparerVersions` renvoie `0`
  dès qu'une des deux versions est illisible. Renvoyer `-1` par défaut aurait proposé une
  mise à jour vers n'importe quoi. Un test vérifie que `App.version` elle-même reste
  lisible par le comparateur — sinon la vérification serait silencieusement morte.
- **Sauvegarde forcée : seulement si `estModifie()`.** Quand le document n'est pas
  modifié, `lastExportedAt >= lastModifiedAt` : un `.devis` existe déjà, c'est la
  certitude qu'on cherchait. Forcer un export de plus n'aurait ajouté qu'un fichier.
- **Sources éclatées : pas de bouton.** Le bandeau apparaît, mais sans téléchargement —
  il n'y a pas de fichier unique à remplacer, et le poste de développement sait quoi
  faire. La distinction passe par `App.build.fichierUnique`.
- **`localStorage`, seul endroit du projet où il est utilisé.** Réglage d'interface. Sa
  perte réactive simplement la vérification, ce qui est le bon comportement par défaut.

### Vérification

- [x] Comparaison de versions : 19 cas dans `tests.html`, groupe « Vérification de
      version ». Aucun test n'émet de requête réseau.
- [x] Hors ligne, aucun message : toute erreur de `M.interroger` est avalée, seul un
      `console.debug` subsiste.
- [ ] Bandeau, sauvegarde forcée et téléchargement : **à valider à la main** après la
      première publication réelle d'un `version.json`. Ils ne peuvent pas l'être avant.

---

## Écarté : charger le code applicatif depuis IndexedDB

L'idée : réduire `index.html` à un amorceur qui lit le code de l'application dans
IndexedDB et l'exécute. La mise à jour se ferait par `<input type="file">`, sans réseau ni
écriture disque — élégant sur le papier, et techniquement fonctionnel.

**Rejeté** : le code de l'application vivrait alors dans un cache que le poste peut
effacer à la fermeture d'Edge, comme documenté dans la [limitation n°
5](../README.md#5-le-cache-navigateur-est-volatil). L'outil disparaîtrait de lui-même.

Un repli sur le code embarqué dans le dossier annulerait tout le bénéfice, en doublant la
complexité.

---

## Décisions

2. **Le fichier unique remplace-t-il les sources éclatées ? — TRANCHÉ : les deux
   coexistent.** Le fichier unique est le livrable, les sources sont l'environnement de
   développement. Ce sont bien deux chemins à tester, mais le second ne peut pas
   disparaître : `tests.html` et `template-lab.html` travaillent dessus. Le drapeau
   `App.build.fichierUnique` rend la différence explicite partout où elle compte.

1. **Le dépôt reste-t-il public ? — TRANCHÉ : oui.** Aucun jeton n'est donc embarqué nulle
   part. Passer le dépôt en privé casserait la vérification de version : il faudrait
   republier le `version.json` sur un hôte public, ou renoncer à la phase 2. À ne pas
   faire sans y penser.
3. **Le poste cible a-t-il un accès réseau ? — TRANCHÉ : oui**, vérifié le 2026-08-09.
4. **Où sont publiées les versions ? — TRANCHÉ : releases GitHub**, dépôt
   `AurelienLab/KMInvoices`. Le manifeste `version.json` vit à la racine de `main`, le
   livrable est une pièce jointe de release. Procédure dans le README.

## Critères d'acceptation

Phase 1 — remplis, validés sur le poste cible :

- [x] L'ordre de concaténation est dérivé de `index.html`, pas redéclaré.
- [x] `outils/build.py` produit un `KMInvoices.html` qui s'ouvre par double-clic et se
      comporte comme les sources.
- [x] Le PDF produit par le fichier unique est identique à celui des sources sur un même
      devis.

Phase 2 :

- [x] Hors ligne, l'application ne montre aucun message lié à la mise à jour.
- [x] Aucune vérification de version ne peut faire perdre du travail non enregistré —
      `assurerSauvegarde()` précède le téléchargement, et son échec l'interrompt.
- [ ] Le bandeau apparaît réellement face à un `version.json` publié. *(première
      publication)*
