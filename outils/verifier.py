#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verifier.py — contrôle le livrable produit par build.py.

    python3 outils/verifier.py [chemin]

Ce que ce script NE FAIT PAS : ouvrir un navigateur. Le comportement réel de
l'application — `tests.html` au vert, un PDF identique à celui des sources —
ne se vérifie que dans Edge, à la main. Voir docs/plan-mise-a-jour.md.

Ce qu'il attrape, et qui justifie qu'il existe : les régressions du build
lui-même. Un `</script>` littéral qui coupe le fichier en deux, une balise
oubliée qui laisse une référence vers un fichier voisin absent, une version
qui diverge de sa source. Autant de cassures invisibles sur les sources
éclatées, et fatales dans le fichier unique.

Sort en code 1 au premier échec. Node est requis pour l'analyse syntaxique.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DEFAUT = RACINE / 'dist' / 'KMInvoices.html'
NAMESPACE = RACINE / 'app' / '00-namespace.js'

RE_BLOC = re.compile(r'<script>(.*?)</script>', re.S)
RE_LOCALE = re.compile(r'<(?:link|script|img)[^>]*\s(?:href|src)="(?!https?:|data:|#)([^"]+)"')

echecs = []


def controle(nom, ok, detail=''):
    print(('  OK   ' if ok else '  ÉCHEC ') + nom + (' — ' + detail if detail else ''))
    if not ok:
        echecs.append(nom)
    return ok


def afficher(chemin: Path) -> str:
    """Chemin lisible, sans supposer qu'il vit dans le dépôt : le script
    accepte n'importe quelle cible en argument."""
    try:
        return str(chemin.relative_to(RACINE))
    except ValueError:
        return str(chemin)


def verifier(chemin: Path) -> int:
    echecs.clear()
    if not chemin.is_file():
        print(f'ERREUR — livrable introuvable : {chemin}\nLancer d\'abord outils/build.py.')
        return 1

    html = chemin.read_text(encoding='utf-8')
    print(f'{afficher(chemin)} — {len(html.encode("utf-8")) / 1024:.0f} Ko\n')

    # 1. Autonomie. Une seule référence locale suffit à casser le livrable sur
    #    un poste où le dossier des sources n'existe pas.
    #    Le contrôle porte sur le squelette HTML seul : le code inliné contient
    #    des commentaires qui citent des balises à titre d'exemple.
    squelette = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', '', html, flags=re.S)
    locales = RE_LOCALE.findall(squelette)
    controle('aucune référence à un fichier voisin', not locales, ', '.join(locales))

    # 2. Intégrité du découpage. Un `</script>` mal échappé fait que le
    #    navigateur ferme la balise trop tôt : le HTML restant devient du texte.
    blocs = RE_BLOC.findall(html)
    controle('les blocs <script> se referment tous',
             len(blocs) == html.count('</script>'),
             f'{len(blocs)} blocs pour {html.count("</script>")} fermetures')

    # 3. Syntaxe. La concaténation peut produire du code invalide là où chaque
    #    fichier était valide isolément.
    if shutil.which('node'):
        mauvais = []
        for i, bloc in enumerate(blocs):
            f = Path(tempfile.mkstemp(suffix='.js')[1])
            f.write_text(bloc, encoding='utf-8')
            r = subprocess.run(['node', '--check', str(f)], capture_output=True, text=True)
            if r.returncode:
                mauvais.append(f'bloc {i} : ' + r.stderr.strip().splitlines()[0])
            f.unlink()
        controle(f'les {len(blocs)} blocs JavaScript sont syntaxiquement valides',
                 not mauvais, ' | '.join(mauvais))
    else:
        print('  PASSÉ  analyse syntaxique — node absent')

    # 4. Ordre. La bannière renseigne App.build, que 00-namespace.js lit : si
    #    elle arrive après, le livrable se croit être des sources éclatées.
    i_ban = html.find('__KMI_BUILD__')
    i_ns = html.find('00-namespace.js =====')
    controle('la bannière de build précède 00-namespace.js',
             0 <= i_ban < i_ns)

    # 5. Version. Deux valeurs différentes veulent dire que l'outil affiche une
    #    version qu'il n'exécute pas — et que la vérification de version ment.
    src = re.search(r"App\.version\s*=\s*'([^']+)'", NAMESPACE.read_text(encoding='utf-8'))
    ban = re.search(r'"version"\s*:\s*"([^"]+)"', html)
    controle('la version du livrable est celle des sources',
             bool(src and ban) and src.group(1) == ban.group(1),
             f'sources {src.group(1) if src else "?"} / livrable {ban.group(1) if ban else "?"}')

    # 6. JSZip. Son absence ne se voit qu'au moment d'ouvrir un .devis, donc
    #    trop tard.
    controle('JSZip est inliné', 'jszip.min.js =====' in html and 'JSZip' in html)

    print()
    if echecs:
        print(f'ÉCHEC — {len(echecs)} contrôle(s) : ' + ', '.join(echecs))
        return 1
    print('OK — le livrable est autonome et cohérent avec les sources.')
    print('Reste à valider dans Edge : tests.html au vert, PDF identique aux sources.')
    return 0


if __name__ == '__main__':
    cible = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAUT
    sys.exit(verifier(cible))
