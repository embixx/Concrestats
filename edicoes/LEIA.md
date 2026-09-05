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

## Como está hoje (04/09/2026)

O canal **estável esconde o PAINEL de todas as cópias** (`--edicao-para "*"`),
e o canal **teste não esconde nada**.

**O cliente não tem acesso ao canal de teste.** O seletor saiu da tela: o
canal agora é um arquivo `canal.txt` ao lado do executável, e sem ele a cópia
fica no estável. Só quem tem o arquivo vê o seletor, e a rota que troca o
canal recusa quem não tem — esconder o botão não bastaria, bastava chamar a
rota.

Quem testa liga em dois cliques com `Canal_Teste.bat` (e volta com
`Canal_Estavel.bat`). Os dois se recusam a rodar fora da pasta do
`Concrestats.exe`, dizendo qual pasta encontraram.

## Como ligar sem baixar nada (o jeito automático)

A edição pode viajar dentro da própria atualização. A instalação pergunta se
há versão nova, e a resposta — **assinada** — diz também quais abas aquela
cópia mostra. Nada para baixar, nada para colocar em pasta.

Precisa do código de 10 letras da máquina, que aparece na tela de
**Atualização** dela. É o único passo manual, e é inevitável: o programa não
tem como adivinhar qual computador é o da Usinop.

```
python tools/publicar_atualizacao.py --canal estavel --edicao usinop --edicao-para a1b2c3d4e5
python tools/publicar_atualizacao.py --canal teste   --edicao usinop --edicao-para a1b2c3d4e5
git push origin main
```

Nos dois canais, para a máquina receber esteja ela em qual estiver.

Sem `--versao` e sem `--novidades`, o comando **repete o que já está
publicado**. Não é comodidade: versão ou novidades diferentes mudam o
conteúdo do pacote, mudam o hash, e os manifestos passam a apontar um arquivo
que não existe mais — a atualização para de funcionar sem dar erro. E ele
começa das edições já publicadas nos dois canais, então ligar a de uma
máquina nova nunca desliga a de outra.

Na abertura seguinte daquela máquina a aba some, e continua sumida em todas
as atualizações futuras. Para desfazer, publique de novo apontando uma edição
vazia para o mesmo código.

`--edicao-para "*"` vale para todas as instalações daquele canal.

**Por que assinada:** é comportamento mudando por ordem remota. Sem
assinatura, quem trocasse o manifesto no caminho mandaria esconder abas na
máquina de outra pessoa. O teste `test_edicoes.py` tenta exatamente isso — a
edição é trocada depois de assinada — e o programa recusa.

**Por que a assinatura é um campo separado** (`assinatura_edicoes`, e não
junto do corpo do pacote): quem confere o pacote é a cópia **instalada**, que
é antiga por definição. Uma cópia que não conhecesse o campo novo montaria o
corpo sem ele e recusaria a atualização como forjada — travada para sempre,
porque para sair do buraco precisaria justamente atualizar. Assinadas à
parte, as cópias antigas ignoram o campo que não entendem e continuam
atualizando. Há teste para isso.

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
