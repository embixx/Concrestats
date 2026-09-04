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
 * Quem manda é o edicao.json ao lado do executável:
 *     { "nome": "Usinop", "ocultar": ["painel"] }
 *
 * Sem esse arquivo, nada é escondido.
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

  document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/ambiente')
      .then(function (r) { return r.json(); })
      .then(function (a) {
        if (!a) return;
        esconder(a.ocultar);
        if (a.edicao) {
          // deixa registrado na tela qual edição é esta, junto da versão —
          // sem isso, "sumiu uma aba" vira chamado de suporte.
          const carimbo = document.getElementById('empty-versao');
          if (carimbo) {
            carimbo.dataset.edicao = a.edicao;
            const marca = document.createElement('span');
            marca.className = 'empty-edicao';
            marca.textContent = 'edição ' + a.edicao;
            carimbo.parentElement.insertBefore(marca, carimbo.nextSibling);
          }
        }
      })
      .catch(function () { /* sem resposta, mostra tudo */ });
  });
})();
