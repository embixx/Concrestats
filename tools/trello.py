#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLI do quadro do Trello (Concrestats).
Usado para manter o quadro em dia a cada mudanca no app.

CREDENCIAIS (uma vez so')
-------------------------
Crie o arquivo  .trello.json  na RAIZ do projeto (ele esta' no .gitignore):

    {"key": "SUA_KEY", "token": "SEU_TOKEN", "board": "NF2AmAIp"}

Ou use as variaveis de ambiente TRELLO_KEY / TRELLO_TOKEN.

COMANDOS
--------
  listar                          mostra listas e cartoes
  add "Titulo" --lista "Feito" [--desc "..."] [--etiqueta som]
  mover "trecho do titulo" --para "Feito"
  comentar "trecho do titulo" --texto "corrigido na v1.5.4"
  feito "trecho do titulo" [--nota "..."]      move p/ Feito + comenta

Exemplos:
  python tools/trello.py feito "Dano de queda" --nota "ajustado na v1.5.4"
  python tools/trello.py add "Bug: bot trava no Mall" --lista Reportado --etiqueta mapas
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://api.trello.com/1"
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# O console do Windows abre em cp1252, que nao tem emoji. Um cartao chamado
# "⬇ BUILD" derrubava o `listar` inteiro com UnicodeEncodeError - e o quadro e'
# do cliente, entao o titulo do cartao nao esta' sob o nosso controle. Aqui o
# terminal passa a escrever UTF-8; onde nem isso da', o caractere vira "?" em
# vez de matar o comando.
for _fluxo in (sys.stdout, sys.stderr):
    try:
        _fluxo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def credenciais():
    arq = os.path.join(RAIZ, ".trello.json")
    dados = {}
    if os.path.exists(arq):
        with open(arq, encoding="utf-8") as f:
            dados = json.load(f)
    key = os.environ.get("TRELLO_KEY") or dados.get("key")
    token = os.environ.get("TRELLO_TOKEN") or dados.get("token")
    board = os.environ.get("TRELLO_BOARD") or dados.get("board") or "NF2AmAIp"
    if not key or not token:
        raise SystemExit(
            "Faltam credenciais.\n"
            "Crie .trello.json na raiz do projeto:\n"
            '  {"key": "SUA_KEY", "token": "SEU_TOKEN", "board": "NF2AmAIp"}\n'
            "(pegue em https://trello.com/power-ups/admin)")
    return {"key": key, "token": token}, board


def chamar(metodo, caminho, cred, **params):
    p = {k: v for k, v in {**cred, **params}.items() if v is not None}
    url = f"{API}{caminho}?{urllib.parse.urlencode(p)}"
    req = urllib.request.Request(url, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            corpo = r.read().decode("utf-8")
            return json.loads(corpo) if corpo.strip() else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"ERRO {e.code} em {metodo} {caminho}: "
                         f"{e.read().decode('utf-8','replace')[:200]}")


def board_id(cred, board):
    return chamar("GET", f"/boards/{board}", cred).get("id", board)


def listas(cred, bid):
    return {l["name"]: l["id"] for l in chamar("GET", f"/boards/{bid}/lists", cred)}


def achar_cartao(cred, bid, trecho):
    alvo = trecho.lower()
    achados = [c for c in chamar("GET", f"/boards/{bid}/cards", cred)
               if alvo in c["name"].lower()]
    if not achados:
        raise SystemExit(f"Nenhum cartao com '{trecho}'.")
    if len(achados) > 1:
        nomes = "\n  ".join(c["name"] for c in achados[:8])
        raise SystemExit(f"'{trecho}' casa com varios cartoes:\n  {nomes}\nSeja mais especifico.")
    return achados[0]


def etiqueta_id(cred, bid, nome):
    for e in chamar("GET", f"/boards/{bid}/labels", cred):
        if (e.get("name") or "").lower() == nome.lower():
            return e["id"]
    return None


def main():
    ap = argparse.ArgumentParser(description="CLI do quadro Trello do projeto")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("listar")

    a1 = sub.add_parser("add")
    a1.add_argument("titulo")
    a1.add_argument("--lista", default="Reportado")
    a1.add_argument("--desc", default=None)
    a1.add_argument("--etiqueta", default=None)

    a2 = sub.add_parser("mover")
    a2.add_argument("trecho")
    a2.add_argument("--para", required=True)

    a3 = sub.add_parser("comentar")
    a3.add_argument("trecho")
    a3.add_argument("--texto", required=True)

    a4 = sub.add_parser("feito")
    a4.add_argument("trecho")
    a4.add_argument("--nota", default=None)

    a = ap.parse_args()
    cred, board = credenciais()
    bid = board_id(cred, board)

    if a.cmd == "listar":
        ls = chamar("GET", f"/boards/{bid}/lists", cred)
        cards = chamar("GET", f"/boards/{bid}/cards", cred)
        por_lista = {}
        for c in cards:
            por_lista.setdefault(c["idList"], []).append(c["name"])
        for l in ls:
            nomes = por_lista.get(l["id"], [])
            print(f"\n[{l['name']}]  ({len(nomes)})")
            for n in nomes:
                print("   -", n)
        return

    if a.cmd == "add":
        ids = listas(cred, bid)
        if a.lista not in ids:
            raise SystemExit(f"Lista '{a.lista}' nao existe. Ha': {', '.join(ids)}")
        extra = {}
        if a.etiqueta:
            lid = etiqueta_id(cred, bid, a.etiqueta)
            if lid:
                extra["idLabels"] = lid
        c = chamar("POST", "/cards", cred, idList=ids[a.lista], name=a.titulo,
                   desc=a.desc, pos="bottom", **extra)
        print(f"criado em [{a.lista}]: {c['name']}")
        return

    if a.cmd in ("mover", "feito"):
        destino = a.para if a.cmd == "mover" else "Feito"
        ids = listas(cred, bid)
        if destino not in ids:
            raise SystemExit(f"Lista '{destino}' nao existe. Ha': {', '.join(ids)}")
        c = achar_cartao(cred, bid, a.trecho)
        chamar("PUT", f"/cards/{c['id']}", cred, idList=ids[destino])
        print(f"movido p/ [{destino}]: {c['name']}")
        nota = getattr(a, "nota", None)
        if nota:
            chamar("POST", f"/cards/{c['id']}/actions/comments", cred, text=nota)
            print(f"   comentario: {nota}")
        return

    if a.cmd == "comentar":
        c = achar_cartao(cred, bid, a.trecho)
        chamar("POST", f"/cards/{c['id']}/actions/comments", cred, text=a.texto)
        print(f"comentado em '{c['name']}': {a.texto}")
        return


if __name__ == "__main__":
    main()
