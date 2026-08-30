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


def empacotar(versao, novidades=None):
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
                    if dentro == "static/versao.json":
                        # A VERSAO E' ESCRITA AQUI, nao copiada do disco.
                        #
                        # Antes havia duas fontes de verdade: o manifesto dizia
                        # uma versao e o versao.json dentro do pacote dizia
                        # outra, a de quando o programa foi compilado. O
                        # aplicativo baixava, aplicava, e ao conferir de novo
                        # continuava se vendo desatualizado — oferecendo a
                        # mesma atualizacao para sempre, sem nunca dar erro.
                        z.writestr(dentro, json.dumps(
                            {"versao": versao, "novidades": list(novidades or [])},
                            ensure_ascii=False, indent=2))
                    else:
                        z.write(inteiro, dentro)
                    contados += 1
    return caminho, nome_zip, contados


def main():
    ap = argparse.ArgumentParser(description="Empacota e assina uma atualização")
    ap.add_argument("--versao", default=datetime.datetime.now().strftime("%d/%m/%Y %H:%M"))
    ap.add_argument("--novidades", nargs="*", default=[])
    ap.add_argument("--onde", default="https://trello.com/c/QL8BmY8O",
                    help="para onde mandar quem preferir baixar à mão")
    ap.add_argument("--canal", default="estavel", choices=["estavel", "teste"],
                    help="teste = só quem está nesse canal recebe (manifesto-teste.json)")
    ap.add_argument("--somente", nargs="*", default=[], metavar="INSTALACAO",
                    help="libera só para estas instalações (o código de 10 letras "
                         "que aparece na tela de Atualização de cada uma)")
    a = ap.parse_args()

    if not os.path.isdir(DIST):
        print("Compile antes: python -m PyInstaller Concrestats.spec --noconfirm")
        return 1
    if not os.path.exists(ARQUIVO_PRIVADA):
        print("Não achei a chave privada. Rode antes:")
        print("  python tools/emitir_licenca.py --criar-chaves")
        return 1

    caminho, nome_zip, quantos = empacotar(a.versao, a.novidades)
    with open(caminho, "rb") as fh:
        dados = fh.read()
    sha = hashlib.sha256(dados).hexdigest()

    with open(ARQUIVO_PRIVADA, encoding="utf-8") as fh:
        semente = base64.b64decode(fh.read().strip())
    import atualizador
    corpo = atualizador.corpo_assinado(a.versao, sha, a.somente)
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
        "canal": a.canal,
    }
    if a.somente:
        manifesto["liberado_para"] = sorted(x.strip() for x in a.somente)

    # Cada canal e' um arquivo. Quem esta' no canal estavel nunca chega a ler o
    # manifesto de teste, entao publicar um nao mexe no outro.
    nome_manifesto = "manifesto.json" if a.canal == "estavel" else f"manifesto-{a.canal}.json"
    with open(os.path.join(SAIDA, nome_manifesto), "w", encoding="utf-8") as fh:
        json.dump(manifesto, fh, ensure_ascii=False, indent=2)

    # O pacote pode estar sendo ignorado pelo git — foi o que aconteceu na
    # primeira publicacao, por causa de um "*.zip" generico no .gitignore. Os
    # manifestos subiam, a carga nao, e o aplicativo anunciava versao nova para
    # depois falhar ao baixar. Erro caro de achar depois; barato de conferir
    # aqui.
    import subprocess
    try:
        r = subprocess.run(["git", "check-ignore", caminho],
                           cwd=RAIZ, capture_output=True, text=True)
        if r.returncode == 0:
            print()
            print("PARE: o git esta' ignorando o pacote que acabei de gerar.")
            print("  " + nome_zip)
            print("Ele nao vai subir no push, e o programa vai anunciar versao")
            print("nova para depois falhar ao baixar. Acrescente ao .gitignore:")
            print("    !atualizacao/*.zip")
            return 1
    except OSError:
        pass          # sem git por perto, segue: o aviso e' que se perde

    # Confere que o pacote anuncia a mesma versao do manifesto. Se um dia
    # alguem mexer no empacotamento, este teste avisa antes de publicar.
    import zipfile as _zip
    with _zip.ZipFile(caminho) as _z:
        _dentro = json.loads(_z.read("static/versao.json").decode("utf-8"))
    if _dentro.get("versao") != a.versao:
        print()
        print("PARE: o pacote diz estar na versao %s, mas o manifesto anuncia %s."
              % (_dentro.get("versao"), a.versao))
        print("Assim o programa se atualiza e continua se vendo desatualizado.")
        return 1

    print(f"Pacote: {nome_zip}  ({len(dados)/1024:.0f} KB, {quantos} arquivos)")
    print(f"Versão: {a.versao}   Canal: {a.canal}")
    if a.somente:
        print("Liberada SÓ para: " + ", ".join(sorted(a.somente)))
    else:
        print("Liberada para todos que estão no canal " + a.canal)
    print("\nAgora suba a pasta atualizacao/ para o GitHub:")
    print("    git add atualizacao && git commit -m \"atualizacao\" && git push")
    print("\nE, no computador de quem testa, o endereço a configurar é:")
    print(f"    {base_raw}/manifesto.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
