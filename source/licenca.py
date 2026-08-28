"""licenca.py — mensalidade do Concrestats.

Como funciona, em uma frase: quem vende gera um arquivo `licenca.key` assinado
com a chave privada; o app confere com a chave pública embutida e olha a data.

Decisões que valem explicar:

1. ARQUIVO, não código digitado. A assinatura tem 64 bytes; digitar isso à mão
   seria cruel. O cliente recebe um arquivo e aponta onde ele está.

2. VENCER NÃO TRANCA OS DADOS. Depois do vencimento vêm 7 dias de aviso e, aí
   sim, o app entra em modo leitura: abre, filtra, analisa e imprime, mas não
   salva nem exporta. Ninguém fica refém da planilha do próprio laboratório —
   e um cliente trancado não paga, desinstala.

3. O RELÓGIO ANDA PARA TRÁS. Guardamos a maior data já vista; se o computador
   voltar no tempo, o app percebe e usa a data guardada. Sem isso, atrasar o
   relógio do Windows renovaria a licença de graça.

4. SEM INTERNET. O laboratório fica em usina, com rede ruim. Nada aqui exige
   estar online.
"""

import base64
import datetime
import json
import os

import assinatura

# Chave PÚBLICA. Confere assinatura, não cria nenhuma — pode ficar à vista.
# A privada vive só em tools/emitir_licenca.py, na máquina de quem vende.
CHAVE_PUBLICA = base64.b64decode("PUBLICA_AQUI_PLACEHOLDER_32_BYTES_BASE64==")

# Enquanto a chave não for gerada (tools/emitir_licenca.py --criar-chaves), a
# mensalidade fica DESLIGADA e o app funciona inteiro. Cobrar com a chave
# errada travaria todo mundo por engano de configuração, não por regra de
# negócio — e o cliente pagante é quem pagaria o pato.
def configurada():
    return len(CHAVE_PUBLICA) == 32

DIAS_DE_CORTESIA = 7        # depois de vencer, ainda funciona avisando
DIAS_DE_TESTE = 15          # sem licença nenhuma, para conhecer o produto

ESTADOS = ("valida", "cortesia", "vencida", "teste", "teste_vencido", "invalida")


def _hoje(marca_do_relogio):
    """Data de hoje, protegida contra relógio atrasado.

    Devolve (data, relogio_voltou). A marca é a maior data já vista, guardada
    nas preferências pelo chamador.
    """
    agora = datetime.date.today()
    if marca_do_relogio:
        try:
            vista = datetime.date.fromisoformat(marca_do_relogio)
            if agora < vista:
                return vista, True
        except ValueError:
            pass
    return agora, False


def ler_arquivo(caminho):
    """Lê e confere o licenca.key. Devolve (dados, erro)."""
    try:
        with open(caminho, "r", encoding="utf-8") as fh:
            bruto = fh.read().strip()
    except OSError as e:
        return None, f"não consegui ler o arquivo ({e.strerror or e})"
    return interpretar(bruto)


def interpretar(bruto):
    """Texto do licenca.key → (dados, erro)."""
    try:
        limpo = "".join(bruto.split())
        pacote = json.loads(base64.b64decode(limpo).decode("utf-8"))
        corpo = json.dumps(pacote["licenca"], sort_keys=True,
                           separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        firma = base64.b64decode(pacote["assinatura"])
    except Exception:  # noqa: BLE001 -- qualquer defeito é licença inválida
        return None, "arquivo de licença ilegível"

    if not assinatura.conferir(corpo, firma, CHAVE_PUBLICA):
        return None, "esta licença não foi emitida por nós (assinatura não confere)"

    dados = pacote["licenca"]
    for campo in ("cliente", "vence"):
        if not dados.get(campo):
            return None, f"licença sem {campo}"
    try:
        datetime.date.fromisoformat(dados["vence"])
    except ValueError:
        return None, "data de vencimento inválida"
    return dados, None


def situacao(dados, marca_do_relogio=None, inicio_do_teste=None):
    """Diz em que pé está a licença, para o app decidir o que liberar."""
    hoje, voltou = _hoje(marca_do_relogio)

    if not configurada():
        return {"estado": "livre", "dias": 0, "pode_gravar": True,
                "texto": "Mensalidade não configurada nesta cópia",
                "relogio_voltou": False}

    if not dados:
        # sem licença: período de conhecimento
        if not inicio_do_teste:
            return {"estado": "teste", "dias": DIAS_DE_TESTE, "pode_gravar": True,
                    "texto": f"Período de teste — {DIAS_DE_TESTE} dias",
                    "relogio_voltou": voltou}
        try:
            comeco = datetime.date.fromisoformat(inicio_do_teste)
        except ValueError:
            comeco = hoje
        restam = DIAS_DE_TESTE - (hoje - comeco).days
        if restam > 0:
            return {"estado": "teste", "dias": restam, "pode_gravar": True,
                    "texto": f"Período de teste — {restam} dia(s) restante(s)",
                    "relogio_voltou": voltou}
        return {"estado": "teste_vencido", "dias": 0, "pode_gravar": False,
                "texto": "Período de teste encerrado — o app abre e analisa, "
                         "mas não salva nem exporta",
                "relogio_voltou": voltou}

    vence = datetime.date.fromisoformat(dados["vence"])
    restam = (vence - hoje).days
    cliente = dados.get("cliente", "")

    if restam >= 0:
        return {"estado": "valida", "dias": restam, "pode_gravar": True,
                "cliente": cliente, "vence": dados["vence"],
                "texto": (f"Licenciado para {cliente}" +
                          (f" — vence em {restam} dia(s)" if restam <= 10 else "")),
                "relogio_voltou": voltou}

    atraso = -restam
    if atraso <= DIAS_DE_CORTESIA:
        return {"estado": "cortesia", "dias": DIAS_DE_CORTESIA - atraso, "pode_gravar": True,
                "cliente": cliente, "vence": dados["vence"],
                "texto": (f"Mensalidade vencida há {atraso} dia(s). "
                          f"O app continua completo por mais "
                          f"{DIAS_DE_CORTESIA - atraso} dia(s)."),
                "relogio_voltou": voltou}

    return {"estado": "vencida", "dias": 0, "pode_gravar": False,
            "cliente": cliente, "vence": dados["vence"],
            "texto": (f"Mensalidade vencida em {_br(dados['vence'])}. "
                      "Seus dados continuam acessíveis: dá para abrir, filtrar, "
                      "analisar e imprimir. Salvar e exportar voltam assim que "
                      "a licença for renovada."),
            "relogio_voltou": voltou}


def _br(iso):
    try:
        a, m, d = iso.split("-")
        return f"{d}/{m}/{a}"
    except ValueError:
        return iso


def procurar(pasta):
    """Acha o licenca.key ao lado do executável, se houver."""
    for nome in ("licenca.key", "licença.key", "concrestats.key"):
        p = os.path.join(pasta, nome)
        if os.path.isfile(p):
            return p
    return None
