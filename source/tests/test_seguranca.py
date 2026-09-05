# -*- coding: utf-8 -*-
"""Testes das falhas encontradas na auditoria de 05/09/2026.

Cada um destes existe porque a coisa ESTAVA quebrada e foi corrigida. Sao os
casos que ninguem percebe acontecendo: nao ha' erro na tela, so' o resultado
errado - o cliente sem poder salvar, o programa buscando atualizacao no lugar
errado, metade do backend novo e metade velho no disco.
"""

import io
import json
import os
import shutil
import sys
import tempfile
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = os.path.dirname(AQUI)
sys.path.insert(0, FONTE)
sys.path.insert(0, os.path.join(os.path.dirname(FONTE), "tools"))
os.environ.setdefault("CONCRE_NO_WINDOW", "1")
os.environ.setdefault("CONCRESTATS_WEB", "0")

import app          # noqa: E402
import atualizador  # noqa: E402


def _zip(arquivos):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for nome, dado in arquivos.items():
            z.writestr(nome, dado)
    return buf.getvalue()


def rodar():
    falhas = []

    def conf(nome, cond, detalhe=""):
        print(("OK   " if cond else "FALHA") + " | " + nome + (f"  ({detalhe})" if detalhe else ""))
        if not cond:
            falhas.append(nome)

    # ── 1. o pacote nao escreve fora do lugar
    for mau in ("../fora.py", "codigo/../../fora.py", "/etc/passwd",
                "C:/Windows/x.dll", "outra/coisa.py", "codigo"):
        conf("Recusa caminho perigoso: " + mau, not atualizador._seguro(mau))
    for bom in ("static/js/a.js", "templates/index.html", "codigo/app.py"):
        conf("Aceita caminho legitimo: " + bom, atualizador._seguro(bom))

    # ── 2. codigo/ tambem tem copia de seguranca
    #
    # Quando codigo/ entrou, a copia de seguranca continuou cobrindo so' static
    # e templates. Uma falha no meio da gravacao deixava a pasta com metade dos
    # .py novos e metade velhos - backend inconsistente, que e' pior do que
    # backend quebrado, porque pode ate' abrir.
    base = tempfile.mkdtemp(prefix="concre_seg_")
    try:
        os.makedirs(os.path.join(base, "codigo"))
        with open(os.path.join(base, "codigo", "app.py"), "w", encoding="utf-8") as fh:
            fh.write("versao antiga")
        # arquivo que existia e sumiu da versao nova
        with open(os.path.join(base, "codigo", "sumiu.py"), "w", encoding="utf-8") as fh:
            fh.write("modulo que foi apagado")

        ok, msg = atualizador.aplicar(_zip({"codigo/app.py": "versao nova"}), base)
        conf("Aplica o pacote", ok, msg)
        with open(os.path.join(base, "codigo", "app.py"), encoding="utf-8") as fh:
            conf("O arquivo foi trocado", fh.read() == "versao nova")
        conf("Modulo apagado na versao nova some do disco",
             not os.path.exists(os.path.join(base, "codigo", "sumiu.py")))
        # A copia de seguranca cobre codigo/ agora, e nao so' static/templates.
        # Ela FICA depois de dar certo, de proposito: e' a unica volta atras
        # quando a versao nova abre mas esta' ruim — a quarentena do carregador
        # so' pega o que nao abre.
        guardado = os.path.join(base, "_antes_da_atualizacao", "codigo", "app.py")
        conf("codigo/ tambem tem copia de seguranca", os.path.isfile(guardado))
        if os.path.isfile(guardado):
            with open(guardado, encoding="utf-8") as fh:
                conf("E a copia e' mesmo a versao anterior", fh.read() == "versao antiga")
    finally:
        shutil.rmtree(base, ignore_errors=True)

    # ── 3. pacote que estoura o disco e' recusado
    base = tempfile.mkdtemp(prefix="concre_seg_")
    try:
        gordo = _zip({"codigo/app.py": b"\0" * (atualizador.DESCOMPACTADO_MAXIMO + 1)})
        ok, msg = atualizador.aplicar(gordo, base)
        conf("Pacote que abre grande demais e' recusado", not ok, msg)
        conf("E nao chegou a gravar nada", not os.path.isdir(os.path.join(base, "codigo")))
    finally:
        shutil.rmtree(base, ignore_errors=True)

    # ── 4. redirecionamento nao contorna a conferencia do endereco
    #
    # A validacao rodava so' no endereco inicial. Um endereco de fora passava e
    # mandava o programa para 127.0.0.1 ou para a rede interna em seguida.
    vistos = []

    def conferir_falso(url):
        vistos.append(url)
        return None if url.startswith("https://ok.exemplo/") else "endereco recusado"

    try:
        atualizador.baixar("https://interno.exemplo/p.zip", conferir_endereco=conferir_falso)
        conf("Endereco recusado nao e' baixado", False, "deixou passar")
    except ValueError as e:
        conf("Endereco recusado nao e' baixado", "recusado" in str(e), str(e))
    conf("A conferencia foi mesmo chamada", vistos == ["https://interno.exemplo/p.zip"])

    import urllib.request
    handler = None
    for h in urllib.request.build_opener().handlers:
        if isinstance(h, urllib.request.HTTPRedirectHandler):
            handler = h
    conf("O redirecionador padrao existe (o nosso substitui ele)", handler is not None)

    # ── 5. as preferencias do programa nao sao gravaveis pela tela
    #
    # No app de mesa o POST caia direto na raiz, sem filtro: qualquer coisa
    # capaz de falar com 127.0.0.1 podia trocar de onde vem a atualizacao,
    # zerar o periodo de teste ou esconder abas.
    cliente = app.app.test_client()
    for chave, valor in (("__url_atualizacao", "http://algum-lugar/m.json"),
                         ("__teste_desde", "1999-01-01"),
                         ("__relogio", "2099-01-01"),
                         ("__instalacao", "aaaaaaaaaa"),
                         ("__edicao_remota", {"nome": "X", "ocultar": ["planilhas"]}),
                         ("__canal_atualizacao", "teste")):
        r = cliente.post("/api/prefs", json={chave: valor})
        conf("Recusa gravar " + chave, r.status_code == 403, str(r.status_code))

    antes = app._prefs_cru().get("__url_atualizacao")
    cliente.post("/api/prefs", json={"__url_atualizacao": "http://algum-lugar/m.json"})
    conf("E nao gravou mesmo", app._prefs_cru().get("__url_atualizacao") == antes)

    # o que a tela grava de verdade continua funcionando
    r = cliente.post("/api/prefs", json={"__receitas": {"x": 1}})
    conf("As preferencias normais continuam gravando", r.status_code == 200, str(r.status_code))

    # ── 6. a entrega nao leva estado desta maquina
    #
    # Conferir o exe uma vez ja' escreve prefs.json ao lado dele. A entrega da
    # Usinop saiu com "__teste_desde" da minha maquina: 15 dias correndo desde
    # a data em que eu compilei, e nao a que o cliente instalar.
    from build_edicao import limpar_entrega  # noqa: PLC0415
    base = tempfile.mkdtemp(prefix="concre_entrega_")
    try:
        with open(os.path.join(base, "Concrestats.exe"), "w") as fh:
            fh.write("x")
        with open(os.path.join(base, "prefs.json"), "w", encoding="utf-8") as fh:
            json.dump({"__instalacao": "meu", "__teste_desde": "2026-09-04"}, fh)
        with open(os.path.join(base, "canal.txt"), "w") as fh:
            fh.write("teste")
        with open(os.path.join(base, "licenca.key"), "w") as fh:
            fh.write("minha licenca")
        os.makedirs(os.path.join(base, "webview_data", "Default"))
        os.makedirs(os.path.join(base, "uploads"))
        with open(os.path.join(base, "uploads", "planilha_do_naor.xlsx"), "w") as fh:
            fh.write("dados de alguem")

        tirados = limpar_entrega(base)
        for proibido in ("prefs.json", "canal.txt", "licenca.key"):
            conf("Nao vai junto: " + proibido, not os.path.exists(os.path.join(base, proibido)))
        conf("Nao vai junto: webview_data/",
             not os.path.isdir(os.path.join(base, "webview_data")))
        conf("Nao vai junto: planilha de outra pessoa",
             not os.path.exists(os.path.join(base, "uploads", "planilha_do_naor.xlsx")))
        conf("A pasta uploads continua existindo, vazia",
             os.path.isdir(os.path.join(base, "uploads")))
        conf("O programa em si fica", os.path.exists(os.path.join(base, "Concrestats.exe")))
        conf("E diz o que tirou", len(tirados) >= 5, str(tirados))
    finally:
        shutil.rmtree(base, ignore_errors=True)

    # ── 7. filtro que dá zero linhas exporta zero linhas
    #
    # `body.get("filtered_data") or payload["data"]`: lista vazia e' falsa em
    # Python, entao o filtro era descartado e saia a planilha INTEIRA. Num
    # laboratorio que atende varios clientes, e' mandar os dados de um para
    # outro - e a tela mostrava zero linhas, entao ninguem desconfia.
    cliente = app.app.test_client()
    sid = "teste-export"
    app.SESSIONS.pop(sid, None)
    sess = app._session(sid)
    sess["sheets"]["Plan1"] = {"headers": ["CLIENTE", "M3"],
                               "data": [["Alfa", 5], ["Beta", 7], ["Gama", 9]]}
    sess["active"] = "Plan1"

    r = cliente.post("/api/export", json={"session_id": sid, "sheet_name": "Plan1",
                                          "format": "csv", "filtered_data": []})
    corpo = r.get_data(as_text=True)
    linhas = [x for x in corpo.splitlines() if x.strip()]
    conf("Filtro com zero linhas exporta zero linhas",
         r.status_code == 200 and len(linhas) == 1, "%d linha(s): %r" % (len(linhas), linhas[:3]))
    conf("E nao vaza o cliente que foi filtrado fora", "Beta" not in corpo)

    r = cliente.post("/api/export", json={"session_id": sid, "sheet_name": "Plan1",
                                          "format": "csv"})
    conf("Sem filtro nenhum continua exportando tudo",
         "Alfa" in r.get_data(as_text=True) and "Gama" in r.get_data(as_text=True))

    r = cliente.post("/api/export", json={"session_id": sid, "sheet_name": "Plan1",
                                          "format": "csv",
                                          "filtered_data": [["Beta", 7]]})
    corpo = r.get_data(as_text=True)
    conf("Filtro com uma linha exporta so' ela",
         "Beta" in corpo and "Alfa" not in corpo and "Gama" not in corpo)
    app.SESSIONS.pop(sid, None)

    # ── 8. corpo malformado nao apaga as receitas
    #
    # get_json(silent=True) devolve None quando o corpo nao chega inteiro, e o
    # None virava lista vazia gravada por cima do arquivo. Todas as receitas
    # apagadas, respondendo sucesso - e receitas.json nao tem copia de
    # seguranca, diferente das planilhas.
    guardado = None
    if os.path.exists(app.RECEITAS_FILE):
        with open(app.RECEITAS_FILE, encoding="utf-8") as fh:
            guardado = fh.read()
    try:
        with open(app.RECEITAS_FILE, "w", encoding="utf-8") as fh:
            json.dump([{"nome": "FCK 25", "traco": "1:2:3"}], fh)

        r = cliente.post("/api/receitas", data="isto nao e json",
                         content_type="application/json")
        conf("Corpo quebrado nao e' aceito", r.status_code == 400, str(r.status_code))
        with open(app.RECEITAS_FILE, encoding="utf-8") as fh:
            sobrou = json.load(fh)
        conf("E as receitas continuam la'", sobrou and sobrou[0]["nome"] == "FCK 25",
             str(sobrou))

        r = cliente.post("/api/receitas", json={"nao": "e lista"})
        conf("Objeto no lugar de lista tambem e' recusado", r.status_code == 400)

        r = cliente.post("/api/receitas", json=[{"nome": "FCK 30"}])
        conf("Lista de verdade continua gravando", r.status_code == 200)
        with open(app.RECEITAS_FILE, encoding="utf-8") as fh:
            conf("E gravou mesmo", json.load(fh)[0]["nome"] == "FCK 30")
    finally:
        if guardado is None:
            if os.path.exists(app.RECEITAS_FILE):
                os.remove(app.RECEITAS_FILE)
        else:
            with open(app.RECEITAS_FILE, "w", encoding="utf-8") as fh:
                fh.write(guardado)

    print()
    if falhas:
        print("FALHARAM: " + ", ".join(falhas))
        return 1
    print("TODOS OS TESTES PASSARAM")
    return 0


if __name__ == "__main__":
    raise SystemExit(rodar())
