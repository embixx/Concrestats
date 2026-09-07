/**
 * sinal-de-vida.js — diz ao programa que a tela continua viva, e em que aba.
 *
 * Por que existe
 * --------------
 * O Naor relatou "o app fica morrendo, acontece a cada algumas trocas de aba".
 * Na hora de investigar, descobri que o programa nao gravava NADA ao morrer:
 * nao havia um arquivo, nem aqui nem na maquina dele, dizendo o que estava
 * acontecendo quando a janela sumiu. Eu corrigi um vazamento que EXPLICA o
 * sintoma, mas sem registro nenhum isso continua sendo deducao.
 *
 * Daqui para a frente fica escrito. Enquanto o programa esta' aberto existe um
 * sessao.json ao lado do exe; fechar pela janela apaga esse arquivo. Se na
 * abertura seguinte ele ainda estiver la', a vez anterior nao terminou — e o
 * que ela estava fazendo (que aba, ha' quanto tempo, qual versao) vai para o
 * quedas.txt, na mesma pasta.
 *
 * O sinal e' de propósito raro (30s): isto e' para saber ONDE o programa
 * estava quando morreu, nao para medir nada com precisao.
 */
(function () {
  'use strict';

  const INTERVALO = 30000;

  function abaAtual() {
    const b = document.querySelector('.nav-btn.active');
    return (b && b.dataset && b.dataset.module) || '';
  }

  function bater() {
    try {
      fetch('/api/sinal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aba: abaAtual() }),
        keepalive: true,
      }).catch(function () { /* sem servidor, nao ha' o que registrar */ });
    } catch (e) { /* idem */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    bater();
    setInterval(bater, INTERVALO);
    // Trocar de aba e' justamente o momento que o Naor descreveu. Vale um sinal
    // fora de hora para o registro apontar a aba certa.
    document.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('.nav-btn[data-module]')) {
        setTimeout(bater, 50);
      }
    }, true);
  });
})();
