"""Testes da comparacao de versao.

O erro que estes testes procuram nao aparece na tela: o programa oferece uma
atualizacao que nao e' atualizacao, e quem recebe aplica achando que esta'
avancando.
"""
import os, sys
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
os.environ.setdefault("CONCRE_NO_WINDOW", "1")
os.environ.setdefault("CONCRESTATS_WEB", "0")
import app  # noqa: E402


def rodar():
    falhas = []
    def conf(nome, cond, detalhe=""):
        print(("OK   " if cond else "FALHA") + " | " + nome + (f"  ({detalhe})" if detalhe else ""))
        if not cond: falhas.append(nome)

    m = app._mais_nova
    conf("Mais recente e' oferecida",
         m("30/08/2026 10:00", "29/08/2026 16:58"))
    conf("A mesma nao e' oferecida",
         not m("29/08/2026 16:58", "29/08/2026 16:58"))
    conf("MAIS ANTIGA nao e' oferecida",
         not m("28/08/2026 10:00", "29/08/2026 16:58"))
    conf("Uma hora depois no mesmo dia conta",
         m("29/08/2026 23:15", "29/08/2026 16:58"))
    conf("Um minuto antes nao conta",
         not m("29/08/2026 16:57", "29/08/2026 16:58"))

    # o caso que a comparacao por texto errava
    conf("Dezembro e' mais novo que agosto (texto diria o contrario)",
         m("01/12/2026 08:00", "29/08/2026 16:58"))
    conf("Agosto nao e' mais novo que dezembro",
         not m("29/08/2026 16:58", "01/12/2026 08:00"))
    conf("Ano seguinte conta",
         m("01/01/2027 00:00", "31/12/2026 23:59"))

    # versao escrita a mao: volta ao comportamento antigo
    conf("Texto ilegivel diferente ainda conta", m("2.1", "2.0"))
    conf("Texto ilegivel igual nao conta", not m("2.0", "2.0"))
    conf("Vazio nunca conta", not m("", "29/08/2026 16:58"))
    conf("Sem versao instalada, qualquer anuncio conta", m("29/08/2026 16:58", ""))

    print()
    print("TODOS OS TESTES PASSARAM" if not falhas else f"FALHAS: {falhas}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(rodar())
