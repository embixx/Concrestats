/**
 * edicao.js — esconde abas que esta cópia não mostra.
 *
 * O mesmo programa é entregue para pessoas diferentes, e nem todas veem as
 * mesmas abas. O Naor pediu a versão da Usinop sem o PAINEL, porque ele ainda
 * vai mudar muito e não quer o cliente usando algo instável.
 *
 * POR QUE ISSO NÃO É FEITO APAGANDO DO index.html: o pacote de atualização
 * substitui templates/ e static/ inteiros. Uma aba removida do arquivo
 * voltaria na primeira atualização automática, sozinha, sem ninguém entender
 * por quê. Aqui a decisão é lida a cada abertura, de um arquivo que a
 * atualização não toca.
 *
 * Três origens, decididas no servidor (ver edicao() em app.py):
 *   1. edicao.json ao lado do executável   { "nome": "Usinop", "ocultar": ["painel"] }
 *   2. a edição compilada dentro do programa
 *   3. a que veio assinada no manifesto de atualização — sem baixar nada
 *
 * Sem nenhuma das três, nada é escondido.
 */
(function () {
  'use strict';

  function esconder(quais) {
    if (!quais || !quais.length) return;

    quais.forEach(function (mod) {
      // o botão da barra de cima
      document.querySelectorAll('.nav-btn[data-module="' + mod + '"]').forEach(function (b) {
        b.remove();
      });
      // qualquer atalho que leve para lá
      document.querySelectorAll('[data-open-module="' + mod + '"]').forEach(function (b) {
        b.remove();
      });
      // e a tela em si, para não sobrar nada alcançável por teclado
      const painel = document.getElementById('module-' + mod) ||
                     document.getElementById(mod + '-module') ||
                     document.getElementById('view-' + mod);
      if (painel) painel.remove();
    });

    // Se a aba escondida era a que estava aberta, cai para a planilha —
    // senão o usuário abre o programa numa tela que não existe mais.
    const ativa = document.querySelector('.nav-btn.active');
    if (!ativa) {
      const primeira = document.querySelector('.nav-btn[data-module="spreadsheet"]') ||
                       document.querySelector('.nav-btn[data-module]');
      if (primeira) primeira.click();
    }
  }

  function marcar(nome) {
    if (!nome) return;
    if (document.querySelector('.empty-edicao')) return;   // ja' esta' na tela
    // deixa registrado na tela qual edição é esta, junto da versão —
    // sem isso, "sumiu uma aba" vira chamado de suporte.
    const carimbo = document.getElementById('empty-versao');
    if (!carimbo) return;
    carimbo.dataset.edicao = nome;
    const marca = document.createElement('span');
    marca.className = 'empty-edicao';
    marca.textContent = 'edição ' + nome;
    carimbo.parentElement.insertBefore(marca, carimbo.nextSibling);
  }

  function aplicar(a) {
    if (!a) return;
    esconder(a.ocultar);
    marcar(a.edicao);
  }

  function ambiente() {
    return fetch('/api/ambiente').then(function (r) { return r.json(); });
  }

  /* A edição também pode chegar pela ATUALIZAÇÃO, sem baixar nada: a resposta
   * assinada do manifesto diz quais abas esta cópia mostra, e o servidor
   * guarda isso. Mas a verificação só acontecia quando alguém abria a tela de
   * Atualização — numa máquina onde ninguém abre essa tela, a edição nunca
   * chegaria. Por isso a busca silenciosa aqui, uma vez por abertura.
   *
   * Na PRIMEIRA abertura depois de a edição ser publicada, a aba aparece por
   * um instante e some. Da segunda em diante já vem escondida, porque o que
   * foi aprendido fica gravado. */
  function buscarEdicaoRemota() {
    return fetch('/api/atualizacao')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.edicao_aplicada) return null;
        return ambiente();
      })
      .catch(function () { return null; });   // sem rede, segue com o que tem
  }

  document.addEventListener('DOMContentLoaded', function () {
    ambiente()
      .then(function (a) {
        aplicar(a);
        return buscarEdicaoRemota();
      })
      .then(aplicar)
      .catch(function () { /* sem resposta, mostra tudo */ });
  });
})();
