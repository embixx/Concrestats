"""Testes do atualizador. Um mecanismo que baixa e passa a executar arquivo é
o ponto mais perigoso do programa — aqui cada defesa é atacada de propósito."""

import base64
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))

import assinatura      # noqa: E402
import atualizador     # noqa: E402

SEMENTE = bytes(range(32))
PUBLICA = assinatura.chave_publica(SEMENTE)


def montar_zip(arquivos):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for nome, conteudo in arquivos.items():
            z.writestr(nome, conteudo)
    return buf.getvalue()


def manifesto_de(dados, versao="26/08/2026 10:00", semente=SEMENTE, somente=None):
    sha = hashlib.sha256(dados).hexdigest()
    corpo = atualizador.corpo_assinado(versao, sha, somente)
    m = {"versao": versao, "sha256": sha,
         "assinatura": base64.b64encode(assinatura.assinar(corpo, semente)).decode()}
    if somente:
        m["liberado_para"] = sorted(somente)
    return m


def rodar():
    falhas = []

    def conf(nome, cond, detalhe=""):
        print(("OK   " if cond else "FALHA") + " | " + nome + (f"  ({detalhe})" if detalhe else ""))
        if not cond:
            falhas.append(nome)

    bom = montar_zip({"static/js/app.js": "// novo\n",
                      "templates/index.html": "<html>novo</html>"})

    # ── aceita o que é nosso
    m = manifesto_de(bom)
    conf("Pacote legítimo é aceito",
         atualizador.conferir_pacote(bom, m, PUBLICA) is None)

    # ── recusa o que não é
    m2 = manifesto_de(bom, semente=bytes([9] * 32))
    conf("Pacote assinado por outra chave é recusado",
         atualizador.conferir_pacote(bom, m2, PUBLICA) is not None,
         atualizador.conferir_pacote(bom, m2, PUBLICA))

    mexido = montar_zip({"static/js/app.js": "// CODIGO DE ATACANTE\n"})
    m3 = manifesto_de(bom)                      # manifesto do arquivo bom...
    conf("Arquivo trocado no caminho é recusado",
         atualizador.conferir_pacote(mexido, m3, PUBLICA) is not None,
         atualizador.conferir_pacote(mexido, m3, PUBLICA))

    m4 = dict(manifesto_de(bom)); m4["versao"] = "99/99/9999"
    conf("Versão mexida no manifesto é recusada",
         atualizador.conferir_pacote(bom, m4, PUBLICA) is not None)

    conf("Sem chave configurada, não aplica nada",
         atualizador.conferir_pacote(bom, manifesto_de(bom), b"curta") is not None)

    # ── zip que tenta escapar da pasta
    for perigoso in ("../../Windows/System32/algo.dll",
                     "..\\..\\evil.exe",
                     "/etc/passwd",
                     "C:/Windows/algo.dll",
                     "outra_pasta/x.js"):
        z = montar_zip({perigoso: "x"})
        pasta = tempfile.mkdtemp(prefix="upd_")
        try:
            ok, msg = atualizador.aplicar(z, pasta)
            conf(f"Zip com caminho perigoso recusado: {perigoso[:28]}", not ok, msg[:44])
        finally:
            shutil.rmtree(pasta, ignore_errors=True)

    # ── aplicar de verdade, e voltar atrás quando falha
    pasta = tempfile.mkdtemp(prefix="upd_")
    try:
        os.makedirs(os.path.join(pasta, "static", "js"))
        os.makedirs(os.path.join(pasta, "templates"))
        with open(os.path.join(pasta, "static", "js", "app.js"), "w") as fh:
            fh.write("// versao antiga\n")
        with open(os.path.join(pasta, "templates", "index.html"), "w") as fh:
            fh.write("<html>antigo</html>")

        ok, msg = atualizador.aplicar(bom, pasta)
        conteudo = open(os.path.join(pasta, "static", "js", "app.js")).read()
        conf("Aplica e substitui os arquivos", ok and "novo" in conteudo, msg)
        conf("Guarda o estado anterior",
             os.path.isdir(os.path.join(pasta, "_antes_da_atualizacao", "static")))
        anterior = open(os.path.join(pasta, "_antes_da_atualizacao",
                                     "static", "js", "app.js")).read()
        conf("A cópia guardada é mesmo a versão antiga", "antiga" in anterior)
    finally:
        shutil.rmtree(pasta, ignore_errors=True)

    # ── quem recebe qual versao ────────────────────────────────────────────
    # A lista de liberacao viaja assinada. Ela nao guarda o pacote (a
    # assinatura faz isso), mas se ficasse de fora daria para apagar a lista
    # de um manifesto legitimo e entregar ao cliente uma versao que estava
    # liberada so' para quem testa.
    restrito = manifesto_de(bom, somente=["aaa111bbb2", "ccc333ddd4"])
    conf("Manifesto com lista de liberacao e' aceito",
         atualizador.conferir_pacote(bom, restrito, PUBLICA) is None)

    sem_lista = dict(restrito); sem_lista.pop("liberado_para")
    conf("Apagar a lista quebra a assinatura",
         atualizador.conferir_pacote(bom, sem_lista, PUBLICA) is not None,
         atualizador.conferir_pacote(bom, sem_lista, PUBLICA))

    com_intruso = dict(restrito)
    com_intruso["liberado_para"] = restrito["liberado_para"] + ["eu9999zzz0"]
    conf("Acrescentar alguem na lista quebra a assinatura",
         atualizador.conferir_pacote(bom, com_intruso, PUBLICA) is not None)

    trocado = dict(restrito); trocado["liberado_para"] = ["eu9999zzz0"]
    conf("Trocar a lista inteira quebra a assinatura",
         atualizador.conferir_pacote(bom, trocado, PUBLICA) is not None)

    fora_de_ordem = dict(restrito)
    fora_de_ordem["liberado_para"] = list(reversed(restrito["liberado_para"]))
    conf("A mesma lista em outra ordem continua valendo",
         atualizador.conferir_pacote(bom, fora_de_ordem, PUBLICA) is None)

    conf("Lista vazia assina igual a nenhuma lista",
         atualizador.corpo_assinado("v", "abc", []) ==
         atualizador.corpo_assinado("v", "abc", None))
    # ── pacote absurdamente grande
    m5 = manifesto_de(b"x")
    conf("Pacote grande demais é recusado",
         atualizador.conferir_pacote(b"x" * (41 * 1024 * 1024), m5, PUBLICA) is not None)

    print("\n" + ("TODOS OS TESTES PASSARAM" if not falhas else f"FALHAS: {falhas}"))
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(rodar())
