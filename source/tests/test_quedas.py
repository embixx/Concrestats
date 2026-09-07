# -*- coding: utf-8 -*-
"""O programa tem de registrar quando morre sem avisar.

Ate' agora nao registrava nada. O Naor disse "o app fica morrendo, acontece a
cada algumas trocas de aba" e nao havia um arquivo sequer, nem aqui nem na
maquina dele, dizendo o que estava acontecendo — nem se tinha sido o programa,
nem o antivirus, nem quantas vezes. Este teste existe para que isso nao volte
a ser assim.

A distincao que importa: fechar pela janela NAO e' queda; o processo sumir sem
passar pela saida limpa E' queda.
"""

import json
import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = os.path.dirname(AQUI)
sys.path.insert(0, FONTE)

falhas = []


def confere(nome, condicao, detalhe=""):
    if condicao:
        print("OK    | %s" % nome)
    else:
        falhas.append(nome)
        print("FALHOU| %s  %s" % (nome, detalhe))


def main():
    import app

    pasta = tempfile.mkdtemp(prefix="concre_quedas_")
    try:
        app.SESSAO_FILE = os.path.join(pasta, "sessao.json")
        app.QUEDAS_FILE = os.path.join(pasta, "quedas.txt")

        # 1. primeira abertura: nao ha' queda anterior nenhuma
        anterior = app.abrir_sessao()
        confere("Primeira abertura nao inventa queda",
                anterior is None and not os.path.exists(app.QUEDAS_FILE))
        confere("A sessao fica marcada enquanto o programa esta' aberto",
                os.path.exists(app.SESSAO_FILE))

        # 2. fechar pela janela apaga a marca
        app.fechar_sessao()
        confere("Fechar pela janela some com a marca",
                not os.path.exists(app.SESSAO_FILE))

        # 3. abrir de novo, depois de um fechamento limpo, nao registra queda
        app.abrir_sessao()
        app.fechar_sessao()
        confere("Fechamento limpo nao vira queda",
                not os.path.exists(app.QUEDAS_FILE))

        # 4. o processo morre sem passar pela saida limpa: a marca fica
        app.abrir_sessao()
        with open(app.SESSAO_FILE, encoding="utf-8") as fh:
            dados = json.load(fh)
        dados["aba"] = "charts"
        dados["sinais"] = 7
        with open(app.SESSAO_FILE, "w", encoding="utf-8") as fh:
            json.dump(dados, fh)

        # ... e a proxima abertura encontra a marca e registra
        anterior = app.abrir_sessao()
        confere("A abertura seguinte percebe que a anterior nao terminou",
                bool(anterior) and anterior.get("aba") == "charts")
        confere("A queda vai para o quedas.txt",
                os.path.exists(app.QUEDAS_FILE))

        with open(app.QUEDAS_FILE, encoding="utf-8") as fh:
            linha = fh.read()
        confere("O registro diz em que aba a pessoa estava",
                "charts" in linha, linha.strip()[:120])
        confere("O registro diz quantos sinais a sessao deu",
                "7 sinais" in linha, linha.strip()[:120])
        confere("Uma queda = uma linha", app._quantas_quedas() == 1)

        # 5. duas quedas seguidas contam duas
        app.abrir_sessao()
        confere("Quedas seguidas nao se sobrescrevem",
                app._quantas_quedas() == 2)

        # 6. sessao.json ilegivel nao derruba a abertura
        with open(app.SESSAO_FILE, "w", encoding="utf-8") as fh:
            fh.write("{isto nao e' json")
        app.abrir_sessao()
        confere("Arquivo de sessao corrompido nao impede o programa de abrir",
                os.path.exists(app.SESSAO_FILE) and app._quantas_quedas() == 3)
    finally:
        shutil.rmtree(pasta, ignore_errors=True)

    print()
    if falhas:
        print("FALHARAM: " + ", ".join(falhas))
        return 1
    print("TODOS OS TESTES PASSARAM")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
