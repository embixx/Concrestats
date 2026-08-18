# Concrestats — versão web

O mesmo app, servido no navegador. Serve para o Naor testar sem baixar nada.

## Diferenças em relação ao aplicativo instalado
| Recurso | App instalado | Web |
|---|---|---|
| Abrir / Adicionar arquivo | diálogo do Windows | envio pelo navegador |
| Salvar no arquivo original | sim | **não** (use Exportar para baixar) |
| Recarregar do disco | sim | **não** |
| Arquivos recentes | sim | não (caminhos são locais) |
| Análise, Painel, Gráficos, Relatório | iguais | iguais |

Motivo: na web o "disco" é o do servidor, não o do usuário. Esses recursos ficam
bloqueados no backend (HTTP 403), não só escondidos na tela.

Cada pessoa tem preferências próprias (templates, painéis, campos fixos),
separadas por um identificador guardado no navegador.

## Como publicar (Render, Railway, Fly.io…)
1. Crie o serviço apontando para esta pasta (`source/`).
2. Build:  `pip install -r requirements-web.txt`
3. Start:  `gunicorn app:app --bind 0.0.0.0:$PORT --timeout 120 --workers 1 --threads 4`
   (ou deixe o host usar o `Procfile`)
4. Não defina `CONCRESTATS_WEB=0` — o padrão já é o modo web seguro.

Importante: use **1 worker**. Os dados da planilha ficam na memória do processo;
com vários workers a sessão cairia num processo diferente a cada requisição.

## Rodar em rede local (sem internet)
    set CONCRESTATS_WEB=1
    python -m flask --app app run --host 0.0.0.0 --port 5000
Acesse de outro PC da mesma rede: http://SEU-IP:5000
