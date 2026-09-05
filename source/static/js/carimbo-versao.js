/**
 * carimbo-versao.js — mostra na tela inicial qual build está rodando.
 *
 * Quatro correções seguidas voltaram como "não funciona aqui" — e sem um
 * carimbo na tela não dá pra saber se o conserto não pegou ou se abriram a
 * pasta antiga. Clique copia, pra mandar junto ao reportar.
 */
(function () {
  'use strict';

  function pintar(texto) {
    var el = document.getElementById('empty-versao');
    if (!el) return;
    el.textContent = texto;
    el.hidden = false;
    el.addEventListener('click', function () {
      try {
        navigator.clipboard.writeText(texto);
        if (window.toast) toast('Versão copiada — cole no relato', 'info');
      } catch (e) { /* sem área de transferência: o texto está na tela mesmo */ }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // caminho relativo: vale tanto no Flask quanto dentro do APK
    fetch('static/versao.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (v) {
        if (v && v.versao) pintar('Versão ' + v.versao);
      })
      .catch(function () { /* sem o arquivo, não mostra nada */ });
  });
})();
