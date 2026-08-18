# Concrestats — código-fonte reconstruído + build

Este pacote permite **rodar, alterar e reempacotar** o Concrestats em um EXE novo
via PyInstaller. O `app.py` (backend Flask) foi **reconstruído** a partir do
contrato observado do build original; o frontend (`templates/`, `static/`) já
contém **todas as correções** validadas (dashboard, gráficos, relatório, filtros,
performance do grid).

> ⚠️ Importante: o backend foi reconstruído e **não pôde ser compilado/testado no
> ambiente onde foi gerado** (sem Python lá). Antes de distribuir, rode o
> `verify_backend.py` e teste os fluxos na sua máquina.

## Estrutura

```
source/
├── app.py              # backend Flask reconstruído
├── templates/          # index.html (corrigido)
├── static/             # css/js (corrigidos)
├── requirements.txt    # dependências (Flask 3.0.3, pandas, openpyxl, numpy)
├── Concrestats.spec    # configuração do PyInstaller (onedir)
├── build.bat           # cria venv, instala deps e gera o .exe
├── run.bat             # roda em modo dev (python app.py)
└── verify_backend.py   # valida a fidelidade do backend contra o contrato
```

## Pré-requisitos

- **Python 3.11** (mesma série do build original) instalado e no PATH.

## Rodar em desenvolvimento (sem empacotar)

```bat
run.bat
```
Sobe o Flask em http://127.0.0.1:5000 e abre o navegador.

## Validar a fidelidade do backend

Com uma planilha de rompimentos em `uploads/` (ou passe o caminho):

```bat
python verify_backend.py "uploads\Rompimentos 09-25 a 01-26.xlsx"
```
Deve imprimir **RESULTADO: OK** — confirma cabeçalhos com dedup (`TNF 28.1`,
`MPA 28.1`), datas em ISO e números inteiros sem `.0`, exatamente como o frontend
espera.

## Gerar o EXE

```bat
build.bat
```
Saída: `dist\Concrestats\Concrestats.exe` (+ `_internal\`). Copie `uploads\` e
`exports\` para o lado do `.exe` se quiser as pastas já criadas (o app as cria
automaticamente na 1ª execução).

## Contrato replicado (endpoints)

| Método | Rota | Observação |
|---|---|---|
| GET  | `/` | serve o `index.html` |
| POST | `/api/upload` | multipart `file`,`session_id` → `{success,active_sheet,sheets,data:{headers,data}}` |
| POST | `/api/import_merge` | anexa linhas ao sheet alvo *(reconstruído)* |
| POST | `/api/get_sheet` | troca o sheet ativo |
| POST | `/api/new_sheet` | cria sheet vazio |
| POST | `/api/delete_sheet` | remove sheet |
| POST | `/api/save_data` | auto-save do grid (memória) |
| POST | `/api/save_file` | grava no arquivo original *(reconstruído)* |
| POST | `/api/export` | csv/xlsx/html |
| POST | `/api/export_report_custom` | xlsx (`relatorio_<sheet>.xlsx`) / html |
| GET/POST | `/api/receitas` | persiste `receitas.json` *(reconstruído)* |

### Detalhe crítico de fidelidade (já implementado em `app.py`)
A conversão célula→texto replica o build original:
- datas → `YYYY-MM-DD`; vazio/NaN → `""`;
- `8.0` → `"8"` (inteiro sem `.0`), `0.5` → `"0.5"`;
- cabeçalhos duplicados ganham sufixo do pandas (`Data 28` → `Data 28.1`).

## Pontos marcados `# [reconstruído]` (confira)

- **`/api/import_merge`** — anexa as linhas alinhando por nome de coluna.
- **`/api/save_file`** — regrava o arquivo de origem a partir do estado em memória
  (os valores voltam como texto; formatação/tipos originais do Excel não são
  preservados — comportamento esperado de um “salvar dados”).
- **`/api/receitas`** — guarda em `receitas.json` ao lado do executável.

Se algum desses precisar se comportar exatamente como o build antigo, me diga o
comportamento esperado que eu ajusto.

## Console vs. sem janela
O `.spec` está com `console=True` (mostra o log do Flask, igual ao original).
Para um app sem janela de terminal, troque para `console=False` em `Concrestats.spec`.
