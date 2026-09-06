# -*- coding: utf-8 -*-
"""Assina o Concrestats.exe com um certificado de code signing.

Por que existe
--------------
O Naor recebeu PDM:Trojan.Win32.Generic no exe. E' veredito de COMPORTAMENTO
do antivirus, nao assinatura de virus: o programa e' novo, ninguem no mundo o
conhece, ele descompacta Python em tempo de execucao e baixa a propria
atualizacao escrevendo codigo na pasta dele. Cada um desses conta ponto.

Assinar e' o unico jeito de sair dessa lista de uma vez: o executavel passa a
dizer de quem e', o antivirus tem a quem atribuir, e o SmartScreen do Windows
para de tratar cada build como um arquivo desconhecido.

O que este arquivo NAO faz
--------------------------
Nao guarda certificado nem senha. Desde junho de 2023 a chave de um
certificado de code signing tem de viver em hardware (token USB ou HSM na
nuvem) — nao existe mais o .pfx que se copiava para a maquina. Entao aqui so'
ha' a receita de COMO chamar a assinatura; o segredo fica no token ou no
servico, fora do projeto e fora do git.

Como ligar
----------
Crie `%APPDATA%\\Concrestats\\assinatura_exe.json` (mesma pasta da chave das
atualizacoes, que tambem nunca entra no repositorio).

Certificado em token USB, ja' instalado no Windows:

    {
      "modo": "token",
      "thumbprint": "a1b2c3...",      // Gerenciador de Certificados > Detalhes
      "timestamp": "http://timestamp.digicert.com",
      "descricao": "Concrestats",
      "url": "https://trello.com/b/NF2AmAIp"
    }

Servico de assinatura na nuvem (Azure Trusted Signing, DigiCert KeyLocker,
SSL.com eSigner): a linha de comando inteira, com {arquivo} onde entra o exe.

    {
      "modo": "comando",
      "comando": ["signtool", "sign", "/fd", "SHA256", "/tr",
                  "http://timestamp.acs.microsoft.com", "/td", "SHA256",
                  "/dlib", "C:\\\\...\\\\Azure.CodeSigning.Dlib.dll",
                  "/dmdf", "C:\\\\...\\\\metadata.json", "{arquivo}"]
    }

Sem esse arquivo o build continua funcionando: sai sem assinatura, do jeito
que sai hoje. Nao assinar nunca pode quebrar a entrega.

O carimbo de tempo (/tr) nao e' enfeite: sem ele, todo exe ja' distribuido
passa a dar erro de assinatura no dia em que o certificado vencer. Com ele, a
assinatura continua valida porque prova que foi feita enquanto o certificado
valia.
"""

import json
import os
import subprocess

TIMESTAMP_PADRAO = "http://timestamp.digicert.com"


def _pasta_da_chave():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Concrestats")


ARQUIVO_CONFIG = os.path.join(_pasta_da_chave(), "assinatura_exe.json")


def achar_signtool():
    """O signtool vem no Windows SDK, numa pasta com o numero da versao no
    nome. Pega a mais nova, que e' a que entende os algoritmos atuais."""
    candidatos = []
    for raiz in (r"C:\Program Files (x86)\Windows Kits\10\bin",
                 r"C:\Program Files\Windows Kits\10\bin"):
        if not os.path.isdir(raiz):
            continue
        for versao in sorted(os.listdir(raiz), reverse=True):
            p = os.path.join(raiz, versao, "x64", "signtool.exe")
            if os.path.isfile(p):
                candidatos.append(p)
    alternativo = (r"C:\Program Files (x86)\Windows Kits\10"
                   r"\App Certification Kit\signtool.exe")
    if os.path.isfile(alternativo):
        candidatos.append(alternativo)
    return candidatos[0] if candidatos else None


def ler_config():
    if not os.path.isfile(ARQUIVO_CONFIG):
        return None
    try:
        with open(ARQUIVO_CONFIG, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:  # noqa: BLE001
        raise SystemExit("assinatura_exe.json ilegivel: %s" % e)


def _montar_comando(cfg, exe):
    if cfg.get("modo") == "comando":
        bruto = cfg.get("comando") or []
        if not bruto:
            return None, "modo 'comando' sem a chave 'comando'"
        return [str(x).replace("{arquivo}", exe) for x in bruto], None

    thumb = (cfg.get("thumbprint") or "").replace(" ", "")
    if not thumb:
        return None, "modo 'token' sem 'thumbprint'"
    st = cfg.get("signtool") or achar_signtool()
    if not st:
        return None, ("nao achei o signtool.exe (instale o Windows SDK, ou "
                      "aponte 'signtool' no assinatura_exe.json)")
    cmd = [st, "sign", "/sha1", thumb, "/fd", "SHA256",
           "/tr", cfg.get("timestamp") or TIMESTAMP_PADRAO, "/td", "SHA256"]
    if cfg.get("descricao"):
        cmd += ["/d", cfg["descricao"]]
    if cfg.get("url"):
        cmd += ["/du", cfg["url"]]
    cmd.append(exe)
    return cmd, None


def assinar(exe):
    """Devolve (estado, mensagem). estado: 'assinado', 'pulado' ou 'erro'.

    'pulado' NAO e' falha: e' o caminho normal enquanto nao ha' certificado.
    """
    if not os.path.isfile(exe):
        return "erro", "nao achei " + exe

    cfg = ler_config()
    if cfg is None:
        return "pulado", ("sem certificado configurado (o exe sai sem "
                          "assinatura, como hoje)")

    cmd, erro = _montar_comando(cfg, exe)
    if erro:
        return "erro", erro

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        saida = ((r.stderr or "") + (r.stdout or "")).strip()
        return "erro", "signtool falhou: " + saida[-400:]

    st = cfg.get("signtool") or achar_signtool()
    if st:
        # Assinar e conferir sao coisas diferentes: o signtool pode terminar
        # com sucesso e o Windows recusar a cadeia mesmo assim.
        v = subprocess.run([st, "verify", "/pa", exe],
                           capture_output=True, text=True)
        if v.returncode != 0:
            saida = ((v.stderr or "") + (v.stdout or "")).strip()
            return "erro", "assinou mas o Windows nao aceitou: " + saida[-400:]

    return "assinado", "assinado e carimbado com a hora"


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Assina um executavel")
    ap.add_argument("exe", help="caminho do .exe")
    a = ap.parse_args()
    estado, msg = assinar(a.exe)
    print("%-9s %s" % (estado + ":", msg))
    return 1 if estado == "erro" else 0


if __name__ == "__main__":
    raise SystemExit(main())
