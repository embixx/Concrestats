# Mensalidade e atualização — como usar

Guia curto, para quando você for vender o programa.

## 0. Ligar tudo de uma vez

```
python tools/ligar_atualizacoes.py
```

Faz os cinco passos em sequência: cria o par de chaves, **escreve a chave
pública dentro de `source/licenca.py`**, confere que o programa passou a se
considerar configurado, recompila e assina a primeira atualização. Depois
mostra os comandos de git que faltam.

O passo que ele elimina é o mais perigoso: copiar a chave pública na mão.
Uma letra a menos e o programa compila, roda e recusa toda atualização com
"assinatura não confere" — sem dizer que o problema está na própria chave.

Depois disso falta só publicar:

```
git add atualizacao && git commit -m "primeira atualizacao" && git push
```

O repositório precisa existir e ser **público** — o app lê o arquivo sem
login. Criar repositório é decisão sua; nada aqui faz isso por você.

**Um aviso para quem testa:** a versão que ele tem hoje foi compilada antes
da chave existir, então não consegue validar nada. Ele precisa baixar por
RAR **uma última vez**. Dessa em diante é pelo próprio aplicativo. Sem esse
aviso ele clica em Procurar atualização, não recebe nada, e reporta como
defeito.

As seções abaixo explicam cada passo em separado, para quando algo der
errado no meio.

## 1. Uma vez só, na vida: criar a sua chave

```
python tools/emitir_licenca.py --criar-chaves
```

Isso cria a **chave privada** em `%APPDATA%\Concrestats\chave_privada.txt` —
fora da pasta do projeto de propósito, para não ir junto quando você manda o
código-fonte em `.rar`.

O comando imprime uma linha assim:

```
CHAVE_PUBLICA = base64.b64decode("....")
```

Cole essa linha por cima do `CHAVE_PUBLICA = ...` que está no começo de
`source/licenca.py`, e recompile o programa. Pronto: a mensalidade está ligada.

**Guarde um backup da chave privada.** Sem ela você não emite licença nova.
(As já emitidas continuam valendo até vencer.) E quem tiver essa chave consegue
emitir licença sozinho — trate como a senha do banco.

Enquanto você não fizer esse passo, **a mensalidade fica desligada** e o
programa funciona inteiro. É de propósito: cobrar com a chave errada travaria
o cliente por engano de configuração.

## 1.5. Receber o dinheiro (PIX)

O programa mostra QR e "Copia e Cola" do PIX dentro da própria tela de
mensalidade. Não passa por Stripe nem Mercado Pago: sem taxa por transação,
sem conta de empresa, sem servidor ouvindo webhook. O dinheiro cai direto na
sua conta.

Para ligar, crie `%APPDATA%\Concrestats\recebedor.json`:

```json
{
  "chave": "sua-chave-pix",
  "nome": "Seu Nome ou Empresa",
  "cidade": "Sinop",
  "planos": [
    {"id": "mensal", "titulo": "Mensal", "valor": 89.90,  "meses": 1},
    {"id": "anual",  "titulo": "Anual",  "valor": 899.00, "meses": 12}
  ]
}
```

A chave pode ser CPF, CNPJ, e-mail, telefone (com +55) ou aleatória. Nome
até 25 caracteres e cidade até 15, sem acento — é limite do padrão do Banco
Central, e o programa corta sozinho se passar.

**Enquanto esse arquivo não existir, a tela de pagamento simplesmente não
aparece.** Botão de pagar que não recebe é pior do que não ter botão.

### O que este sistema NÃO faz

Ele não confere se o pagamento caiu. O fluxo é manual e tem três passos:

1. O cliente paga pelo QR ou pelo Copia e Cola
2. Manda o comprovante para você
3. Você emite a licença (seção 2) e envia o `licenca.key`

Conferência automática exigiria API de cobrança PIX do banco, com certificado
mTLS e um endereço público para receber o aviso. Vale a pena quando houver
volume. Para uma ou duas vendas por ano, o WhatsApp resolve.

O código de cobrança é montado no formato oficial (EMV/BR Code com CRC16) e
está coberto por `source/tests/test_pagamento.py`, que desmonta o código campo
a campo e confere o CRC contra o vetor oficial da CCITT.

## 2. A cada venda: emitir a licença

```
python tools/emitir_licenca.py "Usinop Concreto" --meses 1
python tools/emitir_licenca.py "Usinop Concreto" --meses 12 --plano anual
python tools/emitir_licenca.py "Cliente X" --ate 2027-03-31 --plano cortesia
```

Sai um arquivo `licenca_Usinop_Concreto.key`. Mande para o cliente por
WhatsApp ou e-mail.

O cliente faz uma das duas coisas:
- coloca o arquivo com o nome `licenca.key` na pasta do programa, ou
- abre o programa → clica no selo no canto superior direito → **Escolher o
  arquivo** (ou **Colar o conteúdo**, se recebeu o texto pelo WhatsApp)

## 3. O que acontece quando vence

| Situação | O que o cliente pode fazer |
|---|---|
| Em dia | tudo |
| Faltam 10 dias ou menos | tudo, com aviso discreto no selo |
| Vencida há até 7 dias | **tudo** — é a cortesia, para quem só esqueceu |
| Vencida há mais de 7 dias | abre, filtra, analisa, imprime. **Não salva nem exporta** |
| Sem licença nenhuma | 15 dias de teste completo, depois vira modo leitura |

A regra que não muda: **o cliente nunca perde acesso aos dados dele**. Um
laboratório trancado fora da própria planilha não paga — desinstala e fala mal.
O que para é gravar e exportar, e a mensagem diz exatamente isso.

Detalhe: atrasar o relógio do Windows não renova nada. O programa guarda a
maior data que já viu.

## 4. Aviso de versão nova (opcional)

O programa sabe checar se saiu versão nova, mas só se você disser onde olhar.
Publique um arquivo JSON em qualquer endereço público:

```json
{
  "versao": "25/08/2026 14:00",
  "onde": "https://trello.com/c/QL8BmY8O",
  "novidades": ["Mensalidade", "Alertas automáticos"]
}
```

Depois, no computador do cliente, grave a preferência `__url_atualizacao`
apontando para esse endereço. Aí o botão **Procurar atualização** (dentro da
janela da mensalidade) passa a avisar quando houver versão nova.

Sem endereço configurado, o botão apenas informa a versão instalada — não
incomoda ninguém.

Por segurança, só `http` e `https` são aceitos, e endereços internos da rede
são recusados.

## 4.5. Quem recebe qual versão

Duas maneiras, que servem a coisas diferentes.

### Canal — o do dia a dia

Cada instalação escolhe um canal na tela de Atualização:

| Canal | Quem fica nele | O que recebe |
|---|---|---|
| Estável | o cliente | só o que já passou por quem testa |
| Teste | quem testa | as versões novas primeiro |

Publicar num canal não mexe no outro, porque cada um é um arquivo separado:

```
python tools/publicar_atualizacao.py --canal teste --novidades "Distribuicao refeita"
python tools/publicar_atualizacao.py --canal estavel --novidades "Distribuicao refeita"
```

O primeiro comando gera `manifesto-teste.json`, o segundo `manifesto.json`.
Quem está no estável nunca chega a ler o de teste.

### Liberado para — o controle fino

Serve para mandar uma correção para **uma pessoa** antes de soltar para o
resto. Cada instalação tem um código de 10 letras, que aparece na própria
tela de Atualização e é copiado com um clique. Peça o código e use:

```
python tools/publicar_atualizacao.py --somente 238b103c49 a1b2c3d4e5
```

Só essas duas instalações recebem. As outras veem "existe uma versão mais
nova, mas ela foi liberada só para algumas instalações" — o programa não
mente dizendo que estão na mais recente.

O código não é o nome nem o e-mail de ninguém: são caracteres sorteados na
primeira vez que o programa roda, guardados nas preferências daquela máquina.

**A lista viaja dentro da assinatura.** Ela não é uma barreira de segurança
(a assinatura é que garante que o pacote é seu), mas se ficasse de fora
alguém poderia apagá-la de um manifesto legítimo e empurrar para o cliente
uma versão que estava liberada só para quem testa. Isso está coberto por
teste: `source/tests/test_atualizador.py` tenta apagar, acrescentar e trocar
a lista, e as três tentativas quebram a assinatura.

## 5. Como isso resiste a fraude

A licença é assinada com **Ed25519**. O programa carrega apenas a chave
**pública**: ela confere assinaturas, mas não cria nenhuma. Editar a data de
vencimento no arquivo, trocar o nome do cliente ou fabricar uma licença do zero
não funciona — a assinatura deixa de bater e o programa recusa.

Isso está coberto por teste: `source/tests/test_licenca.py` tenta cada uma
dessas fraudes e confere que todas são recusadas. E `assinatura.py` é validado
contra os vetores oficiais da RFC 8032.

Nenhuma proteção de software é absoluta contra quem tem tempo e conhecimento
para modificar o executável. O que este desenho garante é que **ninguém fabrica
licença** — e é isso que sustenta a cobrança mensal.
