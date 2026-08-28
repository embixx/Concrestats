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


def manifesto_de(dados, versao="26/08/2026 10:00", semente=SEMENTE):
    sha = hashlib.sha256(dados).hexdigest()
    corpo = json.dumps({"versao": versao, "sha256": sha},
                       sort_keys=True, separators=(",", ":")).encode()
    return {"versao": versao, "sha256": sha,
            "assinatura": base64.b64encode(assinatura.assinar(corpo, semente)).decode()}


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

    # ── pacote absurdamente grande
    m5 = manifesto_de(b"x")
    conf("Pacote grande demais é recusado",
         atualizador.conferir_pacote(b"x" * (41 * 1024 * 1024), m5, PUBLICA) is not None)

    print("\n" + ("TODOS OS TESTES PASSARAM" if not falhas else f"FALHAS: {falhas}"))
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(rodar())
