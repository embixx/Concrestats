"""ligar_atualizacoes.py — liga a atualizacao automatica, de uma vez.

Antes disto eram cinco passos manuais, e o terceiro (copiar a chave publica
para dentro de licenca.py na mao) era o unico que podia dar errado CALADO: uma
letra a menos e o programa compila, roda, e simplesmente recusa toda
atualizacao com "assinatura nao confere" — sem dizer que o problema esta' na
propria chave.

Aqui a chave vai para o arquivo por escrito, e o resultado e' conferido antes
de seguir.

    python tools/ligar_atualizacoes.py

O que ele faz, em ordem, parando no primeiro erro:

  1. cria o par de chaves, se ainda nao existir
  2. escreve a chave PUBLICA dentro de source/licenca.py
  3. confere que o programa passou a se considerar configurado
  4. recompila o executavel
  5. empacota e assina a primeira atualizacao
  6. mostra os comandos de git que faltam

A chave PRIVADA nunca e' impressa, nunca sai de %APPDATA% e nunca entra no
repositorio. Quem a tiver emite licenca sozinho: trate como senha de banco.
"""

import base64
import os
import re
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "source"))
sys.path.insert(0, os.path.join(RAIZ, "tools"))

LICENCA_PY = os.path.join(RAIZ, "source", "licenca.py")


def passo(n, texto):
    print()
    print(f"[{n}/6] {texto}")


def erro(texto, dica=""):
    print()
    print("PAROU AQUI: " + texto)
    if dica:
        print("  " + dica)
    return 1


def _python():
    """O interpretador do proprio ambiente, para os subprocessos."""
    return sys.executable


def criar_chaves():
    import emitir_licenca
    if os.path.exists(emitir_licenca.ARQUIVO_PRIVADA):
        print("      ja' existe uma chave privada — mantida.")
        print("      (criar outra invalidaria todas as licencas ja' emitidas)")
        return True
    r = subprocess.run([_python(), os.path.join(RAIZ, "tools", "emitir_licenca.py"),
                        "--criar-chaves"], capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout or "", r.stderr or "")
        return False
    print("      chave criada em %APPDATA%\\Concrestats (fora do repositorio)")
    return True


def publica_atual():
    """Le' a chave privada e devolve a publica correspondente, em base64."""
    import assinatura
    import emitir_licenca
    with open(emitir_licenca.ARQUIVO_PRIVADA, encoding="utf-8") as fh:
        semente = base64.b64decode(fh.read().strip())
    return base64.b64encode(assinatura.chave_publica(semente)).decode()


def escrever_publica(b64):
    """Troca a linha CHAVE_PUBLICA de licenca.py. Sem copiar e colar."""
    with open(LICENCA_PY, encoding="utf-8") as fh:
        texto = fh.read()
    nova = 'CHAVE_PUBLICA = base64.b64decode("%s")' % b64
    novo, quantas = re.subn(r'^CHAVE_PUBLICA = base64\.b64decode\("[^"]*"\)',
                            nova.replace("\\", "\\\\"), texto, count=1, flags=re.M)
    if quantas != 1:
        return False
    if novo == texto:
        print("      a chave ja' estava escrita — nada a mudar.")
        return True
    with open(LICENCA_PY, "w", encoding="utf-8") as fh:
        fh.write(novo)
    return True


def conferir_configurada():
    """Roda num processo separado: o modulo ja' pode estar carregado aqui."""
    codigo = ("import sys; sys.path.insert(0, r'%s'); import licenca; "
              "print('OK' if licenca.configurada() and len(licenca.CHAVE_PUBLICA)==32 "
              "else 'NAO')" % os.path.join(RAIZ, "source"))
    r = subprocess.run([_python(), "-c", codigo], capture_output=True, text=True)
    return "OK" in (r.stdout or "")


def main():
    print("=" * 66)
    print("LIGANDO A ATUALIZACAO AUTOMATICA")
    print("=" * 66)

    passo(1, "Par de chaves")
    if not criar_chaves():
        return erro("nao consegui criar o par de chaves.")

    passo(2, "Escrevendo a chave publica em source/licenca.py")
    b64 = publica_atual()
    if not escrever_publica(b64):
        return erro("nao achei a linha CHAVE_PUBLICA em source/licenca.py.",
                    "Se voce mexeu nesse arquivo a mao, devolva a linha ao formato "
                    'CHAVE_PUBLICA = base64.b64decode("...")')
    print("      chave publica gravada (%d caracteres)" % len(b64))

    passo(3, "Conferindo")
    if not conferir_configurada():
        return erro("o programa continua se considerando nao configurado.",
                    "A chave publica precisa ter 32 bytes depois de decodificada.")
    print("      o programa agora se considera configurado")

    passo(4, "Recompilando o executavel")
    spec = os.path.join(RAIZ, "source", "Concrestats.spec")
    r = subprocess.run([_python(), "-m", "PyInstaller", spec, "--noconfirm"],
                       cwd=os.path.join(RAIZ, "source"),
                       capture_output=True, text=True)
    if r.returncode != 0:
        print((r.stdout or "")[-1500:])
        return erro("a compilacao falhou.")
    print("      compilado")

    passo(5, "Empacotando e assinando a primeira atualizacao")
    r = subprocess.run([_python(), os.path.join(RAIZ, "tools", "publicar_atualizacao.py"),
                        "--canal", "teste",
                        "--novidades", "Primeira atualizacao pelo proprio app"],
                       capture_output=True, text=True)
    print("      " + (r.stdout or "").strip().replace("\n", "\n      "))
    if r.returncode != 0:
        return erro("nao consegui empacotar.", (r.stderr or "")[:300])

    passo(6, "Falta so' publicar")
    print("""
      O pacote esta' assinado em atualizacao/. Ele precisa ficar num
      endereco publico para os aplicativos consultarem:

          git add atualizacao
          git commit -m "primeira atualizacao"
          git push -u origin main

      O repositorio https://github.com/embixx/Concrestats precisa existir e
      ser PUBLICO (o app le' o arquivo sem login). Se ainda nao existe, crie
      pelo site e rode o push acima.

      Depois disso, confira que o endereco responde:
          https://raw.githubusercontent.com/embixx/Concrestats/main/atualizacao/manifesto-teste.json
""")

    print("=" * 66)
    print("AVISO QUE VALE MANDAR PARA QUEM TESTA")
    print("=" * 66)
    print("""
  A versao que ele tem hoje foi compilada ANTES desta chave existir, entao
  ela nao consegue validar nada. Ele precisa baixar por RAR UMA ultima vez —
  a build de agora. Dessa em diante e' pelo proprio aplicativo.

  Sem esse aviso ele vai clicar em Procurar atualizacao, nao vai receber
  nada, e vai reportar como defeito.
""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
