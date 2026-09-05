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
FONTE_PY = os.path.join(RAIZ, "source")
SAIDA = os.path.join(RAIZ, "atualizacao")
USUARIO_GITHUB = "embixx"
REPO_GITHUB = "Concrestats"


def _pasta_da_chave():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Concrestats")


ARQUIVO_PRIVADA = os.path.join(_pasta_da_chave(), "chave_privada.txt")


# ── envio automatico ────────────────────────────────────────────────────────
# Publicar deixou de ser "gere o pacote e depois lembre de dar push". Lembrar
# era o passo que falhava: o manifesto subia e o pacote nao, ou nada subia e o
# programa continuava anunciando a versao velha.
#
# Push automatico para repositorio PUBLICO significa que ninguem le' o que sai
# antes de sair. Por isso a auditoria abaixo roda sempre, e ela RECUSA o envio
# em vez de avisar — aviso em terminal automatizado ninguem le'.

# A primeira versao desta trava comparava NOME DE ARQUIVO, e falhou: eu copiei
# o .trello.json para dentro de atualizacao/ com o nome "config_trello_copia
# .json" para testar, a lista procurava a string ".trello.json", nao casou, e a
# ferramenta publicou a credencial num repositorio publico.
#
# Nome de arquivo e' escolha de quem cria o arquivo. Conteudo nao. Agora a
# conferencia le' o que vai dentro.

import re as _re

# Coisas que so' existem em credencial, nao em codigo nem em dado de planilha.
PADROES = [
    (_re.compile(r"BEGIN [A-Z ]*PRIVATE KEY"),          "chave privada"),
    (_re.compile(r'"token"\s*:\s*"[A-Za-z0-9]{60,}"'),  "token de API"),
    (_re.compile(r'"key"\s*:\s*"[a-f0-9]{32}"'),        "chave de API"),
    (_re.compile(r"ATATT[A-Za-z0-9_\-]{20,}"),         "token Atlassian"),
    # O token que o Trello gera hoje comeca com ATTA, nao ATATT. Eu tinha
    # assumido o formato errado — a trava deixaria passar o token de verdade
    # deste projeto. Achado ao ver um token real, nao lendo o codigo.
    (_re.compile(r"ATTA[A-Fa-f0-9]{60,}"),           "token Trello"),
    (_re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),       "token GitHub"),
    (_re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"),    "token Slack"),
    (_re.compile(r"AKIA[0-9A-Z]{16}"),              "chave AWS"),
    (_re.compile(r"-----BEGIN OPENSSH PRIVATE"),        "chave SSH"),
]

EXTENSOES_DE_DADOS = (".xlsx", ".xls", ".csv", ".concre", ".key", ".pem")

# O pacote de atualizacao so' pode conter isto. Qualquer outra coisa e' engano.
PERMITIDO_EM_ATUALIZACAO = (".json", ".zip", ".md")


def _auditar_envio(raiz):
    """Le' o CONTEUDO do que esta' prestes a subir. Devolve a lista de achados."""
    import subprocess
    achados = []

    r = subprocess.run(["git", "diff", "--cached", "--name-only"],
                       cwd=raiz, capture_output=True, text=True)
    arquivos = [x.strip() for x in (r.stdout or "").splitlines() if x.strip()]

    for f in arquivos:
        baixo = f.lower()

        # 1. o que NAO pertence a uma pasta de atualizacao
        if baixo.startswith("atualizacao/") and not baixo.endswith(PERMITIDO_EM_ATUALIZACAO):
            achados.append("nao deveria estar em atualizacao/: " + f)
        if baixo.endswith(EXTENSOES_DE_DADOS):
            achados.append("planilha ou chave: " + f)

        # 2. o que esta' escrito dentro
        caminho = os.path.join(raiz, f)
        if not os.path.isfile(caminho) or os.path.getsize(caminho) > 4 * 1024 * 1024:
            continue
        try:
            with open(caminho, "rb") as fh:
                bruto = fh.read().decode("utf-8", "ignore")
        except OSError:
            continue
        for padrao, oque in PADROES:
            if padrao.search(bruto):
                achados.append("%s dentro de %s" % (oque, f))
                break
    return achados


def _auditar_pacote(caminho_zip):
    """Le' o conteudo DO PACOTE, que e' o que chega na maquina das pessoas.

    A auditoria de cima olha os arquivos do git. Nao servia para isto por dois
    motivos: ela so' roda no caminho --enviar, que esta' desligado, e nunca
    olhou DENTRO do zip. Enquanto o pacote levava so' telas isso era pouco;
    agora ele leva os .py que vao rodar la'.
    """
    achados = []
    with zipfile.ZipFile(caminho_zip) as z:
        for nome in z.namelist():
            if nome.endswith("/"):
                continue
            info = z.getinfo(nome)
            if info.file_size > 4 * 1024 * 1024:
                continue
            try:
                bruto = z.read(nome).decode("utf-8", "ignore")
            except Exception:  # noqa: BLE001
                continue
            for padrao, oque in PADROES:
                if padrao.search(bruto):
                    achados.append("%s dentro de %s" % (oque, nome))
                    break
    return achados


def enviar(raiz, versao, canal):
    """Registra e publica o pacote. Devolve (ok, mensagem)."""
    import subprocess

    def git(*args):
        return subprocess.run(["git"] + list(args), cwd=raiz,
                              capture_output=True, text=True)

    if git("rev-parse", "--git-dir").returncode != 0:
        return False, "isto nao e' um repositorio git — publique a mao"

    git("add", "atualizacao")
    if not (git("diff", "--cached", "--name-only").stdout or "").strip():
        return True, "nada mudou em atualizacao/ — nao havia o que enviar"

    achados = _auditar_envio(raiz)
    if achados:
        git("reset")
        return False, ("RECUSEI ENVIAR. Ia junto algo que nao devia:\n    "
                       + "\n    ".join(achados))

    r = git("commit", "-m", "Atualizacao %s (canal %s)" % (versao, canal))
    if r.returncode != 0 and "nothing to commit" not in (r.stdout or ""):
        return False, "nao consegui registrar: " + (r.stderr or r.stdout)[:200]

    r = git("push", "origin", "HEAD")
    if r.returncode != 0:
        return False, ("registrei aqui mas NAO consegui enviar:\n    "
                       + (r.stderr or r.stdout)[:300]
                       + "\n  Rode 'git push origin main' a mao.")
    return True, "enviado"


def conferir_no_ar(usuario, repo, canal, versao):
    """Le' do endereco publico e confere que e' mesmo o que acabou de sair."""
    import urllib.request
    nome = "manifesto.json" if canal == "estavel" else "manifesto-%s.json" % canal
    url = ("https://raw.githubusercontent.com/%s/%s/main/atualizacao/%s"
           % (usuario, repo, nome))
    try:
        m = json.loads(urllib.request.urlopen(url, timeout=30).read().decode())
    except Exception as e:  # noqa: BLE001
        return False, "nao consegui ler de volta (%s)" % str(e)[:60]
    if m.get("versao") != versao:
        return False, "no ar ainda esta' a versao %s" % m.get("versao")
    try:
        dados = urllib.request.urlopen(m["arquivo"], timeout=40).read(60 * 1024 * 1024)
    except Exception as e:  # noqa: BLE001
        return False, "o manifesto subiu mas o PACOTE nao (%s)" % str(e)[:50]
    import hashlib
    if hashlib.sha256(dados).hexdigest() != m.get("sha256"):
        return False, "o pacote no ar nao confere com o anunciado"
    return True, "conferido no ar: %s, pacote de %.0f KB" % (m["versao"], len(dados) / 1024)


def empacotar(versao, novidades=None, canal="estavel"):
    """Monta o pacote de atualizacao. O MESMO conteudo tem de dar o MESMO
    arquivo, byte a byte.

    Sem isso, publicar dois canais em sequencia quebrava o primeiro: cada
    execucao remontava o zip com carimbo de hora novo, o arquivo mudava, e o
    manifesto ja' escrito passava a apontar um sha256 que nao existia mais. O
    app baixava, conferia, nao batia e recusava a atualizacao - sem erro
    visivel, so' parando de atualizar. Aconteceu em 04/09/2026 com o canal de
    teste.

    Por isso: ordem fixa dos arquivos e data fixa nas entradas. O zip passa a
    ser funcao do conteudo, e nao de quando foi gerado.
    """
    os.makedirs(SAIDA, exist_ok=True)
    # Cada canal tem o seu arquivo. As novidades vao DENTRO do pacote, entao
    # dois canais com textos diferentes geram conteudos diferentes - e dividir
    # o mesmo nome fazia o segundo sobrescrever o primeiro, deixando um
    # manifesto apontando um sha256 que nao existia mais.
    nome_zip = "patch-%s%s.zip" % (
        versao.replace("/", "-").replace(" ", "_").replace(":", "-"),
        "" if canal == "estavel" else "-" + canal)
    caminho = os.path.join(SAIDA, nome_zip)

    # 1980-01-01: o menor carimbo que o formato zip aceita. O valor nao importa,
    # importa ser sempre o mesmo.
    DATA_FIXA = (1980, 1, 1, 0, 0, 0)

    itens = []
    for pasta in ("static", "templates"):
        base = os.path.join(DIST, pasta)
        if not os.path.isdir(base):
            continue
        for raiz, dirs, arquivos in os.walk(base):
            dirs.sort()                       # ordem estavel entre maquinas
            for a in sorted(arquivos):
                inteiro = os.path.join(raiz, a)
                dentro = os.path.relpath(inteiro, DIST).replace(os.sep, "/")
                itens.append((dentro, inteiro))

    # O backend vai junto, em codigo/. Sem isto, corrigir qualquer coisa fora
    # das telas obrigava a pessoa a baixar o programa inteiro de novo, a mao,
    # por um anexo - e uma correcao publicada nao chegava a ninguem ate' alguem
    # lembrar de avisar.
    #
    # principal.py fica de fora de proposito: e' ele que carrega esta pasta e
    # que sabe voltar para o embutido quando o que chegou nao abre. Se pudesse
    # ser substituido, um pacote ruim levaria junto a recuperacao.
    for a in sorted(os.listdir(FONTE_PY)):
        if not a.endswith(".py") or a in ("principal.py", "verify_backend.py"):
            continue
        itens.append(("codigo/" + a, os.path.join(FONTE_PY, a)))

    itens.sort()

    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dentro, inteiro in itens:
            info = zipfile.ZipInfo(dentro, date_time=DATA_FIXA)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            if dentro == "static/versao.json":
                # A VERSAO E' ESCRITA AQUI, nao copiada do disco.
                #
                # Antes havia duas fontes de verdade: o manifesto dizia uma
                # versao e o versao.json dentro do pacote dizia outra, a de
                # quando o programa foi compilado. O aplicativo baixava,
                # aplicava, e ao conferir de novo continuava se vendo
                # desatualizado - oferecendo a mesma atualizacao para sempre,
                # sem nunca dar erro.
                dados = json.dumps({"versao": versao, "novidades": list(novidades or [])},
                                   ensure_ascii=False, indent=2).encode("utf-8")
            else:
                with open(inteiro, "rb") as fh:
                    dados = fh.read()
            z.writestr(info, dados)

    return caminho, nome_zip, len(itens)


def conferir_manifestos(sha_atual, nome_zip):
    """Todo manifesto que aponta para este pacote tem de trazer o hash certo.

    E' a checagem que faltava quando o canal de teste quebrou: o problema so'
    aparecia na maquina de quem ia atualizar, e la' aparecia como nada
    acontecendo.
    """
    problemas = []
    for nome in sorted(os.listdir(SAIDA)):
        if not nome.startswith("manifesto") or not nome.endswith(".json"):
            continue
        try:
            with open(os.path.join(SAIDA, nome), encoding="utf-8") as fh:
                m = json.load(fh)
        except Exception:  # noqa: BLE001
            problemas.append(f"{nome}: nao consegui ler")
            continue
        if not str(m.get("arquivo", "")).endswith(nome_zip):
            continue                      # aponta para outro pacote: nao e' comigo
        if m.get("sha256") != sha_atual:
            problemas.append(
                f"{nome}: aponta para {nome_zip} com sha256 {str(m.get('sha256'))[:12]}..., "
                f"mas o arquivo agora e' {sha_atual[:12]}... "
                f"-> republique este canal, senao a atualizacao dele sera recusada")
    return problemas


def main():
    ap = argparse.ArgumentParser(description="Empacota e assina uma atualização")
    ap.add_argument("--versao", default=None,
                    help="padrao: agora. Com --edicao e sem --versao, repete a "
                         "versao que ja' esta' publicada no canal.")
    ap.add_argument("--novidades", nargs="*", default=[])
    ap.add_argument("--onde", default="https://trello.com/c/QL8BmY8O",
                    help="para onde mandar quem preferir baixar à mão")
    # Desligado por padrao. O envio automatico publicou uma credencial num
    # repositorio publico da primeira vez que foi testado, porque a trava de
    # seguranca comparava nome de arquivo. A trava foi reescrita para comparar
    # conteudo, mas quem religa isso e' o dono do projeto, nao a ferramenta.
    ap.add_argument("--enviar", action="store_true",
                    help="registra e publica automaticamente (confira tools/"
                         "publicar_atualizacao.py antes de usar)")
    ap.add_argument("--canal", default="estavel", choices=["estavel", "teste"],
                    help="teste = só quem está nesse canal recebe (manifesto-teste.json)")
    ap.add_argument("--somente", nargs="*", default=[], metavar="INSTALACAO",
                    help="libera só para estas instalações (o código de 10 letras "
                         "que aparece na tela de Atualização de cada uma)")
    ap.add_argument("--edicao", default=None, metavar="NOME",
                    help="nome do arquivo em edicoes/ (sem .json) a mandar para "
                         "as instalacoes de --edicao-para")
    ap.add_argument("--edicao-para", nargs="*", default=[], metavar="INSTALACAO",
                    help="quais instalacoes recebem a edicao; use * para todas "
                         "as deste canal")
    a = ap.parse_args()

    # Ligar uma edicao nao e' lancar versao. Se a versao e as novidades nao
    # forem as que ja' estao publicadas, o pacote muda de conteudo, muda de
    # hash, e os manifestos passam a apontar um arquivo que nao existe mais -
    # a atualizacao para de funcionar sem dar erro. Entao, por padrao, repete.
    nome_manif = "manifesto.json" if a.canal == "estavel" else f"manifesto-{a.canal}.json"
    publicado = {}
    caminho_manif = os.path.join(SAIDA, nome_manif)
    if os.path.exists(caminho_manif):
        try:
            with open(caminho_manif, encoding="utf-8") as fh:
                publicado = json.load(fh) or {}
        except Exception:  # noqa: BLE001
            publicado = {}
    if a.versao is None:
        a.versao = (publicado.get("versao") if a.edicao else None)             or datetime.datetime.now().strftime("%d/%m/%Y %H:%M")
    if a.edicao and not a.novidades:
        a.novidades = list(publicado.get("novidades") or [])

    if not os.path.isdir(DIST):
        print("Compile antes: python -m PyInstaller Concrestats.spec --noconfirm")
        return 1
    if not os.path.exists(ARQUIVO_PRIVADA):
        print("Não achei a chave privada. Rode antes:")
        print("  python tools/emitir_licenca.py --criar-chaves")
        return 1

    # Edicoes que este manifesto carrega. Vao ASSINADAS: e' comportamento
    # mudando por ordem remota, entao tem de ser comprovadamente nosso.
    edicoes = None
    if a.edicao:
        if not a.edicao_para:
            print("--edicao precisa de --edicao-para (o codigo da instalacao, "
                  "ou * para todas as do canal)")
            return 1
        origem = os.path.join(RAIZ, "edicoes", a.edicao + ".json")
        if not os.path.isfile(origem):
            print("Nao achei " + origem)
            return 1
        with open(origem, encoding="utf-8") as fh:
            cfg = json.load(fh)
        corpo_ed = {"nome": str(cfg.get("nome") or ""),
                    "ocultar": sorted(str(x).strip().lower()
                                      for x in (cfg.get("ocultar") or []))}
        # Comeca do que JA' esta' publicado, nos dois canais: sair do manifesto
        # e' ser desligado na maquina de alguem, e uma instalacao pode ter
        # ganhado a edicao pelo canal de teste e nao constar do estavel.
        edicoes = {}
        for nome in ("manifesto.json", f"manifesto-{a.canal}.json", "manifesto-teste.json"):
            caminho = os.path.join(SAIDA, nome)
            if not os.path.exists(caminho):
                continue
            try:
                with open(caminho, encoding="utf-8") as fh:
                    edicoes.update((json.load(fh) or {}).get("edicoes") or {})
            except Exception:  # noqa: BLE001
                pass
        for x in a.edicao_para:
            edicoes[str(x).strip()] = corpo_ed
    elif a.edicao_para:
        print("--edicao-para sem --edicao nao faz nada")
        return 1

    caminho, nome_zip, quantos = empacotar(a.versao, a.novidades, a.canal)

    # Antes de assinar. Assinar e' o que transforma um arquivo qualquer em algo
    # que a maquina das pessoas aceita e executa - se ha' segredo la' dentro,
    # a assinatura so' garante que o vazamento e' autentico.
    achados = _auditar_pacote(caminho)
    if achados:
        print("PAREI. Ha' coisa que nao pode sair no pacote:")
        for x in achados:
            print("   " + x)
        os.remove(caminho)
        return 1

    with open(caminho, "rb") as fh:
        dados = fh.read()
    sha = hashlib.sha256(dados).hexdigest()

    with open(ARQUIVO_PRIVADA, encoding="utf-8") as fh:
        semente = base64.b64decode(fh.read().strip())
    import atualizador
    corpo = atualizador.corpo_assinado(a.versao, sha, a.somente)
    firma = base64.b64encode(assinatura.assinar(corpo, semente)).decode()
    # As edicoes vao com assinatura PROPRIA, para nao mexer no corpo que as
    # copias ja' instaladas conferem. Ver corpo_das_edicoes().
    firma_edicoes = None
    if edicoes:
        firma_edicoes = base64.b64encode(assinatura.assinar(
            atualizador.corpo_das_edicoes(a.versao, sha, edicoes), semente)).decode()

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
    if edicoes:
        manifesto["edicoes"] = edicoes
        manifesto["assinatura_edicoes"] = firma_edicoes

    # Cada canal e' um arquivo. Quem esta' no canal estavel nunca chega a ler o
    # manifesto de teste, entao publicar um nao mexe no outro.
    nome_manifesto = "manifesto.json" if a.canal == "estavel" else f"manifesto-{a.canal}.json"

    # Uma edicao que sai do manifesto e' uma edicao DESLIGADA na maquina de
    # alguem. Publicar com --edicao para uma instalacao nova, esquecendo as
    # que ja' estavam, devolveria a aba escondida para o cliente antigo - meses
    # depois, sem ninguem relacionar uma coisa com a outra.
    #
    # (Manifesto SEM edicao nenhuma nao mexe em nada: quem ja' aprendeu a sua
    # continua com ela. O risco e' so' quando ha' edicoes e falta alguem.)
    anterior = os.path.join(SAIDA, nome_manifesto)
    if not edicoes and os.path.exists(anterior):
        try:
            with open(anterior, encoding="utf-8") as fh:
                antigas = (json.load(fh) or {}).get("edicoes") or {}
        except Exception:  # noqa: BLE001
            antigas = {}
        if antigas:
            print("ATENCAO: o manifesto anterior deste canal escondia abas para " +
                  ", ".join(sorted(antigas)) + ".")
            print("         Publicar sem --edicao DEVOLVE todas as abas para essas "
                  "instalacoes.")
    if edicoes and os.path.exists(anterior):
        try:
            with open(anterior, encoding="utf-8") as fh:
                antigas = (json.load(fh) or {}).get("edicoes") or {}
        except Exception:  # noqa: BLE001
            antigas = {}
        perdidas = [k for k in antigas if k not in edicoes]
        if perdidas:
            print("ATENCAO: este manifesto deixa de fora " +
                  ", ".join(sorted(perdidas)) +
                  " - essas instalacoes VOLTAM a mostrar todas as abas.")
            print("         Se nao e' isso que voce quer, repita o --edicao-para "
                  "com elas junto.")

    with open(os.path.join(SAIDA, nome_manifesto), "w", encoding="utf-8") as fh:
        json.dump(manifesto, fh, ensure_ascii=False, indent=2)

    # Confere TODOS os manifestos, nao so' o que acabou de ser escrito: o erro
    # que motivou esta checagem quebrava o canal ANTERIOR, nao o atual.
    for aviso in conferir_manifestos(sha, nome_zip):
        print("ATENCAO: " + aviso)

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
    if not a.enviar:
        print()
        print("Gerado, NAO publicado. Para publicar:")
        print("    git add atualizacao && git commit -m atualizacao && git push")
        return 0

    print()
    print("Publicando...")
    ok, msg = enviar(RAIZ, a.versao, a.canal)
    print("  " + msg.replace(chr(10), chr(10) + "  "))
    if not ok:
        return 1
    if msg != "enviado":
        return 0

    # Le de volta do endereco publico e confere. Ja aconteceu de o manifesto
    # subir e o pacote ficar para tras — o programa anunciava versao nova e
    # falhava ao baixar, na maquina de quem usa. Conferir custa dois segundos.
    ok2, msg2 = conferir_no_ar(USUARIO_GITHUB, REPO_GITHUB, a.canal, a.versao)
    print("  " + msg2)
    if not ok2:
        print()
        print("  Saiu daqui, mas o endereco publico ainda nao mostra o")
        print("  esperado. Pode ser demora do GitHub. NAO avise ninguem para")
        print("  atualizar ainda; rode de novo em um minuto para conferir.")
        return 1
    print()
    print("Pronto. Quem estiver no canal %s ja recebe esta versao." % a.canal)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
