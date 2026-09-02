"""colar_token.py — guarda o token do Trello sem voce editar JSON na mao.

    python tools/colar_token.py SEU_TOKEN_AQUI

Confere se o token funciona ANTES de gravar. Token invalido nao entra: melhor
recusar aqui do que so' descobrir quando uma publicacao falhar no meio.
"""

import io
import json
import os
import sys
import urllib.parse
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQUIVO = os.path.join(RAIZ, ".trello.json")


def main():
    if len(sys.argv) != 2:
        print(__doc__.strip())
        return 1
    token = sys.argv[1].strip()

    if len(token) < 60:
        print("Isso tem %d caracteres. O token do Trello tem uns 76." % len(token))
        print("A chave de 32 caracteres e' outra coisa, e ja' esta' guardada.")
        return 1

    with io.open(ARQUIVO, encoding="utf-8") as fh:
        c = json.load(fh)

    q = urllib.parse.urlencode({"key": c["key"], "token": token, "fields": "username"})
    try:
        with urllib.request.urlopen(
                "https://api.trello.com/1/members/me?" + q, timeout=20) as r:
            quem = json.loads(r.read().decode()).get("username", "?")
    except Exception as e:  # noqa: BLE001
        print("O token nao foi aceito pelo Trello (%s)." % str(e)[:60])
        print("Nao gravei nada. Gere outro e tente de novo.")
        return 1

    q2 = urllib.parse.urlencode({"key": c["key"], "token": token, "fields": "name"})
    try:
        with urllib.request.urlopen(
                "https://api.trello.com/1/boards/%s?%s" % (c["board"], q2), timeout=20) as r:
            quadro = json.loads(r.read().decode()).get("name", "?")
    except Exception:  # noqa: BLE001
        quadro = "(nao consegui ler o quadro — confira as permissoes)"

    c["token"] = token
    with io.open(ARQUIVO, "w", encoding="utf-8") as fh:
        json.dump(c, fh, indent=2, ensure_ascii=False)

    print("Guardado.")
    print("  conta  :", quem)
    print("  quadro :", quadro)
    print()
    print("O arquivo continua fora do repositorio (.gitignore).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
