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

Sem --novidades, a lista sai SOZINHA do quadro: os cartoes que voltaram para
"Testar" desde a build anterior. Duas builds seguidas com o mesmo texto
"build nova" fazem quem testa achar que a versao nova nao tem nada dentro -
e o tempo dele nao e' nosso para gastar.

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


MANIFESTO = os.path.join(RAIZ, ".ultima_build.json")
# Partes do build que mudam a cada rodada de frontend. O resto (numpy, pandas,
# DLLs) fica igual por meses e nao precisa ser reenviado.
LEVES = ("_internal/static", "_internal/templates")


def _hashes():
    """Impressao digital dos arquivos do build, por caminho relativo."""
    import hashlib
    out = {}
    for raiz, _, arquivos in os.walk(DIST):
        for a in arquivos:
            caminho = os.path.join(raiz, a)
            rel = os.path.relpath(caminho, DIST).replace("\\", "/")
            try:
                with open(caminho, "rb") as fh:
                    out[rel] = hashlib.md5(fh.read()).hexdigest()
            except OSError:
                pass
    return out


def decidir_pacote():
    """Patch (leve) quando so' o frontend mudou; completo quando muda o exe.

    O testador baixa 350 KB em vez de 33 MB em 4 partes - a diferenca entre
    testar hoje e testar quando sobrar tempo.
    """
    atual = _hashes()
    try:
        with open(MANIFESTO, encoding="utf-8") as fh:
            anterior = json.load(fh)
    except Exception:
        return "completo", atual, []       # primeira vez: manda tudo

    mudou = [k for k, v in atual.items() if anterior.get(k) != v]
    mudou += [k for k in anterior if k not in atual]
    if not mudou:
        return "nada", atual, []
    if all(k.startswith(LEVES) for k in mudou):
        return "patch", atual, mudou
    return "completo", atual, mudou


def achar_rar():
    for p in (r"C:\Program Files\WinRAR\rar.exe",
              r"C:\Program Files (x86)\WinRAR\rar.exe"):
        if os.path.exists(p):
            return p
    return None


def novidades_do_quadro(key, token, board):
    """O que mudou desde a build anterior, lido do proprio quadro.

    Usa o comentario da build anterior como marco: tudo que voltou para a
    lista de teste depois dele entrou nesta versao. E' a mesma informacao que
    seria digitada na mao, so' que sem depender de alguem lembrar.
    """
    try:
        cards = chamar("GET", f"/boards/{board}/cards", key, token, fields="name")
        card = next((c for c in cards if "BUILD" in c["name"].upper()), None)
        if not card:
            return []

        anteriores = chamar("GET", f"/cards/{card['id']}/actions", key, token,
                            filter="commentCard", limit="1")
        desde = anteriores[0]["date"] if anteriores else None

        acoes = chamar("GET", f"/boards/{board}/actions", key, token,
                       filter="updateCard", limit="200", **({"since": desde} if desde else {}))
    except Exception:
        # Quadro fora do ar nao pode impedir a publicacao da build.
        return []

    nomes = []
    for a in acoes:
        d = a.get("data", {})
        depois = (d.get("listAfter") or {}).get("name", "")
        if "testar" not in depois.lower():
            continue
        nome = (d.get("card") or {}).get("name", "").strip()
        if nome and nome not in nomes:
            nomes.append(nome)
    return nomes


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

    novidades = args.novidades or novidades_do_quadro(key, token, board)
    if novidades:
        print(f"[0/4] novidades desta build: {len(novidades)}")
        for n in novidades:
            print(f"      - {n}")
    else:
        print("[0/4] AVISO: nada mudou de lista desde a build anterior.")
        print("      Quem testa vai ver 'build nova' sem saber o que mudou.")
        print("      Se ha' novidade, publique com --novidades \"...\"")

    # 0.5) grava o que mudou DENTRO do build: o Modo Teste do app le isso e
    # mostra a lista do que olhar, sem ninguem precisar abrir o Trello.
    try:
        alvo_versao = os.path.join(DIST, "_internal", "static", "versao.json")
        with open(alvo_versao, "w", encoding="utf-8") as fh:
            json.dump({"versao": args.versao, "novidades": novidades}, fh, ensure_ascii=False, indent=2)
        # o mesmo arquivo no fonte, para a proxima compilacao ja nascer com ele
        fonte_versao = os.path.join(RAIZ, "source", "static", "versao.json")
        shutil.copyfile(alvo_versao, fonte_versao)
        print(f"[0/4] versao.json gravado ({len(novidades)} novidade(s))")
    except OSError as e:
        print(f"[0/4] aviso: nao consegui gravar versao.json ({e})")

    # 1) decide entre patch leve e build completa
    modo, manifesto, mudou = decidir_pacote()
    if modo == "nada":
        print("[1/4] Nada mudou desde a ultima publicacao. Nada a enviar.")
        return
    print(f"[1/4] {len(mudou)} arquivo(s) alterado(s) -> pacote {modo.upper()}")

    tmp = os.path.join(os.environ.get("TEMP", "."), "concrestats_partes")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp, exist_ok=True)
    if modo == "patch":
        # so' static/ e templates/, com o caminho relativo a pasta do app
        alvo = os.path.join(tmp, "Concrestats_ATUALIZACAO.rar")
        subprocess.run([rar, "a", "-r", "-m5", "-idq", alvo,
                        "_internal\\static", "_internal\\templates"],
                       cwd=DIST, check=True)
    else:
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
        # No patch, a build COMPLETA continua no cartao: quem ainda nao tem o
        # app (ou perdeu a pasta) precisa dela. So' o patch anterior sai.
        antigos = card.get("attachments", [])
        alvos = [a for a in antigos
                 if modo == "completo" or "ATUALIZACAO" in a["name"].upper()]
        for a in alvos:
            chamar("DELETE", f"/cards/{card['id']}/attachments/{a['id']}", key, token)
        mantidos = len(antigos) - len(alvos)
        print(f"[2/4] cartao reaproveitado ({len(alvos)} anexo(s) trocado(s)"
              + (f", {mantidos} mantido(s)" if mantidos else "") + ")")
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
    if modo == "patch":
        passos = NL.join([
            "ATUALIZACAO RAPIDA (1 arquivo pequeno, nao precisa baixar tudo de novo)", "",
            "1. Baixe o anexo Concrestats_ATUALIZACAO.rar.",
            "2. Botao direito nele - Extrair aqui - e mande para DENTRO da pasta",
            "   Concrestats (a mesma onde fica o Concrestats.exe).",
            "3. Confirme SUBSTITUIR os arquivos quando ele perguntar.",
            "4. Abra o Concrestats.exe normalmente.", "",
            "So' isso: seus dados, receitas e paineis continuam como estavam.", "",
            "Nao tem o app ainda? Baixe as partes .part01/.part02/... deste",
            "mesmo cartao (build completa) e siga o passo a passo delas.", "",
            "Versao publicada em: " + args.versao,
        ])
    else:
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
    if novidades:
        passos += "\nO QUE MUDOU NESTA VERSAO\n" + "\n".join(f"- {n}" for n in novidades)
    chamar("PUT", f"/cards/{card['id']}", key, token, name=TITULO, desc=passos)

    membros = chamar("GET", f"/boards/{board}/members", key, token, fields="username")
    naor = next((m for m in membros if m["username"] == "naorleitzke"), None)
    if naor:
        try:
            chamar("POST", f"/cards/{card['id']}/idMembers", key, token, value=naor["id"])
        except Exception:
            pass  # ja e membro do cartao
    # O comentario diz PRIMEIRO o que mudou. Quem esta' testando decide com
    # isso se vale baixar agora ou terminar a rodada atual antes.
    if novidades:
        texto = ("@naorleitzke build nova - o que mudou:" + NL
                 + NL.join(f"- {n}" for n in novidades) + NL + NL)
    else:
        texto = "@naorleitzke build nova. " + NL
    texto += ("IMPORTANTE: baixe TODAS as partes na mesma pasta, depois SELECIONE TODAS "
              "de uma vez, botao direito, Extrair aqui. Extrair uma de cada vez nao funciona.")
    chamar("POST", f"/cards/{card['id']}/actions/comments", key, token, text=texto)

    shutil.rmtree(tmp, ignore_errors=True)
    try:
        with open(MANIFESTO, "w", encoding="utf-8") as fh:
            json.dump(manifesto, fh)
    except OSError:
        pass          # sem manifesto a proxima publicacao so' manda tudo
    print(f"[3/4] descricao e comentario atualizados")
    print(f"[4/4] PRONTO: {card.get('shortUrl', '')}")


if __name__ == "__main__":
    main()
