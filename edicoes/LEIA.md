# Edições

O mesmo programa, entregue com abas diferentes. Cada arquivo aqui é uma edição.

## Como entregar (o jeito normal)

Compile com a edição **dentro** do programa:

```
python tools/build_edicao.py usinop
```

Sai a pasta `_entrega_usinop`, pronta: quem recebe baixa e abre, e a aba já
não está lá. Nada para colocar em pasta nenhuma — que era o passo manual que
falhava calado (arquivo na pasta errada, o app abre normal com a aba no
lugar, e ninguém entende por quê).

A ferramenta confere sozinha, abrindo a edição pela **mesma função** que o
programa usa, fingindo ser o executável recém-compilado. Se o que ele leria
não for o esperado, ela falha e não entrega a pasta.

O build normal (`source/dist`) não é tocado: sai numa pasta própria.

## Como converter uma instalação que já existe

Quando o programa já está na máquina e não vale a pena baixar 97 MB de novo:
`Ativar_Usinop.bat` grava o `edicao.json` na pasta onde está, e **se recusa a
rodar se o `Concrestats.exe` não estiver ali**. O arquivo solto vence a
edição embutida, então também serve para desligar uma.

| Arquivo | Quem recebe | O que muda |
|---|---|---|
| `usinop.json` | a usina | sem a aba PAINEL |
| `painel-unico.json` | quando o Naor mandar | sem ANÁLISE e sem DASHBOARD — o Painel faz as duas |
| (nenhum) | você e o Naor | tudo |

(O Windows esconde a extensão dos arquivos conhecidos, então salvar um
`.json` à mão vira `edicao.json.txt` com facilidade. Por isso o `.bat`, e por
isso o caminho normal é a edição compilada junto.)

## Por que não é feito apagando a aba do código

O pacote de atualização substitui `templates/` e `static/` inteiros. Uma aba
removida do arquivo voltaria na primeira atualização automática, sozinha, sem
ninguém entender por quê.

Tanto o `edicao.json` solto quanto o embutido ficam **fora** dessas duas
pastas — o embutido vai para a raiz do bundle, ao lado do `icon.ico`. A
atualização não os toca.

Conferido de verdade: apliquei o pacote sobre a entrega da Usinop, os 20
arquivos foram trocados, e o programa continuou lendo
`{"nome": "Usinop", "ocultar": ["painel"]}`.

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
