# -*- coding: utf-8 -*-
"""Compila o Concrestats com uma edicao JA' DENTRO dele.

Sem isto, entregar a versao da Usinop exigia colocar um edicao.json na pasta
do programa - um passo manual, feito por outra pessoa, num computador que nao
e' o nosso, e que falha calado: arquivo na pasta errada e o app abre normal,
com a aba que era para estar escondida.

Aqui a edicao vai para dentro do bundle na hora de compilar. Quem recebe so'
baixa e abre.

    python tools/build_edicao.py usinop
    python tools/build_edicao.py painel-unico --saida _entrega_teste

O build normal (source/dist) nao e' tocado: sai numa pasta propria.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTE = os.path.join(RAIZ, "source")
EDICOES = os.path.join(RAIZ, "edicoes")
EMBUTIDA = os.path.join(FONTE, "edicao_embutida.json")


def _python():
    venv = os.path.join(FONTE, ".venv", "Scripts", "python.exe")
    return venv if os.path.isfile(venv) else sys.executable


def conferir(pasta, esperado):
    """Abre a edicao pela MESMA funcao que o programa usa.

    Conferir so' se o arquivo existe nao provaria nada: ele pode estar no
    lugar errado do bundle, ou com um nome que resource_path() nao procura. O
    que interessa e' o que o app le' quando abre - entao e' isso que se mede,
    fingindo ser o executavel que acabou de sair.
    """
    interno = os.path.join(pasta, "_internal")
    sys.path.insert(0, FONTE)
    os.environ.setdefault("CONCRESTATS_WEB", "0")
    os.environ.setdefault("CONCRE_NO_WINDOW", "1")
    frozen, meipass, executavel = (
        getattr(sys, "frozen", None), getattr(sys, "_MEIPASS", None), sys.executable)
    try:
        sys.frozen = True                      # noqa: SLF001
        sys._MEIPASS = interno                 # noqa: SLF001
        sys.executable = os.path.join(pasta, "Concrestats.exe")
        for mod in ("app",):
            sys.modules.pop(mod, None)
        import app                             # noqa: PLC0415
        lido = app.edicao()
    finally:
        if frozen is None:
            if hasattr(sys, "frozen"):
                del sys.frozen
        else:
            sys.frozen = frozen
        if meipass is None:
            if hasattr(sys, "_MEIPASS"):
                del sys._MEIPASS
        else:
            sys._MEIPASS = meipass
        sys.executable = executavel

    if lido.get("nome") != esperado.get("nome") or \
       sorted(lido.get("ocultar") or []) != sorted(
           str(x).strip().lower() for x in (esperado.get("ocultar") or [])):
        return False, f"o programa leria {lido}, esperado {esperado}"
    return True, f"o programa le': {json.dumps(lido, ensure_ascii=False)}"


def main():
    ap = argparse.ArgumentParser(description="Compila com a edicao embutida")
    ap.add_argument("edicao", help="nome do arquivo em edicoes/ (sem .json)")
    ap.add_argument("--saida", default=None,
                    help="pasta de entrega (padrao: _entrega_<edicao>)")
    a = ap.parse_args()

    origem = os.path.join(EDICOES, a.edicao + ".json")
    if not os.path.isfile(origem):
        print("Nao achei " + origem)
        print("Edicoes disponiveis: " + ", ".join(
            sorted(f[:-5] for f in os.listdir(EDICOES) if f.endswith(".json"))))
        return 1
    with open(origem, encoding="utf-8") as fh:
        cfg = json.load(fh)

    saida = os.path.join(RAIZ, a.saida or ("_entrega_" + a.edicao.replace("-", "_")))
    dist = os.path.join(FONTE, "build_edicao", "dist")
    work = os.path.join(FONTE, "build_edicao", "work")

    shutil.copyfile(origem, EMBUTIDA)
    try:
        print("Compilando com a edicao '%s' dentro..." % cfg.get("nome", a.edicao))
        r = subprocess.run(
            [_python(), "-m", "PyInstaller", "Concrestats.spec", "--noconfirm",
             "--distpath", dist, "--workpath", work],
            cwd=FONTE, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-2000:])
            print(r.stderr[-2000:])
            return 1
    finally:
        # Sai SEMPRE, mesmo se a compilacao falhar: deixar o arquivo para tras
        # faria o proximo build normal sair com a edicao da Usinop dentro.
        if os.path.exists(EMBUTIDA):
            os.remove(EMBUTIDA)

    pronto = os.path.join(dist, "Concrestats")
    if not os.path.isdir(pronto):
        print("A compilacao nao gerou " + pronto)
        return 1

    ok, detalhe = conferir(pronto, cfg)
    if not ok:
        print("FALHOU a conferencia: " + detalhe)
        return 1

    if os.path.exists(saida):
        shutil.rmtree(saida)
    shutil.move(pronto, saida)
    for lixo in ("webview_data", "copias"):
        alvo = os.path.join(saida, lixo)
        if os.path.isdir(alvo):
            shutil.rmtree(alvo)
    # Um edicao.json solto aqui venceria a embutida e daria a impressao de que
    # ela nao funciona. A entrega tem de provar o caminho embutido.
    solto = os.path.join(saida, "edicao.json")
    if os.path.exists(solto):
        os.remove(solto)

    n = sum(len(f) for _, _, f in os.walk(saida))
    mb = sum(os.path.getsize(os.path.join(r, f))
             for r, _, fs in os.walk(saida) for f in fs) / 1024 / 1024
    print()
    print("Pronto: %s" % saida)
    print("  %d arquivos, %.0f MB, sem nenhum arquivo solto para colocar" % (n, mb))
    print("  " + detalhe)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
