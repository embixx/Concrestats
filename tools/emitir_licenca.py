"""emitir_licenca.py — gera o arquivo de licença de um cliente.

RODA SÓ NA SUA MÁQUINA. É aqui que vive a chave privada; ela nunca vai junto
com o programa. Quem tiver essa chave consegue emitir licença — trate o arquivo
`chave_privada.txt` como trata a senha do banco.

Uso:
    python tools/emitir_licenca.py --criar-chaves          (uma vez, na vida)
    python tools/emitir_licenca.py "Usinop Concreto" --meses 1
    python tools/emitir_licenca.py "Usinop Concreto" --ate 2027-03-31

Sai um `licenca.key`. Você manda esse arquivo para o cliente; ele coloca na
pasta do programa (ou usa o botão Licença dentro do app).
"""

import argparse
import base64
import datetime
import json
import os
import secrets
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "source"))
import assinatura  # noqa: E402

# A chave privada fica FORA do projeto, de proposito: a pasta do projeto vira
# .rar e vai para quem testa. Um deslize ali entregaria o poder de emitir
# licenca junto com o codigo-fonte.
def _pasta_da_chave():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    pasta = os.path.join(base, "Concrestats")
    os.makedirs(pasta, exist_ok=True)
    return pasta


ARQUIVO_PRIVADA = os.path.join(_pasta_da_chave(), "chave_privada.txt")


def criar_chaves():
    if os.path.exists(ARQUIVO_PRIVADA):
        print("Já existe uma chave privada. Se criar outra, TODAS as licenças")
        print("já emitidas param de funcionar. Apague o arquivo à mão se for isso mesmo:")
        print(" ", ARQUIVO_PRIVADA)
        return 1
    semente = secrets.token_bytes(32)
    publica = assinatura.chave_publica(semente)
    with open(ARQUIVO_PRIVADA, "w", encoding="utf-8") as fh:
        fh.write(base64.b64encode(semente).decode())
    try:
        os.chmod(ARQUIVO_PRIVADA, 0o600)      # so o seu usuario le
    except OSError:
        pass
    print("Chave privada gravada em:", ARQUIVO_PRIVADA)
    print("  -> Fica FORA da pasta do projeto, para nao ir junto no .rar.")
    print("  -> Faca um backup. Sem ela nao da para emitir licenca nova.")
    print("")
    print("Agora cole esta linha no lugar do PUBLICA_AQUI em source/licenca.py:\n")
    print('CHAVE_PUBLICA = base64.b64decode("%s")' % base64.b64encode(publica).decode())
    return 0


def emitir(cliente, vence, plano, observacao):
    if not os.path.exists(ARQUIVO_PRIVADA):
        print("Não achei a chave privada. Rode antes:  --criar-chaves")
        return 1
    with open(ARQUIVO_PRIVADA, encoding="utf-8") as fh:
        semente = base64.b64decode(fh.read().strip())

    dados = {
        "cliente": cliente,
        "vence": vence,
        "plano": plano,
        "emitido": datetime.date.today().isoformat(),
        "id": secrets.token_hex(4),
    }
    if observacao:
        dados["obs"] = observacao

    corpo = json.dumps(dados, sort_keys=True, separators=(",", ":"),
                       ensure_ascii=False).encode("utf-8")
    firma = assinatura.assinar(corpo, semente)
    pacote = {"licenca": dados, "assinatura": base64.b64encode(firma).decode()}
    texto = base64.b64encode(json.dumps(pacote, ensure_ascii=False).encode("utf-8")).decode()

    seguro = "".join(c for c in cliente if c.isalnum() or c in " -_").strip()[:40]
    saida = os.path.join(RAIZ, f"licenca_{seguro.replace(' ', '_')}.key")
    with open(saida, "w", encoding="utf-8") as fh:
        # quebrado em linhas para sobreviver a copiar e colar no WhatsApp
        for i in range(0, len(texto), 76):
            fh.write(texto[i:i + 76] + "\n")

    print("Licença gerada:", saida)
    print("  cliente :", cliente)
    print("  plano   :", plano)
    print("  vence   :", vence)
    print("  id      :", dados["id"])
    print("\nMande esse arquivo para o cliente.")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Emite licença do Concrestats")
    ap.add_argument("cliente", nargs="?", help="nome do cliente (aparece no app)")
    ap.add_argument("--meses", type=int, help="quantos meses a partir de hoje")
    ap.add_argument("--ate", help="data final, no formato 2027-03-31")
    ap.add_argument("--plano", default="mensal", help="mensal, anual, cortesia...")
    ap.add_argument("--obs", default="", help="anotação livre")
    ap.add_argument("--criar-chaves", action="store_true",
                    help="cria o par de chaves (uma vez só, na vida)")
    a = ap.parse_args()

    if a.criar_chaves:
        return criar_chaves()
    if not a.cliente:
        ap.print_help()
        return 1

    if a.ate:
        vence = a.ate
        try:
            datetime.date.fromisoformat(vence)
        except ValueError:
            print("Data inválida. Use 2027-03-31.")
            return 1
    else:
        meses = a.meses or 1
        hoje = datetime.date.today()
        m = hoje.month - 1 + meses
        ano = hoje.year + m // 12
        mes = m % 12 + 1
        dia = min(hoje.day, [31, 29 if ano % 4 == 0 and (ano % 100 != 0 or ano % 400 == 0)
                             else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1])
        vence = datetime.date(ano, mes, dia).isoformat()

    return emitir(a.cliente, vence, a.plano, a.obs)


if __name__ == "__main__":
    raise SystemExit(main())
