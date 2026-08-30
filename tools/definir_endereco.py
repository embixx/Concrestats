"""definir_endereco.py — aponta os aplicativos para onde as atualizacoes moram.

O endereco aparece em TRES lugares (o servidor Python, a tela do Android e o
publicador). Editar na mao os tres e' pedir para um ficar para tras, e um
endereco desencontrado nao da' erro: da' "nao consegui verificar", que parece
falta de internet.

    python tools/definir_endereco.py embixx/concrestats-atualizacoes
"""

import io
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ALVOS = [
    (os.path.join(RAIZ, "source", "app.py"), "python"),
    (os.path.join(RAIZ, "tools", "publicar_atualizacao.py"), "publicador"),
    (os.path.join(RAIZ, "mobile", "app", "src", "main", "assets", "web",
                  "static", "js", "atualizar-apk.js"), "android"),
]


def trocar(caminho, usuario, repo):
    if not os.path.exists(caminho):
        return None
    texto = io.open(caminho, encoding="utf-8").read()
    original = texto

    # o endereco cru, em qualquer um dos formatos usados
    texto = re.sub(r"raw\.githubusercontent\.com/[^/\s\"']+/[^/\s\"']+/",
                   "raw.githubusercontent.com/%s/%s/" % (usuario, repo), texto)
    # as constantes do publicador
    texto = re.sub(r'^USUARIO_GITHUB = "[^"]*"',
                   'USUARIO_GITHUB = "%s"' % usuario, texto, flags=re.M)
    texto = re.sub(r'^REPO_GITHUB = "[^"]*"',
                   'REPO_GITHUB = "%s"' % repo, texto, flags=re.M)

    if texto != original:
        io.open(caminho, "w", encoding="utf-8").write(texto)

    # Confere o RESULTADO. "Nao mudou nada" pode significar duas coisas
    # opostas: ja' estava certo, ou o padrao nao casou e o arquivo ficou para
    # tras. Supor a primeira e' como este mecanismo falha calado.
    alvo = "%s/%s/" % (usuario, repo)
    alvo = "%s/%s/" % (usuario, repo)
    base = "raw.githubusercontent.com/"
    # Contagem em vez de regex: quantos enderecos existem no arquivo, e
    # quantos apontam para o lugar certo. Se os numeros nao batem, sobrou um
    # antigo — e um endereco desencontrado nao da erro, da "nao consegui
    # verificar", que parece falta de internet.
    total = texto.count(base)
    certos = texto.count(base + alvo)
    # Um endereco montado a partir das constantes ({USUARIO_GITHUB}/...) nunca
    # aparece escrito por inteiro. Conta como certo desde que as constantes
    # estejam certas — o que e' conferido logo abaixo.
    montados = texto.count(base + "{")
    if montados:
        tem_const = ('USUARIO_GITHUB = "%s"' % usuario) in texto and                     ('REPO_GITHUB = "%s"' % repo) in texto
        if not tem_const:
            return "sobrou_antigo"
        certos += montados
    if total == 0:
        return "nao_achou"
    if certos != total:
        return "sobrou_antigo"
    return 1 if texto != original else 0


def main():
    if len(sys.argv) != 2 or "/" not in sys.argv[1]:
        print(__doc__.strip())
        print()
        print("Formato esperado: usuario/repositorio")
        return 1
    usuario, repo = sys.argv[1].split("/", 1)

    mudou = 0
    problemas = 0
    for caminho, nome in ALVOS:
        r = trocar(caminho, usuario, repo)
        if r is None:
            print("  %-12s NAO ACHEI o arquivo (%s)" % (nome, caminho))
            problemas += 1
        elif r == "nao_achou":
            print("  %-12s NAO CONSEGUI TROCAR — o endereco neste arquivo nao esta'"
                  % nome)
            print("  %-12s no formato esperado. Abra e ajuste a mao." % "")
            problemas += 1
        elif r == "sobrou_antigo":
            print("  %-12s TROQUEI EM PARTE — sobrou endereco antigo no arquivo" % nome)
            problemas += 1
        elif r == 1:
            print("  %-12s atualizado" % nome)
            mudou += 1
        else:
            print("  %-12s ja' apontava para la' (conferido)" % nome)

    print()
    print("Endereco que os aplicativos passam a consultar:")
    print("  https://raw.githubusercontent.com/%s/%s/main/atualizacao/manifesto.json"
          % (usuario, repo))
    print()
    if problemas:
        print("ATENCAO: %d arquivo(s) ficaram para tras. Um endereco desencontrado"
              % problemas)
        print("nao da' erro: da' 'nao consegui verificar', que parece falta de internet.")
        print()
    if mudou:
        print("Falta recompilar para o endereco entrar no programa:")
        print("  source" + os.sep + ".venv" + os.sep + "Scripts" + os.sep +
              "python.exe -m PyInstaller Concrestats.spec --noconfirm   (dentro de source)")
        print("  python tools" + os.sep + "sincronizar_mobile.py        (para o APK)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
