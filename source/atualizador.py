"""atualizador.py — atualizar sem baixar 33 MB de RAR e trocar pasta na mão.

O que muda entre uma versão e outra é quase sempre tela e comportamento
(js/css/html ≈ 1,5 MB, uns 400 KB compactados). O executável em si raramente
muda. Então o pacote de atualização leva só isso, e o app troca sozinho.

A parte séria: um mecanismo que baixa arquivo e passa a executá-lo é porta de
entrada se ninguém conferir a origem. Aqui o pacote é ASSINADO com a mesma
chave Ed25519 da mensalidade. Sem assinatura válida, nada é aplicado — nem que
o endereço tenha sido trocado, nem que a rede esteja sendo grampeada.

Três cuidados que valem citar:

1. CONFERE ANTES DE ABRIR. A assinatura é verificada sobre o hash do arquivo,
   e o hash é conferido, antes de descompactar qualquer coisa.

2. ZIP NÃO ESCREVE ONDE QUER. Um .zip pode conter "..\\..\\Windows\\algo.dll".
   Só entram caminhos dentro de static/ e templates/.

3. DÁ PARA VOLTAR. O que existe é guardado antes; se algo falhar no meio, o
   estado anterior é restaurado.
"""

import hashlib
import io
import json
import os
import shutil
import zipfile

import assinatura

PASTAS_PERMITIDAS = ("static/", "templates/")
TAMANHO_MAXIMO = 40 * 1024 * 1024        # 40 MB: pacote de tela não passa disso


def _seguro(nome):
    """O caminho dentro do zip pode ser aplicado?"""
    n = nome.replace("\\", "/")
    if n.startswith("/") or ".." in n.split("/") or ":" in n:
        return False
    return any(n.startswith(p) for p in PASTAS_PERMITIDAS)


def corpo_assinado(versao, sha256, liberado_para=None):
    """O texto exato que e' assinado. Quem publica e quem confere tem que montar
    igual, byte a byte — por isso mora aqui, num lugar so'.

    A lista de liberacao entra na assinatura. Ela nao e' barreira de seguranca
    (a assinatura e' que garante a origem do pacote), mas se ficasse de fora
    daria para apagar a lista de um manifesto legitimo e empurrar para o
    cliente uma versao que estava liberada so' para quem testa.
    """
    corpo = {"versao": versao, "sha256": sha256}
    if liberado_para:
        # ordenada: a mesma lista em outra ordem tem que dar a mesma assinatura
        corpo["liberado_para"] = sorted(str(x).strip() for x in liberado_para)
    return json.dumps(corpo, sort_keys=True, separators=(",", ":")).encode("utf-8")


def corpo_das_edicoes(versao, sha256, edicoes):
    """As edicoes tem assinatura PROPRIA, num campo proprio.

    A tentacao era junta-las ao corpo do pacote, que ja' e' assinado. Mas a
    conferencia do pacote roda na COPIA INSTALADA, que e' antiga por
    definicao: uma copia que nao conhece o campo novo montaria o corpo sem ele
    e recusaria o pacote como forjado. A atualizacao pararia justamente para
    quem mais precisa dela, com uma mensagem que faz pensar em invasao e nao
    em erro nosso. E para sair do buraco seria preciso... atualizar.

    Assinadas a parte, as copias antigas simplesmente ignoram o campo que nao
    entendem e continuam atualizando como sempre.

    Vai amarrado a versao e ao sha do pacote para que a assinatura de um
    manifesto nao possa ser colada em outro.
    """
    corpo = {"versao": versao, "sha256": sha256, "edicoes": edicoes}
    return json.dumps(corpo, sort_keys=True, separators=(",", ":")).encode("utf-8")


def conferir_manifesto(manifesto, chave_publica):
    """Confere so' a assinatura do manifesto, sem baixar o pacote.

    O conferir_pacote() so' roda na hora de aplicar - tarde demais para
    decidir se da' para acreditar no que o manifesto diz sobre a edicao. Esta
    aqui roda na verificacao, que e' quando a edicao chega.
    """
    if not manifesto.get("edicoes"):
        return None                      # nada a conferir: nao ha' edicao
    if len(chave_publica) != 32:
        return "atualização automática não está configurada nesta cópia"
    corpo = corpo_das_edicoes(manifesto.get("versao", ""),
                              str(manifesto.get("sha256") or "").lower(),
                              manifesto.get("edicoes"))
    try:
        import base64
        firma = base64.b64decode(manifesto.get("assinatura_edicoes", ""))
    except Exception:  # noqa: BLE001
        return "assinatura das edições ilegível"
    if not assinatura.conferir(corpo, firma, chave_publica):
        return "as edições deste manifesto não foram publicadas por nós"
    return None


def edicao_do_manifesto(manifesto, ident):
    """Qual edicao este manifesto manda para ESTA instalacao?

    O mapa e' {"<codigo da instalacao>": {...}}, e a chave "*" vale para quem
    nao esta' listado. Devolve None quando o manifesto nao fala de edicao -
    que e' o caso normal e nao mexe em nada.
    """
    mapa = manifesto.get("edicoes")
    if not isinstance(mapa, dict) or not mapa:
        return None
    escolhida = mapa.get(str(ident).strip())
    if escolhida is None:
        escolhida = mapa.get("*")
    if escolhida is None:
        return None
    if not isinstance(escolhida, dict):
        return None
    ocultar = escolhida.get("ocultar") or []
    if not isinstance(ocultar, list):
        ocultar = []
    return {"nome": str(escolhida.get("nome") or ""),
            "ocultar": [str(x).strip().lower() for x in ocultar if str(x).strip()]}


def conferir_pacote(bytes_do_zip, manifesto, chave_publica):
    """Confere hash e assinatura. Devolve None se está tudo certo, ou o motivo."""
    if len(bytes_do_zip) > TAMANHO_MAXIMO:
        return "pacote grande demais"
    sha = hashlib.sha256(bytes_do_zip).hexdigest()
    if sha != (manifesto.get("sha256") or "").lower():
        return "o arquivo baixado não confere com o anunciado"
    if len(chave_publica) != 32:
        return "atualização automática não está configurada nesta cópia"
    # As edicoes NAO entram aqui: elas tem assinatura propria (ver
    # corpo_das_edicoes). Assim uma copia antiga, que nem sabe que edicao
    # existe, continua conferindo o pacote exatamente como sempre conferiu.
    corpo = corpo_assinado(manifesto.get("versao", ""), sha,
                           manifesto.get("liberado_para"))
    try:
        import base64
        firma = base64.b64decode(manifesto.get("assinatura", ""))
    except Exception:  # noqa: BLE001
        return "assinatura ilegível"
    if not assinatura.conferir(corpo, firma, chave_publica):
        return "esta atualização não foi publicada por nós (assinatura não confere)"
    return None


def aplicar(bytes_do_zip, pasta_do_app):
    """Troca static/ e templates/ pelo conteúdo do pacote. Devolve (ok, mensagem)."""
    backup = os.path.join(pasta_do_app, "_antes_da_atualizacao")
    try:
        with zipfile.ZipFile(io.BytesIO(bytes_do_zip)) as z:
            itens = [n for n in z.namelist() if not n.endswith("/")]
            if not itens:
                return False, "pacote vazio"
            fora = [n for n in itens if not _seguro(n)]
            if fora:
                return False, f"pacote tenta escrever fora do lugar ({fora[0]})"

            # guarda o que existe hoje
            shutil.rmtree(backup, ignore_errors=True)
            os.makedirs(backup, exist_ok=True)
            for pasta in ("static", "templates"):
                origem = os.path.join(pasta_do_app, pasta)
                if os.path.isdir(origem):
                    shutil.copytree(origem, os.path.join(backup, pasta))

            try:
                for nome in itens:
                    destino = os.path.join(pasta_do_app, nome.replace("/", os.sep))
                    os.makedirs(os.path.dirname(destino), exist_ok=True)
                    with z.open(nome) as entrada, open(destino, "wb") as saida:
                        shutil.copyfileobj(entrada, saida, 1024 * 64)
            except Exception as e:  # noqa: BLE001 -- desfaz e devolve o motivo
                for pasta in ("static", "templates"):
                    guardado = os.path.join(backup, pasta)
                    if os.path.isdir(guardado):
                        shutil.rmtree(os.path.join(pasta_do_app, pasta), ignore_errors=True)
                        shutil.copytree(guardado, os.path.join(pasta_do_app, pasta))
                return False, f"falhou no meio e voltei ao estado anterior ({e})"
        return True, f"{len(itens)} arquivo(s) atualizados"
    except zipfile.BadZipFile:
        return False, "o arquivo baixado está corrompido"
    except OSError as e:
        return False, f"não consegui gravar ({e})"


def baixar(url, limite=TAMANHO_MAXIMO, tempo=30):
    """Baixa o pacote. Quem chama já validou o endereço."""
    import urllib.request
    pedido = urllib.request.Request(url, headers={"User-Agent": "Concrestats"})
    with urllib.request.urlopen(pedido, timeout=tempo) as r:
        dados = r.read(limite + 1)
    if len(dados) > limite:
        raise ValueError("pacote grande demais")
    return dados
