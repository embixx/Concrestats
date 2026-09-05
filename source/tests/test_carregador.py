# -*- coding: utf-8 -*-
"""Testes do carregador (principal.py): de onde o programa roda.

O programa passou a rodar por uma pasta que chega pela REDE. O erro que estes
testes procuram e' o pior de todos neste projeto: um pacote ruim que impeca o
programa de abrir. Nao ha' mensagem, nao ha' tela, nao ha' como mandar a
correcao da correcao - porque para receber a correcao o programa precisaria
abrir. A pessoa fica com um icone que nao faz nada.

Por isso a cada abertura o carregador deixa uma marca, e so' apaga quando o
servidor responde. Marca sobrando na abertura seguinte quer dizer que a
anterior nao abriu, e a pasta vai para a quarentena.
"""

import importlib.util
import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = os.path.dirname(AQUI)


def carregar():
    """Importa principal.py sem executa-lo como programa."""
    spec = importlib.util.spec_from_file_location(
        "principal_sob_teste", os.path.join(FONTE, "principal.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def rodar():
    falhas = []

    def conf(nome, cond, detalhe=""):
        print(("OK   " if cond else "FALHA") + " | " + nome + (f"  ({detalhe})" if detalhe else ""))
        if not cond:
            falhas.append(nome)

    p = carregar()
    base = tempfile.mkdtemp(prefix="concre_carregador_")
    p._base = lambda: base

    # _rodar de verdade abriria o programa; aqui so' se registra a escolha.
    escolhas = []
    p._rodar = lambda de_onde: escolhas.append(de_onde)
    p._confirmar_que_abriu = lambda: None

    pasta = p._pasta_codigo()

    def por_codigo(conteudo="print('ok')"):
        os.makedirs(pasta, exist_ok=True)
        with open(os.path.join(pasta, "app.py"), "w", encoding="utf-8") as fh:
            fh.write(conteudo)

    def limpar():
        del escolhas[:]
        for d in (pasta, pasta + ".quebrado"):
            shutil.rmtree(d, ignore_errors=True)

    try:
        # ── sem pasta nenhuma: e' o estado de quem acabou de instalar
        limpar()
        p.main()
        conf("Sem codigo/ roda pelo embutido", escolhas == ["embutido"], str(escolhas))

        # ── com codigo valido
        limpar()
        por_codigo()
        p.main()
        conf("Com codigo/ roda pelo atualizado", escolhas == ["atualizado"], str(escolhas))
        conf("A pasta entra no caminho de importacao", pasta in sys.path)
        try:
            sys.path.remove(pasta)
        except ValueError:
            pass

        # ── a marca fica enquanto nao se confirmou a abertura
        conf("Fica uma marca dizendo que esta' abrindo", os.path.exists(p._marca()))

        # ── ESTE e' o caso que importa: a abertura anterior nao abriu
        limpar()
        por_codigo()
        with open(p._marca(), "w", encoding="utf-8") as fh:
            fh.write("abertura anterior")
        p.main()
        conf("Marca sobrando manda para a quarentena e usa o embutido",
             escolhas == ["embutido"], str(escolhas))
        conf("A pasta com problema sai da frente", not os.path.isdir(pasta))
        conf("E' guardada, nao apagada", os.path.isdir(pasta + ".quebrado"))

        # ── o motivo fica registrado, senao nao ha' como descobrir o que houve
        limpar()
        por_codigo()
        p._quarentena("motivo de teste")
        caminho = os.path.join(pasta + ".quebrado", "_motivo.txt")
        conf("O motivo fica escrito junto", os.path.isfile(caminho))
        if os.path.isfile(caminho):
            with open(caminho, encoding="utf-8") as fh:
                conf("E' o motivo certo", fh.read() == "motivo de teste")

        # ── uma pasta pela metade nao conta como codigo
        limpar()
        os.makedirs(pasta, exist_ok=True)
        with open(os.path.join(pasta, "licenca.py"), "w", encoding="utf-8") as fh:
            fh.write("x = 1")
        p.main()
        conf("Pasta sem app.py nao e' usada", escolhas == ["embutido"], str(escolhas))

        # ── quarentena duas vezes seguidas nao pode explodir
        limpar()
        por_codigo()
        p._quarentena("primeira")
        por_codigo()
        p._quarentena("segunda")
        conf("Quarentena repetida substitui a anterior sem erro",
             os.path.isdir(pasta + ".quebrado") and not os.path.isdir(pasta))

        # ── e sem pasta nenhuma tambem nao pode explodir
        limpar()
        p._quarentena("nada para tirar")
        conf("Quarentena sem pasta nao quebra", not os.path.isdir(pasta))
    finally:
        shutil.rmtree(base, ignore_errors=True)

    print()
    if falhas:
        print("FALHARAM: " + ", ".join(falhas))
        return 1
    print("TODOS OS TESTES PASSARAM")
    return 0


if __name__ == "__main__":
    raise SystemExit(rodar())
