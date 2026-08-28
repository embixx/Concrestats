"""sincronizar_mobile.py — leva as telas do programa de PC para dentro do APK.

O APK reaproveita a MESMA interface do computador: os mesmos .js, .css e o
mesmo index.html. O que muda é só o encanamento — no PC quem responde
`/api/...` é o Python; no Android é o `ponte-mobile.js`, em JavaScript.

Antes isso era copiado na mao, e as duas copias divergiram. Quando isso
acontece, um conserto entra no PC e nao chega no tablet — e quem testa
reporta de novo o mesmo problema, com razao. Este script apaga essa classe
de erro: a versao do APK passa a ser sempre gerada a partir da do PC.

    python tools/sincronizar_mobile.py
"""

import os
import re
import shutil
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEM = os.path.join(RAIZ, "source")
DESTINO = os.path.join(RAIZ, "mobile", "app", "src", "main", "assets", "web")

# Ferramenta de desenvolvimento: nao vai no aplicativo entregue.
NAO_COPIAR = {"testes.js"}

# Existem so' no APK — nao podem ser apagados ao espelhar a pasta.
SO_DO_APK = {"ponte-mobile.js", "toque-tablet.js", "atualizar-apk.js", "mobile.css"}

VIEWPORT = ('<meta name="viewport" content="width=device-width, initial-scale=1, '
            'maximum-scale=1, user-scalable=no, viewport-fit=cover">')


def _telas(html):
    """Adapta o index.html do PC para rodar dentro do WebView do Android."""
    # 1. no APK nao existe servidor: os caminhos viram relativos
    html = html.replace('href="/static/', 'href="static/')
    html = html.replace('src="/static/', 'src="static/')

    # 2. viewport de tablet, respeitando a area segura da tela
    html = re.sub(r'<meta name="viewport"[^>]*>', VIEWPORT, html, count=1)

    # 3. folha de estilo propria do toque, depois da principal
    html = html.replace(
        '<link rel="stylesheet" href="static/css/style.css">',
        '<link rel="stylesheet" href="static/css/style.css">\n'
        '  <link rel="stylesheet" href="static/css/mobile.css">', 1)

    # 4. a ponte precisa existir antes de qualquer tela chamar /api/...
    html = html.replace('<script src="static/js/xlsx.full.min.js"></script>',
                        '<script src="static/js/xlsx.full.min.js"></script>\n'
                        '<script src="static/js/ponte-mobile.js"></script>', 1)

    # 5. mensalidade e carregador do Modo Teste sao coisas do PC
    html = html.replace('<script src="static/js/licenca.js"></script>\n', '')
    html = re.sub(r'<script>\s*//[^\n]*Modo Teste.*?</script>\s*', '',
                  html, flags=re.S)

    # 6. o que so' existe no tablet entra por ultimo
    html = html.replace('</body>',
                        '<script src="static/js/atualizar-apk.js"></script>\n'
                        '<script src="static/js/toque-tablet.js"></script>\n'
                        '</body>', 1)
    return html


def _espelhar(sub):
    """Copia source/static/<sub> para o APK, preservando o que e' so' de la'."""
    de = os.path.join(ORIGEM, "static", sub)
    para = os.path.join(DESTINO, "static", sub)
    os.makedirs(para, exist_ok=True)
    copiados = 0
    for nome in sorted(os.listdir(de)):
        inteiro = os.path.join(de, nome)
        if not os.path.isfile(inteiro) or nome in NAO_COPIAR:
            continue
        shutil.copy2(inteiro, os.path.join(para, nome))
        copiados += 1
    # nada de apagar arquivo que so' existe no APK
    sobrando = [n for n in os.listdir(para)
                if os.path.isfile(os.path.join(para, n))
                and not os.path.exists(os.path.join(de, n))
                and n not in SO_DO_APK]
    return copiados, sobrando


def main():
    if not os.path.isdir(DESTINO):
        print("Nao achei a pasta do APK:", DESTINO)
        return 1

    total, avisos = 0, []
    for sub in ("js", "css"):
        n, sobra = _espelhar(sub)
        total += n
        avisos += [f"static/{sub}/{x}" for x in sobra]
        print(f"static/{sub}: {n} arquivo(s)")

    for solto in ("versao.json", "icone.png"):
        de = os.path.join(ORIGEM, "static", solto)
        if os.path.exists(de):
            shutil.copy2(de, os.path.join(DESTINO, "static", solto))
            print("static/" + solto)

    with open(os.path.join(ORIGEM, "templates", "index.html"), encoding="utf-8") as fh:
        html = _telas(fh.read())
    with open(os.path.join(DESTINO, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)

    # confere o resultado em vez de confiar que deu certo
    problemas = []
    if '"/static/' in html:
        problemas.append("sobrou caminho absoluto /static/ (nao funciona no APK)")
    if "testes.js" in html:
        problemas.append("o Modo Teste vazou para o APK")
    for obrigatorio in ("ponte-mobile.js", "toque-tablet.js", "atualizar-apk.js",
                        "mobile.css", "carimbo-versao.js"):
        if obrigatorio not in html:
            problemas.append("faltou " + obrigatorio)

    print(f"\nindex.html adaptado ({total} arquivos de tela sincronizados)")
    for a in avisos:
        print("  aviso: existe so' no APK e nao tem par no PC ->", a)
    for p in problemas:
        print("  ERRO:", p)
    return 1 if problemas else 0


if __name__ == "__main__":
    raise SystemExit(main())
