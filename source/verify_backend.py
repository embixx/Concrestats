"""
Valida o backend reconstruído contra o CONTRATO observado do build original.

Não precisa subir o servidor: importa o app.py e testa diretamente a conversão
de planilha → payload (headers/data), que é a parte crítica para o frontend.

Uso:
    python verify_backend.py [caminho-da-planilha.xlsx]
(default: uploads/Rompimentos 09-25 a 01-26.xlsx)
"""
import sys
import re

import app as backend  # importa o app.py reconstruído

EXPECTED_HEADERS = [
    "CP", "DATA", "NF", "CLIENTE", "PRODUTO", "RECEITA", "M³", "Data 7",
    "TNF 7", "AREA", "MPA 7", "Data 28", "TNF 28", "TNF 28.1", "MPA 28", "MPA 28.1",
]

path = sys.argv[1] if len(sys.argv) > 1 else "uploads/Rompimentos 09-25 a 01-26.xlsx"

print(f"Lendo: {path}")
sheets = backend.read_any(path, path)
name = next(iter(sheets))
payload = backend.df_to_payload(sheets[name])
headers = payload["headers"]
data = payload["data"]

ok = True

print(f"\nPlanilha ativa: {name}")
print(f"Linhas: {len(data)}  |  Colunas: {len(headers)}")

print("\n[1] Cabeçalhos batem com o contrato?")
if headers == EXPECTED_HEADERS:
    print("    OK")
else:
    ok = False
    print("    DIVERGENTE")
    print("    esperado:", EXPECTED_HEADERS)
    print("    obtido:  ", headers)

# Pega uma linha com dados (CP preenchido) para checar formatação
sample = next((r for r in data if r and r[0].strip()), data[0] if data else [])
print("\n[2] Amostra de linha:")
print("   ", sample)

if sample:
    iso = bool(re.match(r"^\d{4}-\d{2}-\d{2}$", sample[1]))
    print(f"\n[3] DATA em ISO (YYYY-MM-DD)? {'OK' if iso else 'DIVERGENTE -> '+sample[1]}")
    ok = ok and iso

    nf_int = "." not in sample[2]
    print(f"[4] NF inteiro sem .0?         {'OK' if nf_int else 'DIVERGENTE -> '+sample[2]}")
    ok = ok and nf_int

print("\n==============================")
print("RESULTADO:", "OK (fiel ao contrato)" if ok else "DIVERGENTE - revisar app.py")
print("==============================")
sys.exit(0 if ok else 1)
