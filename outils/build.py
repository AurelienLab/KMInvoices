#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — produit le livrable en fichier unique.

    python3 outils/build.py

Concatène tout le CSS et tout le JavaScript de `index.html` dans un seul
`dist/KMInvoices.html`, autonome, ouvrable par double-clic. Mettre l'outil à
jour sur le poste cible revient alors à glisser un fichier par-dessus un autre.

CE SCRIPT NE TOURNE QUE SUR LE POSTE DE DÉVELOPPEMENT. La contrainte « aucune
étape de build » porte sur le poste cible : il exécute le livrable tel quel.

L'ordre de concaténation est DÉRIVÉ de `index.html`, jamais redéclaré ici :
les balises `<link rel=stylesheet>` et `<script src>` sont remplacées sur
place, dans leur ordre d'apparition. Ajouter un fichier à l'application ne
demande donc aucune modification de ce script.

`probe.html`, `tests.html` et `template-lab.html` restent des fichiers
séparés : ce sont des outils de mise au point, ils travaillent sur les sources.

Aucune dépendance hors bibliothèque standard.
"""

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / 'index.html'
SORTIE = RACINE / 'dist' / 'KMInvoices.html'
NAMESPACE = RACINE / 'app' / '00-namespace.js'

# Les deux seules formes de référence externe utilisées par index.html.
# Volontairement strictes : une balise écrite autrement doit faire échouer le
# build plutôt que produire un livrable amputé sans le dire.
RE_CSS = re.compile(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>')
RE_JS = re.compile(r'<script\s+src="([^"]+)"\s*>\s*</script>')

# Toute autre référence à une ressource locale signalerait un fichier oublié.
RE_SUSPECT = re.compile(r'(?:<link[^>]*\shref=|<script[^>]*\ssrc=|<img[^>]*\ssrc=)"(?!https?:|data:)([^"]+)"')


def lire(chemin: Path) -> str:
    if not chemin.is_file():
        raise SystemExit(f'ERREUR — fichier référencé introuvable : {chemin}')
    return chemin.read_text(encoding='utf-8')


def version_source() -> str:
    """La version vit dans 00-namespace.js et nulle part ailleurs.

    Le build la lit pour estampiller le livrable ; il ne la réécrit pas. Une
    seconde déclaration divergerait tôt ou tard de celle qu'affiche l'outil.
    """
    m = re.search(r"App\.version\s*=\s*'([^']+)'", lire(NAMESPACE))
    if not m:
        raise SystemExit(f'ERREUR — App.version introuvable dans {NAMESPACE}')
    return m.group(1)


def neutraliser_fermeture(contenu: str, balise: str) -> str:
    """Empêche une fermeture littérale dans une chaîne de couper le HTML.

    Aucun cas aujourd'hui dans les sources, mais un `'</script>'` écrit un jour
    dans une chaîne JavaScript casserait le livrable sans casser les sources —
    donc sans que rien ne le signale avant l'ouverture du fichier produit.
    """
    return re.compile(r'</\s*' + balise, re.I).sub(r'<\\/' + balise, contenu)


def inliner(html: str, banniere: str) -> str:
    injecte = {'fait': False}

    def css(m):
        chemin = m.group(1)
        contenu = neutraliser_fermeture(lire(RACINE / chemin), 'style')
        return f'<style>\n/* ===== {chemin} ===== */\n{contenu}\n</style>'

    def js(m):
        chemin = m.group(1)
        contenu = neutraliser_fermeture(lire(RACINE / chemin), 'script')
        bloc = f'<script>\n/* ===== {chemin} ===== */\n{contenu}\n</script>'
        # La bannière doit précéder 00-namespace.js, qui la lit.
        if not injecte['fait']:
            injecte['fait'] = True
            bloc = banniere + '\n\n' + bloc
        return bloc

    return RE_JS.sub(js, RE_CSS.sub(css, html))


def construire(sortie: Path) -> Path:
    html = lire(SOURCE)
    version = version_source()
    date = datetime.datetime.now().astimezone().isoformat(timespec='seconds')

    css = RE_CSS.findall(html)
    js = RE_JS.findall(html)
    if not css or not js:
        raise SystemExit('ERREUR — aucune balise à inliner dans index.html : '
                         'la forme des balises a changé, revoir RE_CSS / RE_JS.')

    marqueur = json.dumps({'fichierUnique': True, 'version': version, 'date': date},
                          ensure_ascii=False)
    banniere = f'<script>window.__KMI_BUILD__ = {marqueur};</script>'

    # Controle sur la SOURCE, pas sur le produit : le produit contient le code
    # applicatif, dont les commentaires citent des balises a titre d'exemple.
    oublies = [c for c in RE_SUSPECT.findall(html)
               if not c.startswith('#') and c not in css and c not in js]
    if oublies:
        raise SystemExit('ERREUR — références locales non inlinées, le livrable '
                         'ne serait pas autonome : ' + ', '.join(oublies))

    produit = inliner(html, banniere)

    entete = (f'<!-- KMInvoices {version} — livrable en fichier unique.\n'
              f'     Généré par outils/build.py le {date}.\n'
              f'     ARTEFACT GÉNÉRÉ : ne pas modifier ici. Éditer les sources, '
              f'puis relancer le build. -->')
    produit = produit.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + entete, 1)

    sortie.parent.mkdir(parents=True, exist_ok=True)
    sortie.write_text(produit, encoding='utf-8')

    print(f'{sortie.relative_to(RACINE)} — {len(produit.encode("utf-8")) / 1024:.0f} Ko')
    print(f'  version {version}')
    print(f'  {len(css)} feuille(s) de style, {len(js)} script(s) inlinés :')
    for chemin in css + js:
        print(f'    {chemin}')
    return sortie


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('-o', '--sortie', type=Path, default=SORTIE,
                    help=f'chemin du fichier produit (défaut : {SORTIE.relative_to(RACINE)})')
    args = ap.parse_args()
    construire(args.sortie.resolve())
    return 0


if __name__ == '__main__':
    sys.exit(main())
