# -*- coding: utf-8 -*-
"""Monta uma pasta com o codigo-fonte do Concrestats, pronta para mostrar.

    python tools/empacotar_fonte.py
    python tools/empacotar_fonte.py --saida _codigo_fonte

A pasta do projeto tem, misturado com o codigo: credencial do Trello, dados de
planilha de gente de verdade, builds compilados de 97 MB, o ambiente Python
inteiro e anotacoes internas. Copiar "a pasta do projeto" para mostrar a
alguem entrega tudo isso junto.

Aqui a lista e' de INCLUSAO, nao de exclusao: entra o que esta' escrito abaixo
e mais nada. Lista de exclusao erra por omissao — basta eu criar um arquivo
novo e esquecer de acrescentar. Esta erra por falta, que e' visivel: alguem
percebe que um arquivo nao veio, ninguem percebe que uma senha veio.

No fim ela e' auditada: procura credencial e procura o que nao deveria estar
ali. Se achar, nao entrega a pasta.
"""

import argparse
import os
import re
import shutil
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)

from publicar_atualizacao import PADROES  # noqa: E402

# O que entra, e nada mais.
PASTAS = [
    ("source/static", "source/static"),
    ("source/templates", "source/templates"),
    ("source/tests", "source/tests"),
    ("tools", "tools"),
    ("edicoes", "edicoes"),
]
ARQUIVOS = [
    "source/app.py",
    "source/principal.py",
    "source/atualizador.py",
    "source/assinatura.py",
    "source/licenca.py",
    "source/pagamento.py",
    "source/verify_backend.py",
    "source/Concrestats.spec",
    "source/requirements.txt",
    "source/requirements-web.txt",
    "source/README_BUILD.md",
    "source/LEIA-ME-WEB.md",
    "source/build.bat",
    "source/run.bat",
    "source/Procfile",
    "source/runtime.txt",
]

# Nunca, mesmo que caiam dentro de uma pasta da lista acima.
NUNCA = re.compile(
    r"(^|/)(\.git|\.venv|__pycache__|build|dist|build_edicao|node_modules|"
    r"webview_data|copias|uploads|exports)(/|$)"
    r"|\.(pyc|pyo|xlsx|xls|csv|rar|zip|apk|idsig|keystore|jks|key|pem)$"
    r"|(^|/)(prefs|receitas|recebedor|edicao|\.trello)\.json$"
    r"|(^|/)canal\.txt$"
    # Atalhos meus, de clicar duas vezes: trazem o caminho completo desta
    # maquina, com o nome de usuario. Nao sao o programa, sao a minha bancada.
    # (Os .bat de edicoes/ ficam: aqueles sao do produto e usam caminho
    # relativo — vao junto com a copia entregue.)
    r"|^tools/.*\.(bat|ps1)$"
)

# Caminho absoluto de maquina, em qualquer formato. Nao e' segredo, mas mostra
# a bancada de quem escreveu em vez do programa — e envelhece mal: no dia em
# que a pasta mudar de lugar, o arquivo passa a mentir.
CAMINHO_DE_MAQUINA = re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s\"']+", re.I)


def copiar(saida):
    levados = []
    for origem_rel, destino_rel in PASTAS:
        origem = os.path.join(RAIZ, origem_rel)
        if not os.path.isdir(origem):
            continue
        for raiz, dirs, arquivos in os.walk(origem):
            dirs[:] = [d for d in sorted(dirs)
                       if not NUNCA.search((os.path.relpath(os.path.join(raiz, d), RAIZ)
                                            ).replace(os.sep, "/"))]
            for a in sorted(arquivos):
                inteiro = os.path.join(raiz, a)
                rel = os.path.relpath(inteiro, RAIZ).replace(os.sep, "/")
                if NUNCA.search(rel):
                    continue
                destino = os.path.join(saida, rel.replace("/", os.sep))
                os.makedirs(os.path.dirname(destino), exist_ok=True)
                shutil.copy2(inteiro, destino)
                levados.append(rel)
    for rel in ARQUIVOS:
        inteiro = os.path.join(RAIZ, rel.replace("/", os.sep))
        if not os.path.isfile(inteiro):
            continue
        destino = os.path.join(saida, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        shutil.copy2(inteiro, destino)
        levados.append(rel)
    return sorted(levados)


def auditar(saida):
    """Le' o conteudo do que vai ser mostrado. Devolve os problemas."""
    achados = []
    for raiz, _, arquivos in os.walk(saida):
        for a in arquivos:
            caminho = os.path.join(raiz, a)
            rel = os.path.relpath(caminho, saida).replace(os.sep, "/")
            if os.path.getsize(caminho) > 4 * 1024 * 1024:
                continue
            try:
                with open(caminho, "rb") as fh:
                    texto = fh.read().decode("utf-8", "ignore")
            except OSError:
                continue
            # O arquivo que DEFINE os padroes casa com eles: "BEGIN OPENSSH
            # PRIVATE" esta' escrito la' como texto de busca, nao como chave.
            # Isento a linha do _re.compile em vez do arquivo inteiro — isentar
            # o arquivo deixaria de olhar uma credencial de verdade posta ali.
            texto = "\n".join(l for l in texto.splitlines() if "_re.compile(" not in l)
            for padrao, oque in PADROES:
                if padrao.search(texto):
                    achados.append("%s em %s" % (oque, rel))
                    break
            m = CAMINHO_DE_MAQUINA.search(texto)
            if m:
                achados.append("caminho desta maquina (%s) em %s" % (m.group(0), rel))
    return achados


LEIA = """# Concrestats — código-fonte

O programa que gera as análises e os certificados. Windows, roda como
aplicativo de mesa (janela própria, sem navegador).

## Como está organizado

    source/app.py          o servidor: planilhas, filtros, fórmulas, salvar,
                           exportar, licença, atualização
    source/principal.py    o carregador: decide se o programa roda pelo código
                           que veio na atualização ou pelo embutido, e sabe
                           voltar atrás se o que chegou não abrir
    source/atualizador.py  baixa, confere a assinatura e aplica a atualização
    source/assinatura.py   Ed25519 escrito à mão, sem dependência externa,
                           conferido contra os vetores oficiais da RFC 8032
    source/licenca.py      licença e período de teste
    source/pagamento.py    código PIX (padrão EMV do Banco Central)

    source/static/js/      a tela. JavaScript puro, sem framework:
                             app.js        planilha, fórmulas, filtros
                             analise.js    tabela cruzada e gráficos
                             dashboard.js  painel do laboratório
                             painel.js     canvas de blocos que se arrastam
                             relatorio.js  certificado de compressão
                             testes.js     o Modo Teste que roda dentro do app

    source/tests/          testes automáticos do servidor
    tools/                 compilar, publicar, gerar as edições por cliente
    edicoes/               qual cópia mostra quais abas

## Como rodar a partir do código

    cd source
    python -m venv .venv
    .venv\\Scripts\\pip install -r requirements.txt
    .venv\\Scripts\\python principal.py

Ao abrir, o programa pergunta ao servidor de atualização qual edição esta
cópia mostra — e a edição publicada hoje esconde a aba PAINEL. Não é defeito:
é a mesma decisão que vale para as cópias entregues. Para ver todas as abas,
crie um arquivo `canal.txt` ao lado com a palavra `teste`.

## Como compilar

    .venv\\Scripts\\python -m PyInstaller Concrestats.spec --noconfirm

Sai em `source/dist/Concrestats`.

## O que NÃO está aqui

Credenciais, chave de assinatura, planilhas de clientes e os programas já
compilados. Nada disso é código, e não vai junto.
"""


def main():
    ap = argparse.ArgumentParser(description="Monta a pasta de codigo-fonte")
    ap.add_argument("--saida", default="_codigo_fonte")
    a = ap.parse_args()

    saida = os.path.join(RAIZ, a.saida)
    if os.path.exists(saida):
        shutil.rmtree(saida)
    os.makedirs(saida)

    levados = copiar(saida)
    with open(os.path.join(saida, "LEIA-ME.md"), "w", encoding="utf-8") as fh:
        fh.write(LEIA)

    problemas = auditar(saida)
    if problemas:
        print("PAREI. Ha' coisa que nao pode ser mostrada:")
        for p in problemas:
            print("   " + p)
        shutil.rmtree(saida, ignore_errors=True)
        return 1

    tamanho = sum(os.path.getsize(os.path.join(r, f))
                  for r, _, fs in os.walk(saida) for f in fs) / 1024.0
    print("Pronto: %s" % saida)
    print("  %d arquivos, %.0f KB" % (len(levados) + 1, tamanho))
    print("  auditado: nenhuma credencial")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
