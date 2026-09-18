# Concrestats — canal de atualizações

Este repositório serve **só** para o Concrestats se atualizar sozinho. Não há
código-fonte aqui: são dois arquivos de texto e os pacotes de atualização.

```
atualizacao/
  manifesto.json         o que o programa lê para saber se saiu versão nova
  manifesto-teste.json   o mesmo, para quem está no canal de teste
  patch-<data>.zip       as telas e o backend novos
```

## Por que é público

O programa roda na máquina do cliente e precisa ler o manifesto sem usuário
nem senha. Um endereço autenticado obrigaria a embutir a credencial no
programa distribuído, que é o mesmo que publicá-la. Então o canal é público —
e **só o canal**.

## Isso é seguro?

É público para ler, não para escrever. Cada pacote vai assinado (Ed25519), e o
programa **confere a assinatura antes de descompactar**: pacote trocado no
caminho é recusado sem sequer ser aberto. Publicar aqui sem a chave privada
não adianta nada, e a chave privada nunca sai da máquina de quem publica.
