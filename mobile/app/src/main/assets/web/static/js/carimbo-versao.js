/**
 * carimbo-versao.js — mostra na tela inicial qual build está rodando.
 *
 * Por que isso existe: quatro correções seguidas voltaram como "não funciona
 * no meu computador", e em pelo menos um caso o próprio testador desconfiou
 * ("tentei até reiniciar o PC para ver se não estava lembrando da versão
 * antiga"). Sem um carimbo visível não dá para saber se o conserto não pegou
 * ou se a pasta antiga é que continuou sendo aberta.
 *
 * Fica discreto no rodapé da tela inicial. Um clique copia o texto, para
 * mandar junto quando reportar algo.
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
