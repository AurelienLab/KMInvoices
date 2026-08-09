# Plan — système de mise à jour depuis l'interface

**État : phase 1 faite, phase 2 en attente d'un test terrain.**

| | |
|---|---|
| Phase 1 — livrable en fichier unique | fait, `outils/build.py` |
| Prérequis phase 2 — test d'accès réseau | outillé dans `probe.html`, **à lancer sur le poste cible** |
| Phase 2 — vérification de version | non commencée, et conditionnée au résultat ci-dessus |

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

**Restant à valider dans un navigateur** — ces deux points ne peuvent pas être vérifiés
autrement :

- [ ] `tests.html` toujours au vert sur les sources.
- [ ] Le fichier unique produit un devis rigoureusement identique à celui des sources —
      comparer deux PDF sur le même jeu de données.

---

## Phase 2 — Vérification de version, optionnelle

Utile seulement si le poste a un accès réseau. À ne construire qu'après la phase 1.

### Prérequis à valider avant d'écrire quoi que ce soit

**Le test est en place dans `probe.html`** — bouton « Tester l'accès réseau » : un
`fetch()` depuis `file://` vers `raw.githubusercontent.com`.

Il n'est **jamais déclenché automatiquement**. L'outil promet qu'aucune donnée ne sort du
poste ; émettre une requête au chargement d'une page de diagnostic contredirait cette
promesse dans les faits, même sans rien transmettre. La requête reste un acte volontaire.

La requête part avec `Origin: null`. GitHub répond `Access-Control-Allow-Origin: *`, ce
qui devrait suffire à Chromium — mais cela reste à confirmer **sur le poste cible**, où un
proxy d'entreprise ou une stratégie peuvent tout changer. Si ce test échoue, la phase 2
s'arrête là et la phase 1 se suffit à elle-même.

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

Restent ouvertes, et sans objet tant que le test réseau n'a pas été lancé sur le poste :

1. **Le dépôt reste-t-il public ?** La phase 2 lit une URL publique. Un dépôt privé
   imposerait un jeton, donc un secret dans un fichier lisible par tous — inacceptable.
   Dans ce cas, publier le `version.json` ailleurs, ou renoncer à la phase 2.
3. **Le poste cible a-t-il un accès réseau ?** Si non, la phase 2 est sans objet.
4. **Où sont publiées les versions ?** Releases GitHub, partage réseau interne, autre.

## Critères d'acceptation

Phase 1 :

- [x] L'ordre de concaténation est dérivé de `index.html`, pas redéclaré.
- [ ] `outils/build.py` produit un `KMInvoices.html` qui s'ouvre par double-clic et se
      comporte comme les sources. *(à confirmer dans Edge)*
- [ ] Le PDF produit par le fichier unique est identique à celui des sources sur un même
      devis. *(à confirmer dans Edge)*

Phase 2, si elle voit le jour :

- [ ] Hors ligne, l'application ne montre aucun message lié à la mise à jour.
- [ ] Aucune vérification de version ne peut faire perdre du travail non enregistré.
