# -*- coding: utf-8 -*-
"""Sobe uma pasta de entrega pronta para um cartao do Trello.

    python tools/publicar_entrega.py _entrega_naor   --cartao "BAIXAR - versao completa"
    python tools/publicar_entrega.py _entrega_usinop --cartao "BAIXAR - versao da Usinop"

Existe separado do publicar_build.py porque faz outra coisa. Aquele publica O
build - decide entre patch e completo, carimba a versao, monta as novidades a
partir do quadro. Este so' pega uma pasta que ja' esta' pronta, com a edicao
compilada dentro, e entrega.

Cada cliente baixa a pasta dele e abre. Nao ha' arquivo para colocar, canal
para escolher nem codigo para mandar de volta - foi tudo decidido na hora de
compilar. As atualizacoes seguintes chegam sozinhas, para os dois.
"""

import argparse
import os
import shutil
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)

from publicar_build import (achar_rar, chamar, credenciais,  # noqa: E402
                            enviar_anexo)

LISTA_PADRAO = "Aceito"


def empacotar(pasta, base, rar):
    """Divide em partes de 9 MB: o Trello recusa anexo grande."""
    tmp = os.path.join(os.environ.get("TEMP", "."), "concrestats_entrega")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp, exist_ok=True)
    alvo = os.path.join(tmp, base + ".rar")
    subprocess.run([rar, "a", "-r", "-m5", "-v9m", "-idq", alvo,
                    os.path.basename(pasta)],
                   cwd=os.path.dirname(pasta), check=True)
    partes = sorted(f for f in os.listdir(tmp) if f.startswith(base) and f.endswith(".rar"))
    return tmp, partes


def main():
    ap = argparse.ArgumentParser(description="Publica uma pasta de entrega no Trello")
    ap.add_argument("pasta", help="pasta pronta (ex.: _entrega_usinop)")
    ap.add_argument("--cartao", required=True, help="titulo do cartao no quadro")
    ap.add_argument("--lista", default=LISTA_PADRAO)
    ap.add_argument("--desc", default=None, help="descricao do cartao")
    ap.add_argument("--comentario", default=None)
    ap.add_argument("--base", default=None,
                    help="nome do arquivo .rar (padrao: nome da pasta)")
    a = ap.parse_args()

    pasta = os.path.abspath(os.path.join(RAIZ, a.pasta))
    if not os.path.isdir(pasta):
        sys.exit("Nao achei a pasta " + pasta)
    if not os.path.isfile(os.path.join(pasta, "Concrestats.exe")):
        sys.exit("Isso nao parece uma entrega: nao ha' Concrestats.exe em " + pasta)

    rar = achar_rar()
    if not rar:
        sys.exit("WinRAR nao encontrado (precisa do rar.exe para dividir em partes).")

    key, token, board = credenciais()
    base = a.base or os.path.basename(pasta).lstrip("_")

    print("Empacotando " + os.path.basename(pasta) + " ...")
    tmp, partes = empacotar(pasta, base, rar)
    total = sum(os.path.getsize(os.path.join(tmp, f)) for f in partes) / 1024 / 1024
    print("  %d parte(s), %.1f MB" % (len(partes), total))

    listas = {l["name"]: l["id"] for l in chamar("GET", "/boards/%s/lists" % board, key, token)}
    if a.lista not in listas:
        sys.exit("Lista '%s' nao existe. Ha': %s" % (a.lista, ", ".join(listas)))

    cards = chamar("GET", "/boards/%s/cards" % board, key, token,
                   fields="name,shortUrl", attachments="true")
    card = next((c for c in cards if c["name"].strip() == a.cartao.strip()), None)
    if card:
        print("  cartao reaproveitado")
        # Anexos antigos saem: duas versoes no mesmo cartao e' a receita para
        # alguem baixar a errada e reportar um problema ja' corrigido.
        for at in card.get("attachments", []):
            chamar("DELETE", "/cards/%s/attachments/%s" % (card["id"], at["id"]), key, token)
    else:
        card = chamar("POST", "/cards", key, token, idList=listas[a.lista], name=a.cartao)
        print("  cartao criado")

    for i, p in enumerate(partes, 1):
        caminho = os.path.join(tmp, p)
        print("  anexo %d/%d: %s (%.1f MB)"
              % (i, len(partes), p, os.path.getsize(caminho) / 1024 / 1024))
        enviar_anexo(card["id"], caminho, key, token)

    if a.desc:
        chamar("PUT", "/cards/%s" % card["id"], key, token, desc=a.desc)
    if a.comentario:
        chamar("POST", "/cards/%s/actions/comments" % card["id"], key, token,
               text=a.comentario)

    shutil.rmtree(tmp, ignore_errors=True)
    print("PRONTO: " + card.get("shortUrl", ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
