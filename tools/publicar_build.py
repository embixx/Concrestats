#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Publica a build atual no Trello (canal com o Naor), sem precisar de nuvem.

O que faz:
  1. Compacta  source/dist/Concrestats  em partes de 9 MB (limite do Trello é 10)
  2. Acha (ou cria) o cartao "BUILD — baixar o app aqui"
  3. APAGA os anexos antigos e sobe as partes novas
  4. Atualiza a descricao com a data e as novidades
  5. Comenta marcando o Naor

Uso:
    python tools/publicar_build.py
    python tools/publicar_build.py --novidades "corrigido X" "adicionado Y"

Credenciais: .trello.json na raiz do projeto (mesmo do tools/trello.py).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
import uuid
from datetime import datetime

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(RAIZ, "source", "dist", "Concrestats")
TITULO = "⬇ BUILD — baixar o app aqui"
API = "https://api.trello.com/1"
NL = chr(10)


def credenciais():
    arq = os.path.join(RAIZ, ".trello.json")
    if not os.path.exists(arq):
        sys.exit("Faltam credenciais: crie .trello.json na raiz do projeto.")
    d = json.load(open(arq, encoding="utf-8"))
    return d["key"], d["token"], d.get("board", "NF2AmAIp")


def chamar(metodo, caminho, key, token, **params):
    p = {"key": key, "token": token}
    p.update({k: v for k, v in params.items() if v is not None})
    url = f"{API}{caminho}?{urllib.parse.urlencode(p)}"
    req = urllib.request.Request(url, method=metodo)
    with urllib.request.urlopen(req) as r:
        txt = r.read().decode("utf-8")
    return json.loads(txt) if txt.strip() else {}


def enviar_anexo(card_id, arquivo, key, token):
    """Upload multipart de um arquivo para o cartao."""
    bd = "----b" + uuid.uuid4().hex
    corpo = b""
    for campo, valor in (("key", key), ("token", token)):
        corpo += (f"--{bd}\r\nContent-Disposition: form-data; "
                  f'name="{campo}"\r\n\r\n{valor}\r\n').encode()
    nome = os.path.basename(arquivo)
    corpo += (f"--{bd}\r\nContent-Disposition: form-data; name=\"file\"; "
              f'filename="{nome}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
    with open(arquivo, "rb") as fh:
        corpo += fh.read()
    corpo += f"\r\n--{bd}--\r\n".encode()
    req = urllib.request.Request(
        f"{API}/cards/{card_id}/attachments", data=corpo, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={bd}"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def achar_rar():
    for p in (r"C:\Program Files\WinRAR\rar.exe",
              r"C:\Program Files (x86)\WinRAR\rar.exe"):
        if os.path.exists(p):
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--novidades", nargs="*", default=[],
                    help="linhas de novidades desta versao")
    ap.add_argument("--versao", default=datetime.now().strftime("%d/%m/%Y %H:%M"))
    args = ap.parse_args()

    if not os.path.isdir(DIST):
        sys.exit(f"Build nao encontrada em {DIST}\n"
                 "Compile antes: python -m PyInstaller Concrestats.spec --noconfirm")
    rar = achar_rar()
    if not rar:
        sys.exit("WinRAR nao encontrado (precisa do rar.exe para dividir em partes).")

    key, token, board = credenciais()

    # 1) partes de 9 MB
    tmp = os.path.join(os.environ.get("TEMP", "."), "concrestats_partes")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp, exist_ok=True)
    alvo = os.path.join(tmp, "Concrestats.rar")
    subprocess.run([rar, "a", "-r", "-m5", "-v9m", "-idq", alvo, "Concrestats"],
                   cwd=RAIZ, check=True)
    partes = sorted(f for f in os.listdir(tmp) if f.endswith(".rar"))
    total = sum(os.path.getsize(os.path.join(tmp, f)) for f in partes) / 1024 / 1024
    print(f"[1/4] {len(partes)} parte(s), {total:.1f} MB no total")

    # 2) cartao
    listas = {l["name"]: l["id"] for l in chamar("GET", f"/boards/{board}/lists", key, token)}
    cards = chamar("GET", f"/boards/{board}/cards", key, token,
                   fields="name,idList,shortUrl", attachments="true")
    card = next((c for c in cards if "BUILD" in c["name"].upper()), None)
    if card:
        for a in card.get("attachments", []):
            chamar("DELETE", f"/cards/{card['id']}/attachments/{a['id']}", key, token)
        print(f"[2/4] cartao existente reaproveitado ({len(card.get('attachments', []))} anexos antigos removidos)")
    else:
        destino = listas.get("Aceito") or list(listas.values())[0]
        card = chamar("POST", "/cards", key, token, idList=destino, name=TITULO)
        print("[2/4] cartao criado")

    # 3) anexos
    for i, nome in enumerate(partes, 1):
        r = enviar_anexo(card["id"], os.path.join(tmp, nome), key, token)
        print(f"      anexo {i}/{len(partes)}: {r['name']} ({r.get('bytes', 0)/1024/1024:.1f} MB)")

    # 4) descricao + comentario
    n = str(len(partes))
    passos = NL.join([
        "COMO INSTALAR (3 passos - vale ler)", "",
        "1. BAIXE AS " + n + " PARTES na MESMA pasta e espere todas terminarem.",
        "   Se voce usa gerenciador de download (Gopeed, IDM), ele pode",
        "   atrapalhar: pause/desative e baixe pelo proprio navegador.", "",
        "2. SELECIONE AS " + n + " PARTES DE UMA VEZ (clique na primeira, segure",
        "   SHIFT, clique na ultima) - botao direito - Extrair aqui.",
        "   Extrair uma de cada vez NAO funciona: sozinhas elas nao abrem.",
        "   (Alternativa: com as " + n + " na mesma pasta, botao direito so na .part01)", "",
        "3. Abra a pasta Concrestats e clique em Concrestats.exe.",
        "   Nao precisa instalar nada. Se o Windows avisar editor desconhecido:",
        "   Mais informacoes - Executar assim mesmo.", "",
        "Versao publicada em: " + args.versao,
    ])
    if args.novidades:
        passos += "\nNOVIDADES\n" + "\n".join(f"- {n}" for n in args.novidades)
    chamar("PUT", f"/cards/{card['id']}", key, token, name=TITULO, desc=passos)

    membros = chamar("GET", f"/boards/{board}/members", key, token, fields="username")
    naor = next((m for m in membros if m["username"] == "naorleitzke"), None)
    if naor:
        try:
            chamar("POST", f"/cards/{card['id']}/idMembers", key, token, value=naor["id"])
        except Exception:
            pass  # ja e membro do cartao
    texto = "@naorleitzke build nova. IMPORTANTE: baixe TODAS as partes na mesma pasta, depois SELECIONE TODAS de uma vez, botao direito, Extrair aqui. Extrair uma de cada vez nao funciona."
    if args.novidades:
        texto += " Novidades: " + "; ".join(args.novidades)
    chamar("POST", f"/cards/{card['id']}/actions/comments", key, token, text=texto)

    shutil.rmtree(tmp, ignore_errors=True)
    print(f"[3/4] descricao e comentario atualizados")
    print(f"[4/4] PRONTO: {card.get('shortUrl', '')}")


if __name__ == "__main__":
    main()
