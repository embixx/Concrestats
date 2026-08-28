"""Testes do PIX. Codigo de cobranca errado nao da' erro na tela: da' erro no
aplicativo do banco do cliente, na hora de pagar, e voce so' descobre pelo
telefone. Por isso cada campo e' desmontado e conferido aqui."""

import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))

import pagamento  # noqa: E402


def desmontar(carga):
    """Le' o BR Code de volta: id -> conteudo. Se o tamanho declarado nao bater
    com o conteudo real, isso estoura aqui — que e' o ponto."""
    campos, i = {}, 0
    while i < len(carga):
        ident = carga[i:i + 2]
        tamanho = int(carga[i + 2:i + 4])
        campos[ident] = carga[i + 4:i + 4 + tamanho]
        i += 4 + tamanho
    return campos


def rodar():
    falhas = []

    def conf(nome, cond, detalhe=""):
        print(("OK   " if cond else "FALHA") + " | " + nome +
              (f"  ({detalhe})" if detalhe else ""))
        if not cond:
            falhas.append(nome)

    # ── o CRC, contra o vetor conhecido da CCITT-FALSE
    conf("CRC-16/CCITT-FALSE de '123456789' e' 29B1",
         pagamento._crc16("123456789") == "29B1", pagamento._crc16("123456789"))

    # ── um codigo completo, desmontado campo a campo
    codigo = pagamento.codigo_pix("12345678901", "Usinop Concreto",
                                  "Sinop", 149.90)
    c = desmontar(codigo)
    conf("Versao do formato e' 01", c.get("00") == "01")
    conf("Moeda e' real (986)", c.get("53") == "986")
    conf("Pais e' BR", c.get("58") == "BR")
    conf("Valor sai com 2 casas", c.get("54") == "149.90", c.get("54"))
    conf("Ramo de atividade preenchido", c.get("52") == "0000")

    dentro = desmontar(c.get("26", ""))
    conf("Dominio do PIX correto", dentro.get("00") == "br.gov.bcb.pix")
    conf("A chave vai inteira", dentro.get("01") == "12345678901")

    conf("CRC do codigo confere",
         pagamento._crc16(codigo[:-4]) == codigo[-4:])
    conf("CRC fica nos ultimos 4 e vem depois de 6304",
         codigo[-8:-4] == "6304")

    # ── acento e cedilha quebram o padrao: tem que sumir
    ac = desmontar(pagamento.codigo_pix("x", "Concreto Sao Joao", "Sinop", 10))
    conf("Nome perde o acento", ac.get("59") == "CONCRETO SAO JOAO", ac.get("59"))
    ac2 = desmontar(pagamento.codigo_pix("x", "Usinop", "Varzea Grande", 10))
    conf("Cidade perde o acento", ac2.get("60") == "VARZEA GRANDE", ac2.get("60"))

    # ── limites de tamanho do padrao
    lg = desmontar(pagamento.codigo_pix(
        "x", "Laboratorio de Concreto e Argamassa do Centro Oeste",
        "Sao Jose dos Quatro Marcos", 10))
    conf("Nome cortado em 25", len(lg.get("59", "")) <= 25, lg.get("59"))
    conf("Cidade cortada em 15", len(lg.get("60", "")) <= 15, lg.get("60"))

    # ── cobranca sem valor: o cliente digita quanto pagar
    sem = desmontar(pagamento.codigo_pix("x", "Usinop", "Sinop", None))
    conf("Sem valor, o campo 54 nao existe", "54" not in sem)
    conf("Sem valor, o resto continua valido", sem.get("53") == "986")

    # ── valores que costumam quebrar formatacao
    for valor, esperado in ((1, "1.00"), (0.5, "0.50"), (1234.5, "1234.50"),
                            (99.99, "99.99"), (1000, "1000.00")):
        d = desmontar(pagamento.codigo_pix("x", "U", "S", valor))
        conf(f"Valor {valor} vira {esperado}", d.get("54") == esperado, d.get("54"))

    # ── todo campo declara o proprio tamanho: um erro de 1 caractere quebra tudo
    conf("Todos os tamanhos declarados batem", desmontar(codigo) is not None)

    # ── sem chave configurada, nao mostra tela de pagamento
    conf("Sem chave, nao se considera configurado",
         not pagamento.configurado({"chave": "", "nome": "x", "cidade": "y"}))
    conf("Com os tres campos, considera configurado",
         pagamento.configurado({"chave": "a", "nome": "b", "cidade": "c"}))

    # ── o QR tem que sair desenhavel
    svg = pagamento.qr_svg(codigo)
    conf("QR sai como SVG", svg.startswith("<?xml") or "<svg" in svg)
    conf("QR tem tamanho definido", 'width="210"' in svg)

    print("\n" + ("TODOS OS TESTES PASSARAM" if not falhas else f"FALHAS: {falhas}"))
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(rodar())
