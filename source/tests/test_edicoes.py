"""Testes das edicoes: quem ve' quais abas, e por qual caminho.

Sao tres origens e uma ordem entre elas. O erro que estes testes procuram nao
aparece como erro: a aba certa fica visivel para o cliente errado, ou some
para quem deveria ver - e ninguem recebe mensagem nenhuma.

A terceira origem chega pela rede. Se a assinatura nao fosse conferida, quem
trocasse o manifesto no caminho mandaria esconder abas na maquina dos outros.
"""

import base64
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
os.environ.setdefault("CONCRE_NO_WINDOW", "1")
os.environ.setdefault("CONCRESTATS_WEB", "0")

import app          # noqa: E402
import assinatura   # noqa: E402
import atualizador  # noqa: E402


def rodar():
    falhas = []

    def conf(nome, cond, detalhe=""):
        print(("OK   " if cond else "FALHA") + " | " + nome + (f"  ({detalhe})" if detalhe else ""))
        if not cond:
            falhas.append(nome)

    EU, OUTRO = "aaa111bbb2", "zzz999yyy8"
    USINOP = {"nome": "Usinop", "ocultar": ["painel"]}

    # ── compatibilidade: manifesto sem edicao assina igual ao de antes
    antes = json.dumps({"versao": "1", "sha256": "ab"},
                       sort_keys=True, separators=(",", ":")).encode("utf-8")
    conf("Manifesto sem edicao assina como sempre assinou",
         atualizador.corpo_assinado("1", "ab") == antes)
    conf("Edicao vazia nao muda a assinatura",
         atualizador.corpo_assinado("1", "ab", None, {}) == antes)
    conf("Edicao presente MUDA a assinatura",
         atualizador.corpo_assinado("1", "ab", None, {EU: USINOP}) != antes)

    # ── assinatura de verdade, com um par de chaves de teste
    semente = b"\x11" * 32
    publica = assinatura.chave_publica(semente)

    def manifesto(edicoes, adulterar=None):
        m = {"versao": "04/09/2026 15:11", "sha256": "cafe"}
        corpo = atualizador.corpo_assinado(m["versao"], m["sha256"], None, edicoes)
        m["assinatura"] = base64.b64encode(assinatura.assinar(corpo, semente)).decode()
        if edicoes:
            m["edicoes"] = edicoes
        if adulterar:
            m["edicoes"] = adulterar          # trocado DEPOIS de assinar
        return m

    bom = manifesto({EU: USINOP})
    conf("Manifesto legitimo confere",
         atualizador.conferir_manifesto(bom, publica) is None)

    # o ataque que motiva a assinatura: esconder abas na maquina dos outros
    forjado = manifesto({EU: USINOP}, adulterar={OUTRO: USINOP, EU: USINOP})
    conf("Trocar a edicao depois de assinar e' recusado",
         atualizador.conferir_manifesto(forjado, publica) is not None,
         str(atualizador.conferir_manifesto(forjado, publica)))

    conf("Chave errada e' recusada",
         atualizador.conferir_manifesto(bom, assinatura.chave_publica(b"\x22" * 32))
         is not None)
    conf("Chave de tamanho errado nao passa como valida",
         atualizador.conferir_manifesto(bom, b"curta") is not None)

    # ── para quem vale
    conf("A instalacao listada recebe a edicao",
         atualizador.edicao_do_manifesto(bom, EU) == USINOP)
    conf("Quem nao esta' na lista nao recebe nada",
         atualizador.edicao_do_manifesto(bom, OUTRO) is None)

    todos = manifesto({"*": USINOP})
    conf("Com *, qualquer instalacao recebe",
         atualizador.edicao_do_manifesto(todos, OUTRO) == USINOP)

    misto = manifesto({EU: {"nome": "", "ocultar": []}, "*": USINOP})
    conf("O codigo da instalacao vence o *",
         atualizador.edicao_do_manifesto(misto, EU) == {"nome": "", "ocultar": []})

    conf("Manifesto sem edicoes nao mexe em nada",
         atualizador.edicao_do_manifesto(manifesto(None), EU) is None)
    conf("Edicoes com formato errado nao quebram",
         atualizador.edicao_do_manifesto({"edicoes": "nao e' mapa"}, EU) is None)
    conf("Ocultar com formato errado vira lista vazia",
         atualizador.edicao_do_manifesto(
             {"edicoes": {"*": {"nome": "X", "ocultar": "painel"}}}, EU)
         == {"nome": "X", "ocultar": []})

    # ── a ordem das tres origens, medida na funcao que o programa usa
    solto = os.path.join(app.app_dir(), "edicao.json")
    guardado = app._prefs_cru().get("__edicao_remota")

    def limpar():
        if os.path.exists(solto):
            os.remove(solto)
        app._prefs_grava({"__edicao_remota": None})

    try:
        limpar()
        conf("Sem origem nenhuma, nada e' escondido",
             app.edicao() == {"nome": "", "ocultar": []})

        app._prefs_grava({"__edicao_remota": USINOP})
        conf("So' a remota: e' ela que vale",
             app.edicao() == USINOP, str(app.edicao()))

        with open(solto, "w", encoding="utf-8") as fh:
            json.dump({"nome": "Local", "ocultar": ["dashboard"]}, fh)
        conf("O arquivo solto vence a remota",
             app.edicao() == {"nome": "Local", "ocultar": ["dashboard"]},
             str(app.edicao()))

        os.remove(solto)
        conf("Tirando o solto, a remota volta a valer", app.edicao() == USINOP)

        # A remota apagada tem de DESLIGAR a edicao, e nao ficar para sempre:
        # senao nao havia como voltar atras a distancia.
        app._prefs_grava({"__edicao_remota": None})
        conf("Apagar a remota devolve todas as abas",
             app.edicao() == {"nome": "", "ocultar": []})
    finally:
        limpar()
        if guardado:
            app._prefs_grava({"__edicao_remota": guardado})

    print()
    if falhas:
        print("FALHARAM: " + ", ".join(falhas))
        return 1
    print("TODOS OS TESTES PASSARAM")
    return 0


if __name__ == "__main__":
    raise SystemExit(rodar())
