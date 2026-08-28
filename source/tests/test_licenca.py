"""Testes da licença. Usa um par de chaves descartável, criado na hora e só em
memória — nada aqui toca a chave real de produção."""

import base64
import datetime
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))

import assinatura          # noqa: E402
import licenca             # noqa: E402

SEMENTE_DE_TESTE = bytes(range(32))          # fixa: teste tem que ser repetível
PUBLICA_DE_TESTE = assinatura.chave_publica(SEMENTE_DE_TESTE)


def montar(cliente="Usinop Concreto", vence="2027-01-31", plano="mensal",
           semente=SEMENTE_DE_TESTE):
    dados = {"cliente": cliente, "vence": vence, "plano": plano,
             "emitido": "2026-08-25", "id": "abc12345"}
    corpo = json.dumps(dados, sort_keys=True, separators=(",", ":"),
                       ensure_ascii=False).encode("utf-8")
    firma = assinatura.assinar(corpo, semente)
    pacote = {"licenca": dados, "assinatura": base64.b64encode(firma).decode()}
    return base64.b64encode(json.dumps(pacote, ensure_ascii=False)
                            .encode("utf-8")).decode()


def rodar():
    licenca.CHAVE_PUBLICA = PUBLICA_DE_TESTE      # aponta para o par de teste
    falhas = []

    def conf(nome, condicao, detalhe=""):
        marca = "OK   " if condicao else "FALHA"
        print(f"{marca} | {nome}" + (f"  ({detalhe})" if detalhe else ""))
        if not condicao:
            falhas.append(nome)

    # ── aceitar o que é nosso
    dados, erro = licenca.interpretar(montar())
    conf("Licença legítima é aceita", dados and not erro, erro or dados.get("cliente"))

    # ── recusar o que não é
    outra = bytes([1] * 32)
    _, erro = licenca.interpretar(montar(semente=outra))
    conf("Licença de outra chave é recusada", erro is not None, erro)

    adulterada = montar()
    cru = json.loads(base64.b64decode(adulterada))
    cru["licenca"]["vence"] = "2099-12-31"        # estica o prazo na marra
    texto = base64.b64encode(json.dumps(cru, ensure_ascii=False).encode()).decode()
    _, erro = licenca.interpretar(texto)
    conf("Data esticada à mão é recusada", erro is not None, erro)

    cru2 = json.loads(base64.b64decode(montar()))
    cru2["licenca"]["cliente"] = "Concorrente S/A"
    texto2 = base64.b64encode(json.dumps(cru2, ensure_ascii=False).encode()).decode()
    _, erro = licenca.interpretar(texto2)
    conf("Troca de cliente é recusada", erro is not None, erro)

    _, erro = licenca.interpretar("nao sou uma licenca")
    conf("Texto qualquer não quebra o app", erro is not None, erro)

    # ── estados ao longo do tempo
    hoje = datetime.date.today()
    def com_vencimento(dias):
        d, _ = licenca.interpretar(montar(vence=(hoje + datetime.timedelta(days=dias)).isoformat()))
        return licenca.situacao(d)

    s = com_vencimento(20)
    conf("Em dia: grava normalmente", s["estado"] == "valida" and s["pode_gravar"], s["texto"])

    s = com_vencimento(5)
    conf("Perto de vencer: avisa mas grava", s["estado"] == "valida" and s["pode_gravar"], s["texto"])

    s = com_vencimento(-3)
    conf("Vencida há 3 dias: cortesia, ainda grava",
         s["estado"] == "cortesia" and s["pode_gravar"], s["texto"])

    s = com_vencimento(-30)
    conf("Vencida de vez: NÃO grava", s["estado"] == "vencida" and not s["pode_gravar"])
    conf("Vencida: mensagem diz que os dados continuam acessíveis",
         "acessíveis" in s["texto"], s["texto"][:60] + "...")

    # ── teste sem licença
    s = licenca.situacao(None)
    conf("Sem licença: começa o teste", s["estado"] == "teste" and s["pode_gravar"], s["texto"])
    s = licenca.situacao(None, inicio_do_teste=(hoje - datetime.timedelta(days=20)).isoformat())
    conf("Teste vencido: não grava", s["estado"] == "teste_vencido" and not s["pode_gravar"])

    # ── relógio atrasado não renova licença
    ontem_de_verdade = (hoje + datetime.timedelta(days=40)).isoformat()   # já vimos o futuro
    d, _ = licenca.interpretar(montar(vence=(hoje + datetime.timedelta(days=10)).isoformat()))
    s = licenca.situacao(d, marca_do_relogio=ontem_de_verdade)
    conf("Atrasar o relógio não renova", s["estado"] in ("vencida", "cortesia") and s["relogio_voltou"],
         s["estado"] + ", relogio_voltou=" + str(s["relogio_voltou"]))

    print("\n" + ("TODOS OS TESTES PASSARAM" if not falhas else f"FALHAS: {falhas}"))
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(rodar())
