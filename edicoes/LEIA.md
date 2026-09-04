# Edições

O mesmo programa, entregue com abas diferentes. Cada arquivo aqui é uma
edição; para aplicar, copie-o para a pasta do executável com o nome
`edicao.json`.

| Arquivo | Quem recebe | O que muda |
|---|---|---|
| `usinop.json` | a usina | sem a aba PAINEL |
| `painel-unico.json` | quando o Naor mandar | sem ANÁLISE e sem DASHBOARD — o Painel faz as duas |
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

## A troca do Painel pelas outras duas

O Naor escreveu: *"Planejo que futuramente o PAINEL substitua ANÁLISE e
DASHBOARD."* O Painel já dá conta das duas:

- **do Dashboard** — o botão *Painel automático* reconhece a planilha do
  laboratório e monta sozinho os mesmos cartões, produção e crescimento, mapa
  de calor, volume por cliente e por produto, e a distribuição da resistência
  contra o fck. O histograma é a **mesma função** que a aba Dashboard usa, não
  uma segunda versão parecida: duas cópias acabariam discordando um dia, e
  quem visse a diferença não saberia em qual acreditar. Conferido nos 4.809
  registros da usina, número por número.
- **da Análise** — clicar numa barra, fatia ou mês filtra o painel inteiro, e
  uma faixa no topo mostra o que está filtrado e desfaz.

Trocar é copiar `painel-unico.json` como `edicao.json`. Para voltar atrás,
apagar o arquivo — nada é perdido, porque as duas abas continuam no programa.

**Ainda não foi feito por padrão**, e de propósito: o próprio Naor disse que o
Painel *"ainda tem mais a mudar"*. Tirar duas abas que funcionam antes de ele
confirmar seria devolver como regressão o que era para ser avanço.
