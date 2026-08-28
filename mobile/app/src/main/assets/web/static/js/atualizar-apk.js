/**
 * atualizar-apk.js — aviso de versão nova no tablet.
 *
 * No computador o app troca só as telas (js/css/html) e segue rodando. No
 * Android isso não existe: o sistema exige que a atualização venha como APK
 * assinado, instalado pelo próprio Android. Então aqui o fluxo é outro —
 * o app avisa, baixa o APK e entrega ao instalador do sistema.
 *
 * Existe só no APK.
 */
(function () {
  'use strict';
  if (!window.CONCRE_MOBILE) return;

  const CHAVE_URL = '__url_atualizacao';
  const $ = id => document.getElementById(id);

  async function prefs() {
    try { return await (await fetch('/api/prefs')).json(); } catch (e) { return {}; }
  }

  async function versaoInstalada() {
    try {
      const v = await (await fetch('static/versao.json?t=' + Date.now())).json();
      return (v && v.versao) || '';
    } catch (e) { return ''; }
  }

  async function verificar(silencioso) {
    const p = await prefs();
    const url = p[CHAVE_URL];
    if (!url) {
      if (!silencioso) mostrar('Não há endereço de atualização configurado.', null);
      return null;
    }
    try {
      const m = await (await fetch(url, { cache: 'no-store' })).json();
      const atual = await versaoInstalada();
      const tem = m.versao && m.versao !== atual;
      if (!silencioso || tem) {
        if (tem) {
          mostrar(`Saiu a versão ${m.versao} — você está na ${atual || '—'}.`, true, m);
        } else {
          mostrar('Você já está na versão mais recente.', true);
        }
      }
      return tem ? m : null;
    } catch (e) {
      if (!silencioso) mostrar('Não consegui verificar agora (sem internet?)', false);
      return null;
    }
  }

  function abrir() {
    openModal('Atualização', `
      <p class="atz-ajuda">O programa avisa quando sai uma versão nova e baixa
        para você. Quem instala é o próprio Android, como qualquer aplicativo.</p>
      <div class="atz-acoes">
        <button class="secondary-btn" id="atz-verificar">Procurar atualização</button>
      </div>
      <div id="atz-resultado" class="atz-resultado"></div>`,
      () => closeModal(), 'modal-atualizar');
    setTimeout(() => {
      $('atz-verificar')?.addEventListener('click', () => verificar(false));
      verificar(false);
    }, 40);
  }

  function mostrar(texto, bom, manifesto) {
    const el = $('atz-resultado');
    if (!el) return;
    el.textContent = texto;
    el.className = 'atz-resultado ' + (bom === true ? 'bom' : bom === false ? 'ruim' : '');
    if (manifesto && manifesto.apk) {
      const b = document.createElement('button');
      b.className = 'primary-btn'; b.style.marginTop = '10px';
      b.textContent = 'Baixar e instalar';
      b.addEventListener('click', () => baixar(manifesto.apk, b));
      el.appendChild(document.createElement('br'));
      el.appendChild(b);
    }
    if (manifesto && (manifesto.novidades || []).length) {
      const ul = document.createElement('ul');
      ul.className = 'atz-novidades';
      manifesto.novidades.slice(0, 8).forEach(n => {
        const li = document.createElement('li'); li.textContent = n; ul.appendChild(li);
      });
      el.appendChild(ul);
    }
  }

  function baixar(url, botao) {
    botao.disabled = true; botao.textContent = 'Baixando…';
    // O Android cuida do download e depois abre o instalador do sistema
    if (window.Android && window.Android.baixarApk) {
      window.Android.baixarApk(url);
      botao.textContent = 'Veja a barra de notificações';
    } else {
      window.open(url, '_blank');
      botao.textContent = 'Abrindo o navegador…';
    }
  }

  // Ao abrir o app, olha uma vez por dia — sem incomodar
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
      let ultimo = 0;
      try { ultimo = +(localStorage.getItem('concre_ultima_checagem') || 0); } catch (e) {}
      if (Date.now() - ultimo < 20 * 60 * 60 * 1000) return;
      try { localStorage.setItem('concre_ultima_checagem', String(Date.now())); } catch (e) {}
      const m = await verificar(true);
      if (m && window.toast) {
        toast('Saiu a versão ' + m.versao + ' — toque em Atualização para instalar', 'info');
      }
    }, 4000);
  });

  // botao proprio na barra, para nao ficar escondido
  document.addEventListener('DOMContentLoaded', () => {
    const alvo = document.getElementById('btn-recentes');
    if (!alvo || !alvo.parentElement) return;
    const b = document.createElement('button');
    b.className = 'tool-btn'; b.id = 'btn-atualizar-apk';
    b.title = 'Procurar versão nova do aplicativo';
    b.innerHTML = '<svg viewBox="0 0 16 16"><path d="M8 2.5v7M5.2 6.8L8 9.6l2.8-2.8" ' +
      'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" ' +
      'stroke-linejoin="round"/><path d="M2.8 11.5v1.2a1 1 0 001 1h8.4a1 1 0 001-1v-1.2" ' +
      'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' +
      ' Atualizar';
    b.addEventListener('click', abrir);
    alvo.parentElement.insertBefore(b, alvo.nextSibling);
  });

  window.ConcreAtualizar = { abrir, verificar };
})();
