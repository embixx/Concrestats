# -*- coding: utf-8 -*-
"""Ponto de entrada do Concrestats. Escolhe DE ONDE carregar o programa.

Por que existe
--------------
A atualizacao automatica so' conseguia trocar as telas (static/ e templates/).
Todo o resto - app.py, licenca.py, atualizador.py - ficava congelado dentro do
Concrestats.exe, e o exe nenhuma atualizacao encosta. Na pratica: qualquer
correcao que nao fosse de tela exigia a pessoa baixar o programa inteiro de
novo, a mao, por um anexo no Trello. Uma correcao publicada nao chegava a
ninguem ate' alguem lembrar de avisar.

Agora o pacote de atualizacao tambem traz os .py, numa pasta `codigo/` ao lado
das telas. Este arquivo poe essa pasta na frente do caminho de importacao, e o
programa passa a rodar de la'.

A rede de seguranca
-------------------
Codigo que chega pela rede pode vir quebrado - erro de digitacao meu, pacote
truncado, o que for. Se isso derrubasse o programa, a pessoa ficaria com um
icone que nao abre e nenhuma forma de voltar atras: para receber a correcao da
correcao, o programa precisaria abrir.

Entao:

  * antes de rodar o codigo atualizado, deixa-se uma marca em disco;
  * quando o servidor responde, a marca e' apagada - isso e' "abriu";
  * se numa abertura a marca AINDA esta' la', a anterior nao chegou a abrir:
    a pasta `codigo/` vai para a quarentena e o programa volta a rodar pela
    copia congelada, que veio junto com o exe e sempre funciona.

Este arquivo NAO e' atualizavel, de proposito. E' ele que sabe se recuperar;
se pudesse ser substituido, um pacote ruim levaria junto a recuperacao.
"""

import os
import shutil
import sys
import threading
import time

NOME_PASTA = "codigo"
MARCA = ".abrindo"


def _base():
    """Onde ficam os arquivos que vieram no bundle (e onde o patch escreve)."""
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def _pasta_codigo():
    return os.path.join(_base(), NOME_PASTA)


def _quarentena(motivo):
    """Tira o codigo atualizado da frente, guardando para eu poder olhar depois."""
    pasta = _pasta_codigo()
    if not os.path.isdir(pasta):
        return
    destino = os.path.join(_base(), NOME_PASTA + ".quebrado")
    try:
        if os.path.isdir(destino):
            shutil.rmtree(destino, ignore_errors=True)
        shutil.move(pasta, destino)
        with open(os.path.join(destino, "_motivo.txt"), "w", encoding="utf-8") as fh:
            fh.write(str(motivo))
    except Exception:  # noqa: BLE001
        # Nao deu para mover: apagar tambem resolve, e e' melhor do que ficar
        # preso num codigo que nao abre.
        shutil.rmtree(pasta, ignore_errors=True)


def _marca():
    return os.path.join(_pasta_codigo(), MARCA)


def _confirmar_que_abriu():
    """Apaga a marca quando o servidor comeca a responder.

    Nao serve olhar so' se a importacao deu certo: o programa pode importar
    inteiro e morrer depois, montando a janela. O sinal de que abriu de
    verdade e' o servidor no ar.
    """
    import urllib.request
    fim = time.time() + 90
    while time.time() < fim:
        try:
            with urllib.request.urlopen("http://127.0.0.1:5000/api/ambiente", timeout=2):
                pass
            try:
                os.remove(_marca())
            except OSError:
                pass
            return
        except Exception:  # noqa: BLE001
            time.sleep(1)


def _rodar(de_onde):
    import runpy
    runpy.run_module("app", run_name="__main__")
    _ = de_onde


def main():
    pasta = _pasta_codigo()
    usar_atualizado = os.path.isdir(pasta) and os.path.isfile(os.path.join(pasta, "app.py"))

    if usar_atualizado and os.path.exists(_marca()):
        # A abertura anterior nao chegou a responder. Nao insiste.
        _quarentena("a abertura anterior nao chegou a abrir")
        usar_atualizado = False

    if usar_atualizado:
        try:
            with open(_marca(), "w", encoding="utf-8") as fh:
                fh.write(time.strftime("%Y-%m-%d %H:%M:%S"))
        except OSError:
            usar_atualizado = False

    if usar_atualizado:
        sys.path.insert(0, pasta)
        threading.Thread(target=_confirmar_que_abriu, daemon=True).start()
        try:
            _rodar("atualizado")
            return
        except SystemExit:
            raise
        except BaseException as e:  # noqa: BLE001 -- inclusive erro de sintaxe
            import traceback
            _quarentena(traceback.format_exc())
            # Tira da frente e esquece o que ja' foi importado de la', senao a
            # segunda tentativa reaproveita os modulos quebrados.
            try:
                sys.path.remove(pasta)
            except ValueError:
                pass
            for nome in ("app", "licenca", "atualizador", "assinatura", "pagamento"):
                sys.modules.pop(nome, None)
            print("codigo atualizado nao abriu (%s); voltando para o embutido" % e)

    _rodar("embutido")


if __name__ == "__main__":
    main()
