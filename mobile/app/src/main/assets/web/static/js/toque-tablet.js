/**
 * toque-tablet.js — o mesmo app, feito para dedo
 *
 * Existe SÓ no APK. A ideia não é mudar o Concrestats, é destravar o que no
 * computador se faz com mouse e no tablet ficaria inalcançável:
 *
 *   - segurar o dedo = botão direito (menu de linha, propriedades do painel,
 *     opções de gráfico). Sem isto, essas funções simplesmente não existem
 *     no tablet
 *   - um toque seleciona a célula; dois toques abrem para editar — assim
 *     rolar a planilha não abre o teclado sem querer
 *   - barra de fórmula com botão de confirmar, porque o "Enter" do teclado
 *     do Android nem sempre aparece
 */
(function () {
  'use strict';
  if (!window.CONCRE_MOBILE) return;

  const TEMPO_SEGURAR = 480;   // ms para valer como "botão direito"
  const TOLERANCIA = 12;       // px de folga: dedo treme

  /* ── segurar o dedo = botão direito ───────────────────────── */
  let timer = null, alvo = null, x0 = 0, y0 = 0, jaAbriu = false;

  function cancelar() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (alvo) { alvo.classList.remove('segurando'); alvo = null; }
  }

  document.addEventListener('touchstart', ev => {
    if (ev.touches.length !== 1) return cancelar();
    const t = ev.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (!el) return;
    // só onde o botão direito faz alguma coisa
    const vale = el.closest('td[data-row], th[data-col], .pan-widget, .graf-container, canvas');
    if (!vale) return;
    x0 = t.clientX; y0 = t.clientY; jaAbriu = false;
    alvo = vale;
    vale.classList.add('segurando');
    timer = setTimeout(() => {
      jaAbriu = true;
      vale.classList.remove('segurando');
      vibrar();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 2,
      }));
    }, TEMPO_SEGURAR);
  }, { passive: true });

  document.addEventListener('touchmove', ev => {
    if (!timer) return;
    const t = ev.touches[0];
    if (Math.abs(t.clientX - x0) > TOLERANCIA || Math.abs(t.clientY - y0) > TOLERANCIA) cancelar();
  }, { passive: true });

  document.addEventListener('touchend', () => {
    // se o menu abriu, o toque não deve mais valer como clique
    if (jaAbriu) { jaAbriu = false; }
    cancelar();
  }, { passive: true });
  document.addEventListener('touchcancel', cancelar, { passive: true });

  function vibrar() {
    try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) {}
  }

  /* ── um toque seleciona, dois editam ──────────────────────── */
  // No dedo, abrir o editor a cada toque faz o teclado subir enquanto a pessoa
  // só queria rolar a planilha. Então o primeiro toque apenas seleciona.
  let ultimaCel = null, ultimoToque = 0;

  document.addEventListener('click', ev => {
    const td = ev.target.closest && ev.target.closest('#table-body td[data-row]');
    if (!td || td.classList.contains('row-num')) return;
    if (td.querySelector('input, textarea')) return;      // já está editando

    const ri = parseInt(td.dataset.row), ci = parseInt(td.dataset.col);
    const agora = Date.now();
    const mesma = ultimaCel && ultimaCel.r === ri && ultimaCel.c === ci;

    if (mesma && agora - ultimoToque < 700) {             // segundo toque: edita
      ultimaCel = null;
      return;                                            // deixa o app abrir o editor
    }
    ultimaCel = { r: ri, c: ci }; ultimoToque = agora;
    ev.stopImmediatePropagation();                        // segura o editor
    ev.preventDefault();
    if (window.selectCell) selectCell(ri, ci);
    mostrarDica();
  }, true);

  let dica = null;
  function mostrarDica() {
    if (!dica) {
      dica = document.createElement('div');
      dica.className = 'toque-dica';
      dica.textContent = 'Toque de novo para editar';
      document.body.appendChild(dica);
    }
    dica.classList.add('vendo');
    clearTimeout(dica._t);
    dica._t = setTimeout(() => dica.classList.remove('vendo'), 1400);
  }

  /* ── barra de fórmula: confirmar sem depender do teclado ──── */
  document.addEventListener('DOMContentLoaded', () => {
    const barra = document.getElementById('formula-input');
    if (!barra || !barra.parentElement) return;
    const ok = document.createElement('button');
    ok.className = 'toque-ok'; ok.type = 'button';
    ok.title = 'Confirmar'; ok.textContent = '✓';
    ok.addEventListener('click', () => {
      barra.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      barra.blur();
    });
    barra.parentElement.appendChild(ok);
  });

  /* ── aviso de como usar, na primeira vez ──────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (localStorage.getItem('concre_dica_toque')) return;
      setTimeout(() => {
        if (window.toast) {
          toast('Dica: segure o dedo numa linha ou num gráfico para abrir as opções', 'info');
          localStorage.setItem('concre_dica_toque', '1');
        }
      }, 2500);
    } catch (e) {}
  });
})();
