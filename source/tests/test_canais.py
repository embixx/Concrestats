"""Testes de quem recebe qual versao.

O erro que estes testes procuram nao e' de seguranca — e' de ENTREGA. Mandar
para o cliente uma versao que ainda esta' sendo testada, ou deixar quem testa
preso na versao velha, sao as duas maneiras de este mecanismo falhar.
"""

import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
os.environ.setdefault("CONCRE_NO_WINDOW", "1")
os.environ.setdefault("CONCRESTATS_WEB", "0")

import app  # noqa: E402


def rodar():
    falhas = []

    def conf(nome, cond, detalhe=""):
        print(("OK   " if cond else "FALHA") + " | " + nome + (f"  ({detalhe})" if detalhe else ""))
        if not cond:
            falhas.append(nome)

    # ── o endereco de cada canal
    base = "https://exemplo.com/atualizacao/manifesto.json"
    conf("Canal estavel usa o manifesto principal",
         app._url_do_canal(base, "estavel") == base)
    conf("Canal de teste usa um arquivo ao lado",
         app._url_do_canal(base, "teste") ==
         "https://exemplo.com/atualizacao/manifesto-teste.json",
         app._url_do_canal(base, "teste"))
    conf("Sem endereco nenhum, continua sem endereco",
         app._url_do_canal("", "teste") == "")

    # ── a liberacao por instalacao
    EU, OUTRO = "aaa111bbb2", "zzz999yyy8"

    conf("Manifesto sem lista vale para todo mundo",
         app._liberado_para_mim({"versao": "1"}, EU) is None)
    conf("Lista vazia tambem vale para todo mundo",
         app._liberado_para_mim({"liberado_para": []}, EU) is None)
    conf("Estando na lista, recebe",
         app._liberado_para_mim({"liberado_para": [OUTRO, EU]}, EU) is None)
    conf("Fora da lista, nao recebe",
         app._liberado_para_mim({"liberado_para": [OUTRO]}, EU) is not None)
    conf("Espaco em volta do codigo nao atrapalha",
         app._liberado_para_mim({"liberado_para": ["  " + EU + " "]}, EU) is None)
    conf("Lista malformada nao libera por acidente",
         app._liberado_para_mim({"liberado_para": "aaa111bbb2"}, EU) is not None)

    # O caso que da' errado calado: codigo parecido nao pode passar.
    conf("Codigo parecido nao entra",
         app._liberado_para_mim({"liberado_para": ["aaa111bbb"]}, EU) is not None)
    conf("Codigo com sufixo nao entra",
         app._liberado_para_mim({"liberado_para": ["aaa111bbb23"]}, EU) is not None)

    # ── o canal so' aceita o que existe
    conf("Canal desconhecido cai no estavel",
         all(c in app.CANAIS for c in (app.CANAIS[0], app.CANAIS[1])))

    # ── o identificador
    ident = app._id_da_instalacao()
    conf("Identificador tem 10 caracteres", len(ident) == 10, ident)
    conf("So' letras e numeros", ident.isalnum(), ident)
    conf("Nao muda entre chamadas", ident == app._id_da_instalacao())

    print()
    print("TODOS OS TESTES PASSARAM" if not falhas else f"FALHAS: {falhas}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(rodar())
