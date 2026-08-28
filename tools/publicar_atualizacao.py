"""publicar_atualizacao.py — empacota e assina uma atualização.

Gera dois arquivos dentro de `atualizacao/`:
    manifesto.json    o que o app consulta para saber se saiu versão nova
    patch-<data>.zip  as telas novas (js/css/html)

Depois é só subir a pasta `atualizacao/` para o GitHub e o app do Naor passa a
se atualizar sozinho, sem baixar 33 MB de RAR nem trocar pasta na mão.

Uso:
    python tools/publicar_atualizacao.py --novidades "Alertas" "Icone novo"
"""

import argparse
import base64
import datetime
import hashlib
import json
import os
import sys
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "source"))
import assinatura  # noqa: E402

DIST = os.path.join(RAIZ, "source", "dist", "Concrestats", "_internal")
SAIDA = os.path.join(RAIZ, "atualizacao")
USUARIO_GITHUB = "embixx"
REPO_GITHUB = "Concrestats"


def _pasta_da_chave():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Concrestats")


ARQUIVO_PRIVADA = os.path.join(_pasta_da_chave(), "chave_privada.txt")


def empacotar(versao):
    os.makedirs(SAIDA, exist_ok=True)
    nome_zip = "patch-%s.zip" % versao.replace("/", "-").replace(" ", "_").replace(":", "-")
    caminho = os.path.join(SAIDA, nome_zip)
    contados = 0
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for pasta in ("static", "templates"):
            base = os.path.join(DIST, pasta)
            if not os.path.isdir(base):
                continue
            for raiz, _, arquivos in os.walk(base):
                for a in arquivos:
                    inteiro = os.path.join(raiz, a)
                    dentro = os.path.relpath(inteiro, DIST).replace(os.sep, "/")
                    z.write(inteiro, dentro)
                    contados += 1
    return caminho, nome_zip, contados


def main():
    ap = argparse.ArgumentParser(description="Empacota e assina uma atualização")
    ap.add_argument("--versao", default=datetime.datetime.now().strftime("%d/%m/%Y %H:%M"))
    ap.add_argument("--novidades", nargs="*", default=[])
    ap.add_argument("--onde", default="https://trello.com/c/QL8BmY8O",
                    help="para onde mandar quem preferir baixar à mão")
    a = ap.parse_args()

    if not os.path.isdir(DIST):
        print("Compile antes: python -m PyInstaller Concrestats.spec --noconfirm")
        return 1
    if not os.path.exists(ARQUIVO_PRIVADA):
        print("Não achei a chave privada. Rode antes:")
        print("  python tools/emitir_licenca.py --criar-chaves")
        return 1

    caminho, nome_zip, quantos = empacotar(a.versao)
    with open(caminho, "rb") as fh:
        dados = fh.read()
    sha = hashlib.sha256(dados).hexdigest()

    with open(ARQUIVO_PRIVADA, encoding="utf-8") as fh:
        semente = base64.b64decode(fh.read().strip())
    corpo = json.dumps({"versao": a.versao, "sha256": sha},
                       sort_keys=True, separators=(",", ":")).encode("utf-8")
    firma = base64.b64encode(assinatura.assinar(corpo, semente)).decode()

    base_raw = (f"https://raw.githubusercontent.com/{USUARIO_GITHUB}/"
                f"{REPO_GITHUB}/main/atualizacao")
    manifesto = {
        "versao": a.versao,
        "arquivo": f"{base_raw}/{nome_zip}",
        "sha256": sha,
        "assinatura": firma,
        "novidades": a.novidades,
        "onde": a.onde,
    }
    with open(os.path.join(SAIDA, "manifesto.json"), "w", encoding="utf-8") as fh:
        json.dump(manifesto, fh, ensure_ascii=False, indent=2)

    print(f"Pacote: {nome_zip}  ({len(dados)/1024:.0f} KB, {quantos} arquivos)")
    print(f"Versão: {a.versao}")
    print("\nAgora suba a pasta atualizacao/ para o GitHub:")
    print("    git add atualizacao && git commit -m \"atualizacao\" && git push")
    print("\nE, no computador de quem testa, o endereço a configurar é:")
    print(f"    {base_raw}/manifesto.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
