# Edições

O mesmo programa, entregue com abas diferentes. Cada arquivo aqui é uma
edição; para aplicar, copie-o para a pasta do executável com o nome
`edicao.json`.

| Arquivo | Quem recebe | O que muda |
|---|---|---|
| `usinop.json` | a usina | sem a aba PAINEL |
| (nenhum) | você e o Naor | tudo |

## Por que não é feito apagando a aba do código

O pacote de atualização substitui `templates/` e `static/` inteiros. Uma aba
removida do arquivo voltaria na primeira atualização automática, sozinha, sem
ninguém entender por quê.

O `edicao.json` fica **fora** dessas duas pastas, então a atualização não o
toca. Conferido: apliquei uma atualização sobre uma instalação com a edição
Usinop e o Painel continuou fora.

## Como conferir qual edição está instalada

Na tela inicial, embaixo da versão, aparece `edição Usinop`. Sem o arquivo,
não aparece nada — que é o caso da sua cópia e da do Naor.
