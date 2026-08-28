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


def conferir_pacote(bytes_do_zip, manifesto, chave_publica):
    """Confere hash e assinatura. Devolve None se está tudo certo, ou o motivo."""
    if len(bytes_do_zip) > TAMANHO_MAXIMO:
        return "pacote grande demais"
    sha = hashlib.sha256(bytes_do_zip).hexdigest()
    if sha != (manifesto.get("sha256") or "").lower():
        return "o arquivo baixado não confere com o anunciado"
    if len(chave_publica) != 32:
        return "atualização automática não está configurada nesta cópia"
    corpo = json.dumps({"versao": manifesto.get("versao", ""), "sha256": sha},
                       sort_keys=True, separators=(",", ":")).encode("utf-8")
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
